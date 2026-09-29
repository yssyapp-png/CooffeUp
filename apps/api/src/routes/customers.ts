import type { FastifyInstance } from "fastify";
import { customerInsights, maskEmail, maskPhone, normalizeSaudiMobile, promotionSuggestions, SEGMENT_LABELS, type Permission } from "@cooffeup/shared";
import { z } from "zod";
import { actor, audit, fail, guarded, newId, now, parse, staffCan, type AppContext } from "../context.js";
import type { CustomerRecord } from "../store.js";

export function registerCustomerRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store } = ctx;
  const guard = (...permissions: Permission[]) => guarded(ctx, ...permissions);

  const purchasesOf = (customerId: string) => [...store.orders.values()].filter((order) => order.customerId === customerId).map((order) => ({
    total: order.totals.total, createdAt: order.createdAt,
    items: order.lines.map((line) => ({ productId: line.productId, name: line.name, category: line.category, quantity: line.quantity }))
  }));

  /** Phone and email are stored encrypted and only returned in clear to staff allowed to see PII. */
  const present = (customer: CustomerRecord, reveal: boolean) => {
    const phone = customer.phoneEnc ? ctx.crypto.decrypt(customer.phoneEnc) : undefined;
    const email = customer.emailEnc ? ctx.crypto.decrypt(customer.emailEnc) : undefined;
    const insights = customerInsights(purchasesOf(customer.id));
    return {
      id: customer.id, name: customer.name, notes: customer.notes, marketingConsent: customer.marketingConsent, createdAt: customer.createdAt,
      phone: phone && (reveal ? phone : maskPhone(phone)), email: email && (reveal ? email : maskEmail(email)), piiRevealed: reveal,
      insights: { ...insights, segmentLabel: SEGMENT_LABELS[insights.segment] }
    };
  };

  const customerBody = z.object({
    name: z.string().min(2).max(100),
    phone: z.string().max(20).optional(),
    email: z.string().email().max(120).optional(),
    notes: z.string().max(500).optional(),
    marketingConsent: z.boolean().default(false)
  });

  const encodeContact = (body: { phone?: string; email?: string }, selfId?: string) => {
    const result: Partial<CustomerRecord> = {};
    if (body.phone !== undefined) {
      const phone = normalizeSaudiMobile(body.phone) ?? fail(422, "INVALID_SAUDI_MOBILE");
      const index = ctx.crypto.blindIndex(phone);
      if ([...store.customers.values()].some((customer) => customer.id !== selfId && customer.phoneIndex === index)) fail(409, "PHONE_ALREADY_REGISTERED");
      Object.assign(result, { phoneEnc: ctx.crypto.encrypt(phone), phoneIndex: index });
    }
    if (body.email !== undefined) result.emailEnc = ctx.crypto.encrypt(body.email.toLowerCase());
    return result;
  };

  app.get("/api/v1/customers", guard("customers.view"), async (request) => {
    const query = parse(z.object({ q: z.string().max(80).optional() }), request.query);
    const term = query.q?.trim();
    const phone = term ? normalizeSaudiMobile(term) : null;
    const index = phone ? ctx.crypto.blindIndex(phone) : undefined;
    const matches = [...store.customers.values()].filter((customer) =>
      !term || (index ? customer.phoneIndex === index : customer.name.toLowerCase().includes(term.toLowerCase())));
    return { data: matches.slice(0, 100).map((customer) => present(customer, false)) };
  });

  app.get<{ Params: { id: string } }>("/api/v1/customers/:id", guard("customers.view"), async (request) => {
    const customer = store.customers.get(request.params.id) ?? fail(404, "CUSTOMER_NOT_FOUND");
    const query = parse(z.object({ reveal: z.coerce.boolean().default(false) }), request.query);
    const reveal = query.reveal && staffCan(actor(request), "customers.view_pii");
    if (query.reveal && !reveal) fail(403, "FORBIDDEN", { missing: ["customers.view_pii"] });
    if (reveal) audit(ctx, request, "customer.pii_viewed", { type: "customer", id: customer.id });
    const data = present(customer, reveal);
    return { data: { ...data, suggestions: promotionSuggestions(data.insights) } };
  });

  app.post("/api/v1/customers", guard("customers.manage"), async (request, reply) => {
    const body = parse(customerBody, request.body);
    const customer: CustomerRecord = {
      id: newId(), name: body.name, notes: body.notes, marketingConsent: body.marketingConsent, createdAt: now(), createdBy: actor(request).id,
      ...encodeContact(body)
    };
    store.customers.set(customer.id, customer);
    audit(ctx, request, "customer.created", { type: "customer", id: customer.id });
    return reply.code(201).send({ data: present(customer, false) });
  });

  app.patch<{ Params: { id: string } }>("/api/v1/customers/:id", guard("customers.manage"), async (request) => {
    const customer = store.customers.get(request.params.id) ?? fail(404, "CUSTOMER_NOT_FOUND");
    const body = parse(customerBody.partial(), request.body);
    const contact = encodeContact({ phone: body.phone, email: body.email }, customer.id);
    Object.assign(customer, {
      ...(body.name ? { name: body.name } : {}), ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.marketingConsent !== undefined ? { marketingConsent: body.marketingConsent } : {}), ...contact
    });
    audit(ctx, request, "customer.updated", { type: "customer", id: customer.id });
    return { data: present(customer, false) };
  });
}
