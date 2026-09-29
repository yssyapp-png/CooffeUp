import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  DELIVERY_PLATFORMS, DELIVERY_PLATFORM_IDS, EXTERNAL_STATUS_LABELS, canTransitionExternal,
  type DeliveryPlatform, type EcommercePlatform, type ExternalOrderStatus, type Permission
} from "@cooffeup/shared";
import { z } from "zod";
import { actor, audit, fail, guarded, HttpError, newId, now, parse, type AppContext } from "../context.js";
import { normalizedDeliveryOrderSchema, parseStoreWebhook } from "../integrations.js";
import { createOrder, priceOrder, refundOrder } from "../services/orders.js";
import { runSyncJob, syncAllProducts } from "../services/store-sync.js";
import { isAllowedOutboundUrl, verifyWebhookSignature } from "../security.js";
import type { ExternalOrder, IntegrationLogEntry, StaffMember } from "../store.js";

const ECOMMERCE = ["zid", "salla"] as const;
const SIGNATURE_HEADERS: Record<EcommercePlatform, string[]> = { salla: ["x-salla-signature", "x-signature"], zid: ["x-zid-signature", "x-signature"] };

/** Orders coming from platforms are booked under a system actor named after the channel. */
const systemActor = (source: string): StaffMember => ({
  id: `system:${source}`, name: source, role: "owner", pinHash: "", grants: [], revokes: [], active: false, failedAttempts: 0, tokenVersion: 0
});

