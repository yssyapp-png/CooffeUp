import { useState } from "react";
import { accountByCode, formatSar, type Account, type IncomeStatement, type JournalEntry, type TrialBalanceRow } from "@cooffeup/shared";
import { Download, Link2, Plus, Trash2 } from "lucide-react";
import { api, download } from "../api";
import { Notice, PageHeader, sarInput, useAction, useLoad } from "../components";
import { useSession } from "../session";

interface Statements { trialBalance: TrialBalanceRow[]; incomeStatement: IncomeStatement; vat: { outputVat: number; inputVat: number; netPayable: number } }

export function Accounting() {
  const { can } = useSession();
  const [range, setRange] = useState({ from: "", to: "" });
  const [tab, setTab] = useState<"statements" | "journal" | "manual" | "connect">("statements");
  const query = new URLSearchParams(Object.entries(range).filter(([, value]) => value)).toString();
  const [version, setVersion] = useState(0);
  const statements = useLoad(() => api<{ data: Statements }>(`/api/v1/accounting/statements?${query}`), [query, version]);
  const journal = useLoad(() => api<{ data: JournalEntry[] }>(`/api/v1/accounting/journal?${query}`), [query, version]);
  const action = useAction();

  return <div className="page">
    <PageHeader eyebrow="قيود مؤتمتة لكل بيع وشراء ومصروف" title="المحاسبة" actions={<>
      <label className="inline-field">من<input type="date" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} /></label>
      <label className="inline-field">إلى<input type="date" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} /></label>
      <button className="ghost" onClick={() => action.run(() => download(`/api/v1/accounting/export?format=csv&${query}`, "cooffeup-journal.csv"))}><Download size={15} /> تصدير CSV</button>
    </>} />
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    <div className="segmented inline">
      <button className={tab === "statements" ? "selected" : ""} onClick={() => setTab("statements")}>القوائم المالية</button>
      <button className={tab === "journal" ? "selected" : ""} onClick={() => setTab("journal")}>دفتر اليومية</button>
      {can("accounting.manage") && <button className={tab === "manual" ? "selected" : ""} onClick={() => setTab("manual")}>قيد يدوي</button>}
      {can("accounting.manage") && <button className={tab === "connect" ? "selected" : ""} onClick={() => setTab("connect")}>ربط نظام محاسبي</button>}
    </div>

    {tab === "statements" && statements.data && <div className="split">
      <div className="card">
        <h3>قائمة الدخل</h3>
        <IncomeTable statement={statements.data.data.incomeStatement} />
        <h3>ضريبة القيمة المضافة</h3>
        <div className="stats">
          <div><small>ضريبة المخرجات</small><b>{formatSar(statements.data.data.vat.outputVat)}</b></div>
          <div><small>ضريبة المدخلات</small><b>{formatSar(statements.data.data.vat.inputVat)}</b></div>
          <div><small>الصافي المستحق</small><b>{formatSar(statements.data.data.vat.netPayable)}</b></div>
        </div>
      </div>
      <div className="card">
        <h3>ميزان المراجعة</h3>
        <div className="table-wrap"><table>
          <thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th></tr></thead>
          <tbody>{statements.data.data.trialBalance.map((row) => <tr key={row.account}><td>{row.account} {row.nameAr}</td><td className="num">{formatSar(row.debit)}</td><td className="num">{formatSar(row.credit)}</td></tr>)}</tbody>
          <tfoot><tr><td>الإجمالي</td><td className="num">{formatSar(statements.data.data.trialBalance.reduce((s, r) => s + r.debit, 0))}</td><td className="num">{formatSar(statements.data.data.trialBalance.reduce((s, r) => s + r.credit, 0))}</td></tr></tfoot>
        </table></div>
      </div>
    </div>}

    {tab === "journal" && <div className="card">
      {(journal.data?.data ?? []).length === 0 ? <p className="muted">لا توجد قيود</p> : journal.data!.data.slice(0, 100).map((entry) => <div key={entry.id} className="journal-entry">
        <header><b>قيد {entry.number}</b><span>{entry.date}</span><span>{entry.description}</span></header>
        <table><tbody>{entry.lines.map((line, index) => <tr key={index}><td>{line.account} {accountByCode(line.account)?.nameAr}</td><td className="num">{line.debit ? formatSar(line.debit) : ""}</td><td className="num">{line.credit ? formatSar(line.credit) : ""}</td></tr>)}</tbody></table>
      </div>)}
    </div>}

    {tab === "manual" && <ManualEntry onSaved={() => { setVersion((value) => value + 1); setTab("journal"); }} />}
    {tab === "connect" && <AccountingWebhooks />}
  </div>;
}

