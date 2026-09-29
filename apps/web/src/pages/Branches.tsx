import { useState } from "react";
import type { Branch, StockTransfer } from "@cooffeup/shared";
import { ArrowLeftRight, Plus, Store, Tent, Trash2 } from "lucide-react";
import { api } from "../api";
import { Notice, PageHeader, useAction, useLoad } from "../components";
import { useI18n } from "../i18n";
import { useSession } from "../session";

interface BranchView extends Branch { isOpen: boolean; hasOpenShift: boolean; units: number }
interface StockRow { productId: string; sku: string; nameAr: string; nameEn: string; quantity: number; totalStock: number }

const toIso = (local: string) => (local ? new Date(local).toISOString() : undefined);
const toLocal = (iso?: string) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "");

/** Permanent branches, temporary booths (exhibitions, events), stock per branch and transfers. */
export function Branches() {
  const { can, reloadBranches, reloadSettings } = useSession();
  const { L, tx, dateTime, productName } = useI18n();
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
    } }), form.kind === "temporary" ? L("تم إنشاء البوث", "Booth created") : L("تم إنشاء الفرع", "Branch created"));
    if (saved) { setForm({ ...form, name: "", startsAt: "", endsAt: "", address: "" }); reload(); }
  }

  async function transfer(event: React.FormEvent) {
    event.preventDefault();
    const saved = await action.run(() => api("/api/v1/stock-transfers", { method: "POST", body: {
      fromBranchId: move.fromBranchId, toBranchId: move.toBranchId, note: move.note || undefined,
      lines: move.lines.filter((line) => line.productId).map((line) => ({ productId: line.productId, quantity: Number(line.quantity) }))
    } }), L("تم نقل المخزون", "Stock transferred"));
    if (saved) { setMove({ ...move, note: "", lines: [{ productId: "", quantity: "1" }] }); reload(); }
  }

  const update = async (branch: BranchView, patch: Partial<Branch>) => {
    await action.run(() => api(`/api/v1/branches/${branch.id}`, { method: "PATCH", body: patch }), L("تم حفظ التعديل", "Saved"));
    reload();
  };

  return <div className="page">
    <PageHeader eyebrow={L("فروع دائمة وبوثات مؤقتة للمعارض والفعاليات", "Permanent branches and temporary booths for exhibitions and events")} title={L("الفروع والمخزون", "Branches & stock")} />
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    {list.error && <Notice tone="error">{list.error}</Notice>}

    <div className="cards">{branches.map((branch) => <article key={branch.id} className={`card branch-card ${branch.active ? "" : "inactive"}`}>
      <div className="row between">
        <h3>{branch.kind === "temporary" ? <Tent size={17} /> : <Store size={17} />} {tx(branch.name)}</h3>
        <span className={`pill ${branch.isOpen ? "processed" : "failed"}`}>{!branch.active ? L("مغلق", "Closed") : branch.isOpen ? L("يعمل الآن", "Trading now") : L("خارج فترة العمل", "Outside trading dates")}</span>
      </div>
      <small className="muted">{branch.kind === "temporary" ? L("بوث مؤقت", "Temporary booth") : L("فرع دائم", "Permanent branch")} · {branch.units} {L("قطعة في المخزون", "units in stock")}{branch.hasOpenShift ? ` · ${L("وردية مفتوحة", "shift open")}` : ""}</small>
      {(branch.startsAt || branch.endsAt) && <small>{branch.startsAt ? dateTime(branch.startsAt) : "—"} ← {branch.endsAt ? dateTime(branch.endsAt) : "—"}</small>}
      {list.data?.fulfilmentBranchId === branch.id && <small className="positive">{L("يجهّز طلبات المتجر الإلكتروني وتطبيقات التوصيل", "Fulfils online-store and delivery-app orders")}</small>}
      {manage && branch.active && <>
        <label className="check"><input type="checkbox" checked={branch.syncToStore} onChange={(event) => update(branch, { syncToStore: event.target.checked })} /> {L("مخزونه متاح للبيع في المتجر الإلكتروني (زد وسلة)", "Its stock is offered in the online store (Zid & Salla)")}</label>
        {branch.kind === "temporary" && <div className="grid-2">
          <label>{L("البداية", "Starts")}<input type="datetime-local" defaultValue={toLocal(branch.startsAt)} onBlur={(event) => event.target.value !== toLocal(branch.startsAt) && update(branch, { startsAt: toIso(event.target.value) })} /></label>
          <label>{L("النهاية", "Ends")}<input type="datetime-local" defaultValue={toLocal(branch.endsAt)} onBlur={(event) => event.target.value !== toLocal(branch.endsAt) && update(branch, { endsAt: toIso(event.target.value) })} /></label>
        </div>}
        {branch.kind === "temporary" && (closing?.id === branch.id
          ? <div className="row wrap">
            <label>{L("إرجاع المخزون إلى", "Return stock to")}<select value={closing.returnTo} onChange={(event) => setClosing({ ...closing, returnTo: event.target.value })}>
              {active.filter((other) => other.id !== branch.id).map((other) => <option key={other.id} value={other.id}>{tx(other.name)}</option>)}</select></label>
            <button className="primary small" disabled={action.busy} onClick={async () => {
              await action.run(() => api(`/api/v1/branches/${branch.id}/close`, { method: "POST", body: { returnToBranchId: closing.returnTo } }), L("تم إغلاق البوث وإرجاع مخزونه", "Booth closed and its stock returned"));
              setClosing(null); reload();
            }}>{L("تأكيد الإغلاق", "Confirm close")}</button>
            <button className="ghost small" onClick={() => setClosing(null)}>{L("إلغاء", "Cancel")}</button>
          </div>
          : <button className="ghost small danger" onClick={() => setClosing({ id: branch.id, returnTo: "main" })}>{L("إنهاء البوث وإرجاع المخزون", "End booth and return stock")}</button>)}
        {branch.kind === "permanent" && branch.id !== "main" && <button className="ghost small danger" onClick={() => update(branch, { active: false })}>{L("إيقاف الفرع", "Deactivate branch")}</button>}
      </>}
      {manage && !branch.active && branch.kind === "permanent" && <button className="ghost small" onClick={() => update(branch, { active: true })}>{L("إعادة تفعيل", "Reactivate")}</button>}
    </article>)}</div>

    {manage && can("staff.manage") && active.length > 1 && <div className="card form compact">
      <label>{L("الفرع الذي يجهّز طلبات المتجر وتطبيقات التوصيل", "Branch that fulfils online-store and delivery-app orders")}
        <select value={list.data?.fulfilmentBranchId ?? "main"} onChange={async (event) => {
          await action.run(() => api("/api/v1/settings", { method: "PATCH", body: { fulfilmentBranchId: event.target.value } }), L("تم تغيير فرع التجهيز", "Fulfilment branch changed"));
          await reloadSettings(); reload();
        }}>{active.map((branch) => <option key={branch.id} value={branch.id}>{tx(branch.name)}</option>)}</select>
      </label>
    </div>}

    <div className="split">
      {manage && <form className="card form" onSubmit={create}>
        <h3><Plus size={16} /> {L("فرع أو بوث جديد", "New branch or booth")}</h3>
        <div className="segmented inline">
          <button type="button" className={form.kind === "temporary" ? "selected" : ""} onClick={() => setForm({ ...form, kind: "temporary", syncToStore: false })}>{L("بوث مؤقت", "Temporary booth")}</button>
          <button type="button" className={form.kind === "permanent" ? "selected" : ""} onClick={() => setForm({ ...form, kind: "permanent", syncToStore: true })}>{L("فرع دائم", "Permanent branch")}</button>
        </div>
        <label>{L("الاسم", "Name")}<input required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={form.kind === "temporary" ? L("بوث معرض الرياض للقهوة", "Riyadh Coffee Expo booth") : L("فرع العليا", "Olaya branch")} /></label>
        <div className="grid-2">
          <label>{L("البداية", "Starts")}<input type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} /></label>
          <label>{L("النهاية", "Ends")}{form.kind === "temporary" && ` (${L("مطلوبة", "required")})`}<input type="datetime-local" required={form.kind === "temporary"} value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} /></label>
        </div>
        <label>{L("العنوان", "Address")}<input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={form.syncToStore} onChange={(event) => setForm({ ...form, syncToStore: event.target.checked })} /> {L("مخزونه متاح للبيع في المتجر الإلكتروني", "Its stock is offered in the online store")}</label>
        <small className="muted">{L("البوث المؤقت يبيع فقط بين تاريخي البداية والنهاية، وعند إنهائه يعود مخزونه المتبقي إلى الفرع الذي تختاره.", "A booth only sells between its start and end dates; when it ends, its remaining stock returns to the branch you choose.")}</small>
        <button className="primary" disabled={action.busy}>{L("إنشاء", "Create")}</button>
      </form>}

      {manage && active.length > 1 && <form className="card form" onSubmit={transfer}>
        <h3><ArrowLeftRight size={16} /> {L("نقل مخزون بين الفروع", "Transfer stock between branches")}</h3>
        <div className="grid-2">
          <label>{L("من", "From")}<select value={move.fromBranchId} onChange={(event) => setMove({ ...move, fromBranchId: event.target.value })}>{active.map((branch) => <option key={branch.id} value={branch.id}>{tx(branch.name)}</option>)}</select></label>
          <label>{L("إلى", "To")}<select required value={move.toBranchId} onChange={(event) => setMove({ ...move, toBranchId: event.target.value })}>
            <option value="">{L("اختر الفرع", "Choose a branch")}</option>{active.filter((branch) => branch.id !== move.fromBranchId).map((branch) => <option key={branch.id} value={branch.id}>{tx(branch.name)}</option>)}</select></label>
        </div>
        {move.lines.map((line, index) => <div key={index} className="row">
          <select aria-label={L("المنتج", "Product")} value={line.productId} onChange={(event) => setMove({ ...move, lines: move.lines.map((row, i) => i === index ? { ...row, productId: event.target.value } : row) })}>
            <option value="">{L("اختر المنتج", "Choose a product")}</option>
            {(stock.data?.[move.fromBranchId] ?? []).map((row) => <option key={row.productId} value={row.productId} disabled={row.quantity <= 0}>{productName(row)} — {L("متوفر", "available")} {row.quantity}</option>)}
          </select>
          <input type="number" min={1} aria-label={L("الكمية", "Quantity")} value={line.quantity} onChange={(event) => setMove({ ...move, lines: move.lines.map((row, i) => i === index ? { ...row, quantity: event.target.value } : row) })} />
          {move.lines.length > 1 && <button type="button" className="icon" aria-label={L("حذف", "Remove")} onClick={() => setMove({ ...move, lines: move.lines.filter((_, i) => i !== index) })}><Trash2 size={14} /></button>}
        </div>)}
        <button type="button" className="link" onClick={() => setMove({ ...move, lines: [...move.lines, { productId: "", quantity: "1" }] })}><Plus size={14} /> {L("منتج آخر", "Another product")}</button>
        <label>{L("ملاحظة", "Note")}<input value={move.note} onChange={(event) => setMove({ ...move, note: event.target.value })} /></label>
        <button className="primary" disabled={action.busy || !move.toBranchId}>{L("نقل", "Transfer")}</button>
      </form>}
    </div>

    {can("inventory.manage") && products.length > 0 && <div className="card">
      <h3>{L("المخزون حسب الفرع", "Stock by branch")}</h3>
      <div className="table-wrap"><table>
        <thead><tr><th>{L("المنتج", "Product")}</th>{active.map((branch) => <th key={branch.id}>{tx(branch.name)}</th>)}<th>{L("الإجمالي", "Total")}</th></tr></thead>
        <tbody>{products.map((product) => <tr key={product.productId}>
          <td>{productName(product)}</td>
          {active.map((branch) => {
            const quantity = stock.data?.[branch.id]?.find((row) => row.productId === product.productId)?.quantity ?? 0;
            return <td key={branch.id} className={`num ${quantity < 0 ? "negative" : ""}`}>{quantity}</td>;
          })}
          <td className="num"><b>{product.totalStock}</b></td>
        </tr>)}</tbody>
      </table></div>
    </div>}

    {(transfers.data?.data ?? []).length > 0 && <div className="card">
      <h3>{L("آخر عمليات النقل", "Recent transfers")}</h3>
      <ul className="list">{transfers.data!.data.slice(0, 20).map((record) => <li key={record.id}>
        <div><b>{nameOf(record.fromBranchId)} ← {nameOf(record.toBranchId)}</b>
          <small>{record.lines.map((line) => `${(() => { const product = products.find((candidate) => candidate.productId === line.productId); return product ? productName(product) : line.productId; })()} × ${line.quantity}`).join(", ")}{record.note ? ` · ${record.note}` : ""}</small></div>
        <small>{dateTime(record.createdAt)}</small>
      </li>)}</ul>
    </div>}
  </div>;
}
