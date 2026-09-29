import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Product } from "@cooffeup/shared";

export type Language = "ar" | "en";

/**
 * Strings for the screens used at the till (sign-in, navigation, point of sale, shift and receipt).
 * Back-office screens are Arabic-first and keep right-to-left layout in either language.
 */
const STRINGS = {
  ar: {
    appSubtitle: "نظام نقاط البيع والمحاسبة", whoIsUsing: "من يستخدم الجهاز؟", changeUser: "← تغيير المستخدم", pin: "الرمز السري", delete: "حذف", signIn: "دخول",
    online: "متصل", offlineSelling: "بلا إنترنت — البيع مستمر", logout: "خروج", noSections: "لا توجد أقسام متاحة لصلاحياتك", language: "English",
    nav_pos: "نقطة البيع", nav_channels: "الطلبات الموحدة", nav_kitchen: "المطبخ والطاولات", nav_appointments: "المواعيد", nav_customers: "العملاء",
    nav_shift: "الوردية والصندوق", nav_purchases: "المشتريات والمصروفات", nav_accounting: "المحاسبة", nav_reports: "التقارير", nav_integrations: "الربط والمنصات", nav_staff: "الموظفون والصلاحيات", nav_branches: "الفروع والمخزون", nav_orders: "الطلبات والمرتجعات", nav_dashboard: "لوحة التحكم", nav_pickups: "الاستلام والتسليم", readyBy: "موعد الجاهزية للاستلام", branch: "الفرع", booth: "بوث",
    chooseProducts: "اختر المنتجات", searchPlaceholder: "ابحث بالاسم أو امسح الباركود", all: "الكل", inStock: "متوفر", soldOut: "نفد", noResults: "لا توجد منتجات مطابقة",
    savedOnDevice: "بلا اتصال — يتم حفظ المبيعات على الجهاز", connectedShort: "متصل", awaitingSync: "بانتظار المزامنة", syncNow: "مزامنة الآن", ignore: "تجاهل",
    currentOrder: "الطلب الحالي", items: "أصناف", holdCart: "تعليق السلة", heldCarts: "السلات المعلقة", clear: "مسح", noHeldCarts: "لا توجد سلات معلقة",
    holdPrompt: "اسم للسلة المعلقة (مثال: طاولة 3 أو اسم العميل)", cart: "سلة",
    dine_in: "محلي", takeaway: "سفري", delivery: "توصيل", table: "الطاولة", noTable: "بدون طاولة",
    addCustomer: "إضافة عميل للطلب", removeCustomer: "إزالة العميل", visits: "زيارات", points: "نقطة", freeDrink: "استبدال مشروب مجاني (100 نقطة)",
    customerSearch: "رقم الجوال أو الاسم", newCustomerName: "اسم العميل الجديد", add: "إضافة",
    emptyCart: "السلة فارغة", emptyHint: "اختر منتجًا لبدء الطلب", edited: "معدّل", editPrice: "تعديل السعر", newPrice: "السعر الجديد (قبل الضريبة، ر.س)",
    decrease: "إنقاص", increase: "زيادة", discountSar: "خصم (ر.س)", maxDiscount: "الحد الأقصى", discount: "الخصم", reward: "مكافأة الولاء",
    subtotal: "المجموع قبل الضريبة", vat: "ضريبة القيمة المضافة", total: "الإجمالي", paymentMethod: "طريقة الدفع", amount: "المبلغ", splitPayment: "+ دفع مجزأ",
    changeDue: "الباقي للعميل", processing: "جارٍ تنفيذ الدفع...", remaining: "المتبقي", pay: "دفع", recordFree: "تسجيل الطلب المجاني", invalidAmount: "مبلغ غير صحيح",
    shiftRequired: "لا توجد وردية مفتوحة. افتح الوردية من قسم \"الوردية والصندوق\" قبل البيع.",
    paid: "تم الدفع بنجاح", savedOffline: "تم حفظ البيع على الجهاز", receiptNumber: "رقم الإيصال", pointsEarned: "نقاط مكتسبة",
    offlineNotice: "لا يوجد اتصال الآن. سيُرسل البيع تلقائيًا عند عودة الإنترنت ويحصل على رقم فاتورة نهائي.",
    customerPhone: "جوال العميل", sendSms: "إرسال الفاتورة SMS", smsSent: "تم إرسال الفاتورة للعميل برسالة نصية", newOrder: "طلب جديد",
    shiftTitle: "الوردية والصندوق", shiftEyebrow: "فتح الصندوق وإغلاقه وحركات النقد والمطابقة", noOpenShift: "لا توجد وردية مفتوحة", openingFloat: "رصيد الافتتاح (ر.س)",
    openShift: "فتح الوردية", shiftOpened: "تم فتح الوردية", shiftOpenSince: "الوردية مفتوحة منذ", cashSales: "مبيعات نقدية", refundsExpenses: "مرتجعات ومصروفات نقدية",
    orders: "عدد الطلبات", cashIn: "إيداع في الصندوق", cashOut: "سحب من الصندوق", movementReason: "السبب", recordMovement: "تسجيل الحركة", movementSaved: "تم تسجيل حركة النقد",
    countedCash: "النقد المعدود في الدرج (ر.س)", notes: "ملاحظات", closeShift: "إغلاق الصندوق", closeReport: "تقرير إغلاق الصندوق", expectedCash: "النقد المتوقع",
    variance: "الفرق", varianceBooked: "تم تسجيل الفرق تلقائيًا في حساب \"عجز وزيادة الصندوق\".", tenders: "التحصيل حسب طريقة الدفع", refunded: "المرتجعات", netSales: "صافي المبيعات"
  },
  en: {
    appSubtitle: "Point of sale & accounting", whoIsUsing: "Who is using this device?", changeUser: "← Change user", pin: "PIN", delete: "Delete", signIn: "Sign in",
    online: "Online", offlineSelling: "Offline — selling continues", logout: "Sign out", noSections: "No sections available for your permissions", language: "العربية",
    nav_pos: "Point of sale", nav_channels: "All orders", nav_kitchen: "Kitchen & tables", nav_appointments: "Appointments", nav_customers: "Customers",
    nav_shift: "Shift & drawer", nav_purchases: "Purchases & expenses", nav_accounting: "Accounting", nav_reports: "Reports", nav_integrations: "Integrations", nav_staff: "Staff & permissions", nav_branches: "Branches & stock", nav_orders: "Orders & refunds", nav_dashboard: "Dashboard", nav_pickups: "Pickups", readyBy: "Ready for pickup by", branch: "Branch", booth: "booth",
    chooseProducts: "Choose products", searchPlaceholder: "Search by name or scan a barcode", all: "All", inStock: "In stock", soldOut: "Sold out", noResults: "No matching products",
    savedOnDevice: "Offline — sales are saved on this device", connectedShort: "Online", awaitingSync: "Awaiting sync", syncNow: "Sync now", ignore: "Dismiss",
    currentOrder: "Current order", items: "items", holdCart: "Hold cart", heldCarts: "Held carts", clear: "Clear", noHeldCarts: "No held carts",
    holdPrompt: "Name for the held cart (e.g. table 3 or the customer's name)", cart: "Cart",
    dine_in: "Dine in", takeaway: "Takeaway", delivery: "Delivery", table: "Table", noTable: "No table",
    addCustomer: "Add customer to order", removeCustomer: "Remove customer", visits: "visits", points: "points", freeDrink: "Redeem a free drink (100 points)",
    customerSearch: "Mobile number or name", newCustomerName: "New customer's name", add: "Add",
    emptyCart: "Cart is empty", emptyHint: "Choose a product to start", edited: "edited", editPrice: "Edit price", newPrice: "New price (before VAT, SAR)",
    decrease: "Decrease", increase: "Increase", discountSar: "Discount (SAR)", maxDiscount: "Maximum", discount: "Discount", reward: "Loyalty reward",
    subtotal: "Subtotal before VAT", vat: "VAT", total: "Total", paymentMethod: "Payment method", amount: "Amount", splitPayment: "+ Split payment",
    changeDue: "Change due", processing: "Processing payment...", remaining: "Remaining", pay: "Pay", recordFree: "Record free order", invalidAmount: "Invalid amount",
    shiftRequired: "No shift is open. Open one from \"Shift & drawer\" before selling.",
    paid: "Payment complete", savedOffline: "Sale saved on this device", receiptNumber: "Receipt", pointsEarned: "Points earned",
    offlineNotice: "You are offline. The sale will be sent automatically when the connection returns and will get a final invoice number.",
    customerPhone: "Customer mobile", sendSms: "Send invoice by SMS", smsSent: "Invoice sent to the customer by SMS", newOrder: "New order",
    shiftTitle: "Shift & drawer", shiftEyebrow: "Open and close the drawer, cash movements and reconciliation", noOpenShift: "No shift is open", openingFloat: "Opening float (SAR)",
    openShift: "Open shift", shiftOpened: "Shift opened", shiftOpenSince: "Shift open since", cashSales: "Cash sales", refundsExpenses: "Cash refunds & expenses",
    orders: "Orders", cashIn: "Cash in", cashOut: "Cash out", movementReason: "Reason", recordMovement: "Record movement", movementSaved: "Cash movement recorded",
    countedCash: "Counted cash in drawer (SAR)", notes: "Notes", closeShift: "Close drawer", closeReport: "Drawer close report", expectedCash: "Expected cash",
    variance: "Variance", varianceBooked: "The variance was booked automatically to \"Cash over / short\".", tenders: "Collected by payment method", refunded: "Refunds", netSales: "Net sales"
  }
} as const;

