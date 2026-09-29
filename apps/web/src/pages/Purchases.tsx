import { useState } from "react";
import { EXPENSE_CATEGORY_LABELS, type ExpenseCategory, type ExpenseRecord, type PaidFrom, type ParsedInvoice, type Product, type PurchaseRecord } from "@cooffeup/shared";
import { Camera, FileText, Plus, ScanLine, Trash2 } from "lucide-react";
import { api } from "../api";
import { Notice, PageHeader, sarInput, todayRiyadh, toSar, useAction, useLoad } from "../components";
import { useI18n } from "../i18n";
import { useSession } from "../session";

type ReadInvoice = Omit<ParsedInvoice, "lines"> & { lines: Array<ParsedInvoice["lines"][number] & { suggestedProductId?: string }> };
interface DraftLine { productId: string; description: string; quantity: string; unitCost: string }
interface Draft { supplierName: string; supplierVat: string; invoiceNumber: string; date: string; vat: string; paidFrom: PaidFrom; source: "manual" | "ocr"; lines: DraftLine[] }

const emptyDraft = (): Draft => ({ supplierName: "", supplierVat: "", invoiceNumber: "", date: todayRiyadh(), vat: "", paidFrom: "payable", source: "manual", lines: [{ productId: "", description: "", quantity: "1", unitCost: "" }] });
const PAID_FROM_LABELS: Record<PaidFrom, [string, string]> = { cash: ["من الصندوق نقدًا", "Cash from the till"], bank: ["تحويل بنكي", "Bank transfer"], payable: ["آجل على المورد", "On supplier credit"] };

export function Purchases() {
  const { can } = useSession();
  const { L } = useI18n();
  const [tab, setTab] = useState<"purchases" | "expenses">(can("purchases.manage") ? "purchases" : "expenses");
  return <div className="page">
    <PageHeader eyebrow={L("قارئ الفواتير الذكي والقيود المؤتمتة", "Smart invoice reader and automatic journal entries")} title={L("المشتريات والمصروفات", "Purchases & expenses")} />
    <div className="segmented inline">
      {can("purchases.manage") && <button className={tab === "purchases" ? "selected" : ""} onClick={() => setTab("purchases")}>{L("فواتير المشتريات", "Purchase invoices")}</button>}
      {can("expenses.manage") && <button className={tab === "expenses" ? "selected" : ""} onClick={() => setTab("expenses")}>{L("المصروفات", "Expenses")}</button>}
    </div>
    {tab === "purchases" ? <PurchaseInvoices /> : <Expenses />}
  </div>;
}

function PurchaseInvoices() {
  const { L, sar, productName } = useI18n();
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
    const saved = await action.run(() => api("/api/v1/purchases", { method: "POST", body }), L("تم تسجيل الفاتورة وتحديث المخزون وإنشاء القيد المحاسبي", "Invoice recorded, stock updated and journal entry created"));
    if (saved) { setDraft(emptyDraft()); setScan(null); setVersion((value) => value + 1); }
  }

  return <>
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    <div className="split">
      <form className="card form" onSubmit={save}>
        <div className="row between">
          <h3>{L("فاتورة مشتريات", "Purchase invoice")}</h3>
          <label className="upload primary small"><Camera size={15} /> {L("تصوير الفاتورة", "Scan invoice")}
            <input type="file" accept="image/*" capture="environment" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void readInvoice(file); event.target.value = ""; }} />
          </label>
        </div>
        {scan && <div className="scan">
          {scan.progress < 1 ? <p><ScanLine size={15} /> {L("جارٍ قراءة الفاتورة…", "Reading the invoice…")} {Math.round(scan.progress * 100)}%</p> : <>
            <p>{L("دقة القراءة:", "Read confidence:")} <b>{scan.confidence}%</b> {L("— راجع البيانات قبل الحفظ", "— review the data before saving")}</p>
            {scan.warnings.map((warning) => <Notice key={warning} tone="warning">{warning}</Notice>)}
            {scan.text && <details><summary>{L("النص المقروء", "Recognized text")}</summary><pre>{scan.text}</pre></details>}
          </>}
        </div>}
        <div className="grid-2">
          <label>{L("المورد", "Supplier")}<input required minLength={2} value={draft.supplierName} onChange={(event) => setDraft({ ...draft, supplierName: event.target.value })} /></label>
          <label>{L("الرقم الضريبي للمورد", "Supplier VAT number")}<input pattern="3\d{13}3" title={L("15 رقمًا يبدأ وينتهي بالرقم 3", "15 digits starting and ending with 3")} value={draft.supplierVat} onChange={(event) => setDraft({ ...draft, supplierVat: event.target.value })} /></label>
          <label>{L("رقم الفاتورة", "Invoice number")}<input value={draft.invoiceNumber} onChange={(event) => setDraft({ ...draft, invoiceNumber: event.target.value })} /></label>
          <label>{L("التاريخ", "Date")}<input type="date" required value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
        </div>
        <div className="table-wrap"><table className="edit">
          <thead><tr><th>{L("البند", "Item")}</th><th>{L("المنتج في المخزون", "Stock product")}</th><th>{L("الكمية", "Quantity")}</th><th>{L("سعر الوحدة", "Unit cost")}</th><th>{L("المجموع", "Total")}</th><th /></tr></thead>
          <tbody>{draft.lines.map((line, index) => <tr key={index}>
            <td><input required value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} aria-label={L("البند", "Item")} /></td>
            <td><select value={line.productId} onChange={(event) => updateLine(index, { productId: event.target.value })} aria-label={L("المنتج", "Product")}>
              <option value="">{L("غير مرتبط بمخزون", "Not linked to stock")}</option>{products.data?.data.map((product) => <option key={product.id} value={product.id}>{productName(product)}</option>)}</select></td>
            <td><input type="number" min={1} required value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} aria-label={L("الكمية", "Quantity")} /></td>
            <td><input inputMode="decimal" required value={line.unitCost} onChange={(event) => updateLine(index, { unitCost: event.target.value })} aria-label={L("سعر الوحدة", "Unit cost")} /></td>
            <td className="num">{sar(lineTotal(line))}</td>
            <td>{draft.lines.length > 1 && <button type="button" className="icon" aria-label={L("حذف البند", "Remove item")} onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== index) })}><Trash2 size={14} /></button>}</td>
          </tr>)}</tbody>
        </table></div>
        <button type="button" className="link" onClick={() => setDraft({ ...draft, lines: [...draft.lines, { productId: "", description: "", quantity: "1", unitCost: "" }] })}><Plus size={14} /> {L("إضافة بند", "Add item")}</button>
        <div className="grid-2">
          <label>{L("ضريبة القيمة المضافة (ر.س)", "VAT (SAR)")}<input inputMode="decimal" placeholder={toSar(Math.round(net * 0.15))} value={draft.vat} onChange={(event) => setDraft({ ...draft, vat: event.target.value })} /></label>
          <label>{L("طريقة السداد", "Payment method")}<select value={draft.paidFrom} onChange={(event) => setDraft({ ...draft, paidFrom: event.target.value as PaidFrom })}>
            {Object.entries(PAID_FROM_LABELS).map(([value, label]) => <option key={value} value={value}>{L(...label)}</option>)}</select></label>
        </div>
        <div className="summary"><p><span>{L("قبل الضريبة", "Before VAT")}</span><b>{sar(net)}</b></p><p><span>{L("الضريبة", "VAT")}</span><b>{sar(vat)}</b></p><div><span>{L("الإجمالي", "Total")}</span><strong>{sar(net + vat)}</strong></div></div>
        <button className="primary" disabled={action.busy || net === 0}>{L("حفظ الفاتورة", "Save invoice")}</button>
      </form>
      <div className="card">
        <h3><FileText size={16} /> {L("آخر فواتير المشتريات", "Latest purchase invoices")}</h3>
        {(history.data?.data ?? []).length === 0 ? <p className="muted">{L("لا توجد فواتير بعد", "No invoices yet")}</p> : <ul className="list">{history.data!.data.slice(0, 15).map((purchase) => <li key={purchase.id}>
          <div><b>{purchase.supplierName}</b><small>{purchase.invoiceNumber ?? "—"} · {purchase.date}{purchase.source === "ocr" ? L(" · مقروءة آليًا", " · scanned") : ""}</small></div><b>{sar(purchase.total)}</b>
        </li>)}</ul>}
      </div>
    </div>
  </>;
}

