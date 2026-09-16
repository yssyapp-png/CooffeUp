import type { Product, PaymentMethod, OrderType, Totals } from "@cooffeup/shared";

export interface StoredOrder {
  id: string;
  receiptNumber: string;
  type: OrderType;
  status: "paid";
  lines: Array<{ productId: string; quantity: number; unitPrice: number; name: string }>;
  payments: Array<{ method: PaymentMethod; amount: number }>;
  totals: Totals;
  createdAt: string;
}

export const products = new Map<string, Product>([
  ["espresso", {id:"espresso",sku:"CF-001",nameAr:"إسبريسو",nameEn:"Espresso",category:"coffee",price:1200,taxRateBps:1500,stock:100,active:true}],
  ["latte", {id:"latte",sku:"CF-002",nameAr:"لاتيه",nameEn:"Latte",category:"coffee",price:1800,taxRateBps:1500,stock:100,active:true}],
  ["cold-brew", {id:"cold-brew",sku:"CF-003",nameAr:"كولد برو",nameEn:"Cold Brew",category:"cold",price:2000,taxRateBps:1500,stock:80,active:true}],
  ["croissant", {id:"croissant",sku:"FD-001",nameAr:"كرواسون",nameEn:"Croissant",category:"bakery",price:1400,taxRateBps:1500,stock:40,active:true}]
]);
export const orders = new Map<string, StoredOrder>();
export const idempotency = new Map<string, StoredOrder>();
let receiptSequence = 1000;
export const nextReceipt = () => `CU-${++receiptSequence}`;
