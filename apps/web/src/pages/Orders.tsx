import { useState } from "react";
import { formatSar, ORDER_TYPE_LABELS, PAYMENT_METHOD_LABELS, type OrderRecord, type PaymentMethod, type RefundRecord } from "@cooffeup/shared";
import { ExternalLink, RotateCcw, Search, Send } from "lucide-react";
import { api } from "../api";
import { Notice, PageHeader, useAction, useLoad } from "../components";
import { useSession } from "../session";

interface OrderDetail { data: OrderRecord; refunds: RefundRecord[]; customerName?: string; invoiceUrl: string }

const STATUS_LABELS: Record<OrderRecord["status"], string> = { paid: "مدفوع", partially_refunded: "مسترجع جزئيًا", refunded: "مسترجع" };
const CHANNEL_LABELS: Record<string, string> = {
  pos: "الكاشير", zid: "زد", salla: "سلة", hungerstation: "هنقرستيشن", jahez: "جاهز", keeta: "كيتا", mrsool: "مرسول", the_chefz: "ذا شفز", toyou: "تويو"
};
const dateTime = new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" });

/** Order history with partial refunds and invoice re-sending. */
export function Orders() {
  const { can, staff } = useSession();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [scope, setScope] = useState<"branch" | "all">("branch");
  const [version, setVersion] = useState(0);
  const params = new URLSearchParams({ limit: "100", scope, ...(query ? { q: query } : {}), ...(status ? { status } : {}) });
  const list = useLoad(() => api<{ data: OrderRecord[] }>(`/api/v1/orders?${params}`), [params.toString(), version]);
  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const action = useAction();

  const open = (id: string) => action.run(async () => setSelected(await api<OrderDetail>(`/api/v1/orders/${id}`)));

  return <div className="page">
    <PageHeader eyebrow="البحث في الفواتير والاسترجاع وإعادة إرسال الفاتورة" title="الطلبات والمرتجعات" actions={<>
      <div className="search"><Search size={17} /><input aria-label="بحث" placeholder="رقم الإيصال أو رقم طلب المنصة" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <select aria-label="الحالة" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="">كل الحالات</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {!staff.branchId && <select aria-label="النطاق" value={scope} onChange={(event) => setScope(event.target.value as "branch" | "all")}>
        <option value="branch">هذا الفرع</option><option value="all">كل الفروع</option>
      </select>}
    </>} />
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    {list.error && <Notice tone="error">{list.error}</Notice>}
    <div className="split">
      <div className="card">
        <div className="table-wrap"><table>
          <thead><tr><th>الإيصال</th><th>الوقت</th><th>القناة</th><th>النوع</th><th>الإجمالي</th><th>الحالة</th></tr></thead>
          <tbody>{(list.data?.data ?? []).map((order) => <tr key={order.id} className={`clickable ${selected?.data.id === order.id ? "selected-row" : ""}`} onClick={() => open(order.id)}>
            <td><b>{order.receiptNumber}</b>{order.offline && <small className="muted"> · {order.offline.localReceipt}</small>}</td>
            <td>{dateTime.format(new Date(order.createdAt))}</td>
            <td>{CHANNEL_LABELS[order.channel] ?? order.channel}</td>
            <td>{ORDER_TYPE_LABELS[order.type]}</td>
            <td className="num">{formatSar(order.totals.total)}</td>
            <td><span className={`pill ${order.status === "paid" ? "processed" : order.status === "refunded" ? "failed" : "pending"}`}>{STATUS_LABELS[order.status]}</span></td>
          </tr>)}</tbody>
        </table></div>
        {list.data?.data.length === 0 && <p className="muted center">لا توجد طلبات مطابقة</p>}
      </div>
      {selected && <OrderPanel detail={selected} canRefund={can("pos.refund")} canSend={can("invoices.send")} onChanged={async () => { await open(selected.data.id); setVersion((value) => value + 1); }} />}
    </div>
  </div>;
}

