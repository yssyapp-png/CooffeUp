import { useState } from "react";
import { EXPENSE_CATEGORY_LABELS, formatSar, type ExpenseCategory, type ExpenseRecord, type PaidFrom, type ParsedInvoice, type Product, type PurchaseRecord } from "@cooffeup/shared";
import { Camera, FileText, Plus, ScanLine, Trash2 } from "lucide-react";
import { api } from "../api";
import { Notice, PageHeader, sarInput, todayRiyadh, toSar, useAction, useLoad } from "../components";
import { useSession } from "../session";

type ReadInvoice = Omit<ParsedInvoice, "lines"> & { lines: Array<ParsedInvoice["lines"][number] & { suggestedProductId?: string }> };
interface DraftLine { productId: string; description: string; quantity: string; unitCost: string }
interface Draft { supplierName: string; supplierVat: string; invoiceNumber: string; date: string; vat: string; paidFrom: PaidFrom; source: "manual" | "ocr"; lines: DraftLine[] }

const emptyDraft = (): Draft => ({ supplierName: "", supplierVat: "", invoiceNumber: "", date: todayRiyadh(), vat: "", paidFrom: "payable", source: "manual", lines: [{ productId: "", description: "", quantity: "1", unitCost: "" }] });
const PAID_FROM_LABELS: Record<PaidFrom, string> = { cash: "من الصندوق نقدًا", bank: "تحويل بنكي", payable: "آجل على المورد" };

export function Purchases() {
  const { can } = useSession();
  const [tab, setTab] = useState<"purchases" | "expenses">(can("purchases.manage") ? "purchases" : "expenses");
  return <div className="page">
    <PageHeader eyebrow="قارئ الفواتير الذكي والقيود المؤتمتة" title="المشتريات والمصروفات" />
    <div className="segmented inline">
      {can("purchases.manage") && <button className={tab === "purchases" ? "selected" : ""} onClick={() => setTab("purchases")}>فواتير المشتريات</button>}
      {can("expenses.manage") && <button className={tab === "expenses" ? "selected" : ""} onClick={() => setTab("expenses")}>المصروفات</button>}
    </div>
    {tab === "purchases" ? <PurchaseInvoices /> : <Expenses />}
  </div>;
}

