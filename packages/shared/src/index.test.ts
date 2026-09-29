import { describe, expect, it } from "vitest";
import {
  applySyncResults, can, customerInsights, discountAllowed, distributeDiscount, expenseEntryLines, findAppointmentConflict,
  calculateTotals, incomeStatement, isValidSaudiVat, journalToCsv, markBatchFailed, maskPhone, normalizeSaudiMobile,
  parseInvoiceText, permissionsFor, promotionSuggestions, purchaseEntryLines, refundEntryLines, saleEntryLines,
  trialBalance, vatReturn, zatcaQrPayload, REPORTS, refundSlice, parseSar, loyaltyTierForVisits, calculateLoyaltyPoints, loyaltySnapshot, type JournalEntry, type OutboxEntry, type ReportDataset
} from "./index.js";

const entry = (number: number, lines: JournalEntry["lines"], date = "2026-09-01"): JournalEntry => ({
  id: `j${number}`, number, date, description: "test", source: { type: "manual", id: "x" }, lines, createdBy: "owner", createdAt: `${date}T10:00:00Z`
});

describe("calculateTotals", () => {
  it("calculates VAT after discount using halalas", () => {
    expect(calculateTotals([{productId:"1",name:"Latte",unitPrice:2000,quantity:2,taxRateBps:1500,discount:500}]))
      .toEqual({ subtotal:4000, discount:500, taxable:3500, tax:525, total:4025 });
  });
  it("rejects excessive discounts", () => {
    expect(() => calculateTotals([{productId:"1",name:"x",unitPrice:100,quantity:1,taxRateBps:1500,discount:101}])).toThrow();
  });
  it("distributes an order discount exactly across lines", () => {
    const lines = distributeDiscount([
      { productId: "a", name: "a", unitPrice: 1000, quantity: 1, taxRateBps: 1500 },
      { productId: "b", name: "b", unitPrice: 1000, quantity: 1, taxRateBps: 1500 },
      { productId: "c", name: "c", unitPrice: 1000, quantity: 1, taxRateBps: 1500 }
    ], 100);
    expect(lines.map((line) => line.discount).reduce((a, b) => a! + b!, 0)).toBe(100);
    expect(calculateTotals(lines).discount).toBe(100);
  });
});

describe("refunds and input parsing", () => {
  it("allocates tax rounding across partial refunds without losing a halala", () => {
    const line = { unitPrice: 1_000, quantity: 3, discount: 100, taxRateBps: 1_500 };
    const full = calculateTotals([{ productId: "x", name: "x", ...line }]);
    const slices = [refundSlice(line, 0, 1), refundSlice(line, 1, 1), refundSlice(line, 2, 1)];
    expect(slices.reduce((sum, slice) => sum + slice.taxable, 0)).toBe(full.taxable);
    expect(slices.reduce((sum, slice) => sum + slice.tax, 0)).toBe(full.tax);
  });
  it("parses SAR amounts strictly", () => {
    expect(parseSar("12")).toBe(1_200);
    expect(parseSar("12.5")).toBe(1_250);
    expect(parseSar(" 0.05 ")).toBe(5);
    for (const bad of ["", "1e3", "-5", "12.345", "abc", "1,000"]) expect(parseSar(bad)).toBeNull();
  });
});

describe("loyalty", () => {
  it("promotes customers by completed visit count", () => {
    expect([0, 5, 15, 30].map(loyaltyTierForVisits)).toEqual(["member", "silver", "gold", "platinum"]);
  });
  it("earns whole points from taxable halalas with a tier multiplier", () => {
    expect(calculateLoyaltyPoints(2_050, "member")).toBe(20);
    expect(calculateLoyaltyPoints(2_050, "gold")).toBe(25);
    expect(loyaltySnapshot({ points: 230, visits: 6, tier: "silver" }).freeDrinksAvailable).toBe(2);
  });
});

