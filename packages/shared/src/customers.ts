import type { Money } from "./money.js";

export type CustomerSegment = "new" | "regular" | "loyal" | "vip" | "at_risk" | "lost";

export const SEGMENT_LABELS: Record<CustomerSegment, string> = {
  new: "عميل جديد", regular: "عميل منتظم", loyal: "عميل وفي", vip: "عميل مميز (VIP)", at_risk: "مهدد بالانقطاع", lost: "عميل منقطع"
};

export interface CustomerPurchase {
  total: Money;
  createdAt: string;
  items: Array<{ productId: string; name: string; category: string; quantity: number }>;
}

export interface CustomerInsights {
  visits: number;
  totalSpent: Money;
  averageTicket: Money;
  firstVisit?: string;
  lastVisit?: string;
  daysSinceLastVisit?: number;
  averageDaysBetweenVisits?: number;
  favoriteProducts: Array<{ productId: string; name: string; quantity: number }>;
  favoriteCategory?: string;
  segment: CustomerSegment;
}

const DAY = 86_400_000;

export function customerInsights(purchases: CustomerPurchase[], now = new Date()): CustomerInsights {
  const sorted = [...purchases].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const visits = sorted.length;
  const totalSpent = sorted.reduce((sum, purchase) => sum + purchase.total, 0);
  const products = new Map<string, { productId: string; name: string; quantity: number }>();
  const categories = new Map<string, number>();
  for (const purchase of sorted) for (const item of purchase.items) {
    const entry = products.get(item.productId) ?? { productId: item.productId, name: item.name, quantity: 0 };
    entry.quantity += item.quantity;
    products.set(item.productId, entry);
    categories.set(item.category, (categories.get(item.category) ?? 0) + item.quantity);
  }
  const favoriteProducts = [...products.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 3);
  const favoriteCategory = [...categories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const firstVisit = sorted[0]?.createdAt;
  const lastVisit = sorted[visits - 1]?.createdAt;
  const daysSinceLastVisit = lastVisit ? Math.floor((now.getTime() - new Date(lastVisit).getTime()) / DAY) : undefined;
  const averageDaysBetweenVisits = visits > 1
    ? Math.round((new Date(lastVisit!).getTime() - new Date(firstVisit!).getTime()) / DAY / (visits - 1))
    : undefined;
  return {
    visits, totalSpent, averageTicket: visits ? Math.round(totalSpent / visits) : 0,
    firstVisit, lastVisit, daysSinceLastVisit, averageDaysBetweenVisits, favoriteProducts, favoriteCategory,
    segment: segmentFor(visits, totalSpent, daysSinceLastVisit)
  };
}

export function segmentFor(visits: number, totalSpent: Money, daysSinceLastVisit?: number): CustomerSegment {
  if (daysSinceLastVisit === undefined || visits === 0) return "new";
  if (daysSinceLastVisit > 60) return "lost";
  if (daysSinceLastVisit > 30) return visits >= 2 ? "at_risk" : "lost";
  if (visits >= 10 || totalSpent >= 100_000) return "vip";
  if (visits >= 4) return "loyal";
  if (visits <= 1) return "new";
  return "regular";
}

export interface PromotionSuggestion {
  code: string;
  titleAr: string;
  reasonAr: string;
}

export function promotionSuggestions(insights: CustomerInsights): PromotionSuggestion[] {
  const suggestions: PromotionSuggestion[] = [];
  const favorite = insights.favoriteProducts[0];
  switch (insights.segment) {
    case "new":
      suggestions.push({ code: "WELCOME_BACK", titleAr: "خصم 10% على الزيارة الثانية", reasonAr: "العميل زارك مرة واحدة فقط، شجّعه على العودة" });
      break;
    case "at_risk":
      suggestions.push({ code: "WIN_BACK", titleAr: "عرض استرجاع: خصم 15% لمدة أسبوع", reasonAr: `لم يزرك منذ ${insights.daysSinceLastVisit} يومًا بعد أن كان يزورك بانتظام` });
      break;
    case "lost":
      suggestions.push({ code: "WE_MISS_YOU", titleAr: "رسالة \"اشتقنا لك\" مع مشروب مجاني", reasonAr: `آخر زيارة قبل ${insights.daysSinceLastVisit} يومًا` });
      break;
    case "vip":
      suggestions.push({ code: "VIP_PERK", titleAr: "ترقية مجانية للحجم أو إضافة مجانية", reasonAr: "من أعلى العملاء إنفاقًا وتكرارًا للزيارة" });
      break;
    case "loyal":
      suggestions.push({ code: "LOYALTY_STAMP", titleAr: "بطاقة ولاء: المشروب العاشر مجانًا", reasonAr: `يزورك كل ${insights.averageDaysBetweenVisits ?? "بضعة"} أيام تقريبًا` });
      break;
    case "regular":
      break;
  }
  if (favorite && favorite.quantity >= 3) {
    suggestions.push({ code: "FAVORITE_BUNDLE", titleAr: `عرض باقة مع ${favorite.name}`, reasonAr: `اشترى ${favorite.name} ${favorite.quantity} مرات` });
  }
  if (insights.visits >= 3 && insights.averageTicket < 2_500) {
    suggestions.push({ code: "UPSELL_SNACK", titleAr: "اقتراح إضافة مخبوزات مع الطلب", reasonAr: "متوسط فاتورته منخفض رغم تكرار الزيارة" });
  }
  return suggestions;
}
