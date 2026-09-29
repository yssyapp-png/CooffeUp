export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "انتهت الجلسة، سجّل الدخول مجددًا",
  INVALID_CREDENTIALS: "الرمز السري غير صحيح",
  ACCOUNT_LOCKED: "تم قفل الحساب مؤقتًا بسبب محاولات خاطئة متكررة",
  FORBIDDEN: "لا تملك صلاحية لهذا الإجراء",
  DISCOUNT_NOT_ALLOWED: "الخصم يتجاوز الحد المسموح لك",
  PRICE_OVERRIDE_NOT_ALLOWED: "لا تملك صلاحية تعديل السعر",
  INSUFFICIENT_STOCK: "الكمية غير متوفرة في المخزون",
  PAYMENT_SHORT: "المبلغ المدفوع أقل من الإجمالي",
  OVERPAYMENT_WITHOUT_CASH: "لا يمكن إرجاع باقٍ إلا من الدفع النقدي",
  PRODUCT_NOT_FOUND: "المنتج غير موجود",
  INVALID_SAUDI_MOBILE: "رقم الجوال غير صحيح، استخدم صيغة 05XXXXXXXX",
  PHONE_ALREADY_REGISTERED: "رقم الجوال مسجل لعميل آخر",
  REFUND_EXCEEDS_SOLD: "الكمية المسترجعة أكبر من المباعة",
  SHIFT_ALREADY_OPEN: "توجد وردية مفتوحة بالفعل",
  UNMAPPED_ITEMS: "بعض أصناف الطلب غير مربوطة برمز منتج لديك",
  INVALID_STATUS_TRANSITION: "لا يمكن الانتقال لهذه الحالة",
  APPOINTMENT_CONFLICT: "الموظف لديه موعد آخر في نفس الوقت",
  TOTALS_MISMATCH: "المجموع قبل الضريبة + الضريبة لا يساوي الإجمالي",
  LINES_DO_NOT_MATCH_NET: "مجموع البنود لا يطابق المجموع قبل الضريبة",
  LINE_TOTAL_MISMATCH: "الكمية × السعر لا تساوي مجموع أحد البنود",
  DUPLICATE_SUPPLIER_INVOICE: "هذه الفاتورة مسجلة من قبل",
  UNBALANCED_ENTRY: "القيد غير متوازن",
  INVOICE_SMS_LIMIT_REACHED: "تم إرسال هذه الفاتورة 3 مرات",
  VALIDATION_FAILED: "تحقق من البيانات المدخلة",
  NETWORK: "تعذر الاتصال بالخادم"
};

export class ApiError extends Error {
  constructor(public status: number, public code: string, public body: Record<string, unknown> = {}) {
    super(ERROR_MESSAGES[code] ?? code);
  }
}

let token: string | null = null;
let onUnauthorized: () => void = () => undefined;

export function setSession(value: string | null, unauthorized?: () => void) {
  token = value;
  if (unauthorized) onUnauthorized = unauthorized;
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined
    });
  } catch {
    throw new ApiError(0, "NETWORK");
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    if (response.status === 401 && token) onUnauthorized();
    throw new ApiError(response.status, body.error ?? `HTTP_${response.status}`, body);
  }
  return body as T;
}

export async function download(path: string, filename: string) {
  const response = await fetch(`${API_URL}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new ApiError(response.status, `HTTP_${response.status}`);
  const url = URL.createObjectURL(await response.blob());
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
}

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "حدث خطأ غير متوقع");
