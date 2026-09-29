import { useState } from "react";
import { FREE_DRINK_POINTS, type CustomerInsights, type LoyaltySnapshot, type PromotionSuggestion } from "@cooffeup/shared";
import { Eye, Gift, UserPlus } from "lucide-react";
import { api } from "../api";
import { Notice, PageHeader, useAction, useLoad } from "../components";
import { useI18n } from "../i18n";
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
  const { L, tx, sar, lang } = useI18n();
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
    }), L("تمت إضافة العميل", "Customer added"));
    if (created) { setForm({ name: "", phone: "", email: "", marketingConsent: false }); setVersion((value) => value + 1); }
  }

  return <div className="page">
    <PageHeader eyebrow={L("السلوك الشرائي والعروض المقترحة", "Purchase behaviour and suggested offers")} title={L("العملاء", "Customers")} actions={<input placeholder={L("بحث بالاسم أو الجوال", "Search by name or mobile")} value={query} onChange={(event) => setQuery(event.target.value)} aria-label={L("بحث", "Search")} />} />
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    <div className="split">
      <div className="card">
        <div className="table-wrap"><table>
          <thead><tr><th>{L("العميل", "Customer")}</th><th>{L("الجوال", "Mobile")}</th><th>{L("الشريحة", "Segment")}</th><th>{L("النقاط", "Points")}</th><th>{L("الزيارات", "Visits")}</th><th>{L("متوسط الفاتورة", "Average ticket")}</th><th>{L("آخر زيارة", "Last visit")}</th></tr></thead>
          <tbody>{(list.data?.data ?? []).map((customer) => <tr key={customer.id} className="clickable" onClick={() => open(customer.id)}>
            <td>{customer.name}</td><td dir="ltr">{customer.phone ?? "—"}</td><td><span className={`segment ${customer.insights.segment}`}>{tx(customer.insights.segmentLabel)}</span></td><td className="num">{customer.loyalty.points}</td>
            <td className="num">{customer.insights.visits}</td><td className="num">{sar(customer.insights.averageTicket)}</td>
            <td>{customer.insights.daysSinceLastVisit === undefined ? "—" : L(`قبل ${customer.insights.daysSinceLastVisit} يوم`, `${customer.insights.daysSinceLastVisit} days ago`)}</td>
          </tr>)}</tbody>
        </table></div>
        {list.data?.data.length === 0 && <p className="muted center">{L("لا يوجد عملاء بعد", "No customers yet")}</p>}
      </div>

      <div className="stack">
        {selected && <div className="card">
          <h3>{selected.name}</h3>
          <p dir="ltr" className="muted">{selected.phone ?? L("بدون جوال", "No mobile")} {selected.email && `· ${selected.email}`}</p>
          {!selected.piiRevealed && can("customers.view_pii") && selected.phone && <button className="ghost small" onClick={() => open(selected.id, true)}><Eye size={14} /> {L("إظهار البيانات الكاملة (يُسجّل في سجل التدقيق)", "Reveal full details (recorded in the audit log)")}</button>}
          <div className="stats">
            <div><small>{L("الزيارات", "Visits")}</small><b>{selected.insights.visits}</b></div>
            <div><small>{L("إجمالي المشتريات", "Total spent")}</small><b>{sar(selected.insights.totalSpent)}</b></div>
            <div><small>{L("متوسط الفاتورة", "Average ticket")}</small><b>{sar(selected.insights.averageTicket)}</b></div>
            <div><small>{L("نقاط الولاء", "Loyalty points")}</small><b>{selected.loyalty.points}</b></div>
            <div><small>{L("المستوى", "Tier")}</small><b>{selected.loyalty.tierLabel}</b></div>
            <div><small>{L("يزورك كل", "Visits every")}</small><b>{selected.insights.averageDaysBetweenVisits ? `${selected.insights.averageDaysBetweenVisits} ${L("يوم", "days")}` : "—"}</b></div>
          </div>
          {selected.insights.favoriteProducts.length > 0 && <p>{L("المفضّل", "Favourites")}: {selected.insights.favoriteProducts.map((product) => `${product.name} (${product.quantity})`).join(lang === "ar" ? "، " : ", ")}</p>}
          {selected.loyalty.freeDrinksAvailable > 0 && <Notice tone="success">{L(`يستحق ${selected.loyalty.freeDrinksAvailable} مشروبًا مجانيًا (${FREE_DRINK_POINTS} نقطة لكل مشروب)`, `Eligible for ${selected.loyalty.freeDrinksAvailable} free drink(s) (${FREE_DRINK_POINTS} points each)`)}</Notice>}
          <h4><Gift size={15} /> {L("عروض مقترحة", "Suggested offers")}</h4>
          {selected.suggestions?.length ? <ul className="suggestions">{selected.suggestions.map((suggestion) => <li key={suggestion.code}><b>{L(suggestion.titleAr, suggestion.titleEn)}</b><small>{L(suggestion.reasonAr, suggestion.reasonEn)}</small></li>)}</ul> : <p className="muted">{L("لا توجد اقتراحات حاليًا", "No suggestions right now")}</p>}
          {!selected.marketingConsent && <Notice tone="warning">{L("العميل لم يوافق على الرسائل التسويقية", "The customer has not agreed to marketing messages")}</Notice>}
        </div>}

        {can("customers.manage") && <form className="card form" onSubmit={create}>
          <h3><UserPlus size={16} /> {L("عميل جديد", "New customer")}</h3>
          <label>{L("الاسم", "Name")}<input required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>{L("الجوال", "Mobile")}<input inputMode="tel" placeholder="05XXXXXXXX" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
          <label>{L("البريد الإلكتروني", "Email")}<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={form.marketingConsent} onChange={(event) => setForm({ ...form, marketingConsent: event.target.checked })} /> {L("يوافق على استلام العروض", "Agrees to receive offers")}</label>
          <small className="muted">{L("يُخزَّن الجوال والبريد مشفّرين، ويظهران مخفيين إلا لمن يملك الصلاحية.", "Mobile and email are stored encrypted and shown masked unless you have permission.")}</small>
          <button className="primary" disabled={action.busy}>{L("إضافة", "Add")}</button>
        </form>}
      </div>
    </div>
  </div>;
}