describe("permissions", () => {
  it("applies role defaults, grants and revokes", () => {
    expect(can({ role: "cashier" }, "pos.refund")).toBe(false);
    expect(can({ role: "cashier", grants: ["pos.refund"] }, "pos.refund")).toBe(true);
    expect(can({ role: "manager", revokes: ["pos.refund"] }, "pos.refund")).toBe(false);
    expect(permissionsFor({ role: "kitchen" }).size).toBe(1);
  });
  it("limits discounts per role", () => {
    expect(discountAllowed({ role: "cashier" }, 10_000, 1_000)).toBe(true);
    expect(discountAllowed({ role: "cashier" }, 10_000, 1_001)).toBe(false);
    expect(discountAllowed({ role: "cashier", maxDiscountBps: 2_000 }, 10_000, 2_000)).toBe(true);
    expect(discountAllowed({ role: "kitchen" }, 10_000, 1)).toBe(false);
  });
  it("masks phone numbers", () => {
    expect(maskPhone("+966501234567")).toBe("+966******567");
  });
});

describe("accounting", () => {
  it("posts a sale with change, VAT and cost of goods", () => {
    const lines = saleEntryLines({ payments: [{ method: "cash", amount: 5000 }, { method: "mada", amount: 1000 }], change: 1400, taxable: 4000, tax: 600, cost: 1500 });
    const debit = lines.reduce((total, line) => total + line.debit, 0);
    expect(debit).toBe(lines.reduce((total, line) => total + line.credit, 0));
    expect(lines).toContainEqual({ account: "1101", debit: 3600, credit: 0, memo: undefined });
    expect(lines).toContainEqual({ account: "2201", debit: 0, credit: 600, memo: undefined });
    expect(lines).toContainEqual({ account: "5101", debit: 1500, credit: 0, memo: undefined });
  });
  it("rejects a sale that does not balance", () => {
    expect(() => saleEntryLines({ payments: [{ method: "mada", amount: 1000 }], change: 0, taxable: 900, tax: 135, cost: 0 })).toThrow(/Unbalanced/);
  });
  it("builds statements and VAT return from entries", () => {
    const entries = [
      entry(1, saleEntryLines({ payments: [{ method: "mada", amount: 11500 }], change: 0, taxable: 10000, tax: 1500, cost: 4000 })),
      entry(2, purchaseEntryLines({ net: 2000, vat: 300, paidFrom: "payable" })),
      entry(3, expenseEntryLines({ category: "rent", net: 3000, vat: 0, paidFrom: "bank" })),
      entry(4, refundEntryLines({ method: "mada", taxable: 1000, tax: 150, cost: 400 }))
    ];
    const statement = incomeStatement(entries);
    expect(statement.netRevenue).toBe(9000);
    expect(statement.cogs).toBe(3600);
    expect(statement.netIncome).toBe(9000 - 3600 - 3000);
    expect(vatReturn(entries)).toEqual({ outputVat: 1350, inputVat: 300, netPayable: 1050 });
    const rows = trialBalance(entries);
    expect(rows.reduce((total, row) => total + row.balance, 0)).toBe(0);
  });
  it("exports CSV safely", () => {
    const csv = journalToCsv([{ ...entry(1, purchaseEntryLines({ net: 100, vat: 15, paidFrom: "cash" })), description: "=HYPERLINK(\"x\")" }]);
    expect(csv.split("\n")[1]).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
  });
});

