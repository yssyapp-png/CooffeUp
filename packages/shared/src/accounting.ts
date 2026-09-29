import type { ExpenseCategory, PaidFrom, PaymentMethod } from "./domain.js";
import { assertSafeInteger, type Money } from "./money.js";

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export interface Account {
  code: string;
  nameAr: string;
  nameEn: string;
  type: AccountType;
}

export const CHART_OF_ACCOUNTS: readonly Account[] = [
  { code: "1101", nameAr: "الصندوق (النقدية)", nameEn: "Cash on hand", type: "asset" },
  { code: "1102", nameAr: "البنك", nameEn: "Bank", type: "asset" },
  { code: "1103", nameAr: "مستحقات الشبكة ومدى", nameEn: "Card clearing", type: "asset" },
  { code: "1104", nameAr: "مستحقات المنصات والمتاجر الإلكترونية", nameEn: "Platform receivables", type: "asset" },
  { code: "1201", nameAr: "المخزون", nameEn: "Inventory", type: "asset" },
  { code: "1301", nameAr: "ضريبة القيمة المضافة - المدخلات", nameEn: "Input VAT", type: "asset" },
  { code: "2101", nameAr: "الموردون (ذمم دائنة)", nameEn: "Accounts payable", type: "liability" },
  { code: "2201", nameAr: "ضريبة القيمة المضافة - المخرجات", nameEn: "Output VAT", type: "liability" },
  { code: "3101", nameAr: "رأس المال", nameEn: "Owner's equity", type: "equity" },
  { code: "4101", nameAr: "إيرادات المبيعات", nameEn: "Sales revenue", type: "revenue" },
  { code: "4102", nameAr: "مردودات المبيعات", nameEn: "Sales returns", type: "revenue" },
  { code: "5101", nameAr: "تكلفة البضاعة المباعة", nameEn: "Cost of goods sold", type: "expense" },
  { code: "5102", nameAr: "عجز وزيادة الصندوق", nameEn: "Cash over / short", type: "expense" },
  { code: "6101", nameAr: "مصروف الإيجار", nameEn: "Rent expense", type: "expense" },
  { code: "6102", nameAr: "مصروف الرواتب", nameEn: "Salaries expense", type: "expense" },
  { code: "6103", nameAr: "مصروف الكهرباء والمياه والاتصالات", nameEn: "Utilities expense", type: "expense" },
  { code: "6104", nameAr: "مصروف التسويق", nameEn: "Marketing expense", type: "expense" },
  { code: "6105", nameAr: "مصروف الصيانة", nameEn: "Maintenance expense", type: "expense" },
  { code: "6106", nameAr: "عمولات منصات التوصيل", nameEn: "Delivery commissions", type: "expense" },
  { code: "6199", nameAr: "مصروفات أخرى", nameEn: "Other expenses", type: "expense" }
];

const ACCOUNT_CODES = new Set(CHART_OF_ACCOUNTS.map((account) => account.code));
export const accountByCode = (code: string) => CHART_OF_ACCOUNTS.find((account) => account.code === code);

export const PAYMENT_ACCOUNTS: Record<PaymentMethod, string> = {
  cash: "1101", card: "1103", mada: "1103", apple_pay: "1103", stc_pay: "1103", online: "1104", delivery_platform: "1104"
};

export const PAID_FROM_ACCOUNTS: Record<PaidFrom, string> = { cash: "1101", bank: "1102", payable: "2101" };

export const EXPENSE_ACCOUNTS: Record<ExpenseCategory, string> = {
  rent: "6101", salaries: "6102", utilities: "6103", marketing: "6104", maintenance: "6105", delivery_commission: "6106", other: "6199"
};

export interface JournalLine {
  account: string;
  debit: Money;
  credit: Money;
  memo?: string;
}

export type JournalSourceType = "order" | "refund" | "purchase" | "expense" | "shift" | "manual";

export interface JournalEntry {
  id: string;
  number: number;
  date: string;
  description: string;
  source: { type: JournalSourceType; id: string };
  lines: JournalLine[];
  createdBy: string;
  createdAt: string;
}

const dr = (account: string, amount: Money, memo?: string): JournalLine => ({ account, debit: amount, credit: 0, memo });
const cr = (account: string, amount: Money, memo?: string): JournalLine => ({ account, debit: 0, credit: amount, memo });

/** Removes zero lines and merges lines for the same account and side, then validates balance. */
export function finalizeLines(lines: JournalLine[]): JournalLine[] {
  const merged = new Map<string, JournalLine>();
  for (const line of lines) {
    if (line.debit === 0 && line.credit === 0) continue;
    const key = `${line.account}:${line.debit > 0 ? "d" : "c"}`;
    const existing = merged.get(key);
    if (existing) {
      existing.debit += line.debit;
      existing.credit += line.credit;
    } else merged.set(key, { ...line });
  }
  const result = [...merged.values()];
  assertBalanced(result);
  return result;
}

export function assertBalanced(lines: JournalLine[]): void {
  if (lines.length < 2) throw new Error("A journal entry needs at least two lines");
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    if (!ACCOUNT_CODES.has(line.account)) throw new Error(`Unknown account ${line.account}`);
    assertSafeInteger(line.debit, "debit");
    assertSafeInteger(line.credit, "credit");
    if (line.debit < 0 || line.credit < 0 || (line.debit > 0 && line.credit > 0)) throw new Error("Each line must be a single positive debit or credit");
    debit += line.debit;
    credit += line.credit;
  }
  if (debit !== credit) throw new Error(`Unbalanced entry: debit ${debit} ≠ credit ${credit}`);
}

