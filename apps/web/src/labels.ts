import {
  APPOINTMENT_STATUS_LABELS, CHART_OF_ACCOUNTS, DELIVERY_PLATFORMS, EXPENSE_CATEGORY_LABELS, EXTERNAL_STATUS_LABELS, KITCHEN_STATUS_LABELS,
  LOYALTY_TIER_LABELS, ORDER_TYPE_LABELS, PAYMENT_METHOD_LABELS, PERMISSION_LABELS, PICKUP_STATUS_LABELS, REPORT_CATEGORY_LABELS,
  ROLE_LABELS, SECTOR_PROFILES, SEGMENT_LABELS, TABLE_STATUS_LABELS
} from "@cooffeup/shared";

/**
 * English for labels the API and shared package produce in Arabic (statuses, report names and
 * columns, permissions, categories). Keyed by the Arabic text so one entry covers every place it appears.
 */
const pairs = <K extends string>(arabic: Record<K, string>, english: Record<K, string>) =>
  Object.fromEntries((Object.keys(arabic) as K[]).map((key) => [arabic[key], english[key]]));

export const ARABIC_TO_ENGLISH: Record<string, string> = {
  ...pairs(ORDER_TYPE_LABELS, { dine_in: "Dine in", takeaway: "Takeaway", delivery: "Delivery" }),
  ...pairs(PAYMENT_METHOD_LABELS, { cash: "Cash", card: "Credit card", mada: "mada", apple_pay: "Apple Pay", stc_pay: "STC Pay", online: "Online (store)", delivery_platform: "Paid via delivery app" }),
  ...pairs(EXPENSE_CATEGORY_LABELS, { rent: "Rent", salaries: "Salaries", utilities: "Utilities & telecom", marketing: "Marketing", maintenance: "Maintenance", delivery_commission: "Delivery commissions", other: "Other expenses" }),
  ...pairs(SEGMENT_LABELS, { new: "New", regular: "Regular", loyal: "Loyal", vip: "VIP", at_risk: "At risk", lost: "Lapsed" }),
  ...pairs(LOYALTY_TIER_LABELS, { member: "Member", silver: "Silver", gold: "Gold", platinum: "Platinum" }),
  ...pairs(TABLE_STATUS_LABELS, { available: "Available", occupied: "Occupied", reserved: "Reserved", cleaning: "Cleaning" }),
  ...pairs(KITCHEN_STATUS_LABELS, { new: "New", preparing: "Preparing", ready: "Ready", served: "Served", cancelled: "Cancelled" }),
  ...pairs(APPOINTMENT_STATUS_LABELS, { booked: "Booked", checked_in: "Checked in", completed: "Completed", cancelled: "Cancelled", no_show: "No-show" }),
  ...pairs(PICKUP_STATUS_LABELS, { received: "Received", ready: "Ready for pickup", collected: "Collected" }),
  ...pairs(EXTERNAL_STATUS_LABELS, { new: "New", accepted: "Accepted", preparing: "Preparing", ready: "Ready for pickup", picked_up: "Picked up", delivered: "Delivered", rejected: "Rejected", cancelled: "Cancelled" }),
  ...pairs(ROLE_LABELS, { owner: "Owner", manager: "Branch manager", cashier: "Cashier", kitchen: "Kitchen", accountant: "Accountant" }),
  ...pairs(REPORT_CATEGORY_LABELS, { sales: "Sales", delivery: "Delivery & channels", inventory: "Inventory", purchases: "Purchases & expenses", finance: "Accounting", cash: "Cash & shifts", customers: "Customers", operations: "Operations" }),
  ...pairs(PERMISSION_LABELS, {
    "pos.sell": "Sell at the till", "pos.discount": "Give discounts", "pos.price_override": "Change prices at checkout", "pos.refund": "Refund sales",
    "pos.hold_cart": "Hold and resume carts", "customers.view": "View customers", "customers.view_pii": "Reveal customer contact details",
    "customers.manage": "Add and edit customers", "inventory.manage": "Manage products and stock", "purchases.manage": "Purchases and invoice reader",
    "expenses.manage": "Record expenses", "accounting.view": "View journal and statements", "accounting.manage": "Manual entries and accounting links",
    "reports.view": "View reports", "delivery.manage": "Manage delivery-app orders", "tables.manage": "Manage tables", "kitchen.view": "Kitchen display",
    "appointments.manage": "Manage appointments", "shifts.manage": "Open shifts and close the drawer", "integrations.manage": "Manage store and platform links",
    "staff.manage": "Manage staff and permissions", "invoices.send": "Send invoices by SMS", "branches.manage": "Manage branches, booths and stock transfers"
  }),
  ...Object.fromEntries(Object.values(SECTOR_PROFILES).map((profile, index) => [profile.nameAr, ["Café", "Restaurant", "Retail store", "Salon", "Clinic", "Laundry"][index]])),
  ...Object.fromEntries(CHART_OF_ACCOUNTS.map((account) => [account.nameAr, account.nameEn])),

  // Report names and descriptions
  "ملخص المبيعات": "Sales summary", "المبيعات اليومية": "Daily sales", "المبيعات حسب الساعة": "Sales by hour", "المبيعات حسب المنتج": "Sales by product",
  "المبيعات حسب التصنيف": "Sales by category", "المبيعات حسب طريقة الدفع": "Sales by payment method", "المبيعات حسب القناة": "Sales by channel",
  "المبيعات حسب نوع الطلب": "Sales by order type", "المبيعات حسب الموظف": "Sales by staff member", "تقرير الخصومات": "Discounts", "تقرير المرتجعات": "Refunds",
  "تعديلات الأسعار": "Price overrides", "أداء تطبيقات التوصيل": "Delivery app performance", "أرصدة المخزون": "Stock levels", "منتجات قاربت على النفاد": "Low stock",
  "تقييم المخزون": "Stock valuation", "حركة المخزون": "Stock movements", "ربحية المنتجات": "Product profitability", "المشتريات حسب المورد": "Purchases by supplier",
  "المصروفات حسب البند": "Expenses by category", "ميزان المراجعة": "Trial balance", "قائمة الدخل": "Income statement", "إقرار ضريبة القيمة المضافة": "VAT return",
  "دفتر اليومية": "Journal", "إغلاق الصندوق": "Drawer closings", "المبيعات دون اتصال": "Offline sales", "أفضل العملاء": "Top customers",
  "شرائح العملاء": "Customer segments", "أداء المطبخ": "Kitchen performance",
  "إجمالي المبيعات والضريبة والخصومات والمرتجعات ومتوسط الفاتورة وإجمالي الربح": "Sales, VAT, discounts, refunds, average ticket and gross profit",
  "صافي المبيعات وعدد الطلبات لكل يوم": "Net sales and orders per day", "أوقات الذروة لتخطيط الموظفين والتحضير": "Peak hours for staffing and prep",
  "الكميات والإيرادات لكل منتج": "Quantities and revenue per product", "أداء كل تصنيف من تصنيفات المنتجات": "Performance of each product category",
  "النقد والشبكة ومدى والمحافظ الرقمية والمنصات": "Cash, cards, mada, wallets and platforms", "الكاشير مقابل زد وسلة وتطبيقات التوصيل": "Till vs Zid, Salla and delivery apps",
  "محلي وسفري وتوصيل": "Dine in, takeaway and delivery", "أداء كل كاشير": "Performance of each cashier", "كل الطلبات التي مُنح فيها خصم ومن منحه": "Every discounted order and who gave it",
  "المبيعات المسترجعة وأسبابها ومن نفّذها": "Refunded sales, reasons and who refunded", "البنود التي بيعت بسعر مختلف عن سعر الكتالوج": "Lines sold at a price different from the catalogue",
  "الطلبات والإيرادات والعمولة التقديرية لكل منصة": "Orders, revenue and estimated commission per platform", "الكمية الحالية لكل منتج": "Current quantity of each product",
  "المنتجات التي وصلت لحد إعادة الطلب أو نفدت": "Products at or below the reorder level", "قيمة المخزون بالتكلفة وبسعر البيع": "Stock value at cost and at retail",
  "الوارد والصادر لكل منتج خلال الفترة": "Stock in and out per product for the period", "هامش الربح لكل منتج بعد التكلفة": "Margin per product after cost",
  "قيمة المشتريات وضريبة المدخلات لكل مورد": "Purchases and input VAT per supplier", "الإيجار والرواتب والخدمات وغيرها": "Rent, salaries, utilities and more",
  "أرصدة الحسابات المدينة والدائنة": "Debit and credit balances per account", "الإيرادات والتكاليف والمصروفات وصافي الربح": "Revenue, costs, expenses and net profit",
  "ضريبة المخرجات والمدخلات وصافي المستحق للهيئة": "Output and input VAT and the net amount due", "كل القيود المحاسبية المؤتمتة واليدوية": "All automatic and manual journal entries",
  "النقد المتوقع والمعدود والفروقات لكل وردية": "Expected and counted cash and variance per shift", "المبيعات التي تمت أثناء انقطاع الإنترنت وتعارضات المخزون": "Sales made offline and stock conflicts",
  "العملاء الأعلى إنفاقًا وعدد زياراتهم": "Highest-spending customers and their visits", "توزيع العملاء بين جدد ومنتظمين وأوفياء ومهددين بالانقطاع": "Customers by segment",
  "متوسط زمن التحضير والطلبات المتأخرة": "Average prep time and late tickets",

  // Report columns and fixed rows
  "الحساب": "Account", "رقم الحساب": "Account no.", "المبلغ المحصّل": "Collected", "المبلغ": "Amount", "الموظف": "Staff member", "متوسط التحضير (دقيقة)": "Avg prep (min)",
  "متوسط الطلب": "Average order", "متوسط الفاتورة": "Average ticket", "الرصيد": "Balance", "وقت البيع": "Sold at", "البند": "Item", "التصنيف": "Category", "الإغلاق": "Closed",
  "العمولة التقديرية": "Est. commission", "تعارض مخزون": "Stock conflict", "التكلفة": "Cost", "تكلفة الوحدة": "Unit cost", "القيمة بالتكلفة": "Value at cost", "العدد": "Count",
  "عدد العمليات": "Transactions", "النقد المعدود": "Counted cash", "دائن": "Credit", "العميل": "Customer", "عدد العملاء": "Customers", "التاريخ": "Date", "مدين": "Debit",
  "البيان": "Description", "الخصم": "Discount", "النقد المتوقع": "Expected cash", "قبل الخصم": "Before discount", "وارد": "In", "عدد الفواتير": "Invoices",
  "آخر زيارة": "Last visit", "متأخرة (أكثر من 15 دقيقة)": "Late (>15 min)", "الإيصال المحلي": "Local receipt", "هامش الربح": "Margin", "طريقة الدفع": "Payment method",
  "طريقة الرد": "Refunded to", "اسم الحساب": "Account name", "الصافي": "Net", "المبلغ قبل الضريبة": "Before VAT", "صافي المبيعات": "Net sales", "قبل الضريبة": "Before VAT",
  "رقم القيد": "Entry no.", "الفتح": "Opened", "رصيد الافتتاح": "Opening float", "الطلبات": "Orders", "عدد الطلبات": "Orders", "السعر الأصلي": "List price", "صادر": "Out",
  "المنصة": "Platform", "المنتج": "Product", "الربح": "Profit", "الكمية المباعة": "Qty sold", "الكمية": "Quantity", "نسبة الخصم": "Discount %", "السبب": "Reason",
  "الإيصال الأصلي": "Original receipt", "الإيصال النهائي": "Final receipt", "الإيصال": "Receipt", "حد إعادة الطلب": "Reorder level", "القيمة بسعر البيع": "Value at retail",
  "الشريحة": "Segment", "النسبة": "Share", "الرمز": "SKU", "سعر البيع": "Sold at price", "إجمالي الإنفاق": "Total spent", "إجمالي المشتريات": "Total spent", "الحالة": "Status",
  "المورد": "Supplier", "وقت المزامنة": "Synced at", "الضريبة": "VAT", "عدد التذاكر": "Tickets", "الإجمالي": "Total", "الزيارات": "Visits", "القيمة": "Value",
  "اليوم": "Day", "الساعة": "Hour", "القناة": "Channel", "نوع الطلب": "Order type", "الكاشير": "Till", "متجر زد": "Zid store", "متجر سلة": "Salla store",
  "المبيعات الإجمالية قبل الخصم": "Gross sales before discount", "الخصومات": "Discounts", "صافي المبيعات (قبل الضريبة)": "Net sales (before VAT)",
  "ضريبة القيمة المضافة": "VAT", "المبيعات شاملة الضريبة": "Sales incl. VAT", "المرتجعات (شاملة الضريبة)": "Refunds (incl. VAT)", "تكلفة البضاعة المباعة": "Cost of goods sold",
  "إجمالي الربح": "Gross profit", "إيرادات المبيعات": "Sales revenue", "مردودات المبيعات": "Sales returns", "صافي الإيرادات": "Net revenue", "مجمل الربح": "Gross profit",
  "صافي الربح": "Net profit", "ضريبة المخرجات (المبيعات)": "Output VAT (sales)", "ضريبة المدخلات (المشتريات والمصروفات)": "Input VAT (purchases & expenses)",
  "صافي الضريبة المستحقة": "Net VAT due", "إجمالي الخصومات": "Total discounts", "إجمالي المرتجعات": "Total refunds", "قيمة المخزون بالتكلفة": "Stock value at cost",
  "قيمة المخزون بسعر البيع": "Stock value at retail", "إجمالي المدين": "Total debit", "إجمالي الدائن": "Total credit", "هامش مجمل الربح": "Gross margin",
  "صافي فروقات الصندوق": "Net drawer variance", "نفد": "Out of stock", "منخفض": "Low", "مفتوحة": "Open", "مغلقة": "Closed", "نعم — راجع المخزون": "Yes — check stock", "لا": "No",

  // Screen-level status and action labels
  "بدء التحضير": "Start preparing", "جاهز": "Ready", "تم التقديم": "Served", "قبول": "Accept", "رفض": "Reject", "تم الاستلام": "Picked up",
  "تم التوصيل": "Delivered", "إلغاء": "Cancel", "جديدة": "New", "قيد التحضير": "In progress", "جاهزة للاستلام": "Ready for pickup",
  "مكتملة / ملغاة": "Completed / cancelled", "مدفوع": "Paid", "مسترجع جزئيًا": "Partly refunded", "مسترجع": "Refunded",
  "تمت": "Sent", "فشلت": "Failed", "بالانتظار": "Pending", "تحتاج إعداد": "Needs setup",

  // Seed catalogue categories and branch
  "القهوة": "Coffee", "المشروبات الباردة": "Cold drinks", "المخبوزات": "Bakery", "منتجات للبيع": "Retail items", "الفرع الرئيسي": "Main branch"
};

