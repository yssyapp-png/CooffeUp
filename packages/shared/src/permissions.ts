export const PERMISSIONS = [
  "pos.sell", "pos.discount", "pos.price_override", "pos.refund", "pos.hold_cart",
  "customers.view", "customers.view_pii", "customers.manage",
  "inventory.manage", "purchases.manage", "expenses.manage",
  "accounting.view", "accounting.manage", "reports.view",
  "delivery.manage", "tables.manage", "kitchen.view", "appointments.manage",
  "shifts.manage", "integrations.manage", "staff.manage", "invoices.send"
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type Role = "owner" | "manager" | "cashier" | "kitchen" | "accountant";

export const PERMISSION_LABELS: Record<Permission, string> = {
  "pos.sell": "البيع من الكاشير",
  "pos.discount": "منح الخصومات",
  "pos.price_override": "تعديل سعر المنتج عند البيع",
  "pos.refund": "استرجاع المبيعات",
  "pos.hold_cart": "تعليق السلات واستئنافها",
  "customers.view": "عرض العملاء",
  "customers.view_pii": "كشف بيانات العملاء الحساسة (الجوال والبريد)",
  "customers.manage": "إضافة العملاء وتعديلهم",
  "inventory.manage": "إدارة المنتجات والمخزون",
  "purchases.manage": "إدارة المشتريات وقارئ الفواتير",
  "expenses.manage": "تسجيل المصروفات",
  "accounting.view": "عرض القيود والقوائم المالية",
  "accounting.manage": "إضافة قيود يدوية وربط الأنظمة المحاسبية",
  "reports.view": "عرض التقارير",
  "delivery.manage": "إدارة طلبات تطبيقات التوصيل",
  "tables.manage": "إدارة الطاولات",
  "kitchen.view": "شاشة المطبخ",
  "appointments.manage": "إدارة المواعيد",
  "shifts.manage": "فتح الورديات وإغلاق الصندوق",
  "integrations.manage": "إدارة الربط مع المتاجر والمنصات",
  "staff.manage": "إدارة الموظفين والصلاحيات",
  "invoices.send": "إرسال الفواتير برسائل SMS"
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: "المالك", manager: "مدير الفرع", cashier: "كاشير", kitchen: "مطبخ", accountant: "محاسب"
};

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: PERMISSIONS.filter((permission) => permission !== "staff.manage" && permission !== "accounting.manage"),
  cashier: ["pos.sell", "pos.discount", "pos.hold_cart", "customers.view", "customers.manage", "delivery.manage", "tables.manage", "kitchen.view", "appointments.manage", "shifts.manage", "invoices.send"],
  kitchen: ["kitchen.view"],
  accountant: ["accounting.view", "accounting.manage", "reports.view", "purchases.manage", "expenses.manage", "customers.view"]
};

/** Default maximum discount a role may grant on a single order, in basis points of the gross amount. */
export const ROLE_MAX_DISCOUNT_BPS: Record<Role, number> = { owner: 10_000, manager: 5_000, cashier: 1_000, kitchen: 0, accountant: 0 };

export interface StaffAccess {
  role: Role;
  grants?: Permission[];
  revokes?: Permission[];
  maxDiscountBps?: number;
}

export function permissionsFor(access: StaffAccess): Set<Permission> {
  const result = new Set<Permission>(ROLE_PERMISSIONS[access.role]);
  for (const permission of access.grants ?? []) result.add(permission);
  for (const permission of access.revokes ?? []) result.delete(permission);
  return result;
}

export const can = (access: StaffAccess, permission: Permission) => permissionsFor(access).has(permission);

export const maxDiscountBps = (access: StaffAccess) => access.maxDiscountBps ?? ROLE_MAX_DISCOUNT_BPS[access.role];

export function discountAllowed(access: StaffAccess, gross: number, discount: number): boolean {
  if (discount === 0) return true;
  if (!can(access, "pos.discount")) return false;
  return discount * 10_000 <= gross * maxDiscountBps(access);
}

export function maskPhone(phone: string): string {
  if (phone.length <= 4) return "****";
  return `${phone.slice(0, 4)}${"*".repeat(Math.max(phone.length - 7, 1))}${phone.slice(-3)}`;
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "****";
  return `${user.slice(0, 1)}***@${domain}`;
}
