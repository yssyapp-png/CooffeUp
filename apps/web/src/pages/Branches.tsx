import { useState } from "react";
import type { Branch, StockTransfer } from "@cooffeup/shared";
import { ArrowLeftRight, Plus, Store, Tent, Trash2 } from "lucide-react";
import { api } from "../api";
import { Notice, PageHeader, useAction, useLoad } from "../components";
import { useSession } from "../session";

interface BranchView extends Branch { isOpen: boolean; hasOpenShift: boolean; units: number }
interface StockRow { productId: string; sku: string; nameAr: string; quantity: number; totalStock: number }

const toIso = (local: string) => (local ? new Date(local).toISOString() : undefined);
const toLocal = (iso?: string) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "");
const dateTime = new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium", timeStyle: "short" });

/** Permanent branches, temporary booths (exhibitions, events), stock per branch and transfers. */
export function Branches() {
  const { can, reloadBranches, reloadSettings } = useSession();
  const [version, setVersion] = useState(0);
  const list = useLoad(() => api<{ data: BranchView[]; fulfilmentBranchId: string }>("/api/v1/branches"), [version]);
  const branches = list.data?.data ?? [];
  const active = branches.filter((branch) => branch.active);
  const stock = useLoad(async () => {
    if (!can("inventory.manage")) return {} as Record<string, StockRow[]>;
    const rows = await Promise.all(active.map(async (branch) => [branch.id, (await api<{ data: StockRow[] }>(`/api/v1/branches/${branch.id}/stock`)).data] as const));
    return Object.fromEntries(rows);
  }, [version, active.map((branch) => branch.id).join()]);
  const transfers = useLoad(() => (can("inventory.manage") ? api<{ data: StockTransfer[] }>("/api/v1/stock-transfers") : Promise.resolve({ data: [] })), [version]);
  const action = useAction();
  const manage = can("branches.manage");
  const reload = () => { setVersion((value) => value + 1); void reloadBranches(); };
  const nameOf = (id: string) => branches.find((branch) => branch.id === id)?.name ?? id;
  const products = stock.data ? Object.values(stock.data)[0] ?? [] : [];

  const [form, setForm] = useState({ name: "", kind: "temporary" as Branch["kind"], startsAt: "", endsAt: "", syncToStore: false, address: "" });
  const [move, setMove] = useState({ fromBranchId: "main", toBranchId: "", note: "", lines: [{ productId: "", quantity: "1" }] });
  const [closing, setClosing] = useState<{ id: string; returnTo: string } | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const saved = await action.run(() => api("/api/v1/branches", { method: "POST", body: {
      name: form.name, kind: form.kind, syncToStore: form.syncToStore, address: form.address || undefined, startsAt: toIso(form.startsAt), endsAt: toIso(form.endsAt)
    } }), form.kind === "temporary" ? "تم إنشاء البوث" : "تم إنشاء الفرع");
    if (saved) { setForm({ ...form, name: "", startsAt: "", endsAt: "", address: "" }); reload(); }
  }

  async function transfer(event: React.FormEvent) {
    event.preventDefault();
    const saved = await action.run(() => api("/api/v1/stock-transfers", { method: "POST", body: {
      fromBranchId: move.fromBranchId, toBranchId: move.toBranchId, note: move.note || undefined,
      lines: move.lines.filter((line) => line.productId).map((line) => ({ productId: line.productId, quantity: Number(line.quantity) }))
    } }), "تم نقل المخزون");
    if (saved) { setMove({ ...move, note: "", lines: [{ productId: "", quantity: "1" }] }); reload(); }
  }

  const update = async (branch: BranchView, patch: Partial<Branch>) => {
    await action.run(() => api(`/api/v1/branches/${branch.id}`, { method: "PATCH", body: patch }), "تم حفظ التعديل");
    reload();
  };

  return <div className="page">
    <PageHeader eyebrow="فروع دائمة وبوثات مؤقتة للمعارض والفعاليات" title="الفروع والمخزون" />
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    {list.error && <Notice tone="error">{list.error}</Notice>}

    <div className="cards">{branches.map((branch) => <article key={branch.id} className={`card branch-card ${branch.active ? "" : "inactive"}`}>
      <div className="row between">
        <h3>{branch.kind === "temporary" ? <Tent size={17} /> : <Store size={17} />} {branch.name}</h3>
        <span className={`pill ${branch.isOpen ? "processed" : "failed"}`}>{!branch.active ? "مغلق" : branch.isOpen ? "يعمل الآن" : "خارج فترة العمل"}</span>
      </div>
      <small className="muted">{branch.kind === "temporary" ? "بوث مؤقت" : "فرع دائم"} · {branch.units} قطعة في المخزون{branch.hasOpenShift ? " · وردية مفتوحة" : ""}</small>
      {(branch.startsAt || branch.endsAt) && <small>{branch.startsAt ? dateTime.format(new Date(branch.startsAt)) : "—"} ← {branch.endsAt ? dateTime.format(new Date(branch.endsAt)) : "—"}</small>}
      {list.data?.fulfilmentBranchId === branch.id && <small className="positive">يجهّز طلبات المتجر الإلكتروني وتطبيقات التوصيل</small>}
      {manage && branch.active && <>
        <label className="check"><input type="checkbox" checked={branch.syncToStore} onChange={(event) => update(branch, { syncToStore: event.target.checked })} /> مخزونه متاح للبيع في المتجر الإلكتروني (زد وسلة)</label>
        {branch.kind === "temporary" && <div className="grid-2">
          <label>البداية<input type="datetime-local" defaultValue={toLocal(branch.startsAt)} onBlur={(event) => event.target.value !== toLocal(branch.startsAt) && update(branch, { startsAt: toIso(event.target.value) })} /></label>
          <label>النهاية<input type="datetime-local" defaultValue={toLocal(branch.endsAt)} onBlur={(event) => event.target.value !== toLocal(branch.endsAt) && update(branch, { endsAt: toIso(event.target.value) })} /></label>
        </div>}
        {branch.kind === "temporary" && (closing?.id === branch.id
          ? <div className="row wrap">
            <label>إرجاع المخزون إلى<select value={closing.returnTo} onChange={(event) => setClosing({ ...closing, returnTo: event.target.value })}>
              {active.filter((other) => other.id !== branch.id).map((other) => <option key={other.id} value={other.id}>{other.name}</option>)}</select></label>
            <button className="primary small" disabled={action.busy} onClick={async () => {
              await action.run(() => api(`/api/v1/branches/${branch.id}/close`, { method: "POST", body: { returnToBranchId: closing.returnTo } }), "تم إغلاق البوث وإرجاع مخزونه");
              setClosing(null); reload();
            }}>تأكيد الإغلاق</button>
            <button className="ghost small" onClick={() => setClosing(null)}>إلغاء</button>
          </div>
          : <button className="ghost small danger" onClick={() => setClosing({ id: branch.id, returnTo: "main" })}>إنهاء البوث وإرجاع المخزون</button>)}
        {branch.kind === "permanent" && branch.id !== "main" && <button className="ghost small danger" onClick={() => update(branch, { active: false })}>إيقاف الفرع</button>}
      </>}
      {manage && !branch.active && branch.kind === "permanent" && <button className="ghost small" onClick={() => update(branch, { active: true })}>إعادة تفعيل</button>}
    </article>)}</div>

    {manage && can("staff.manage") && active.length > 1 && <div className="card form compact">
      <label>الفرع الذي يجهّز طلبات المتجر وتطبيقات التوصيل
        <select value={list.data?.fulfilmentBranchId ?? "main"} onChange={async (event) => {
          await action.run(() => api("/api/v1/settings", { method: "PATCH", body: { fulfilmentBranchId: event.target.value } }), "تم تغيير فرع التجهيز");
          await reloadSettings(); reload();
        }}>{active.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select>
      </label>
    </div>}

    <div className="split">
      {manage && <form className="card form" onSubmit={create}>
        <h3><Plus size={16} /> فرع أو بوث جديد</h3>
        <div className="segmented inline">
          <button type="button" className={form.kind === "temporary" ? "selected" : ""} onClick={() => setForm({ ...form, kind: "temporary", syncToStore: false })}>بوث مؤقت</button>
          <button type="button" className={form.kind === "permanent" ? "selected" : ""} onClick={() => setForm({ ...form, kind: "permanent", syncToStore: true })}>فرع دائم</button>
        </div>
        <label>الاسم<input required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={form.kind === "temporary" ? "بوث معرض الرياض للقهوة" : "فرع العليا"} /></label>
        <div className="grid-2">
          <label>البداية<input type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} /></label>
          <label>النهاية{form.kind === "temporary" && " (مطلوبة)"}<input type="datetime-local" required={form.kind === "temporary"} value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} /></label>
        </div>
        <label>العنوان<input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={form.syncToStore} onChange={(event) => setForm({ ...form, syncToStore: event.target.checked })} /> مخزونه متاح للبيع في المتجر الإلكتروني</label>
        <small className="muted">البوث المؤقت يبيع فقط بين تاريخي البداية والنهاية، وعند إنهائه يعود مخزونه المتبقي إلى الفرع الذي تختاره.</small>
        <button className="primary" disabled={action.busy}>إنشاء</button>
      </form>}

      {manage && active.length > 1 && <form className="card form" onSubmit={transfer}>
        <h3><ArrowLeftRight size={16} /> نقل مخزون بين الفروع</h3>
        <div className="grid-2">
          <label>من<select value={move.fromBranchId} onChange={(event) => setMove({ ...move, fromBranchId: event.target.value })}>{active.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <label>إلى<select required value={move.toBranchId} onChange={(event) => setMove({ ...move, toBranchId: event.target.value })}>
            <option value="">اختر الفرع</option>{active.filter((branch) => branch.id !== move.fromBranchId).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        </div>
        {move.lines.map((line, index) => <div key={index} className="row">
          <select aria-label="المنتج" value={line.productId} onChange={(event) => setMove({ ...move, lines: move.lines.map((row, i) => i === index ? { ...row, productId: event.target.value } : row) })}>
            <option value="">اختر المنتج</option>
            {(stock.data?.[move.fromBranchId] ?? []).map((row) => <option key={row.productId} value={row.productId} disabled={row.quantity <= 0}>{row.nameAr} — متوفر {row.quantity}</option>)}
          </select>
          <input type="number" min={1} aria-label="الكمية" value={line.quantity} onChange={(event) => setMove({ ...move, lines: move.lines.map((row, i) => i === index ? { ...row, quantity: event.target.value } : row) })} />
          {move.lines.length > 1 && <button type="button" className="icon" aria-label="حذف" onClick={() => setMove({ ...move, lines: move.lines.filter((_, i) => i !== index) })}><Trash2 size={14} /></button>}
        </div>)}
        <button type="button" className="link" onClick={() => setMove({ ...move, lines: [...move.lines, { productId: "", quantity: "1" }] })}><Plus size={14} /> منتج آخر</button>
        <label>ملاحظة<input value={move.note} onChange={(event) => setMove({ ...move, note: event.target.value })} /></label>
        <button className="primary" disabled={action.busy || !move.toBranchId}>نقل</button>
      </form>}
    </div>

    {can("inventory.manage") && products.length > 0 && <div className="card">
      <h3>المخزون حسب الفرع</h3>
      <div className="table-wrap"><table>
        <thead><tr><th>المنتج</th>{active.map((branch) => <th key={branch.id}>{branch.name}</th>)}<th>الإجمالي</th></tr></thead>
        <tbody>{products.map((product) => <tr key={product.productId}>
          <td>{product.nameAr}</td>
          {active.map((branch) => {
            const quantity = stock.data?.[branch.id]?.find((row) => row.productId === product.productId)?.quantity ?? 0;
            return <td key={branch.id} className={`num ${quantity < 0 ? "negative" : ""}`}>{quantity}</td>;
          })}
          <td className="num"><b>{product.totalStock}</b></td>
        </tr>)}</tbody>
      </table></div>
    </div>}

    {(transfers.data?.data ?? []).length > 0 && <div className="card">
      <h3>آخر عمليات النقل</h3>
      <ul className="list">{transfers.data!.data.slice(0, 20).map((record) => <li key={record.id}>
        <div><b>{nameOf(record.fromBranchId)} ← {nameOf(record.toBranchId)}</b>
          <small>{record.lines.map((line) => `${products.find((product) => product.productId === line.productId)?.nameAr ?? line.productId} × ${line.quantity}`).join("، ")}{record.note ? ` · ${record.note}` : ""}</small></div>
        <small>{dateTime.format(new Date(record.createdAt))}</small>
      </li>)}</ul>
    </div>}
  </div>;
}
