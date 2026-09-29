import { useState } from "react";
import { accountByCode, type Account, type IncomeStatement, type JournalEntry, type TrialBalanceRow } from "@cooffeup/shared";
import { Download, Link2, Plus, Trash2 } from "lucide-react";
import { api, download } from "../api";
import { Notice, PageHeader, sarInput, useAction, useLoad } from "../components";
import { useI18n } from "../i18n";
import { useSession } from "../session";

interface Statements { trialBalance: TrialBalanceRow[]; incomeStatement: IncomeStatement; vat: { outputVat: number; inputVat: number; netPayable: number } }

export function Accounting() {
  const { can } = useSession();
  const { L, sar, lang } = useI18n();
  const accountName = (code: string, nameAr?: string) => (lang === "en" ? accountByCode(code)?.nameEn : undefined) ?? nameAr ?? accountByCode(code)?.nameAr ?? "";
  const [range, setRange] = useState({ from: "", to: "" });
  const [tab, setTab] = useState<"statements" | "journal" | "manual" | "connect">("statements");
  const query = new URLSearchParams(Object.entries(range).filter(([, value]) => value)).toString();
  const [version, setVersion] = useState(0);
  const statements = useLoad(() => api<{ data: Statements }>(`/api/v1/accounting/statements?${query}`), [query, version]);
  const journal = useLoad(() => api<{ data: JournalEntry[] }>(`/api/v1/accounting/journal?${query}`), [query, version]);
  const action = useAction();

  return <div className="page">
    <PageHeader eyebrow={L("قيود مؤتمتة لكل بيع وشراء ومصروف", "Automatic entries for every sale, purchase and expense")} title={L("المحاسبة", "Accounting")} actions={<>
      <label className="inline-field">{L("من", "From")}<input type="date" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} /></label>
      <label className="inline-field">{L("إلى", "To")}<input type="date" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} /></label>
      <button className="ghost" onClick={() => action.run(() => download(`/api/v1/accounting/export?format=csv&${query}`, "cooffeup-journal.csv"))}><Download size={15} /> {L("تصدير CSV", "Export CSV")}</button>
    </>} />
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    <div className="segmented inline">
      <button className={tab === "statements" ? "selected" : ""} onClick={() => setTab("statements")}>{L("القوائم المالية", "Financial statements")}</button>
      <button className={tab === "journal" ? "selected" : ""} onClick={() => setTab("journal")}>{L("دفتر اليومية", "Journal")}</button>
      {can("accounting.manage") && <button className={tab === "manual" ? "selected" : ""} onClick={() => setTab("manual")}>{L("قيد يدوي", "Manual entry")}</button>}
      {can("accounting.manage") && <button className={tab === "connect" ? "selected" : ""} onClick={() => setTab("connect")}>{L("ربط نظام محاسبي", "Connect accounting system")}</button>}
    </div>

    {tab === "statements" && statements.data && <div className="split">
      <div className="card">
        <h3>{L("قائمة الدخل", "Income statement")}</h3>
        <IncomeTable statement={statements.data.data.incomeStatement} />
        <h3>{L("ضريبة القيمة المضافة", "VAT")}</h3>
        <div className="stats">
          <div><small>{L("ضريبة المخرجات", "Output VAT")}</small><b>{sar(statements.data.data.vat.outputVat)}</b></div>
          <div><small>{L("ضريبة المدخلات", "Input VAT")}</small><b>{sar(statements.data.data.vat.inputVat)}</b></div>
          <div><small>{L("الصافي المستحق", "Net payable")}</small><b>{sar(statements.data.data.vat.netPayable)}</b></div>
        </div>
      </div>
      <div className="card">
        <h3>{L("ميزان المراجعة", "Trial balance")}</h3>
        <div className="table-wrap"><table>
          <thead><tr><th>{L("الحساب", "Account")}</th><th>{L("مدين", "Debit")}</th><th>{L("دائن", "Credit")}</th></tr></thead>
          <tbody>{statements.data.data.trialBalance.map((row) => <tr key={row.account}><td>{row.account} {accountName(row.account, row.nameAr)}</td><td className="num">{sar(row.debit)}</td><td className="num">{sar(row.credit)}</td></tr>)}</tbody>
          <tfoot><tr><td>{L("الإجمالي", "Total")}</td><td className="num">{sar(statements.data.data.trialBalance.reduce((s, r) => s + r.debit, 0))}</td><td className="num">{sar(statements.data.data.trialBalance.reduce((s, r) => s + r.credit, 0))}</td></tr></tfoot>
        </table></div>
      </div>
    </div>}

    {tab === "journal" && <div className="card">
      {(journal.data?.data ?? []).length === 0 ? <p className="muted">{L("لا توجد قيود", "No entries")}</p> : journal.data!.data.slice(0, 100).map((entry) => <div key={entry.id} className="journal-entry">
        <header><b>{L("قيد", "Entry")} {entry.number}</b><span>{entry.date}</span><span>{entry.description}</span></header>
        <table><tbody>{entry.lines.map((line, index) => <tr key={index}><td>{line.account} {accountName(line.account)}</td><td className="num">{line.debit ? sar(line.debit) : ""}</td><td className="num">{line.credit ? sar(line.credit) : ""}</td></tr>)}</tbody></table>
      </div>)}
    </div>}

    {tab === "manual" && <ManualEntry onSaved={() => { setVersion((value) => value + 1); setTab("journal"); }} />}
    {tab === "connect" && <AccountingWebhooks />}
  </div>;
}