export interface SaleEntryInput {
  payments: Array<{ method: PaymentMethod; amount: Money }>;
  change: Money;
  taxable: Money;
  tax: Money;
  cost: Money;
}

export function saleEntryLines(input: SaleEntryInput): JournalLine[] {
  const lines: JournalLine[] = [];
  let changeLeft = input.change;
  for (const payment of input.payments) {
    let amount = payment.amount;
    if (payment.method === "cash" && changeLeft > 0) {
      const used = Math.min(changeLeft, amount);
      amount -= used;
      changeLeft -= used;
    }
    lines.push(dr(PAYMENT_ACCOUNTS[payment.method], amount));
  }
  if (changeLeft > 0) throw new Error("Change can only be returned from cash payments");
  lines.push(cr("4101", input.taxable), cr("2201", input.tax));
  if (input.cost > 0) lines.push(dr("5101", input.cost), cr("1201", input.cost));
  return finalizeLines(lines);
}

export function refundEntryLines(input: { method: PaymentMethod; taxable: Money; tax: Money; cost: Money }): JournalLine[] {
  const lines = [dr("4102", input.taxable), dr("2201", input.tax), cr(PAYMENT_ACCOUNTS[input.method], input.taxable + input.tax)];
  if (input.cost > 0) lines.push(dr("1201", input.cost), cr("5101", input.cost));
  return finalizeLines(lines);
}

export function purchaseEntryLines(input: { net: Money; vat: Money; paidFrom: PaidFrom }): JournalLine[] {
  return finalizeLines([dr("1201", input.net), dr("1301", input.vat), cr(PAID_FROM_ACCOUNTS[input.paidFrom], input.net + input.vat)]);
}

export function expenseEntryLines(input: { category: ExpenseCategory; net: Money; vat: Money; paidFrom: PaidFrom }): JournalLine[] {
  return finalizeLines([dr(EXPENSE_ACCOUNTS[input.category], input.net), dr("1301", input.vat), cr(PAID_FROM_ACCOUNTS[input.paidFrom], input.net + input.vat)]);
}

/** Records the difference between counted and expected cash when a shift closes. */
export function cashVarianceLines(variance: Money): JournalLine[] {
  if (variance === 0) return [];
  return variance > 0 ? finalizeLines([dr("1101", variance), cr("5102", variance)]) : finalizeLines([dr("5102", -variance), cr("1101", -variance)]);
}

export interface TrialBalanceRow {
  account: string;
  nameAr: string;
  type: AccountType;
  debit: Money;
  credit: Money;
  /** Positive = debit balance, negative = credit balance. */
  balance: Money;
}

export function trialBalance(entries: JournalEntry[]): TrialBalanceRow[] {
  const totals = new Map<string, { debit: number; credit: number }>();
  for (const entry of entries) for (const line of entry.lines) {
    const row = totals.get(line.account) ?? { debit: 0, credit: 0 };
    row.debit += line.debit;
    row.credit += line.credit;
    totals.set(line.account, row);
  }
  return CHART_OF_ACCOUNTS.filter((account) => totals.has(account.code)).map((account) => {
    const { debit, credit } = totals.get(account.code)!;
    return { account: account.code, nameAr: account.nameAr, type: account.type, debit, credit, balance: debit - credit };
  });
}

export interface IncomeStatement {
  revenue: Money;
  returns: Money;
  netRevenue: Money;
  cogs: Money;
  grossProfit: Money;
  grossMarginBps: number;
  expenses: Array<{ account: string; nameAr: string; amount: Money }>;
  totalExpenses: Money;
  netIncome: Money;
}

export function incomeStatement(entries: JournalEntry[]): IncomeStatement {
  const rows = trialBalance(entries);
  const credit = (code: string) => -(rows.find((row) => row.account === code)?.balance ?? 0);
  const debit = (code: string) => rows.find((row) => row.account === code)?.balance ?? 0;
  const revenue = credit("4101");
  const returns = debit("4102");
  const netRevenue = revenue - returns;
  const cogs = debit("5101");
  const grossProfit = netRevenue - cogs;
  const expenses = rows.filter((row) => row.type === "expense" && row.account !== "5101" && row.balance !== 0)
    .map((row) => ({ account: row.account, nameAr: row.nameAr, amount: row.balance }));
  const totalExpenses = expenses.reduce((sum, row) => sum + row.amount, 0);
  return {
    revenue, returns, netRevenue, cogs, grossProfit,
    grossMarginBps: netRevenue === 0 ? 0 : Math.round((grossProfit * 10_000) / netRevenue),
    expenses, totalExpenses, netIncome: grossProfit - totalExpenses
  };
}

export function vatReturn(entries: JournalEntry[]) {
  const rows = trialBalance(entries);
  const outputVat = -(rows.find((row) => row.account === "2201")?.balance ?? 0);
  const inputVat = rows.find((row) => row.account === "1301")?.balance ?? 0;
  return { outputVat, inputVat, netPayable: outputVat - inputVat };
}

const csvCell = (value: string | number) => {
  const text = String(value);
  // Prefix cells that spreadsheets would evaluate as formulas.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function journalToCsv(entries: JournalEntry[]): string {
  const header = ["entry_number", "date", "description", "source_type", "source_id", "account", "account_name", "debit", "credit", "memo"];
  const rows = entries.flatMap((entry) => entry.lines.map((line) => [
    entry.number, entry.date, entry.description, entry.source.type, entry.source.id, line.account,
    accountByCode(line.account)?.nameEn ?? "", (line.debit / 100).toFixed(2), (line.credit / 100).toFixed(2), line.memo ?? ""
  ]));
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}
