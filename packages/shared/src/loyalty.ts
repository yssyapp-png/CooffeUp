import { assertSafeInteger, type Money } from "./money.js";

/**
 * In-house loyalty: one account per customer, points earned on the taxable amount of every paid
 * order, tiers by visit count with a higher earning multiplier, and a free drink for 100 points.
 */
export type LoyaltyTier = "member" | "silver" | "gold" | "platinum";

export const FREE_DRINK_POINTS = 100;

export const LOYALTY_TIER_LABELS: Record<LoyaltyTier, string> = { member: "عضو", silver: "فضي", gold: "ذهبي", platinum: "بلاتيني" };

const TIERS: Array<{ tier: LoyaltyTier; minimumVisits: number; multiplierBps: number }> = [
  { tier: "platinum", minimumVisits: 30, multiplierBps: 15_000 },
  { tier: "gold", minimumVisits: 15, multiplierBps: 12_500 },
  { tier: "silver", minimumVisits: 5, multiplierBps: 11_000 },
  { tier: "member", minimumVisits: 0, multiplierBps: 10_000 }
];

export interface LoyaltySnapshot {
  points: number;
  visits: number;
  tier: LoyaltyTier;
  freeDrinksAvailable: number;
}

export function loyaltyTierForVisits(visits: number): LoyaltyTier {
  assertSafeInteger(visits, "visits");
  if (visits < 0) throw new Error("visits must be non-negative");
  return TIERS.find((entry) => visits >= entry.minimumVisits)!.tier;
}

/** One point per whole riyal before VAT, multiplied by the tier bonus and rounded down. */
export function calculateLoyaltyPoints(taxable: Money, tier: LoyaltyTier): number {
  assertSafeInteger(taxable, "taxable");
  if (taxable < 0) throw new Error("taxable must be non-negative");
  const multiplier = TIERS.find((entry) => entry.tier === tier)!.multiplierBps;
  return Math.floor((Math.floor(taxable / 100) * multiplier) / 10_000);
}

export const loyaltySnapshot = (account: { points: number; visits: number; tier: LoyaltyTier }): LoyaltySnapshot => ({
  points: account.points, visits: account.visits, tier: account.tier, freeDrinksAvailable: Math.floor(account.points / FREE_DRINK_POINTS)
});