function IncomeTable({ statement }: { statement: IncomeStatement }) {
  const { L, sar, lang } = useI18n();
  const rows: Array<[string, number, boolean?]> = [
    [L("إيرادات المبيعات", "Sales revenue"), statement.revenue], [L("مردودات المبيعات", "Sales returns"), -statement.returns], [L("صافي الإيرادات", "Net revenue"), statement.netRevenue, true],
    [L("تكلفة البضاعة المباعة", "Cost of goods sold"), -statement.cogs], [L("مجمل الربح", "Gross profit"), statement.grossProfit, true],
    ...statement.expenses.map((expense): [string, number] => [(lang === "en" ? accountByCode(expense.account)?.nameEn : undefined) ?? expense.nameAr, -expense.amount]), [L("صافي الربح", "Net profit"), statement.netIncome, true]
  ];
  return <table className="statement"><tbody>{rows.map(([label, value, strong]) => <tr key={label} className={strong ? "strong" : ""}><td>{label}</td><td className={`num ${value < 0 ? "negative" : ""}`}>{sar(value)}</td></tr>)}</tbody></table>;
}

function ManualEntry({ onSaved }: { onSaved: () => void }) {
  const { L, sar, lang } = useI18n();
  const accounts = useLoad(() => api<{ data: Account[] }>("/api/v1/accounting/accounts"));
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), description: "", lines: [{ account: "", debit: "", credit: "" }, { account: "", debit: "", credit: "" }] });
  const action = useAction();
  const debit = form.lines.reduce((sum, line) => sum + sarInput(line.debit), 0);
  const credit = form.lines.reduce((sum, line) => sum + sarInput(line.credit), 0);
  const setLine = (index: number, patch: Partial<(typeof form.lines)[number]>) => setForm({ ...form, lines: form.lines.map((line, i) => i === index ? { ...line, ...patch } : line) });

  return <form className="card form" onSubmit={async (event) => {
    event.preventDefault();
    const saved = await action.run(() => api("/api/v1/accounting/journal", { method: "POST", body: { date: form.date, description: form.description, lines: form.lines.map((line) => ({ account: line.account, debit: sarInput(line.debit), credit: sarInput(line.credit) })) } }), L("تم ترحيل القيد", "Entry posted"));
    if (saved) onSaved();
  }}>
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    <div className="grid-2"><label>{L("التاريخ", "Date")}<input type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
      <label>{L("البيان", "Description")}<input required minLength={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label></div>
    <table className="edit"><thead><tr><th>{L("الحساب", "Account")}</th><th>{L("مدين", "Debit")}</th><th>{L("دائن", "Credit")}</th><th /></tr></thead><tbody>{form.lines.map((line, index) => <tr key={index}>
      <td><select required value={line.account} onChange={(event) => setLine(index, { account: event.target.value })} aria-label={L("الحساب", "Account")}><option value="">{L("اختر الحساب", "Choose account")}</option>{accounts.data?.data.map((account) => <option key={account.code} value={account.code}>{account.code} {lang === "en" ? account.nameEn : account.nameAr}</option>)}</select></td>
      <td><input inputMode="decimal" value={line.debit} onChange={(event) => setLine(index, { debit: event.target.value, credit: "" })} aria-label={L("مدين", "Debit")} /></td>
      <td><input inputMode="decimal" value={line.credit} onChange={(event) => setLine(index, { credit: event.target.value, debit: "" })} aria-label={L("دائن", "Credit")} /></td>
      <td>{form.lines.length > 2 && <button type="button" className="icon" onClick={() => setForm({ ...form, lines: form.lines.filter((_, i) => i !== index) })} aria-label={L("حذف", "Remove")}><Trash2 size={14} /></button>}</td>
    </tr>)}</tbody><tfoot><tr><td>{L("الإجمالي", "Total")}</td><td className="num">{sar(debit)}</td><td className="num">{sar(credit)}</td><td /></tr></tfoot></table>
    <button type="button" className="link" onClick={() => setForm({ ...form, lines: [...form.lines, { account: "", debit: "", credit: "" }] })}><Plus size={14} /> {L("سطر", "Line")}</button>
    {debit !== credit && <Notice tone="warning">{L("القيد غير متوازن: الفرق", "Entry is unbalanced: difference")} {sar(Math.abs(debit - credit))}</Notice>}
    <button className="primary" disabled={action.busy || debit !== credit || debit === 0}>{L("ترحيل القيد", "Post entry")}</button>
  </form>;
}