export const toEnglish = (text: string) => ARABIC_TO_ENGLISH[text] ?? text;

/**
 * Sales channel names. "جاهز" is both the Jahez app and the word "ready", so channels are never
 * translated through the general dictionary.
 */
const CHANNEL_NAMES: Record<string, { ar: string; en: string }> = {
  pos: { ar: "الكاشير", en: "Till" }, zid: { ar: "زد", en: "Zid" }, salla: { ar: "سلة", en: "Salla" },
  ...Object.fromEntries(Object.entries(DELIVERY_PLATFORMS).map(([id, platform]) => [id, { ar: platform.nameAr, en: platform.nameEn }]))
};
export const channelName = (channel: string, lang: "ar" | "en") => CHANNEL_NAMES[channel]?.[lang] ?? channel;

/** Channel cells in reports arrive as Arabic names; this maps them back without the "ready" clash. */
const CHANNEL_BY_ARABIC: Record<string, string> = {
  "متجر زد": "Zid store", "متجر سلة": "Salla store", "الكاشير": "Till",
  ...Object.fromEntries(Object.values(DELIVERY_PLATFORMS).map((platform) => [platform.nameAr, platform.nameEn]))
};
export const channelCellToEnglish = (text: string) => CHANNEL_BY_ARABIC[text] ?? toEnglish(text);