function IncomeTable({ statement }: { statement: IncomeStatement }) {
  const rows: Array<[string, number, boolean?]> = [
    ["إيرادات المبيعات", statement.revenue], ["مردودات المبيعات", -statement.returns], ["صافي الإيرادات", statement.netRevenue, true],
    ["تكلفة البضاعة المباعة", -statement.cogs], ["مجمل الربح", statement.grossProfit, true],
    ...statement.expenses.map((expense): [string, number] => [expense.nameAr, -expense.amount]), ["صافي الربح", statement.netIncome, true]
  ];
  return <table className="statement"><tbody>{rows.map(([label, value, strong]) => <tr key={label} className={strong ? "strong" : ""}><td>{label}</td><td className={`num ${value < 0 ? "negative" : ""}`}>{formatSar(value)}</td></tr>)}</tbody></table>;
}

function ManualEntry({ onSaved }: { onSaved: () => void }) {
  const accounts = useLoad(() => api<{ data: Account[] }>("/api/v1/accounting/accounts"));
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), description: "", lines: [{ account: "", debit: "", credit: "" }, { account: "", debit: "", credit: "" }] });
  const action = useAction();
  const debit = form.lines.reduce((sum, line) => sum + sarInput(line.debit), 0);
  const credit = form.lines.reduce((sum, line) => sum + sarInput(line.credit), 0);
  const setLine = (index: number, patch: Partial<(typeof form.lines)[number]>) => setForm({ ...form, lines: form.lines.map((line, i) => i === index ? { ...line, ...patch } : line) });

  return <form className="card form" onSubmit={async (event) => {
    event.preventDefault();
    const saved = await action.run(() => api("/api/v1/accounting/journal", { method: "POST", body: { date: form.date, description: form.description, lines: form.lines.map((line) => ({ account: line.account, debit: sarInput(line.debit), credit: sarInput(line.credit) })) } }), "تم ترحيل القيد");
    if (saved) onSaved();
  }}>
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    <div className="grid-2"><label>التاريخ<input type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
      <label>البيان<input required minLength={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label></div>
    <table className="edit"><thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th><th /></tr></thead><tbody>{form.lines.map((line, index) => <tr key={index}>
      <td><select required value={line.account} onChange={(event) => setLine(index, { account: event.target.value })} aria-label="الحساب"><option value="">اختر الحساب</option>{accounts.data?.data.map((account) => <option key={account.code} value={account.code}>{account.code} {account.nameAr}</option>)}</select></td>
      <td><input inputMode="decimal" value={line.debit} onChange={(event) => setLine(index, { debit: event.target.value, credit: "" })} aria-label="مدين" /></td>
      <td><input inputMode="decimal" value={line.credit} onChange={(event) => setLine(index, { credit: event.target.value, debit: "" })} aria-label="دائن" /></td>
      <td>{form.lines.length > 2 && <button type="button" className="icon" onClick={() => setForm({ ...form, lines: form.lines.filter((_, i) => i !== index) })} aria-label="حذف"><Trash2 size={14} /></button>}</td>
    </tr>)}</tbody><tfoot><tr><td>الإجمالي</td><td className="num">{formatSar(debit)}</td><td className="num">{formatSar(credit)}</td><td /></tr></tfoot></table>
    <button type="button" className="link" onClick={() => setForm({ ...form, lines: [...form.lines, { account: "", debit: "", credit: "" }] })}><Plus size={14} /> سطر</button>
    {debit !== credit && <Notice tone="warning">القيد غير متوازن: الفرق {formatSar(Math.abs(debit - credit))}</Notice>}
    <button className="primary" disabled={action.busy || debit !== credit || debit === 0}>ترحيل القيد</button>
  </form>;
}

