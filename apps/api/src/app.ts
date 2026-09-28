import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { calculateLoyaltyPoints, calculateTotals, FREE_DRINK_POINTS, normalizeSaudiMobile } from "@cooffeup/shared";
import { z } from "zod";
import { getOrCreateLoyaltyAccount, idempotency, idempotencyRequests, loyaltyLedger, loyaltySnapshot, nextReceipt, orders, products, refreshLoyaltyTier, type StoredOrder } from "./store.js";
import { registerOperationsRoutes } from "./operations-routes.js";
import { managerIdentity } from "./manager-approval.js";
import { shifts } from "./operations.js";

const orderSchema = z.object({
  shiftId: z.string().uuid(),
  type: z.enum(["dine_in", "takeaway", "delivery"]),
  customerMobile: z.string().trim().min(9).max(24).optional(),
  redeemReward: z.enum(["free_drink"]).optional(),
  lines: z.array(z.object({productId:z.string().min(1),quantity:z.number().int().positive().max(99),discount:z.number().int().nonnegative().optional(),notes:z.string().max(250).optional()})).min(1).max(100)
    .refine((lines) => new Set(lines.map((line) => line.productId)).size === lines.length, "DUPLICATE_PRODUCT"),
  payments: z.array(z.object({method:z.enum(["cash","card","mada","apple_pay","stc_pay"]),amount:z.number().int().positive().max(100_000_000)})).min(1).max(5)
});

export async function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", bodyLimit: 256_000, requestIdHeader: "x-request-id" });
  await app.register(helmet);
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(cors, { origin: process.env.WEB_ORIGIN ?? "http://localhost:5173", credentials: true });

  app.get("/health", async () => ({ok:true,service:"cooffeup-api",time:new Date().toISOString()}));
  app.get("/api/v1/products", async () => ({data:[...products.values()].filter((p) => p.active)}));
  app.get("/api/v1/orders", async () => ({data:[...orders.values()].slice(-50).reverse()}));
  app.get("/api/v1/customers/:mobile/loyalty", async (request, reply) => {
    const { mobile } = z.object({mobile:z.string().trim().min(9).max(24)}).parse(request.params);
    try { return {data:loyaltySnapshot(getOrCreateLoyaltyAccount(normalizeSaudiMobile(mobile)))}; }
    catch { return reply.code(422).send({error:"INVALID_SAUDI_MOBILE"}); }
  });

  await registerOperationsRoutes(app);

  app.post("/api/v1/orders", async (request, reply) => {
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8 || key.length > 100) return reply.code(400).send({error:"VALID_IDEMPOTENCY_KEY_REQUIRED"});
    const parsed = orderSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({error:"INVALID_ORDER",issues:parsed.error.issues});
    const fingerprint = JSON.stringify(parsed.data);
    const existing = idempotency.get(key);
    if (existing) {
      if (idempotencyRequests.get(key) !== fingerprint) return reply.code(409).send({error:"IDEMPOTENCY_KEY_REUSED"});
      return reply.code(200).send({data:existing,replayed:true});
    }
    const shift = shifts.get(parsed.data.shiftId);
    if (!shift) return reply.code(404).send({error:"SHIFT_NOT_FOUND"});
    if (shift.status !== "open") return reply.code(409).send({error:"SHIFT_CLOSED"});
    const hasManualDiscount = parsed.data.lines.some((line) => (line.discount ?? 0) > 0);
    const discountApprovedBy = hasManualDiscount ? managerIdentity(request) ?? undefined : undefined;
    if (hasManualDiscount && !discountApprovedBy) return reply.code(403).send({error:"MANAGER_APPROVAL_REQUIRED_FOR_DISCOUNT"});

    const cart = [];
    for (const input of parsed.data.lines) {
      const product = products.get(input.productId);
      if (!product?.active) return reply.code(404).send({error:"PRODUCT_NOT_FOUND",productId:input.productId});
      if (product.stock < input.quantity) return reply.code(409).send({error:"INSUFFICIENT_STOCK",productId:product.id,available:product.stock});
      cart.push({productId:product.id,name:product.nameAr,unitPrice:product.price,quantity:input.quantity,taxRateBps:product.taxRateBps,discount:input.discount,notes:input.notes});
    }
    let account;
    try { account = parsed.data.customerMobile ? getOrCreateLoyaltyAccount(normalizeSaudiMobile(parsed.data.customerMobile)) : undefined; }
    catch { return reply.code(422).send({error:"INVALID_SAUDI_MOBILE"}); }
    if (parsed.data.redeemReward && !account) return reply.code(422).send({error:"CUSTOMER_REQUIRED_FOR_REWARD"});
    if (parsed.data.redeemReward === "free_drink") {
      if (account!.points < FREE_DRINK_POINTS) return reply.code(409).send({error:"INSUFFICIENT_LOYALTY_POINTS",required:FREE_DRINK_POINTS,available:account!.points});
      const eligible = cart
        .filter((line) => products.get(line.productId)?.rewardEligible)
        .sort((a,b) => b.unitPrice-a.unitPrice)[0];
      if (!eligible) return reply.code(422).send({error:"NO_REWARD_ELIGIBLE_DRINK"});
      eligible.discount = (eligible.discount ?? 0) + eligible.unitPrice;
    }
    const totals = calculateTotals(cart);
    const paid = parsed.data.payments.reduce((sum, payment) => sum + payment.amount, 0);
    if (paid < totals.total) return reply.code(422).send({error:"PAYMENT_SHORT",due:totals.total-paid});
    const change = paid - totals.total;
    const cashTendered = parsed.data.payments.filter((payment) => payment.method === "cash").reduce((sum, payment) => sum + payment.amount, 0);
    if (change > cashTendered) return reply.code(422).send({error:"NON_CASH_OVERPAYMENT"});

    for (const line of cart) products.get(line.productId)!.stock -= line.quantity;
    const orderId = crypto.randomUUID();
    if (account && parsed.data.redeemReward === "free_drink") {
      account.points -= FREE_DRINK_POINTS;
      loyaltyLedger.push({id:crypto.randomUUID(),customerMobile:account.customerMobile,orderId,type:"redeem",points:-FREE_DRINK_POINTS,createdAt:new Date().toISOString()});
    }
    if (account) {
      account.visits += 1;
      refreshLoyaltyTier(account);
      const earned = calculateLoyaltyPoints(totals.taxable, account.tier);
      account.points += earned;
      account.updatedAt = new Date().toISOString();
      loyaltyLedger.push({id:crypto.randomUUID(),customerMobile:account.customerMobile,orderId,type:"earn",points:earned,createdAt:new Date().toISOString()});
    }
    const order: StoredOrder = {
      id:orderId, receiptNumber:nextReceipt(), type:parsed.data.type, status:"paid", shiftId:parsed.data.shiftId,
      lines:cart.map(({productId,quantity,unitPrice,name,taxRateBps,discount}) => ({productId,quantity,unitPrice,name,taxRateBps,discount:discount ?? 0})),
      payments:parsed.data.payments, change, discountApprovedBy, totals, customerMobile:account?.customerMobile,
      loyalty:account ? loyaltySnapshot(account) : undefined, createdAt:new Date().toISOString()
    };
    orders.set(order.id, order);
    idempotency.set(key, order);
    idempotencyRequests.set(key, fingerprint);
    return reply.code(201).send({data:order,change});
  });
  return app;
}
