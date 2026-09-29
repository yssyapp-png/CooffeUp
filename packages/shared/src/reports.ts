import { incomeStatement, trialBalance, vatReturn, accountByCode, type JournalEntry } from "./accounting.js";
import { customerInsights, SEGMENT_LABELS, type CustomerSegment } from "./customers.js";
import { DELIVERY_PLATFORMS } from "./delivery.js";
import {
  EXPENSE_CATEGORY_LABELS, ORDER_TYPE_LABELS, PAYMENT_METHOD_LABELS,
  type DeliveryPlatform, type ExpenseRecord, type KitchenTicket, type OrderRecord, type Product,
  type PurchaseRecord, type RefundRecord, type SalesChannel, type ShiftRecord, type StaffSummary, type StockMovement
} from "./domain.js";

export interface ReportDataset {
  orders: OrderRecord[];
  refunds: RefundRecord[];
  products: Product[];
  purchases: PurchaseRecord[];
  expenses: ExpenseRecord[];
  journal: JournalEntry[];
  shifts: ShiftRecord[];
  movements: StockMovement[];
  kitchenTickets: KitchenTicket[];
  customers: Array<{ id: string; name: string }>;
  staff: StaffSummary[];
}

/** Inclusive calendar dates (YYYY-MM-DD) in Saudi time. */
export interface ReportRange {
  from?: string;
  to?: string;
}

export type ColumnKind = "text" | "money" | "number" | "percent" | "date" | "datetime";
export interface ReportColumn { key: string; labelAr: string; kind: ColumnKind }
/** A row may carry a `kind` field that overrides the formatting of its `value` cell (used by summary-style reports). */
export type ReportRow = Record<string, string | number | null>;
export interface ReportResult {
  columns: ReportColumn[];
  rows: ReportRow[];
  summary?: Array<{ labelAr: string; value: number; kind: ColumnKind }>;
}

export type ReportCategory = "sales" | "delivery" | "inventory" | "purchases" | "finance" | "cash" | "customers" | "operations";
export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  sales: "المبيعات", delivery: "التوصيل والقنوات", inventory: "المخزون", purchases: "المشتريات والمصروفات",
  finance: "المحاسبة", cash: "الصندوق والورديات", customers: "العملاء", operations: "التشغيل"
};

export interface ReportDefinition {
  id: string;
  nameAr: string;
  category: ReportCategory;
  descriptionAr: string;
  usesRange: boolean;
  run(data: ReportDataset, range: ReportRange): ReportResult;
}

const RIYADH_OFFSET = 3 * 3_600_000;
export const riyadhDate = (iso: string) => new Date(new Date(iso).getTime() + RIYADH_OFFSET).toISOString().slice(0, 10);
export const riyadhHour = (iso: string) => new Date(new Date(iso).getTime() + RIYADH_OFFSET).getUTCHours();
const inRange = (iso: string, range: ReportRange) => {
  const day = iso.length === 10 ? iso : riyadhDate(iso);
  return (!range.from || day >= range.from) && (!range.to || day <= range.to);
};

const col = (key: string, labelAr: string, kind: ColumnKind = "text"): ReportColumn => ({ key, labelAr, kind });
const sum = <T>(items: T[], pick: (item: T) => number) => items.reduce((total, item) => total + pick(item), 0);
const orderCost = (order: OrderRecord) => sum(order.lines, (line) => line.unitCost * line.quantity);
const channelName = (channel: SalesChannel) =>
  channel === "pos" ? "الكاشير" : channel === "zid" ? "متجر زد" : channel === "salla" ? "متجر سلة" : DELIVERY_PLATFORMS[channel].nameAr;

function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    groups.set(value, [...(groups.get(value) ?? []), item]);
  }
  return groups;
}

const orders = (data: ReportDataset, range: ReportRange) => data.orders.filter((order) => inRange(order.createdAt, range));
const refunds = (data: ReportDataset, range: ReportRange) => data.refunds.filter((refund) => inRange(refund.createdAt, range));
const journal = (data: ReportDataset, range: ReportRange) => data.journal.filter((entry) => inRange(entry.date, range));