interface WebhookView { id: string; name: string; url: string; events: string[]; enabled: boolean }
interface DeliveryView { id: string; webhookId: string; event: string; status: string; attempts: number; responseStatus?: number; lastError?: string; createdAt: string }
const EVENT_LABELS: Record<string, string> = {
  "order.created": "فاتورة مبيعات", "order.refunded": "مرتجع", "purchase.created": "فاتورة مشتريات", "expense.created": "مصروف", "journal.posted": "قيد محاسبي", "shift.closed": "إغلاق صندوق"
};

function AccountingWebhooks() {
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
      <h3><Link2 size={16} /> ربط نظام محاسبي أو تطبيق من سوق زد</h3>
      <p className="muted">يرسل CooffeUp كل حدث مالي إلى الرابط الذي تحدده، موقّعًا بتوقيع HMAC-SHA256 في الترويسة <code>x-cooffeup-signature</code>.</p>
      {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
      {secret && <Notice tone="success">مفتاح التوقيع (يظهر مرة واحدة فقط، احفظه في النظام المستقبِل): <code dir="ltr">{secret}</code></Notice>}
      <label>الاسم<input required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="مثال: قيود، دفترة، نظام ERP" /></label>
      <label>الرابط<input type="url" required dir="ltr" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://" /></label>
      <fieldset><legend>الأحداث</legend>{Object.entries(EVENT_LABELS).map(([event, label]) => <label key={event} className="check">
        <input type="checkbox" checked={form.events.includes(event)} onChange={(change) => setForm({ ...form, events: change.target.checked ? [...form.events, event] : form.events.filter((value) => value !== event) })} /> {label}
      </label>)}</fieldset>
      <button className="primary" disabled={action.busy || !form.events.length}>إضافة الربط</button>
    </form>
    <div className="card">
      <h3>الروابط الحالية</h3>
      {(data.data?.data ?? []).length === 0 ? <p className="muted">لا توجد روابط</p> : <ul className="list">{data.data!.data.map((hook) => <li key={hook.id}>
        <div><b>{hook.name}</b><small dir="ltr">{hook.url}</small><small>{hook.events.map((event) => EVENT_LABELS[event]).join("، ")}</small></div>
        <div className="row">
          <label className="check"><input type="checkbox" checked={hook.enabled} onChange={async (event) => { await action.run(() => api(`/api/v1/accounting/webhooks/${hook.id}`, { method: "PATCH", body: { enabled: event.target.checked } })); reload(); }} /> مفعّل</label>
          <button className="icon danger" aria-label="حذف" onClick={async () => { await action.run(() => api(`/api/v1/accounting/webhooks/${hook.id}`, { method: "DELETE" })); reload(); }}><Trash2 size={14} /></button>
        </div>
      </li>)}</ul>}
      <h3>سجل الإرسال</h3>
      <ul className="list">{(data.data?.deliveries ?? []).slice(0, 20).map((delivery) => <li key={delivery.id}>
        <div><b>{EVENT_LABELS[delivery.event]}</b><small>{new Date(delivery.createdAt).toLocaleString("ar-SA")} · محاولات {delivery.attempts}{delivery.lastError ? ` · ${delivery.lastError}` : ""}</small></div>
        <div className="row"><span className={`pill ${delivery.status}`}>{delivery.status === "delivered" ? "تم" : delivery.status === "failed" ? "فشل" : "قيد الإرسال"}</span>
          {delivery.status !== "delivered" && <button className="ghost small" onClick={async () => { await action.run(() => api(`/api/v1/accounting/webhook-deliveries/${delivery.id}/retry`, { method: "POST" })); reload(); }}>إعادة</button>}</div>
      </li>)}</ul>
    </div>
  </div>;
}