describe("invoice reader", () => {
  const sample = `مؤسسة البن الذهبي للتجارة
فاتورة ضريبية
الرقم الضريبي: ٣١٠١٢٣٤٥٦٧٠٠٠٠٣
رقم الفاتورة: INV-2291
التاريخ: 2026/09/14
حبوب قهوة إثيوبي 2 150.00 300.00
حليب كامل الدسم 10 5.00 50.00
المجموع قبل الضريبة 350.00
ضريبة القيمة المضافة 15% 52.50
الإجمالي شامل الضريبة 402.50`;

  it("extracts header, lines and totals from Arabic OCR text", () => {
    const invoice = parseInvoiceText(sample);
    expect(invoice.supplierName).toBe("مؤسسة البن الذهبي للتجارة");
    expect(invoice.supplierVat).toBe("310123456700003");
    expect(invoice.invoiceNumber).toBe("INV-2291");
    expect(invoice.date).toBe("2026-09-14");
    expect(invoice.lines).toEqual([
      { description: "حبوب قهوة إثيوبي", quantity: 2, unitCost: 15000, total: 30000 },
      { description: "حليب كامل الدسم", quantity: 10, unitCost: 500, total: 5000 }
    ]);
    expect([invoice.net, invoice.vat, invoice.total]).toEqual([35000, 5250, 40250]);
    expect(invoice.confidence).toBe(100);
    expect(invoice.warnings).toEqual([]);
  });
  it("handles reversed RTL column order and English labels", () => {
    const invoice = parseInvoiceText("Fresh Dairy Co\nInvoice No: 77\n12.00 3 36.00 Milk 1L\nSubtotal 36.00\nVAT 5.40\nTotal 41.40");
    expect(invoice.lines).toEqual([{ description: "Milk 1L", quantity: 3, unitCost: 1200, total: 3600 }]);
    expect(invoice.total).toBe(4140);
  });
  it("warns when totals do not reconcile", () => {
    const invoice = parseInvoiceText("Supplier\nItem 1 10.00 10.00\nSubtotal 10.00\nVAT 1.50\nTotal 20.00");
    expect(invoice.warnings.some((warning) => warning.includes("لا يساوي الإجمالي"))).toBe(true);
    expect(invoice.confidence).toBeLessThan(100);
  });
  it("validates Saudi VAT numbers", () => {
    expect(isValidSaudiVat("310123456700003")).toBe(true);
    expect(isValidSaudiVat("210123456700003")).toBe(false);
  });
});

describe("customers", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const visit = (daysAgo: number, total = 2000) => ({
    total, createdAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(), items: [{ productId: "latte", name: "لاتيه", category: "coffee", quantity: 1 }]
  });
  it("computes visit behaviour and segment", () => {
    const insights = customerInsights([visit(2), visit(9), visit(16), visit(23)], now);
    expect(insights).toMatchObject({ visits: 4, totalSpent: 8000, averageTicket: 2000, daysSinceLastVisit: 2, averageDaysBetweenVisits: 7, segment: "loyal" });
    expect(insights.favoriteProducts[0]).toEqual({ productId: "latte", name: "لاتيه", quantity: 4 });
    expect(promotionSuggestions(insights).map((suggestion) => suggestion.code)).toEqual(["LOYALTY_STAMP", "FAVORITE_BUNDLE", "UPSELL_SNACK"]);
  });
  it("flags customers at risk of churning", () => {
    expect(customerInsights([visit(40), visit(50)], now).segment).toBe("at_risk");
    expect(customerInsights([visit(90)], now).segment).toBe("lost");
  });
});

describe("offline queue", () => {
  const item = (id: string): OutboxEntry => ({
    id, deviceId: "dev1", localReceipt: "OFF-1", capturedAt: "2026-09-28T10:00:00Z", attempts: 0, nextAttemptAt: "2026-09-28T10:00:00Z",
    payload: { type: "takeaway", lines: [{ productId: "latte", quantity: 1 }], payments: [{ method: "cash", amount: 2070 }] }
  });
  it("removes synced entries and parks rejected ones for review", () => {
    const { remaining, synced } = applySyncResults([item("a"), item("b"), item("c")], [
      { id: "a", status: "created" }, { id: "b", status: "duplicate" }, { id: "c", status: "rejected", error: "PRODUCT_NOT_FOUND" }
    ]);
    expect(synced).toHaveLength(2);
    expect(remaining).toEqual([expect.objectContaining({ id: "c", needsReview: true, lastError: "PRODUCT_NOT_FOUND" })]);
  });
  it("backs off after network failures", () => {
    const [failed] = markBatchFailed([item("a")], ["a"], "offline", new Date("2026-09-28T10:00:00Z"));
    expect(failed.attempts).toBe(1);
    expect(failed.nextAttemptAt).toBe("2026-09-28T10:00:02.000Z");
  });
});

