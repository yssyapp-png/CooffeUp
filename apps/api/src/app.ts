import Fastify, { type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { calculateTotals, type CartLine } from "@cooffeup/shared";
import { z } from "zod";
import { idempotency, nextReceipt, orders, products, type StoredOrder } from "./store.js";
import { fetchMoyasarPayment, MoyasarError, moyasarConfig, paymentMethodFromSource, validWebhookSecret, type MoyasarConfig, type MoyasarPayment } from "./moyasar.js";
import { createSkylineSync, skylineConfig, type SkylineConfig } from "./skyline.js";

const linesSchema = z.array(z.object({productId:z.string().min(1),quantity:z.number().int().positive().max(99),discount:z.number().int().nonnegative().optional(),notes:z.string().max(250).optional()})).min(1).max(100);
const orderTypeSchema = z.enum(["dine_in", "takeaway", "delivery"]);
const orderSchema = z.object({
  type: orderTypeSchema,
  lines: linesSchema,
  payments: z.array(z.object({method:z.enum(["cash","card","mada","apple_pay","stc_pay"]),amount:z.number().int().positive()})).min(1).max(5)
});
const onlineCheckoutSchema = z.object({type:orderTypeSchema, lines:linesSchema});
const verifySchema = z.object({paymentId:z.string().min(1).max(100)});
const webhookSchema = z.object({type:z.string(), secret_token:z.string().optional(), data:z.object({id:z.string().min(1).max(100)})});

export interface AppOptions {
  fetch?: typeof fetch;
  moyasar?: MoyasarConfig | null;
  skyline?: SkylineConfig | null;
}

const idempotencyKey = (value: unknown) => typeof value === "string" && value.length >= 8 && value.length <= 100 ? value : undefined;

export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", bodyLimit: 256_000, requestIdHeader: "x-request-id" });
  await app.register(helmet);
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(cors, { origin: process.env.WEB_ORIGIN ?? "http://localhost:5173", credentials: true });

  const fetcher = options.fetch ?? fetch;
  const moyasar = options.moyasar === undefined ? moyasarConfig() : options.moyasar ?? undefined;
  const skyline = createSkylineSync(options.skyline === undefined ? skylineConfig() : options.skyline ?? undefined, fetcher);

  type LinesInput = z.infer<typeof linesSchema>;
  function buildCart(lines: LinesInput, reply: FastifyReply): CartLine[] | undefined {
    const cart: CartLine[] = [];
    for (const input of lines) {
      const product = products.get(input.productId);
      if (!product?.active) { reply.code(404).send({error:"PRODUCT_NOT_FOUND",productId:input.productId}); return; }
      if (product.stock < input.quantity) { reply.code(409).send({error:"INSUFFICIENT_STOCK",productId:product.id,available:product.stock}); return; }
      cart.push({productId:product.id,name:product.nameAr,unitPrice:product.price,quantity:input.quantity,taxRateBps:product.taxRateBps,discount:input.discount,notes:input.notes});
    }
    return cart;
  }
  const adjustStock = (order: StoredOrder, sign: 1 | -1) => { for (const line of order.lines) { const product = products.get(line.productId); if (product) product.stock += sign * line.quantity; } };

  app.get("/health", async () => ({ok:true,service:"cooffeup-api",time:new Date().toISOString()}));
  app.get("/api/v1/products", async () => ({data:[...products.values()].filter((p) => p.active)}));
  app.get("/api/v1/orders", async () => ({data:[...orders.values()].slice(-50).reverse()}));

  app.post("/api/v1/orders", async (request, reply) => {
    const key = idempotencyKey(request.headers["idempotency-key"]);
    if (!key) return reply.code(400).send({error:"VALID_IDEMPOTENCY_KEY_REQUIRED"});
    const existing = idempotency.get(key);
    if (existing) return reply.code(200).send({data:existing,replayed:true});
    const parsed = orderSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({error:"INVALID_ORDER",issues:parsed.error.issues});

    const cart = buildCart(parsed.data.lines, reply);
    if (!cart) return reply;
    const totals = calculateTotals(cart);
    const paid = parsed.data.payments.reduce((sum, payment) => sum + payment.amount, 0);
    if (paid < totals.total) return reply.code(422).send({error:"PAYMENT_SHORT",due:totals.total-paid});

    const order: StoredOrder = {
      id:crypto.randomUUID(), receiptNumber:nextReceipt(), type:parsed.data.type, status:"paid",
      lines:cart.map(({productId,quantity,unitPrice,name}) => ({productId,quantity,unitPrice,name})),
      payments:parsed.data.payments, totals, createdAt:new Date().toISOString()
    };
    adjustStock(order, -1);
    orders.set(order.id, order);
    idempotency.set(key, order);
    void skyline.push(order);
    return reply.code(201).send({data:order,change:paid-totals.total});
  });

  // ---- Moyasar online payments ----
  app.post("/api/v1/payments/moyasar/checkout", async (request, reply) => {
    if (!moyasar) return reply.code(503).send({error:"MOYASAR_NOT_CONFIGURED"});
    const key = idempotencyKey(request.headers["idempotency-key"]);
    if (!key) return reply.code(400).send({error:"VALID_IDEMPOTENCY_KEY_REQUIRED"});
    const checkout = (order: StoredOrder) => ({
      orderId:order.id, receiptNumber:order.receiptNumber, amount:order.totals.total, currency:"SAR",
      description:`CooffeUp ${order.receiptNumber}`, publishableKey:moyasar.publishableKey, callbackUrl:moyasar.callbackUrl,
      metadata:{order_id:order.id, receipt:order.receiptNumber}
    });
    const existing = idempotency.get(key);
    if (existing) return reply.code(200).send({data:checkout(existing),replayed:true});
    const parsed = onlineCheckoutSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({error:"INVALID_ORDER",issues:parsed.error.issues});

    const cart = buildCart(parsed.data.lines, reply);
    if (!cart) return reply;
    const totals = calculateTotals(cart);
    if (totals.total < 100) return reply.code(422).send({error:"AMOUNT_BELOW_MINIMUM",minimum:100});

    const order: StoredOrder = {
      id:crypto.randomUUID(), receiptNumber:nextReceipt(), type:parsed.data.type, status:"pending_payment",
      lines:cart.map(({productId,quantity,unitPrice,name}) => ({productId,quantity,unitPrice,name})),
      payments:[], totals, createdAt:new Date().toISOString()
    };
    adjustStock(order, -1); // reserve stock until the payment settles
    orders.set(order.id, order);
    idempotency.set(key, order);
    return reply.code(201).send({data:checkout(order)});
  });

  async function settle(payment: MoyasarPayment): Promise<{code:number;body:Record<string, unknown>}> {
    const order = orders.get(payment.metadata?.order_id ?? "");
    if (!order) return {code:404,body:{error:"ORDER_NOT_FOUND"}};
    const success = payment.status === "paid" || payment.status === "captured";

    if (order.status === "paid") {
      if (order.payments.some((p) => p.reference === payment.id)) return {code:200,body:{data:order}};
      if (success) app.log.error({orderId:order.id,paymentId:payment.id}, "second Moyasar payment for an already paid order; refund required");
      return {code:409,body:{error:"ORDER_ALREADY_PAID",data:order}};
    }
    if (success) {
      if (payment.amount !== order.totals.total || payment.currency !== "SAR") {
        app.log.error({orderId:order.id,paymentId:payment.id,amount:payment.amount}, "Moyasar amount mismatch");
        return {code:422,body:{error:"PAYMENT_AMOUNT_MISMATCH"}};
      }
      if (order.status === "payment_failed") adjustStock(order, -1); // reservation was released; take it again
      order.status = "paid";
      order.payments = [{method:paymentMethodFromSource(payment.source),amount:payment.amount,provider:"moyasar",reference:payment.id}];
      void skyline.push(order);
      return {code:200,body:{data:order}};
    }
    if (payment.status === "failed" && order.status === "pending_payment") {
      order.status = "payment_failed";
      adjustStock(order, 1);
    }
    return {code:order.status === "payment_failed" ? 402 : 202,body:{data:order,paymentStatus:payment.status,message:payment.source?.message}};
  }

  // Called by the web app after Moyasar redirects to the callback URL with ?id=...
  app.post("/api/v1/payments/moyasar/verify", async (request, reply) => {
    if (!moyasar) return reply.code(503).send({error:"MOYASAR_NOT_CONFIGURED"});
    const parsed = verifySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({error:"INVALID_PAYMENT_ID"});
    try {
      const result = await settle(await fetchMoyasarPayment(moyasar, parsed.data.paymentId, fetcher));
      return reply.code(result.code).send(result.body);
    }
    catch (error) { if (error instanceof MoyasarError) return reply.code(error.statusCode).send({error:error.code}); throw error; }
  });

  // Moyasar dashboard → Webhooks: URL = https://<api>/api/v1/webhooks/moyasar, secret = MOYASAR_WEBHOOK_SECRET
  app.post("/api/v1/webhooks/moyasar", {config:{rateLimit:false}}, async (request, reply) => {
    if (!moyasar) return reply.code(503).send({error:"MOYASAR_NOT_CONFIGURED"});
    const parsed = webhookSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({error:"INVALID_WEBHOOK"});
    if (!validWebhookSecret(moyasar.webhookSecret, parsed.data.secret_token)) return reply.code(401).send({error:"INVALID_WEBHOOK_SECRET"});
    try {
      const result = await settle(await fetchMoyasarPayment(moyasar, parsed.data.data.id, fetcher));
      if (result.code >= 400) app.log.warn({paymentId:parsed.data.data.id,result:result.body}, "Moyasar webhook not applied");
      // Acknowledge business-level outcomes so Moyasar does not retry them; only infrastructure errors are retried.
      return reply.code(200).send({received:true});
    } catch (error) {
      if (error instanceof MoyasarError && error.statusCode === 404) return reply.code(200).send({received:true});
      throw error;
    }
  });

  // ---- Skyline sync ----
  app.get("/api/v1/integrations/skyline", async () => ({enabled:skyline.enabled,data:[...skyline.outbox.values()]}));
  app.post<{Params:{orderId:string}}>("/api/v1/integrations/skyline/:orderId/retry", async (request, reply) => {
    if (!skyline.enabled) return reply.code(503).send({error:"SKYLINE_NOT_CONFIGURED"});
    const order = orders.get(request.params.orderId);
    if (order?.status !== "paid") return reply.code(404).send({error:"ORDER_NOT_FOUND"});
    return {data:await skyline.retry(order)};
  });

  return app;
}