function Expenses() {
  const { L, tx, sar } = useI18n();
  const [version, setVersion] = useState(0);
  const list = useLoad(() => api<{ data: ExpenseRecord[] }>("/api/v1/expenses"), [version]);
  const [form, setForm] = useState({ category: "utilities" as ExpenseCategory, description: "", net: "", vat: "", paidFrom: "bank" as PaidFrom, date: todayRiyadh() });
  const action = useAction();

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const saved = await action.run(() => api("/api/v1/expenses", { method: "POST", body: { ...form, net: sarInput(form.net), vat: sarInput(form.vat) } }), L("تم تسجيل المصروف وإنشاء القيد", "Expense recorded and journal entry created"));
    if (saved) { setForm({ ...form, description: "", net: "", vat: "" }); setVersion((value) => value + 1); }
  }

  return <>
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    <div className="split">
      <form className="card form" onSubmit={save}>
        <h3>{L("مصروف جديد", "New expense")}</h3>
        <label>{L("البند", "Item")}<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as ExpenseCategory })}>
          {Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{tx(label)}</option>)}</select></label>
        <label>{L("الوصف", "Description")}<input required minLength={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <div className="grid-2">
          <label>{L("المبلغ قبل الضريبة", "Amount before VAT")}<input inputMode="decimal" required value={form.net} onChange={(event) => setForm({ ...form, net: event.target.value })} /></label>
          <label>{L("الضريبة", "VAT")}<input inputMode="decimal" value={form.vat} onChange={(event) => setForm({ ...form, vat: event.target.value })} placeholder="0.00" /></label>
          <label>{L("السداد", "Paid from")}<select value={form.paidFrom} onChange={(event) => setForm({ ...form, paidFrom: event.target.value as PaidFrom })}>
            {Object.entries(PAID_FROM_LABELS).map(([value, label]) => <option key={value} value={value}>{L(...label)}</option>)}</select></label>
          <label>{L("التاريخ", "Date")}<input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
        </div>
        <button className="primary" disabled={action.busy}>{L("حفظ", "Save")}</button>
      </form>
      <div className="card">
        <h3>{L("آخر المصروفات", "Latest expenses")}</h3>
        {(list.data?.data ?? []).length === 0 ? <p className="muted">{L("لا توجد مصروفات", "No expenses")}</p> : <ul className="list">{list.data!.data.slice(0, 20).map((expense) => <li key={expense.id}>
          <div><b>{expense.description}</b><small>{tx(EXPENSE_CATEGORY_LABELS[expense.category])} · {expense.date}</small></div><b>{sar(expense.total)}</b>
        </li>)}</ul>}
      </div>
    </div>
  </>;
}