function salesGrouping(label: string, key: (order: OrderRecord) => string, name: (key: string) => string = (value) => value): ReportDefinition["run"] {
  return (data, range) => {
    const list = orders(data, range);
    const groups = groupBy(list, key);
    const total = sum(list, (order) => order.totals.taxable);
    const rows = [...groups.entries()].map(([value, group]) => {
      const net = sum(group, (order) => order.totals.taxable);
      return { key: name(value), orders: group.length, net, tax: sum(group, (order) => order.totals.tax), share: total ? Math.round((net * 10_000) / total) : 0 };
    }).sort((a, b) => b.net - a.net);
    return { columns: [col("key", label), col("orders", "عدد الطلبات", "number"), col("net", "صافي المبيعات", "money"), col("tax", "الضريبة", "money"), col("share", "النسبة", "percent")], rows };
  };
}

function productLines(data: ReportDataset, range: ReportRange) {
  return orders(data, range).flatMap((order) => order.lines.map((line) => ({ order, line, net: line.unitPrice * line.quantity - line.discount })));
}

export const REPORTS: ReportDefinition[] = [
  {
    id: "sales_summary", nameAr: "ملخص المبيعات", category: "sales", usesRange: true,
    descriptionAr: "إجمالي المبيعات والضريبة والخصومات والمرتجعات ومتوسط الفاتورة وإجمالي الربح",
    run(data, range) {
      const list = orders(data, range);
      const refundList = refunds(data, range);
      const gross = sum(list, (order) => order.totals.subtotal);
      const discount = sum(list, (order) => order.totals.discount);
      const net = sum(list, (order) => order.totals.taxable);
      const tax = sum(list, (order) => order.totals.tax);
      const returned = sum(refundList, (refund) => refund.total);
      const cost = sum(list, orderCost) - sum(refundList, (refund) => sum(refund.lines, (line) => line.cost));
      const returnedNet = sum(refundList, (refund) => sum(refund.lines, (line) => line.taxable));
      const rows: ReportRow[] = [
        { metric: "عدد الطلبات", value: list.length, kind: "number" },
        { metric: "المبيعات الإجمالية قبل الخصم", value: gross, kind: "money" },
        { metric: "الخصومات", value: discount, kind: "money" },
        { metric: "صافي المبيعات (قبل الضريبة)", value: net, kind: "money" },
        { metric: "ضريبة القيمة المضافة", value: tax, kind: "money" },
        { metric: "المبيعات شاملة الضريبة", value: net + tax, kind: "money" },
        { metric: "المرتجعات (شاملة الضريبة)", value: returned, kind: "money" },
        { metric: "متوسط الفاتورة", value: list.length ? Math.round((net + tax) / list.length) : 0, kind: "money" },
        { metric: "تكلفة البضاعة المباعة", value: cost, kind: "money" },
        { metric: "إجمالي الربح", value: net - returnedNet - cost, kind: "money" }
      ];
      return { columns: [col("metric", "البند"), col("value", "القيمة", "number")], rows };
    }
  },
  {
    id: "sales_by_day", nameAr: "المبيعات اليومية", category: "sales", usesRange: true, descriptionAr: "صافي المبيعات وعدد الطلبات لكل يوم",
    run: salesGrouping("اليوم", (order) => riyadhDate(order.createdAt))
  },
  {
    id: "sales_by_hour", nameAr: "المبيعات حسب الساعة", category: "sales", usesRange: true, descriptionAr: "أوقات الذروة لتخطيط الموظفين والتحضير",
    run(data, range) {
      const result = salesGrouping("الساعة", (order) => String(riyadhHour(order.createdAt)).padStart(2, "0"), (hour) => `${hour}:00`)(data, range);
      result.rows.sort((a, b) => String(a.key).localeCompare(String(b.key)));
      return result;
    }
  },
  {
    id: "sales_by_product", nameAr: "المبيعات حسب المنتج", category: "sales", usesRange: true, descriptionAr: "الكميات والإيرادات لكل منتج",
    run(data, range) {
      const groups = groupBy(productLines(data, range), ({ line }) => line.productId);
      const rows = [...groups.values()].map((items) => ({
        product: items[0].line.name, sku: items[0].line.sku,
        quantity: sum(items, ({ line }) => line.quantity - line.refundedQuantity), net: sum(items, ({ net }) => net)
      })).sort((a, b) => b.net - a.net);
      return { columns: [col("product", "المنتج"), col("sku", "الرمز"), col("quantity", "الكمية المباعة", "number"), col("net", "صافي المبيعات", "money")], rows };
    }
  },
  {
    id: "sales_by_category", nameAr: "المبيعات حسب التصنيف", category: "sales", usesRange: true, descriptionAr: "أداء كل تصنيف من تصنيفات المنتجات",
    run(data, range) {
      const groups = groupBy(productLines(data, range), ({ line }) => line.category);
      const rows = [...groups.entries()].map(([category, items]) => ({ category, quantity: sum(items, ({ line }) => line.quantity), net: sum(items, ({ net }) => net) }))
        .sort((a, b) => b.net - a.net);
      return { columns: [col("category", "التصنيف"), col("quantity", "الكمية", "number"), col("net", "صافي المبيعات", "money")], rows };
    }
  },
  {
    id: "sales_by_payment", nameAr: "المبيعات حسب طريقة الدفع", category: "sales", usesRange: true, descriptionAr: "النقد والشبكة ومدى والمحافظ الرقمية والمنصات",
    run(data, range) {
      const payments = orders(data, range).flatMap((order) => order.payments.map((payment) => ({
        ...payment, amount: payment.method === "cash" ? payment.amount - order.change : payment.amount
      })));
      const groups = groupBy(payments, (payment) => payment.method);
      const rows = [...groups.entries()].map(([method, items]) => ({
        method: PAYMENT_METHOD_LABELS[method as keyof typeof PAYMENT_METHOD_LABELS], count: items.length, amount: sum(items, (item) => item.amount)
      })).sort((a, b) => b.amount - a.amount);
      return { columns: [col("method", "طريقة الدفع"), col("count", "عدد العمليات", "number"), col("amount", "المبلغ المحصّل", "money")], rows };
    }
  },
  {
    id: "sales_by_channel", nameAr: "المبيعات حسب القناة", category: "sales", usesRange: true, descriptionAr: "الكاشير مقابل زد وسلة وتطبيقات التوصيل",
    run: salesGrouping("القناة", (order) => order.channel, (channel) => channelName(channel as SalesChannel))
  },
  {
    id: "sales_by_order_type", nameAr: "المبيعات حسب نوع الطلب", category: "sales", usesRange: true, descriptionAr: "محلي وسفري وتوصيل",
    run: salesGrouping("نوع الطلب", (order) => order.type, (type) => ORDER_TYPE_LABELS[type as keyof typeof ORDER_TYPE_LABELS])
  },
  {
    id: "sales_by_cashier", nameAr: "المبيعات حسب الموظف", category: "sales", usesRange: true, descriptionAr: "أداء كل كاشير",
    run(data, range) {
      const names = new Map(data.staff.map((member) => [member.id, member.name]));
      return salesGrouping("الموظف", (order) => order.cashierId, (id) => names.get(id) ?? id)(data, range);
    }
  },
  {
    id: "discounts", nameAr: "تقرير الخصومات", category: "sales", usesRange: true, descriptionAr: "كل الطلبات التي مُنح فيها خصم ومن منحه",
    run(data, range) {
      const names = new Map(data.staff.map((member) => [member.id, member.name]));
      const rows = orders(data, range).filter((order) => order.totals.discount > 0).map((order) => ({
        receipt: order.receiptNumber, date: order.createdAt, cashier: names.get(order.cashierId) ?? order.cashierId,
        gross: order.totals.subtotal, discount: order.totals.discount, rate: Math.round((order.totals.discount * 10_000) / order.totals.subtotal)
      }));
      return {
        columns: [col("receipt", "الإيصال"), col("date", "التاريخ", "datetime"), col("cashier", "الموظف"), col("gross", "قبل الخصم", "money"), col("discount", "الخصم", "money"), col("rate", "نسبة الخصم", "percent")],
        rows, summary: [{ labelAr: "إجمالي الخصومات", value: sum(rows, (row) => row.discount), kind: "money" }]
      };
    }
  },
  {
    id: "refunds", nameAr: "تقرير المرتجعات", category: "sales", usesRange: true, descriptionAr: "المبيعات المسترجعة وأسبابها ومن نفّذها",
    run(data, range) {
      const names = new Map(data.staff.map((member) => [member.id, member.name]));
      const rows = refunds(data, range).map((refund) => ({
        receipt: refund.receiptNumber, date: refund.createdAt, staff: names.get(refund.staffId) ?? refund.staffId,
        method: PAYMENT_METHOD_LABELS[refund.method], reason: refund.reason, total: refund.total
      }));
      return {
        columns: [col("receipt", "الإيصال الأصلي"), col("date", "التاريخ", "datetime"), col("staff", "الموظف"), col("method", "طريقة الرد"), col("reason", "السبب"), col("total", "المبلغ", "money")],
        rows, summary: [{ labelAr: "إجمالي المرتجعات", value: sum(rows, (row) => row.total), kind: "money" }]
      };
    }
  },
  {
    id: "price_overrides", nameAr: "تعديلات الأسعار", category: "sales", usesRange: true, descriptionAr: "البنود التي بيعت بسعر مختلف عن سعر الكتالوج",
    run(data, range) {
      const names = new Map(data.staff.map((member) => [member.id, member.name]));
      const rows = orders(data, range).flatMap((order) => order.lines.filter((line) => line.priceOverride).map((line) => ({
        receipt: order.receiptNumber, date: order.createdAt, product: line.name, original: line.priceOverride!.originalPrice,
        sold: line.unitPrice, quantity: line.quantity, approvedBy: names.get(line.priceOverride!.approvedBy) ?? line.priceOverride!.approvedBy
      })));
      return { columns: [col("receipt", "الإيصال"), col("date", "التاريخ", "datetime"), col("product", "المنتج"), col("original", "السعر الأصلي", "money"), col("sold", "سعر البيع", "money"), col("quantity", "الكمية", "number"), col("approvedBy", "الموظف")], rows };
    }
  },
  {
    id: "delivery_platforms", nameAr: "أداء تطبيقات التوصيل", category: "delivery", usesRange: true, descriptionAr: "الطلبات والإيرادات والعمولة التقديرية لكل منصة",
    run(data, range) {
      const list = orders(data, range).filter((order) => order.channel in DELIVERY_PLATFORMS);
      const rows = [...groupBy(list, (order) => order.channel).entries()].map(([platform, group]) => {
        const info = DELIVERY_PLATFORMS[platform as DeliveryPlatform];
        const total = sum(group, (order) => order.totals.total);
        return { platform: info.nameAr, orders: group.length, total, commission: Math.round((total * info.defaultCommissionBps) / 10_000), average: Math.round(total / group.length) };
      });
      return { columns: [col("platform", "المنصة"), col("orders", "الطلبات", "number"), col("total", "المبيعات شاملة الضريبة", "money"), col("commission", "العمولة التقديرية", "money"), col("average", "متوسط الطلب", "money")], rows };
    }
  },
  {
    id: "stock_levels", nameAr: "أرصدة المخزون", category: "inventory", usesRange: false, descriptionAr: "الكمية الحالية لكل منتج",
    run(data) {
      const rows = data.products.map((product) => ({ product: product.nameAr, sku: product.sku, category: product.category, stock: product.stock, reorder: product.reorderLevel ?? 0 }));
      return { columns: [col("product", "المنتج"), col("sku", "الرمز"), col("category", "التصنيف"), col("stock", "الرصيد", "number"), col("reorder", "حد إعادة الطلب", "number")], rows };
    }
  },
  {
    id: "low_stock", nameAr: "منتجات قاربت على النفاد", category: "inventory", usesRange: false, descriptionAr: "المنتجات التي وصلت لحد إعادة الطلب أو نفدت",
    run(data) {
      const rows = data.products.filter((product) => product.stock <= (product.reorderLevel ?? 0)).map((product) => ({
        product: product.nameAr, sku: product.sku, stock: product.stock, reorder: product.reorderLevel ?? 0, status: product.stock <= 0 ? "نفد" : "منخفض"
      }));
      return { columns: [col("product", "المنتج"), col("sku", "الرمز"), col("stock", "الرصيد", "number"), col("reorder", "حد إعادة الطلب", "number"), col("status", "الحالة")], rows };
    }
  },
  {
    id: "stock_valuation", nameAr: "تقييم المخزون", category: "inventory", usesRange: false, descriptionAr: "قيمة المخزون بالتكلفة وبسعر البيع",
    run(data) {
      const rows = data.products.map((product) => ({
        product: product.nameAr, stock: product.stock, cost: product.cost ?? 0, costValue: Math.max(product.stock, 0) * (product.cost ?? 0), retailValue: Math.max(product.stock, 0) * product.price
      }));
      return {
        columns: [col("product", "المنتج"), col("stock", "الرصيد", "number"), col("cost", "تكلفة الوحدة", "money"), col("costValue", "القيمة بالتكلفة", "money"), col("retailValue", "القيمة بسعر البيع", "money")],
        rows, summary: [{ labelAr: "قيمة المخزون بالتكلفة", value: sum(rows, (row) => row.costValue), kind: "money" }, { labelAr: "قيمة المخزون بسعر البيع", value: sum(rows, (row) => row.retailValue), kind: "money" }]
      };
    }
  },
  {
    id: "stock_movements", nameAr: "حركة المخزون", category: "inventory", usesRange: true, descriptionAr: "الوارد والصادر لكل منتج خلال الفترة",
    run(data, range) {
      const names = new Map(data.products.map((product) => [product.id, product.nameAr]));
      const groups = groupBy(data.movements.filter((movement) => inRange(movement.createdAt, range)), (movement) => movement.productId);
      const rows = [...groups.entries()].map(([productId, items]) => ({
        product: names.get(productId) ?? productId,
        incoming: sum(items.filter((item) => item.quantity > 0), (item) => item.quantity),
        outgoing: -sum(items.filter((item) => item.quantity < 0), (item) => item.quantity),
        net: sum(items, (item) => item.quantity)
      }));
      return { columns: [col("product", "المنتج"), col("incoming", "وارد", "number"), col("outgoing", "صادر", "number"), col("net", "الصافي", "number")], rows };
    }
  },
  {
    id: "product_profitability", nameAr: "ربحية المنتجات", category: "inventory", usesRange: true, descriptionAr: "هامش الربح لكل منتج بعد التكلفة",
    run(data, range) {
      const groups = groupBy(productLines(data, range), ({ line }) => line.productId);
      const rows = [...groups.values()].map((items) => {
        const net = sum(items, ({ net }) => net);
        const cost = sum(items, ({ line }) => line.unitCost * line.quantity);
        return { product: items[0].line.name, net, cost, profit: net - cost, margin: net ? Math.round(((net - cost) * 10_000) / net) : 0 };
      }).sort((a, b) => b.profit - a.profit);
      return { columns: [col("product", "المنتج"), col("net", "صافي المبيعات", "money"), col("cost", "التكلفة", "money"), col("profit", "الربح", "money"), col("margin", "هامش الربح", "percent")], rows };
    }
  },
  {
    id: "purchases_by_supplier", nameAr: "المشتريات حسب المورد", category: "purchases", usesRange: true, descriptionAr: "قيمة المشتريات وضريبة المدخلات لكل مورد",
    run(data, range) {
      const groups = groupBy(data.purchases.filter((purchase) => inRange(purchase.date, range)), (purchase) => purchase.supplierName);
      const rows = [...groups.entries()].map(([supplier, items]) => ({
        supplier, invoices: items.length, net: sum(items, (item) => item.net), vat: sum(items, (item) => item.vat), total: sum(items, (item) => item.total)
      })).sort((a, b) => b.total - a.total);
      return { columns: [col("supplier", "المورد"), col("invoices", "عدد الفواتير", "number"), col("net", "قبل الضريبة", "money"), col("vat", "ضريبة المدخلات", "money"), col("total", "الإجمالي", "money")], rows };
    }
  },
  {
    id: "expenses_by_category", nameAr: "المصروفات حسب البند", category: "purchases", usesRange: true, descriptionAr: "الإيجار والرواتب والخدمات وغيرها",
    run(data, range) {
      const groups = groupBy(data.expenses.filter((expense) => inRange(expense.date, range)), (expense) => expense.category);
      const rows = [...groups.entries()].map(([category, items]) => ({
        category: EXPENSE_CATEGORY_LABELS[category as keyof typeof EXPENSE_CATEGORY_LABELS], count: items.length, net: sum(items, (item) => item.net), vat: sum(items, (item) => item.vat)
      })).sort((a, b) => b.net - a.net);
      return { columns: [col("category", "البند"), col("count", "العدد", "number"), col("net", "المبلغ قبل الضريبة", "money"), col("vat", "الضريبة", "money")], rows };
    }
  },
  {
    id: "trial_balance", nameAr: "ميزان المراجعة", category: "finance", usesRange: true, descriptionAr: "أرصدة الحسابات المدينة والدائنة",
    run(data, range) {
      const rows = trialBalance(journal(data, range)).map((row) => ({ account: row.account, name: row.nameAr, debit: row.debit, credit: row.credit, balance: row.balance }));
      return {
        columns: [col("account", "رقم الحساب"), col("name", "اسم الحساب"), col("debit", "مدين", "money"), col("credit", "دائن", "money"), col("balance", "الرصيد", "money")],
        rows, summary: [{ labelAr: "إجمالي المدين", value: sum(rows, (row) => row.debit), kind: "money" }, { labelAr: "إجمالي الدائن", value: sum(rows, (row) => row.credit), kind: "money" }]
      };
    }
  },
  {
    id: "income_statement", nameAr: "قائمة الدخل", category: "finance", usesRange: true, descriptionAr: "الإيرادات والتكاليف والمصروفات وصافي الربح",
    run(data, range) {
      const statement = incomeStatement(journal(data, range));
      const rows: ReportRow[] = [
        { item: "إيرادات المبيعات", amount: statement.revenue },
        { item: "مردودات المبيعات", amount: -statement.returns },
        { item: "صافي الإيرادات", amount: statement.netRevenue },
        { item: "تكلفة البضاعة المباعة", amount: -statement.cogs },
        { item: "مجمل الربح", amount: statement.grossProfit },
        ...statement.expenses.map((expense) => ({ item: expense.nameAr, amount: -expense.amount })),
        { item: "صافي الربح", amount: statement.netIncome }
      ];
      return { columns: [col("item", "البند"), col("amount", "المبلغ", "money")], rows, summary: [{ labelAr: "هامش مجمل الربح", value: statement.grossMarginBps, kind: "percent" }] };
    }
  },
  {
    id: "vat_return", nameAr: "إقرار ضريبة القيمة المضافة", category: "finance", usesRange: true, descriptionAr: "ضريبة المخرجات والمدخلات وصافي المستحق للهيئة",
    run(data, range) {
      const vat = vatReturn(journal(data, range));
      return {
        columns: [col("item", "البند"), col("amount", "المبلغ", "money")],
        rows: [{ item: "ضريبة المخرجات (المبيعات)", amount: vat.outputVat }, { item: "ضريبة المدخلات (المشتريات والمصروفات)", amount: vat.inputVat }, { item: "صافي الضريبة المستحقة", amount: vat.netPayable }]
      };
    }
  },
  {
    id: "journal", nameAr: "دفتر اليومية", category: "finance", usesRange: true, descriptionAr: "كل القيود المحاسبية المؤتمتة واليدوية",
    run(data, range) {
      const rows = journal(data, range).flatMap((entry) => entry.lines.map((line) => ({
        number: entry.number, date: entry.date, description: entry.description, account: `${line.account} ${accountByCode(line.account)?.nameAr ?? ""}`, debit: line.debit, credit: line.credit
      })));
      return { columns: [col("number", "رقم القيد", "number"), col("date", "التاريخ", "date"), col("description", "البيان"), col("account", "الحساب"), col("debit", "مدين", "money"), col("credit", "دائن", "money")], rows };
    }
  },
  {
    id: "shift_closings", nameAr: "إغلاق الصندوق", category: "cash", usesRange: true, descriptionAr: "النقد المتوقع والمعدود والفروقات لكل وردية",
    run(data, range) {
      const names = new Map(data.staff.map((member) => [member.id, member.name]));
      const rows = data.shifts.filter((shift) => inRange(shift.openedAt, range)).map((shift) => ({
        staff: names.get(shift.staffId) ?? shift.staffId, opened: shift.openedAt, closed: shift.closedAt ?? null, opening: shift.openingFloat,
        expected: shift.expectedCash ?? null, counted: shift.countedCash ?? null, variance: shift.variance ?? null, status: shift.status === "open" ? "مفتوحة" : "مغلقة"
      }));
      return {
        columns: [col("staff", "الموظف"), col("opened", "الفتح", "datetime"), col("closed", "الإغلاق", "datetime"), col("opening", "رصيد الافتتاح", "money"), col("expected", "النقد المتوقع", "money"), col("counted", "النقد المعدود", "money"), col("variance", "الفرق", "money"), col("status", "الحالة")],
        rows, summary: [{ labelAr: "صافي فروقات الصندوق", value: sum(rows, (row) => row.variance ?? 0), kind: "money" }]
      };
    }
  },
  {
    id: "offline_sales", nameAr: "المبيعات دون اتصال", category: "cash", usesRange: true, descriptionAr: "المبيعات التي تمت أثناء انقطاع الإنترنت وتعارضات المخزون",
    run(data, range) {
      const rows = orders(data, range).filter((order) => order.offline).map((order) => ({
        receipt: order.receiptNumber, local: order.offline!.localReceipt, captured: order.offline!.capturedAt, synced: order.createdAt,
        total: order.totals.total, conflict: order.offline!.stockConflict ? "نعم — راجع المخزون" : "لا"
      }));
      return { columns: [col("receipt", "الإيصال النهائي"), col("local", "الإيصال المحلي"), col("captured", "وقت البيع", "datetime"), col("synced", "وقت المزامنة", "datetime"), col("total", "الإجمالي", "money"), col("conflict", "تعارض مخزون")], rows };
    }
  },
  {
    id: "top_customers", nameAr: "أفضل العملاء", category: "customers", usesRange: true, descriptionAr: "العملاء الأعلى إنفاقًا وعدد زياراتهم",
    run(data, range) {
      const names = new Map(data.customers.map((customer) => [customer.id, customer.name]));
      const groups = groupBy(orders(data, range).filter((order) => order.customerId), (order) => order.customerId!);
      const rows = [...groups.entries()].map(([id, items]) => {
        const spent = sum(items, (order) => order.totals.total);
        return { customer: names.get(id) ?? id, visits: items.length, spent, average: Math.round(spent / items.length), last: items[items.length - 1].createdAt };
      }).sort((a, b) => b.spent - a.spent).slice(0, 50);
      return { columns: [col("customer", "العميل"), col("visits", "الزيارات", "number"), col("spent", "إجمالي المشتريات", "money"), col("average", "متوسط الفاتورة", "money"), col("last", "آخر زيارة", "datetime")], rows };
    }
  },
  {
    id: "customer_segments", nameAr: "شرائح العملاء", category: "customers", usesRange: false, descriptionAr: "توزيع العملاء بين جدد ومنتظمين وأوفياء ومهددين بالانقطاع",
    run(data) {
      const counts = new Map<CustomerSegment, { customers: number; spent: number }>();
      const byCustomer = groupBy(data.orders.filter((order) => order.customerId), (order) => order.customerId!);
      for (const customer of data.customers) {
        const purchases = (byCustomer.get(customer.id) ?? []).map((order) => ({ total: order.totals.total, createdAt: order.createdAt, items: [] }));
        const insights = customerInsights(purchases);
        const entry = counts.get(insights.segment) ?? { customers: 0, spent: 0 };
        entry.customers += 1;
        entry.spent += insights.totalSpent;
        counts.set(insights.segment, entry);
      }
      const rows = [...counts.entries()].map(([segment, value]) => ({ segment: SEGMENT_LABELS[segment], customers: value.customers, spent: value.spent }));
      return { columns: [col("segment", "الشريحة"), col("customers", "عدد العملاء", "number"), col("spent", "إجمالي الإنفاق", "money")], rows };
    }
  },
  {
    id: "kitchen_performance", nameAr: "أداء المطبخ", category: "operations", usesRange: true, descriptionAr: "متوسط زمن التحضير والطلبات المتأخرة",
    run(data, range) {
      const tickets = data.kitchenTickets.filter((ticket) => inRange(ticket.createdAt, range) && ticket.readyAt);
      const minutes = (ticket: KitchenTicket) => (new Date(ticket.readyAt!).getTime() - new Date(ticket.createdAt).getTime()) / 60_000;
      const groups = groupBy(tickets, (ticket) => ORDER_TYPE_LABELS[ticket.orderType]);
      const rows = [...groups.entries()].map(([type, items]) => ({
        type, tickets: items.length, average: Math.round(sum(items, minutes) / items.length), late: items.filter((ticket) => minutes(ticket) > 15).length
      }));
      return { columns: [col("type", "نوع الطلب"), col("tickets", "عدد التذاكر", "number"), col("average", "متوسط التحضير (دقيقة)", "number"), col("late", "متأخرة (أكثر من 15 دقيقة)", "number")], rows };
    }
  }
];

export const reportById = (id: string) => REPORTS.find((report) => report.id === id);
