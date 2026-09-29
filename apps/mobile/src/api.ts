import { Platform } from "react-native";
import { readJson, writeJson } from "./storage";

/**
 * Emulators reach the computer running the API through special addresses; a real phone needs the
 * computer's network address (for example http://192.168.1.20:4000), which can be set on the sign-in
 * screen or through EXPO_PUBLIC_API_URL.
 */
const DEFAULT_URL = process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === "android" ? "http://10.0.2.2:4000" : "http://localhost:4000");
const URL_KEY = "cooffeup.apiUrl";

let baseUrl = DEFAULT_URL;
let token: string | null = null;
let branchId: string | null = null;
let onUnauthorized: () => void = () => undefined;

export const apiUrl = () => baseUrl;
export async function loadApiUrl() {
  baseUrl = await readJson(URL_KEY, DEFAULT_URL);
  return baseUrl;
}
export async function saveApiUrl(url: string) {
  baseUrl = url.trim().replace(/\/$/, "");
  await writeJson(URL_KEY, baseUrl);
}
export function setSession(value: string | null, branch: string | null, unauthorized?: () => void) {
  token = value;
  branchId = branch;
  if (unauthorized) onUnauthorized = unauthorized;
}
export const currentBranch = () => branchId ?? "main";

const MESSAGES: Record<string, string> = {
  NETWORK: "تعذر الاتصال بالخادم", UNAUTHENTICATED: "انتهت الجلسة، سجّل الدخول مجددًا", INVALID_CREDENTIALS: "الرمز السري غير صحيح",
  ACCOUNT_LOCKED: "تم قفل الحساب مؤقتًا", FORBIDDEN: "لا تملك صلاحية لهذا الإجراء", INSUFFICIENT_STOCK: "الكمية غير متوفرة",
  PAYMENT_SHORT: "المبلغ أقل من الإجمالي", SHIFT_REQUIRED: "افتح الوردية أولًا", SHIFT_ALREADY_OPEN: "توجد وردية مفتوحة",
  INSUFFICIENT_LOYALTY_POINTS: "نقاط العميل لا تكفي", NO_REWARD_ELIGIBLE_DRINK: "لا يوجد مشروب مؤهل للمكافأة", BRANCH_CLOSED: "الفرع خارج فترة عمله",
  BRANCH_NOT_ALLOWED: "لا يمكنك العمل في هذا الفرع", VALIDATION_FAILED: "تحقق من البيانات", OVERPAYMENT_WITHOUT_CASH: "الباقي يُرد من النقد فقط"
};

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(MESSAGES[code] ?? code);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(branchId ? { "x-branch-id": branchId } : {}),
        ...init.headers
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined
    });
  } catch {
    throw new ApiError(0, "NETWORK");
  }
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    if (response.status === 401 && token) onUnauthorized();
    throw new ApiError(response.status, body.error ?? `HTTP_${response.status}`);
  }
  return body as T;
}
