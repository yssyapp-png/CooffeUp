import { useState } from "react";
import { formatSar, FREE_DRINK_POINTS, type CustomerInsights, type LoyaltySnapshot, type PromotionSuggestion } from "@cooffeup/shared";
import { Eye, Gift, UserPlus } from "lucide-react";
import { api } from "../api";
import { Notice, PageHeader, useAction, useLoad } from "../components";
import { useSession } from "../session";

interface CustomerView {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  marketingConsent: boolean;
  piiRevealed: boolean;
  insights: CustomerInsights & { segmentLabel: string };
  loyalty: LoyaltySnapshot & { tierLabel: string };
  suggestions?: PromotionSuggestion[];
}

export function Customers() {
  const { can } = useSession();
  const [query, setQuery] = useState("");
  const [version, setVersion] = useState(0);
  const list = useLoad(() => api<{ data: CustomerView[] }>(`/api/v1/customers${query ? `?q=${encodeURIComponent(query)}` : ""}`), [query, version]);
  const [selected, setSelected] = useState<CustomerView | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", marketingConsent: false });
  const action = useAction();

  const open = (id: string, reveal = false) => action.run(async () => {
    const { data } = await api<{ data: CustomerView }>(`/api/v1/customers/${id}${reveal ? "?reveal=true" : ""}`);
    setSelected(data);
  });

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const created = await action.run(() => api<{ data: CustomerView }>("/api/v1/customers", {
      method: "POST", body: { name: form.name, phone: form.phone || undefined, email: form.email || undefined, marketingConsent: form.marketingConsent }
    }), "تمت إضافة العميل");
    if (created) { setForm({ name: "", phone: "", email: "", marketingConsent: false }); setVersion((value) => value + 1); }
  }

  return <div className="page">
    <PageHeader eyebrow="السلوك الشرائي والعروض المقترحة" title="العملاء" actions={<input placeholder="بحث بالاسم أو الجوال" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="بحث" />} />
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    <div className="split">
      <div className="card">
        <div className="table-wrap"><table>
          <thead><tr><th>العميل</th><th>الجوال</th><th>الشريحة</th><th>النقاط</th><th>الزيارات</th><th>متوسط الفاتورة</th><th>آخر زيارة</th></tr></thead>
          <tbody>{(list.data?.data ?? []).map((customer) => <tr key={customer.id} className="clickable" onClick={() => open(customer.id)}>
            <td>{customer.name}</td><td dir="ltr">{customer.phone ?? "—"}</td><td><span className={`segment ${customer.insights.segment}`}>{customer.insights.segmentLabel}</span></td><td className="num">{customer.loyalty.points}</td>
            <td className="num">{customer.insights.visits}</td><td className="num">{formatSar(customer.insights.averageTicket)}</td>
            <td>{customer.insights.daysSinceLastVisit === undefined ? "—" : `قبل ${customer.insights.daysSinceLastVisit} يوم`}</td>
          </tr>)}</tbody>
        </table></div>
        {list.data?.data.length === 0 && <p className="muted center">لا يوجد عملاء بعد</p>}
      </div>

      <div className="stack">
        {selected && <div className="card">
          <h3>{selected.name}</h3>
          <p dir="ltr" className="muted">{selected.phone ?? "بدون جوال"} {selected.email && `· ${selected.email}`}</p>
          {!selected.piiRevealed && can("customers.view_pii") && selected.phone && <button className="ghost small" onClick={() => open(selected.id, true)}><Eye size={14} /> إظهار البيانات الكاملة (يُسجّل في سجل التدقيق)</button>}
          <div className="stats">
            <div><small>الزيارات</small><b>{selected.insights.visits}</b></div>
            <div><small>إجمالي المشتريات</small><b>{formatSar(selected.insights.totalSpent)}</b></div>
            <div><small>متوسط الفاتورة</small><b>{formatSar(selected.insights.averageTicket)}</b></div>
            <div><small>نقاط الولاء</small><b>{selected.loyalty.points}</b></div>
            <div><small>المستوى</small><b>{selected.loyalty.tierLabel}</b></div>
            <div><small>يزورك كل</small><b>{selected.insights.averageDaysBetweenVisits ? `${selected.insights.averageDaysBetweenVisits} يوم` : "—"}</b></div>
          </div>
          {selected.insights.favoriteProducts.length > 0 && <p>المفضّل: {selected.insights.favoriteProducts.map((product) => `${product.name} (${product.quantity})`).join("، ")}</p>}
          {selected.loyalty.freeDrinksAvailable > 0 && <Notice tone="success">يستحق {selected.loyalty.freeDrinksAvailable} مشروبًا مجانيًا ({FREE_DRINK_POINTS} نقطة لكل مشروب)</Notice>}
          <h4><Gift size={15} /> عروض مقترحة</h4>
          {selected.suggestions?.length ? <ul className="suggestions">{selected.suggestions.map((suggestion) => <li key={suggestion.code}><b>{suggestion.titleAr}</b><small>{suggestion.reasonAr}</small></li>)}</ul> : <p className="muted">لا توجد اقتراحات حاليًا</p>}
          {!selected.marketingConsent && <Notice tone="warning">العميل لم يوافق على الرسائل التسويقية</Notice>}
        </div>}

        {can("customers.manage") && <form className="card form" onSubmit={create}>
          <h3><UserPlus size={16} /> عميل جديد</h3>
          <label>الاسم<input required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>الجوال<input inputMode="tel" placeholder="05XXXXXXXX" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
          <label>البريد الإلكتروني<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={form.marketingConsent} onChange={(event) => setForm({ ...form, marketingConsent: event.target.checked })} /> يوافق على استلام العروض</label>
          <small className="muted">يُخزَّن الجوال والبريد مشفّرين، ويظهران مخفيين إلا لمن يملك الصلاحية.</small>
          <button className="primary" disabled={action.busy}>إضافة</button>
        </form>}
      </div>
    </div>
  </div>;
}