interface WebhookView { id: string; name: string; url: string; events: string[]; enabled: boolean }
interface DeliveryView { id: string; webhookId: string; event: string; status: string; attempts: number; responseStatus?: number; lastError?: string; createdAt: string }
const eventLabels = (L: (ar: string, en: string) => string): Record<string, string> => ({
  "order.created": L("فاتورة مبيعات", "Sales invoice"), "order.refunded": L("مرتجع", "Refund"), "purchase.created": L("فاتورة مشتريات", "Purchase invoice"), "expense.created": L("مصروف", "Expense"), "journal.posted": L("قيد محاسبي", "Journal entry"), "shift.closed": L("إغلاق صندوق", "Shift close")
});

function AccountingWebhooks() {
  const { L, lang, dateTime } = useI18n();
  const EVENT_LABELS = eventLabels(L);
  const [version, setVersion] = useState(0);
  const data = useLoad(() => api<{ data: WebhookView[]; deliveries: DeliveryView[] }>("/api/v1/accounting/webhooks"), [version]);
  const [form, setForm] = useState({ name: "", url: "", events: ["journal.posted"] as string[] });
  const [secret, setSecret] = useState("");
  const action = useAction();
  const reload = () => setVersion((value) => value + 1);

  return <div className="split">
    <form className="card form" onSubmit={async (event) => {
      event.preventDefault();
      const created = await action.run(() => api<{ secret: string }>("/api/v1/accounting/webhooks", { method: "POST", body: form }));
      if (created) { setSecret(created.secret); setForm({ name: "", url: "", events: ["journal.posted"] }); reload(); }
    }}>
      <h3><Link2 size={16} /> {L("ربط نظام محاسبي أو تطبيق من سوق زد", "Connect an accounting system or a Zid marketplace app")}</h3>
      <p className="muted">{L("يرسل CooffeUp كل حدث مالي إلى الرابط الذي تحدده، موقّعًا بتوقيع HMAC-SHA256 في الترويسة", "CooffeUp sends every financial event to the URL you set, signed with HMAC-SHA256 in the header")} <code>x-cooffeup-signature</code>.</p>
      {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
      {secret && <Notice tone="success">{L("مفتاح التوقيع (يظهر مرة واحدة فقط، احفظه في النظام المستقبِل):", "Signing secret (shown once only — save it in the receiving system):")} <code dir="ltr">{secret}</code></Notice>}
      <label>{L("الاسم", "Name")}<input required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={L("مثال: قيود، دفترة، نظام ERP", "e.g. Qoyod, Daftra, an ERP")} /></label>
      <label>{L("الرابط", "URL")}<input type="url" required dir="ltr" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://" /></label>
      <fieldset><legend>{L("الأحداث", "Events")}</legend>{Object.entries(EVENT_LABELS).map(([event, label]) => <label key={event} className="check">
        <input type="checkbox" checked={form.events.includes(event)} onChange={(change) => setForm({ ...form, events: change.target.checked ? [...form.events, event] : form.events.filter((value) => value !== event) })} /> {label}
      </label>)}</fieldset>
      <button className="primary" disabled={action.busy || !form.events.length}>{L("إضافة الربط", "Add connection")}</button>
    </form>
    <div className="card">
      <h3>{L("الروابط الحالية", "Current connections")}</h3>
      {(data.data?.data ?? []).length === 0 ? <p className="muted">{L("لا توجد روابط", "No connections")}</p> : <ul className="list">{data.data!.data.map((hook) => <li key={hook.id}>
        <div><b>{hook.name}</b><small dir="ltr">{hook.url}</small><small>{hook.events.map((event) => EVENT_LABELS[event]).join(lang === "ar" ? "، " : ", ")}</small></div>
        <div className="row">
          <label className="check"><input type="checkbox" checked={hook.enabled} onChange={async (event) => { await action.run(() => api(`/api/v1/accounting/webhooks/${hook.id}`, { method: "PATCH", body: { enabled: event.target.checked } })); reload(); }} /> {L("مفعّل", "Enabled")}</label>
          <button className="icon danger" aria-label={L("حذف", "Remove")} onClick={async () => { await action.run(() => api(`/api/v1/accounting/webhooks/${hook.id}`, { method: "DELETE" })); reload(); }}><Trash2 size={14} /></button>
        </div>
      </li>)}</ul>}
      <h3>{L("سجل الإرسال", "Delivery log")}</h3>
      <ul className="list">{(data.data?.deliveries ?? []).slice(0, 20).map((delivery) => <li key={delivery.id}>
        <div><b>{EVENT_LABELS[delivery.event]}</b><small>{dateTime(delivery.createdAt)} · {L("محاولات", "attempts")} {delivery.attempts}{delivery.lastError ? ` · ${delivery.lastError}` : ""}</small></div>
        <div className="row"><span className={`pill ${delivery.status}`}>{delivery.status === "delivered" ? L("تم", "Delivered") : delivery.status === "failed" ? L("فشل", "Failed") : L("قيد الإرسال", "Sending")}</span>
          {delivery.status !== "delivered" && <button className="ghost small" onClick={async () => { await action.run(() => api(`/api/v1/accounting/webhook-deliveries/${delivery.id}/retry`, { method: "POST" })); reload(); }}>{L("إعادة", "Retry")}</button>}</div>
      </li>)}</ul>
    </div>
  </div>;
}