export function registerChannelRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store } = ctx;
  const guard = (...permissions: Permission[]) => guarded(ctx, ...permissions);

  const log = (entry: Omit<IntegrationLogEntry, "id" | "createdAt">) => {
    store.integrationLog.push({ id: newId(), createdAt: now(), ...entry });
    if (store.integrationLog.length > 1000) store.integrationLog.shift();
  };

  const signatureOk = (request: FastifyRequest, secretEnc: string | undefined, headers: string[]) => {
    if (!secretEnc || request.rawBody === undefined) return false;
    const header = headers.map((name) => request.headers[name]).find((value): value is string => typeof value === "string");
    return verifyWebhookSignature(ctx.crypto.decrypt(secretEnc), request.rawBody, header);
  };

  // ---------- Delivery apps: unified order queue ----------
  function acceptExternal(external: ExternalOrder, staff: StaffMember) {
    const payload = external.payload;
    const unmapped = payload.items.filter((item) => !store.productBySku(item.sku)).map((item) => item.sku);
    if (unmapped.length) fail(409, "UNMAPPED_ITEMS", { skus: unmapped });
    const lines = payload.items.map((item) => ({ productId: store.productBySku(item.sku)!.id, quantity: item.quantity, unitPrice: item.unitPrice, notes: item.notes }));
    const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
    const input = { lines, orderDiscount: Math.min(payload.discount, subtotal) };
    const options = { staff, channel: external.platform, branchId: store.settings.fulfilmentBranchId, externalOrderId: payload.externalId, allowNegativeStock: true };
    // The platform collects the money, so the receivable equals our own VAT-correct total.
    const { totals } = priceOrder(ctx, input, options);
    const { order } = createOrder(ctx, { ...input, type: "delivery", payments: [{ method: "delivery_platform", amount: totals.total, reference: payload.externalId }] }, options);
    external.orderId = order.id;
    return order;
  }

  function transition(external: ExternalOrder, status: ExternalOrderStatus, by: string) {
    external.status = status;
    external.updatedAt = now();
    external.history.push({ status, at: external.updatedAt, by });
  }

  app.get("/api/v1/delivery/orders", guard("delivery.manage"), async (request) => {
    const query = parse(z.object({ status: z.enum(Object.keys(EXTERNAL_STATUS_LABELS) as [ExternalOrderStatus, ...ExternalOrderStatus[]]).optional() }), request.query);
    const data = [...store.externalOrders.values()].filter((order) => !query.status || order.status === query.status)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .map((order) => ({ ...order, platformName: DELIVERY_PLATFORMS[order.platform].nameAr, statusLabel: EXTERNAL_STATUS_LABELS[order.status] }));
    return { data };
  });

  app.post<{ Params: { id: string } }>("/api/v1/delivery/orders/:id/status", guard("delivery.manage"), async (request) => {
    const external = store.externalOrders.get(request.params.id) ?? fail(404, "EXTERNAL_ORDER_NOT_FOUND");
    const body = parse(z.object({ status: z.enum(Object.keys(EXTERNAL_STATUS_LABELS) as [ExternalOrderStatus, ...ExternalOrderStatus[]]), reason: z.string().max(200).optional() }), request.body);
    if (!canTransitionExternal(external.status, body.status)) fail(409, "INVALID_STATUS_TRANSITION", { from: external.status, to: body.status });
    if (body.status === "accepted") acceptExternal(external, actor(request));
    if (body.status === "rejected") external.rejectionReason = body.reason ?? "رفض من الفرع";
    if (body.status === "cancelled" && external.orderId) {
      const order = store.orders.get(external.orderId)!;
      const lines = order.lines.filter((line) => line.quantity > line.refundedQuantity).map((line) => ({ productId: line.productId, quantity: line.quantity - line.refundedQuantity }));
      if (lines.length) refundOrder(ctx, order.id, { lines, method: "delivery_platform", reason: body.reason ?? "إلغاء من منصة التوصيل" }, actor(request), order.branchId);
    }
    transition(external, body.status, actor(request).id);
    audit(ctx, request, "delivery.status", { type: "external_order", id: external.id }, { status: body.status });
    return { data: external };
  });

  app.post<{ Params: { platform: string } }>("/api/v1/webhooks/delivery/:platform", { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (request, reply) => {
    const platform = request.params.platform as DeliveryPlatform;
    const connection = store.delivery.get(platform);
    if (!connection?.enabled) return reply.code(404).send({ error: "INTEGRATION_DISABLED" });
    if (!signatureOk(request, connection.webhookSecretEnc, ["x-signature"])) return reply.code(401).send({ error: "INVALID_SIGNATURE" });
    const payload = parse(normalizedDeliveryOrderSchema, request.body);
    const duplicate = [...store.externalOrders.values()].find((order) => order.platform === platform && order.payload.externalId === payload.externalId);
    if (duplicate) return reply.code(200).send({ data: { id: duplicate.id, status: duplicate.status }, duplicate: true });
    const external: ExternalOrder = {
      id: newId(), platform, status: "new", payload: { ...payload, placedAt: payload.placedAt ?? now() },
      receivedAt: now(), updatedAt: now(), history: [{ status: "new", at: now(), by: `system:${platform}` }]
    };
    store.externalOrders.set(external.id, external);
    if (connection.autoAccept) {
      try {
        acceptExternal(external, systemActor(platform));
        transition(external, "accepted", `system:${platform}`);
      } catch (error) {
        // Leave the order in "new" so staff can map the items and accept it manually.
        log({ source: platform, externalId: payload.externalId, event: "auto_accept", status: "failed", message: error instanceof HttpError ? error.code : String(error) });
      }
    }
    log({ source: platform, externalId: payload.externalId, event: "order.received", status: "processed", orderId: external.orderId });
    return reply.code(201).send({ data: { id: external.id, status: external.status } });
  });

  // ---------- Online stores: Zid & Salla ----------
  app.post<{ Params: { platform: string } }>("/api/v1/webhooks/ecommerce/:platform", { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (request, reply) => {
    const platform = request.params.platform as EcommercePlatform;
    if (!ECOMMERCE.includes(platform)) return reply.code(404).send({ error: "UNKNOWN_PLATFORM" });
    const connection = store.ecommerce.get(platform)!;
    if (!connection.enabled) return reply.code(404).send({ error: "INTEGRATION_DISABLED" });
    if (!signatureOk(request, connection.webhookSecretEnc, SIGNATURE_HEADERS[platform])) return reply.code(401).send({ error: "INVALID_SIGNATURE" });
    const event = parseStoreWebhook(platform, request.body);
    const key = `${platform}:${event.externalId}`;
    if (event.kind === "ignored" || !event.externalId) {
      log({ source: platform, externalId: event.externalId, event: "ignored", status: "ignored" });
      return reply.code(202).send({ ignored: true });
    }
    const existing = store.idempotency.get(key);
    if (event.kind === "created") {
      if (existing) return reply.code(200).send({ data: { orderId: existing.id }, duplicate: true });
      const unknown = event.items.filter((item) => !store.productBySku(item.sku)).map((item) => item.sku);
      if (unknown.length || !event.items.length) {
        log({ source: platform, externalId: event.externalId, event: "order.created", status: "failed", message: `رموز منتجات غير معرفة: ${unknown.join(", ") || "لا توجد بنود"}` });
        return reply.code(202).send({ accepted: false, unknownSkus: unknown });
      }
      const lines = event.items.map((item) => ({ productId: store.productBySku(item.sku)!.id, quantity: item.quantity, unitPrice: item.unitPrice || undefined }));
      const options = { staff: systemActor(platform), channel: platform, branchId: store.settings.fulfilmentBranchId, externalOrderId: event.externalId, allowNegativeStock: true };
      const { totals } = priceOrder(ctx, { lines }, options);
      const { order } = createOrder(ctx, { type: "delivery", lines, payments: [{ method: "online", amount: totals.total, reference: event.externalId }] }, options);
      store.idempotency.set(key, order);
      log({ source: platform, externalId: event.externalId, event: "order.created", status: "processed", orderId: order.id });
      return reply.code(201).send({ data: { orderId: order.id, receiptNumber: order.receiptNumber } });
    }
    if (!existing) {
      log({ source: platform, externalId: event.externalId, event: "order.cancelled", status: "ignored", message: "طلب غير مسجل" });
      return reply.code(202).send({ ignored: true });
    }
    const lines = existing.lines.filter((line) => line.quantity > line.refundedQuantity).map((line) => ({ productId: line.productId, quantity: line.quantity - line.refundedQuantity }));
    if (lines.length) refundOrder(ctx, existing.id, { lines, method: "online", reason: `إلغاء من متجر ${platform}` }, systemActor(platform), existing.branchId);
    log({ source: platform, externalId: event.externalId, event: "order.cancelled", status: "processed", orderId: existing.id });
    return reply.code(200).send({ data: { orderId: existing.id, status: existing.status } });
  });

  // ---------- Integration settings ----------
  app.get("/api/v1/integrations", guard("integrations.manage"), async () => ({
    data: {
      ecommerce: [...store.ecommerce.values()].map(({ webhookSecretEnc, accessTokenEnc, ...connection }) => ({
        ...connection, hasWebhookSecret: Boolean(webhookSecretEnc), hasAccessToken: Boolean(accessTokenEnc),
        webhookUrl: `${ctx.config.publicBaseUrl}/api/v1/webhooks/ecommerce/${connection.platform}`
      })),
      delivery: [...store.delivery.values()].map(({ webhookSecretEnc, ...connection }) => ({
        ...connection, nameAr: DELIVERY_PLATFORMS[connection.platform].nameAr, hasWebhookSecret: Boolean(webhookSecretEnc),
        webhookUrl: `${ctx.config.publicBaseUrl}/api/v1/webhooks/delivery/${connection.platform}`
      })),
      syncJobs: [...store.syncJobs.values()].slice(-100).reverse(),
      log: store.integrationLog.slice(-100).reverse()
    }
  }));

  app.put<{ Params: { platform: string } }>("/api/v1/integrations/ecommerce/:platform", guard("integrations.manage"), async (request) => {
    const connection = store.ecommerce.get(request.params.platform as EcommercePlatform) ?? fail(404, "UNKNOWN_PLATFORM");
    const body = parse(z.object({
      enabled: z.boolean(), storeId: z.string().max(80).optional(), webhookSecret: z.string().min(8).max(200).optional(),
      accessToken: z.string().min(8).max(2000).optional(), stockEndpoint: z.string().refine((url) => url.includes("{sku}"), "Must contain {sku}")
        .refine((url) => isAllowedOutboundUrl(url, ctx.config.env === "production"), "A public HTTPS URL is required").optional()
    }), request.body);
    connection.enabled = body.enabled;
    if (body.storeId !== undefined) connection.storeId = body.storeId;
    if (body.stockEndpoint !== undefined) connection.stockEndpoint = body.stockEndpoint;
    if (body.webhookSecret) connection.webhookSecretEnc = ctx.crypto.encrypt(body.webhookSecret);
    if (body.accessToken) connection.accessTokenEnc = ctx.crypto.encrypt(body.accessToken);
    audit(ctx, request, "integration.ecommerce.updated", { type: "integration", id: connection.platform }, { enabled: body.enabled });
    return { data: { platform: connection.platform, enabled: connection.enabled } };
  });

  app.post<{ Params: { platform: string } }>("/api/v1/integrations/ecommerce/:platform/sync", guard("integrations.manage"), async (request) => {
    const platform = request.params.platform as EcommercePlatform;
    if (!store.ecommerce.has(platform)) fail(404, "UNKNOWN_PLATFORM");
    if (!store.ecommerce.get(platform)!.enabled) fail(409, "INTEGRATION_DISABLED");
    return { data: { queued: syncAllProducts(ctx, platform) } };
  });

  app.post<{ Params: { id: string } }>("/api/v1/integrations/sync-jobs/:id/retry", guard("integrations.manage"), async (request) => {
    const job = store.syncJobs.get(request.params.id) ?? fail(404, "SYNC_JOB_NOT_FOUND");
    job.status = "pending";
    await runSyncJob(ctx, job.id);
    return { data: job };
  });

  app.put<{ Params: { platform: string } }>("/api/v1/integrations/delivery/:platform", guard("integrations.manage"), async (request) => {
    if (!DELIVERY_PLATFORM_IDS.includes(request.params.platform as DeliveryPlatform)) fail(404, "UNKNOWN_PLATFORM");
    const connection = store.delivery.get(request.params.platform as DeliveryPlatform)!;
    const body = parse(z.object({
      enabled: z.boolean(), webhookSecret: z.string().min(8).max(200).optional(),
      commissionBps: z.number().int().min(0).max(5_000).optional(), autoAccept: z.boolean().optional()
    }), request.body);
    connection.enabled = body.enabled;
    if (body.webhookSecret) connection.webhookSecretEnc = ctx.crypto.encrypt(body.webhookSecret);
    if (body.commissionBps !== undefined) connection.commissionBps = body.commissionBps;
    if (body.autoAccept !== undefined) connection.autoAccept = body.autoAccept;
    audit(ctx, request, "integration.delivery.updated", { type: "integration", id: connection.platform }, { enabled: body.enabled });
    return { data: { platform: connection.platform, enabled: connection.enabled } };
  });
}