export type StringKey = keyof (typeof STRINGS)["ar"];

const ERRORS: Record<Language, Record<string, string>> = {
  ar: {
    UNAUTHENTICATED: "انتهت الجلسة، سجّل الدخول مجددًا", INVALID_CREDENTIALS: "الرمز السري غير صحيح", ACCOUNT_LOCKED: "تم قفل الحساب مؤقتًا بسبب محاولات خاطئة متكررة",
    FORBIDDEN: "لا تملك صلاحية لهذا الإجراء", DISCOUNT_NOT_ALLOWED: "الخصم يتجاوز الحد المسموح لك", PRICE_OVERRIDE_NOT_ALLOWED: "لا تملك صلاحية تعديل السعر",
    INSUFFICIENT_STOCK: "الكمية غير متوفرة في المخزون", PAYMENT_SHORT: "المبلغ المدفوع أقل من الإجمالي", OVERPAYMENT_WITHOUT_CASH: "لا يمكن إرجاع باقٍ إلا من الدفع النقدي",
    PRODUCT_NOT_FOUND: "المنتج غير موجود", INVALID_SAUDI_MOBILE: "رقم الجوال غير صحيح، استخدم صيغة 05XXXXXXXX", PHONE_ALREADY_REGISTERED: "رقم الجوال مسجل لعميل آخر",
    REFUND_EXCEEDS_SOLD: "الكمية المسترجعة أكبر من المباعة", SHIFT_ALREADY_OPEN: "توجد وردية مفتوحة بالفعل", UNMAPPED_ITEMS: "بعض أصناف الطلب غير مربوطة برمز منتج لديك",
    INVALID_STATUS_TRANSITION: "لا يمكن الانتقال لهذه الحالة", APPOINTMENT_CONFLICT: "الموظف لديه موعد آخر في نفس الوقت",
    TOTALS_MISMATCH: "المجموع قبل الضريبة + الضريبة لا يساوي الإجمالي", LINES_DO_NOT_MATCH_NET: "مجموع البنود لا يطابق المجموع قبل الضريبة",
    LINE_TOTAL_MISMATCH: "الكمية × السعر لا تساوي مجموع أحد البنود", DUPLICATE_SUPPLIER_INVOICE: "هذه الفاتورة مسجلة من قبل", UNBALANCED_ENTRY: "القيد غير متوازن",
    INVOICE_SMS_LIMIT_REACHED: "تم إرسال هذه الفاتورة 3 مرات", VALIDATION_FAILED: "تحقق من البيانات المدخلة", NETWORK: "تعذر الاتصال بالخادم",
    SHIFT_REQUIRED: "افتح الوردية أولًا قبل البيع", SHIFT_NOT_OPEN: "الوردية مغلقة", IDEMPOTENCY_KEY_REUSED: "تم إرسال طلب مختلف بنفس المعرّف، أعد المحاولة",
    INSUFFICIENT_LOYALTY_POINTS: "نقاط العميل لا تكفي للمكافأة", NO_REWARD_ELIGIBLE_DRINK: "لا يوجد مشروب مؤهل للمكافأة في الطلب",
    CUSTOMER_REQUIRED_FOR_REWARD: "أضف العميل إلى الطلب لاستبدال النقاط", REFUND_METHOD_MISMATCH: "لا يمكن الاسترجاع بطريقة دفع غير التي دُفع بها",
    INSUFFICIENT_CASH_IN_DRAWER: "النقد في الدرج لا يكفي", UNEXPECTED: "حدث خطأ غير متوقع",
    BRANCH_CLOSED: "الفرع خارج فترة عمله أو موقوف", BRANCH_NOT_ALLOWED: "لا يمكنك العمل في هذا الفرع", BRANCH_NOT_FOUND: "الفرع غير موجود",
    TEMPORARY_BRANCH_NEEDS_END_DATE: "حدد تاريخ انتهاء البوث", INVALID_BRANCH_WINDOW: "تاريخ البداية يجب أن يسبق النهاية", SAME_BRANCH: "اختر فرعين مختلفين",
    SHIFT_STILL_OPEN: "أغلق وردية الفرع أولًا", MAIN_BRANCH_REQUIRED: "لا يمكن إيقاف الفرع الرئيسي", BRANCH_INACTIVE: "الفرع موقوف",
    TABLE_IN_OTHER_BRANCH: "الطاولة تابعة لفرع آخر"
  },
  en: {
    UNAUTHENTICATED: "Session expired, please sign in again", INVALID_CREDENTIALS: "Incorrect PIN", ACCOUNT_LOCKED: "Account temporarily locked after repeated wrong PINs",
    FORBIDDEN: "You don't have permission for this action", DISCOUNT_NOT_ALLOWED: "The discount exceeds your limit", PRICE_OVERRIDE_NOT_ALLOWED: "You can't change prices",
    INSUFFICIENT_STOCK: "Not enough stock", PAYMENT_SHORT: "Payment is less than the total", OVERPAYMENT_WITHOUT_CASH: "Change can only be given from cash",
    PRODUCT_NOT_FOUND: "Product not found", INVALID_SAUDI_MOBILE: "Invalid mobile number, use 05XXXXXXXX", PHONE_ALREADY_REGISTERED: "This mobile belongs to another customer",
    REFUND_EXCEEDS_SOLD: "Refund quantity exceeds what was sold", SHIFT_ALREADY_OPEN: "A shift is already open", VALIDATION_FAILED: "Please check the entered data",
    NETWORK: "Could not reach the server", SHIFT_REQUIRED: "Open a shift before selling", SHIFT_NOT_OPEN: "The shift is closed",
    IDEMPOTENCY_KEY_REUSED: "A different order was sent with the same key, please retry", INSUFFICIENT_LOYALTY_POINTS: "Not enough loyalty points for the reward",
    NO_REWARD_ELIGIBLE_DRINK: "No reward-eligible drink in the order", CUSTOMER_REQUIRED_FOR_REWARD: "Add the customer to redeem points",
    REFUND_METHOD_MISMATCH: "Refunds must go back to the original payment method", INSUFFICIENT_CASH_IN_DRAWER: "Not enough cash in the drawer",
    INVOICE_SMS_LIMIT_REACHED: "This invoice was already sent 3 times", UNEXPECTED: "Something went wrong",
    BRANCH_CLOSED: "This branch is outside its trading dates or inactive", BRANCH_NOT_ALLOWED: "You can't work at this branch", BRANCH_NOT_FOUND: "Branch not found",
    SHIFT_STILL_OPEN: "Close the branch's shift first", TABLE_IN_OTHER_BRANCH: "This table belongs to another branch"
  }
};

const STORAGE_KEY = "cu.language";
let current: Language = (() => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "ar";
  } catch {
    return "ar";
  }
})();

/** Error text in the active language, falling back to Arabic and then to the code itself. */
export const errorText = (code: string) => ERRORS[current][code] ?? ERRORS.ar[code] ?? code;

interface I18nValue {
  lang: Language;
  dir: "rtl" | "ltr";
  locale: string;
  t(key: StringKey): string;
  productName(product: Pick<Product, "nameAr" | "nameEn">): string;
  toggle(): void;
}

const I18nContext = createContext<I18nValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>(current);
  useEffect(() => {
    current = lang;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // The choice simply won't persist across reloads.
    }
  }, [lang]);
  const value: I18nValue = {
    lang, dir: lang === "ar" ? "rtl" : "ltr", locale: lang === "ar" ? "ar-SA" : "en-SA",
    t: (key) => STRINGS[lang][key],
    productName: (product) => (lang === "en" && product.nameEn ? product.nameEn : product.nameAr),
    toggle: () => setLang((value) => (value === "ar" ? "en" : "ar"))
  };
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n outside LanguageProvider");
  return value;
}
