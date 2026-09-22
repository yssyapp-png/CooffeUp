import { FREE_DRINK_POINTS, loyaltyTierForVisits, type LoyaltySnapshot, type LoyaltyTier, type Product, type PaymentMethod, type OrderType, type Totals } from "@cooffeup/shared";

export interface StoredOrder {
  id: string;
  receiptNumber: string;
  type: OrderType;
  status: "paid";
  shiftId?: string;
  lines: Array<{ productId: string; quantity: number; unitPrice: number; name: string }>;
  payments: Array<{ method: PaymentMethod; amount: number }>;
  totals: Totals;
  customerMobile?: string;
  loyalty?: LoyaltySnapshot;
  createdAt: string;
}

export interface LoyaltyAccount {
  customerMobile: string;
  points: number;
  visits: number;
  tier: LoyaltyTier;
  updatedAt: string;
}

export interface LoyaltyLedgerEntry {
  id: string;
  customerMobile: string;
  orderId: string;
  type: "earn" | "redeem";
  points: number;
  createdAt: string;
}

export const products = new Map<string, Product>([
  ["espresso", {id:"espresso",sku:"CF-001",nameAr:"إسبريسو",nameEn:"Espresso",category:"coffee",price:1200,taxRateBps:1500,stock:100,active:true,rewardEligible:true}],
  ["latte", {id:"latte",sku:"CF-002",nameAr:"لاتيه",nameEn:"Latte",category:"coffee",price:1800,taxRateBps:1500,stock:100,active:true,rewardEligible:true}],
  ["cold-brew", {id:"cold-brew",sku:"CF-003",nameAr:"كولد برو",nameEn:"Cold Brew",category:"cold",price:2000,taxRateBps:1500,stock:80,active:true,rewardEligible:true}],
  ["croissant", {id:"croissant",sku:"FD-001",nameAr:"كرواسون",nameEn:"Croissant",category:"bakery",price:1400,taxRateBps:1500,stock:40,active:true}]
]);
export const orders = new Map<string, StoredOrder>();
export const idempotency = new Map<string, StoredOrder>();
export const loyaltyAccounts = new Map<string, LoyaltyAccount>();
export const loyaltyLedger: LoyaltyLedgerEntry[] = [];

export function getOrCreateLoyaltyAccount(customerMobile: string): LoyaltyAccount {
  const existing = loyaltyAccounts.get(customerMobile);
  if (existing) return existing;
  const account: LoyaltyAccount = { customerMobile, points: 0, visits: 0, tier: "member", updatedAt: new Date().toISOString() };
  loyaltyAccounts.set(customerMobile, account);
  return account;
}

export function loyaltySnapshot(account: LoyaltyAccount): LoyaltySnapshot {
  return {
    customerMobile: account.customerMobile,
    points: account.points,
    visits: account.visits,
    tier: account.tier,
    freeDrinksAvailable: Math.floor(account.points / FREE_DRINK_POINTS)
  };
}

export function refreshLoyaltyTier(account: LoyaltyAccount) {
  account.tier = loyaltyTierForVisits(account.visits);
  account.updatedAt = new Date().toISOString();
}
let receiptSequence = 1000;
export const nextReceipt = () => `CU-${++receiptSequence}`;