describe("appointments", () => {
  it("detects overlapping bookings for the same staff member", () => {
    const booked = [{ id: "1", customerName: "x", serviceProductId: "s", staffId: "st", startsAt: "2026-09-28T10:00:00Z", durationMinutes: 60, status: "booked" as const }];
    expect(findAppointmentConflict(booked, { id: "2", staffId: "st", startsAt: "2026-09-28T10:30:00Z", durationMinutes: 30 })).toBeDefined();
    expect(findAppointmentConflict(booked, { id: "2", staffId: "st", startsAt: "2026-09-28T11:00:00Z", durationMinutes: 30 })).toBeUndefined();
    expect(findAppointmentConflict(booked, { id: "2", staffId: "other", startsAt: "2026-09-28T10:30:00Z", durationMinutes: 30 })).toBeUndefined();
  });
});

describe("helpers", () => {
  it("normalises Saudi mobile numbers", () => {
    expect(normalizeSaudiMobile("0501234567")).toBe("+966501234567");
    expect(normalizeSaudiMobile("٠٥٠ ١٢٣ ٤٥٦٧")).toBe("+966501234567");
    expect(normalizeSaudiMobile("00966501234567")).toBe("+966501234567");
    expect(normalizeSaudiMobile("0112345678")).toBeNull();
  });
  it("encodes the ZATCA QR as base64 TLV", () => {
    const payload = zatcaQrPayload({ sellerName: "CooffeUp", vatNumber: "310123456700003", timestamp: "2026-09-28T10:00:00Z", total: 1150, vat: 150 });
    const bytes = Buffer.from(payload, "base64");
    expect(bytes[0]).toBe(1);
    expect(bytes[1]).toBe(8);
    expect(bytes.subarray(2, 10).toString()).toBe("CooffeUp");
    expect(payload).toBe(Buffer.from(bytes).toString("base64"));
  });
});

describe("reports", () => {
  const data: ReportDataset = {
    orders: [{
      id: "o1", receiptNumber: "CU-1", type: "takeaway", channel: "pos", status: "paid", change: 0, cashierId: "c1", invoiceToken: "t",
      createdAt: "2026-09-28T07:30:00Z", payments: [{ method: "mada", amount: 2300 }],
      totals: { subtotal: 2000, discount: 0, taxable: 2000, tax: 300, total: 2300 },
      lines: [{ productId: "latte", sku: "CF-2", name: "لاتيه", category: "coffee", quantity: 1, unitPrice: 2000, unitCost: 600, discount: 0, taxRateBps: 1500, tax: 300, refundedQuantity: 0 }]
    }],
    refunds: [], products: [], purchases: [], expenses: [], journal: [], shifts: [], movements: [], kitchenTickets: [], customers: [], staff: [{ id: "c1", name: "عبدالله" }]
  };
  it("ships at least 25 reports with unique ids that all run", () => {
    expect(REPORTS.length).toBeGreaterThanOrEqual(25);
    expect(new Set(REPORTS.map((report) => report.id)).size).toBe(REPORTS.length);
    for (const report of REPORTS) expect(() => report.run(data, {})).not.toThrow();
  });
  it("groups sales by Saudi local hour and filters by date", () => {
    const byHour = REPORTS.find((report) => report.id === "sales_by_hour")!.run(data, { from: "2026-09-28", to: "2026-09-28" });
    expect(byHour.rows).toEqual([{ key: "10:00", orders: 1, net: 2000, tax: 300, share: 10_000 }]);
    expect(REPORTS.find((report) => report.id === "sales_by_day")!.run(data, { from: "2026-09-29" }).rows).toEqual([]);
  });
});