function OrderPanel({ detail, canRefund, canSend, onChanged }: { detail: OrderDetail; canRefund: boolean; canSend: boolean; onChanged: () => Promise<void> }) {
  const order = detail.data;
  const refundable = order.lines.filter((line) => line.quantity > line.refundedQuantity);
  const methods = [...new Set(order.payments.map((payment) => payment.method))];
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [reason, setReason] = useState("");
  const [phone, setPhone] = useState("");
  // One key per refund attempt, so a retry after a timeout cannot refund twice.
  const [refundKey, setRefundKey] = useState(() => crypto.randomUUID());
  const action = useAction();
  const lines = Object.entries(quantities).filter(([, quantity]) => quantity > 0).map(([productId, quantity]) => ({ productId, quantity }));

  async function refund(event: React.FormEvent) {
    event.preventDefault();
    const done = await action.run(() => api(`/api/v1/orders/${order.id}/refund`, {
      method: "POST", headers: { "idempotency-key": refundKey }, body: { lines, reason, ...(method ? { method } : {}) }
    }), "تم تنفيذ الاسترجاع وإعادة المخزون وعكس القيد");
    if (done) {
      setQuantities({}); setReason(""); setRefundKey(crypto.randomUUID());
      await onChanged();
    }
  }

  return <div className="stack">
    <div className="card">
      <div className="row between">
        <h3>{order.receiptNumber}</h3>
        <a className="ghost small" href={detail.invoiceUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> الفاتورة</a>
      </div>
      <small className="muted">{dateTime.format(new Date(order.createdAt))} · {CHANNEL_LABELS[order.channel] ?? order.channel}{detail.customerName ? ` · ${detail.customerName}` : ""}{order.externalOrderId ? ` · #${order.externalOrderId}` : ""}</small>
      <table><tbody>{order.lines.map((line) => <tr key={line.productId}>
        <td>{line.name}{line.refundedQuantity > 0 && <small className="negative"> (مسترجع {line.refundedQuantity})</small>}</td>
        <td className="num">{line.quantity} × {formatSar(line.unitPrice)}</td>
        <td className="num">{formatSar(line.unitPrice * line.quantity - line.discount)}</td>
      </tr>)}</tbody></table>
      <div className="summary">
        {order.totals.discount > 0 && <p><span>الخصم</span><b>- {formatSar(order.totals.discount)}</b></p>}
        <p><span>الضريبة</span><b>{formatSar(order.totals.tax)}</b></p>
        <div><span>الإجمالي</span><strong>{formatSar(order.totals.total)}</strong></div>
      </div>
      <small>الدفع: {order.payments.map((payment) => `${PAYMENT_METHOD_LABELS[payment.method]} ${formatSar(payment.amount)}`).join("، ") || "مجاني"}{order.change ? ` · الباقي ${formatSar(order.change)}` : ""}</small>
      {order.loyalty && <small className="positive">نقاط مكتسبة {order.loyalty.earned}{order.loyalty.redeemed ? " · استُبدل مشروب مجاني" : ""}</small>}
      {detail.refunds.length > 0 && <>
        <h4>المرتجعات</h4>
        <ul className="list">{detail.refunds.map((entry) => <li key={entry.id}>
          <div><b>{formatSar(entry.total)}</b><small>{PAYMENT_METHOD_LABELS[entry.method]} · {entry.reason}</small></div><small>{dateTime.format(new Date(entry.createdAt))}</small>
        </li>)}</ul>
      </>}
    </div>

    {canRefund && refundable.length > 0 && <form className="card form" onSubmit={refund}>
      <h3><RotateCcw size={16} /> استرجاع</h3>
      {refundable.map((line) => <label key={line.productId} className="refund-line">
        <span>{line.name} <small className="muted">(متاح {line.quantity - line.refundedQuantity})</small></span>
        <input type="number" min={0} max={line.quantity - line.refundedQuantity} value={quantities[line.productId] ?? 0}
          onChange={(event) => setQuantities({ ...quantities, [line.productId]: Math.min(Math.max(Number(event.target.value) || 0, 0), line.quantity - line.refundedQuantity) })} />
      </label>)}
      <button type="button" className="link" onClick={() => setQuantities(Object.fromEntries(refundable.map((line) => [line.productId, line.quantity - line.refundedQuantity])))}>استرجاع الطلب كاملًا</button>
      {methods.length > 1 && <label>طريقة الرد<select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
        <option value="">تلقائي (حسب طريقة الدفع)</option>{methods.map((value) => <option key={value} value={value}>{PAYMENT_METHOD_LABELS[value]}</option>)}</select></label>}
      <label>السبب<input required minLength={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="مثال: منتج تالف" /></label>
      <small className="muted">يُرد المبلغ بطريقة الدفع الأصلية، ويعود المخزون إلى هذا الفرع، ويُعكس القيد ونقاط الولاء تلقائيًا.</small>
      {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
      <button className="primary" disabled={action.busy || lines.length === 0}>تنفيذ الاسترجاع</button>
    </form>}

    {canSend && <form className="card form compact" onSubmit={(event) => {
      event.preventDefault();
      void action.run(() => api(`/api/v1/orders/${order.id}/send-invoice`, { method: "POST", body: { phone } }), "تم إرسال الفاتورة برسالة نصية");
    }}>
      <h3><Send size={16} /> إرسال الفاتورة SMS</h3>
      <div className="row"><input inputMode="tel" placeholder="05XXXXXXXX" aria-label="جوال العميل" value={phone} onChange={(event) => setPhone(event.target.value)} />
        <button className="primary small" disabled={action.busy || phone.length < 9}>إرسال</button></div>
    </form>}
  </div>;
}
