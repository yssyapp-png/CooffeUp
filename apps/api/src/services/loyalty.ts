import { calculateLoyaltyPoints, FREE_DRINK_POINTS, loyaltyTierForVisits, type OrderRecord } from "@cooffeup/shared";
import { newId, now, type AppContext } from "../context.js";
import type { LoyaltyAccount, LoyaltyLedgerEntry } from "../store.js";

export function loyaltyAccount(ctx: AppContext, customerId: string): LoyaltyAccount {
  let account = ctx.store.loyalty.get(customerId);
  if (!account) {
    account = { customerId, points: 0, visits: 0, tier: "member", updatedAt: now() };
    ctx.store.loyalty.set(customerId, account);
  }
  return account;
}

function record(ctx: AppContext, account: LoyaltyAccount, orderId: string, type: LoyaltyLedgerEntry["type"], points: number) {
  if (points === 0) return;
  account.points += points;
  account.updatedAt = now();
  ctx.store.loyaltyLedger.push({ id: newId(), customerId: account.customerId, orderId, type, points, createdAt: account.updatedAt });
}

const ledgerSum = (ctx: AppContext, orderId: string, type: LoyaltyLedgerEntry["type"]) =>
  ctx.store.loyaltyLedger.filter((entry) => entry.orderId === orderId && entry.type === type).reduce((sum, entry) => sum + entry.points, 0);

/** Counts the visit, earns points at the new tier's rate and books any redeemed reward. */
export function applyOrderLoyalty(ctx: AppContext, order: OrderRecord, redeemed: boolean) {
  if (!order.customerId) return;
  const account = loyaltyAccount(ctx, order.customerId);
  if (redeemed) record(ctx, account, order.id, "redeem", -FREE_DRINK_POINTS);
  account.visits += 1;
  account.tier = loyaltyTierForVisits(account.visits);
  const earned = calculateLoyaltyPoints(order.totals.taxable, account.tier);
  record(ctx, account, order.id, "earn", earned);
  order.loyalty = { earned, ...(redeemed ? { redeemed: "free_drink" as const, redeemedPoints: FREE_DRINK_POINTS } : {}) };
}

/**
 * Reverses earned points in proportion to the refunded value. A full refund also removes the visit
 * and gives back the points spent on a reward, so a refunded free drink can be redeemed again.
 */
export function reverseOrderLoyalty(ctx: AppContext, order: OrderRecord, refundedTotal: number) {
  if (!order.customerId) return;
  const account = ctx.store.loyalty.get(order.customerId);
  if (!account) return;
  const fullyRefunded = order.status === "refunded";
  const earned = ledgerSum(ctx, order.id, "earn");
  const reversed = -ledgerSum(ctx, order.id, "refund_earn_reversal");
  const target = fullyRefunded || order.totals.total === 0 ? earned : Math.min(earned, Math.floor((earned * refundedTotal) / order.totals.total));
  record(ctx, account, order.id, "refund_earn_reversal", -Math.min(Math.max(0, target - reversed), account.points));
  if (fullyRefunded) {
    const redeemed = -ledgerSum(ctx, order.id, "redeem");
    const restored = ledgerSum(ctx, order.id, "refund_redeem_restore");
    record(ctx, account, order.id, "refund_redeem_restore", Math.max(0, redeemed - restored));
    account.visits = Math.max(0, account.visits - 1);
    account.tier = loyaltyTierForVisits(account.visits);
  }
}