function PurchaseInvoices() {
  const [version, setVersion] = useState(0);
  const products = useLoad(() => api<{ data: Product[] }>("/api/v1/products"));
  const history = useLoad(() => api<{ data: PurchaseRecord[] }>("/api/v1/purchases"), [version]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [scan, setScan] = useState<{ progress: number; confidence?: number; warnings: string[]; text?: string } | null>(null);
  const action = useAction();

  const lineTotal = (line: DraftLine) => Math.round(Number(line.quantity || 0) * sarInput(line.unitCost));
  const net = draft.lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const vat = draft.vat === "" ? Math.round(net * 0.15) : sarInput(draft.vat);

  /** Runs OCR on the device (Arabic + English) and turns the text into a draft for review. */
  async function readInvoice(file: File) {
    setScan({ progress: 0, warnings: [] });
    await action.run(async () => {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker(["ara", "eng"], undefined, {
        logger: (message: { status: string; progress: number }) => { if (message.status === "recognizing text") setScan((current) => current && { ...current, progress: message.progress }); }
      });
      try {
        const { data } = await worker.recognize(file);
        await applyText(data.text);
      } finally {
        await worker.terminate();
      }
    });
  }

  async function applyText(text: string) {
    const { data } = await api<{ data: ReadInvoice }>("/api/v1/purchases/parse", { method: "POST", body: { text } });
    setScan({ progress: 1, confidence: data.confidence, warnings: data.warnings, text });
    setDraft({
      supplierName: data.supplierName ?? "", supplierVat: data.supplierVat ?? "", invoiceNumber: data.invoiceNumber ?? "", date: data.date ?? todayRiyadh(),
      vat: data.vat !== undefined ? toSar(data.vat) : "", paidFrom: "payable", source: "ocr",
      lines: data.lines.length ? data.lines.map((line) => ({ productId: line.suggestedProductId ?? "", description: line.description, quantity: String(line.quantity), unitCost: toSar(line.unitCost) })) : emptyDraft().lines
    });
  }

  const updateLine = (index: number, patch: Partial<DraftLine>) => setDraft((current) => ({ ...current, lines: current.lines.map((line, i) => i === index ? { ...line, ...patch } : line) }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const body = {
      supplierName: draft.supplierName, supplierVat: draft.supplierVat || undefined, invoiceNumber: draft.invoiceNumber || undefined, date: draft.date,
      net, vat, total: net + vat, paidFrom: draft.paidFrom, source: draft.source,
      lines: draft.lines.map((line) => ({ productId: line.productId || undefined, description: line.description, quantity: Number(line.quantity), unitCost: sarInput(line.unitCost), total: lineTotal(line) }))
    };
    const saved = await action.run(() => api("/api/v1/purchases", { method: "POST", body }), "تم تسجيل الفاتورة وتحديث المخزون وإنشاء القيد المحاسبي");
    if (saved) { setDraft(emptyDraft()); setScan(null); setVersion((value) => value + 1); }
  }

  return <>
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    <div className="split">
      <form className="card form" onSubmit={save}>
        <div className="row between">
          <h3>فاتورة مشتريات</h3>
          <label className="upload primary small"><Camera size={15} /> تصوير الفاتورة
            <input type="file" accept="image/*" capture="environment" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void readInvoice(file); event.target.value = ""; }} />
          </label>
        </div>
        {scan && <div className="scan">
          {scan.progress < 1 ? <p><ScanLine size={15} /> جارٍ قراءة الفاتورة… {Math.round(scan.progress * 100)}%</p> : <>
            <p>دقة القراءة: <b>{scan.confidence}%</b> — راجع البيانات قبل الحفظ</p>
            {scan.warnings.map((warning) => <Notice key={warning} tone="warning">{warning}</Notice>)}
            {scan.text && <details><summary>النص المقروء</summary><pre>{scan.text}</pre></details>}
          </>}
        </div>}
        <div className="grid-2">
          <label>المورد<input required minLength={2} value={draft.supplierName} onChange={(event) => setDraft({ ...draft, supplierName: event.target.value })} /></label>
          <label>الرقم الضريبي للمورد<input pattern="3\d{13}3" title="15 رقمًا يبدأ وينتهي بالرقم 3" value={draft.supplierVat} onChange={(event) => setDraft({ ...draft, supplierVat: event.target.value })} /></label>
          <label>رقم الفاتورة<input value={draft.invoiceNumber} onChange={(event) => setDraft({ ...draft, invoiceNumber: event.target.value })} /></label>
          <label>التاريخ<input type="date" required value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
        </div>
        <div className="table-wrap"><table className="edit">
          <thead><tr><th>البند</th><th>المنتج في المخزون</th><th>الكمية</th><th>سعر الوحدة</th><th>المجموع</th><th /></tr></thead>
          <tbody>{draft.lines.map((line, index) => <tr key={index}>
            <td><input required value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} aria-label="البند" /></td>
            <td><select value={line.productId} onChange={(event) => updateLine(index, { productId: event.target.value })} aria-label="المنتج">
              <option value="">غير مرتبط بمخزون</option>{products.data?.data.map((product) => <option key={product.id} value={product.id}>{product.nameAr}</option>)}</select></td>
            <td><input type="number" min={1} required value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} aria-label="الكمية" /></td>
            <td><input inputMode="decimal" required value={line.unitCost} onChange={(event) => updateLine(index, { unitCost: event.target.value })} aria-label="سعر الوحدة" /></td>
            <td className="num">{formatSar(lineTotal(line))}</td>
            <td>{draft.lines.length > 1 && <button type="button" className="icon" aria-label="حذف البند" onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== index) })}><Trash2 size={14} /></button>}</td>
          </tr>)}</tbody>
        </table></div>
        <button type="button" className="link" onClick={() => setDraft({ ...draft, lines: [...draft.lines, { productId: "", description: "", quantity: "1", unitCost: "" }] })}><Plus size={14} /> إضافة بند</button>
        <div className="grid-2">
          <label>ضريبة القيمة المضافة (ر.س)<input inputMode="decimal" placeholder={toSar(Math.round(net * 0.15))} value={draft.vat} onChange={(event) => setDraft({ ...draft, vat: event.target.value })} /></label>
          <label>طريقة السداد<select value={draft.paidFrom} onChange={(event) => setDraft({ ...draft, paidFrom: event.target.value as PaidFrom })}>
            {Object.entries(PAID_FROM_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <div className="summary"><p><span>قبل الضريبة</span><b>{formatSar(net)}</b></p><p><span>الضريبة</span><b>{formatSar(vat)}</b></p><div><span>الإجمالي</span><strong>{formatSar(net + vat)}</strong></div></div>
        <button className="primary" disabled={action.busy || net === 0}>حفظ الفاتورة</button>
      </form>
      <div className="card">
        <h3><FileText size={16} /> آخر فواتير المشتريات</h3>
        {(history.data?.data ?? []).length === 0 ? <p className="muted">لا توجد فواتير بعد</p> : <ul className="list">{history.data!.data.slice(0, 15).map((purchase) => <li key={purchase.id}>
          <div><b>{purchase.supplierName}</b><small>{purchase.invoiceNumber ?? "—"} · {purchase.date}{purchase.source === "ocr" ? " · مقروءة آليًا" : ""}</small></div><b>{formatSar(purchase.total)}</b>
        </li>)}</ul>}
      </div>
    </div>
  </>;
}

function Expenses() {
  const [version, setVersion] = useState(0);
  const list = useLoad(() => api<{ data: ExpenseRecord[] }>("/api/v1/expenses"), [version]);
  const [form, setForm] = useState({ category: "utilities" as ExpenseCategory, description: "", net: "", vat: "", paidFrom: "bank" as PaidFrom, date: todayRiyadh() });
  const action = useAction();

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const saved = await action.run(() => api("/api/v1/expenses", { method: "POST", body: { ...form, net: sarInput(form.net), vat: sarInput(form.vat) } }), "تم تسجيل المصروف وإنشاء القيد");
    if (saved) { setForm({ ...form, description: "", net: "", vat: "" }); setVersion((value) => value + 1); }
  }

  return <>
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    <div className="split">
      <form className="card form" onSubmit={save}>
        <h3>مصروف جديد</h3>
        <label>البند<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as ExpenseCategory })}>
          {Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>الوصف<input required minLength={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <div className="grid-2">
          <label>المبلغ قبل الضريبة<input inputMode="decimal" required value={form.net} onChange={(event) => setForm({ ...form, net: event.target.value })} /></label>
          <label>الضريبة<input inputMode="decimal" value={form.vat} onChange={(event) => setForm({ ...form, vat: event.target.value })} placeholder="0.00" /></label>
          <label>السداد<select value={form.paidFrom} onChange={(event) => setForm({ ...form, paidFrom: event.target.value as PaidFrom })}>
            {Object.entries(PAID_FROM_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>التاريخ<input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
        </div>
        <button className="primary" disabled={action.busy}>حفظ</button>
      </form>
      <div className="card">
        <h3>آخر المصروفات</h3>
        {(list.data?.data ?? []).length === 0 ? <p className="muted">لا توجد مصروفات</p> : <ul className="list">{list.data!.data.slice(0, 20).map((expense) => <li key={expense.id}>
          <div><b>{expense.description}</b><small>{EXPENSE_CATEGORY_LABELS[expense.category]} · {expense.date}</small></div><b>{formatSar(expense.total)}</b>
        </li>)}</ul>}
      </div>
    </div>
  </>;
}
