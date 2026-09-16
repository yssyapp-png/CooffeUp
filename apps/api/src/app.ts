import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { calculateTotals } from "@cooffeup/shared";
import { z } from "zod";
import { idempotency, nextReceipt, orders, products, type StoredOrder } from "./store.js";

const orderSchema = z.object({
  type: z.enum(["dine_in", "takeaway", "delivery"]),
  lines: z.array(z.object({productId:z.string().min(1),quantity:z.number().int().positive().max(99),discount:z.number().int().nonnegative().optional(),notes:z.string().max(250).optional()})).min(1).max(100),
  payments: z.array(z.object({method:z.enum(["cash","card","mada","apple_pay","stc_pay"]),amount:z.number().int().positive()})).min(1).max(5)
});

export async function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", bodyLimit: 256_000, requestIdHeader: "x-request-id" });
  await app.register(helmet);
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(cors, { origin: process.env.WEB_ORIGIN ?? "http://localhost:5173", credentials: true });

  app.get("/health", async () => ({ok:true,service:"cooffeup-api",time:new Date().toISOString()}));
  app.get("/api/v1/products", async () => ({data:[...products.values()].filter((p) => p.active)}));
  app.get("/api/v1/orders", async () => ({data:[...orders.values()].slice(-50).reverse()}));

  app.post("/api/v1/orders", async (request, reply) => {
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8 || key.length > 100) return reply.code(400).send({error:"VALID_IDEMPOTENCY_KEY_REQUIRED"});
    const existing = idempotency.get(key);
    if (existing) return reply.code(200).send({data:existing,replayed:true});
    const parsed = orderSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({error:"INVALID_ORDER",issues:parsed.error.issues});

    const cart = [];
    for (const input of parsed.data.lines) {
      const product = products.get(input.productId);
      if (!product?.active) return reply.code(404).send({error:"PRODUCT_NOT_FOUND",productId:input.productId});
      if (product.stock < input.quantity) return reply.code(409).send({error:"INSUFFICIENT_STOCK",productId:product.id,available:product.stock});
      cart.push({productId:product.id,name:product.nameAr,unitPrice:product.price,quantity:input.quantity,taxRateBps:product.taxRateBps,discount:input.discount,notes:input.notes});
    }
    const totals = calculateTotals(cart);
    const paid = parsed.data.payments.reduce((sum, payment) => sum + payment.amount, 0);
    if (paid < totals.total) return reply.code(422).send({error:"PAYMENT_SHORT",due:totals.total-paid});

    for (const line of cart) products.get(line.productId)!.stock -= line.quantity;
    const order: StoredOrder = {
      id:crypto.randomUUID(), receiptNumber:nextReceipt(), type:parsed.data.type, status:"paid",
      lines:cart.map(({productId,quantity,unitPrice,name}) => ({productId,quantity,unitPrice,name})),
      payments:parsed.data.payments, totals, createdAt:new Date().toISOString()
    };
    orders.set(order.id, order);
    idempotency.set(key, order);
    return reply.code(201).send({data:order,change:paid-totals.total});
  });
  return app;
}
