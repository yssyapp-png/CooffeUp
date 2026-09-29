import { useState } from "react";
import { ORDER_TYPE_LABELS, PAYMENT_METHOD_LABELS, type OrderRecord, type PaymentMethod, type RefundRecord } from "@cooffeup/shared";
import { ExternalLink, RotateCcw, Search, Send } from "lucide-react";
import { api } from "../api";
import { Notice, PageHeader, useAction, useLoad } from "../components";
import { useI18n } from "../i18n";
import { channelName } from "../labels";
import { useSession } from "../session";

interface OrderDetail { data: OrderRecord; refunds: RefundRecord[]; customerName?: string; invoiceUrl: string }

const STATUS_LABELS: Record<OrderRecord["status"], string> = { paid: "مدفوع", partially_refunded: "مسترجع جزئيًا", refunded: "مسترجع" };

/** Order history with partial refunds and invoice re-sending. */
export function Orders() {
  const { can, staff } = useSession();
  const { L, tx, sar, dateTime, lang } = useI18n();
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
    <PageHeader eyebrow={L("البحث في الفواتير والاسترجاع وإعادة إرسال الفاتورة", "Find invoices, refund and resend them")} title={L("الطلبات والمرتجعات", "Orders & refunds")} actions={<>
      <div className="search"><Search size={17} /><input aria-label={L("بحث", "Search")} placeholder={L("رقم الإيصال أو رقم طلب المنصة", "Receipt or platform order number")} value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <select aria-label={L("الحالة", "Status")} value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="">{L("كل الحالات", "All statuses")}</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{tx(label)}</option>)}
      </select>
      {!staff.branchId && <select aria-label={L("النطاق", "Scope")} value={scope} onChange={(event) => setScope(event.target.value as "branch" | "all")}>
        <option value="branch">{L("هذا الفرع", "This branch")}</option><option value="all">{L("كل الفروع", "All branches")}</option>
      </select>}
    </>} />
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    {list.error && <Notice tone="error">{list.error}</Notice>}
    <div className="split">
      <div className="card">
        <div className="table-wrap"><table>
          <thead><tr><th>{L("الإيصال", "Receipt")}</th><th>{L("الوقت", "Time")}</th><th>{L("القناة", "Channel")}</th><th>{L("النوع", "Type")}</th><th>{L("الإجمالي", "Total")}</th><th>{L("الحالة", "Status")}</th></tr></thead>
          <tbody>{(list.data?.data ?? []).map((order) => <tr key={order.id} className={`clickable ${selected?.data.id === order.id ? "selected-row" : ""}`} onClick={() => open(order.id)}>
            <td><b>{order.receiptNumber}</b>{order.offline && <small className="muted"> · {order.offline.localReceipt}</small>}</td>
            <td>{dateTime(order.createdAt)}</td>
            <td>{channelName(order.channel, lang)}</td>
            <td>{tx(ORDER_TYPE_LABELS[order.type])}</td>
            <td className="num">{sar(order.totals.total)}</td>
            <td><span className={`pill ${order.status === "paid" ? "processed" : order.status === "refunded" ? "failed" : "pending"}`}>{tx(STATUS_LABELS[order.status])}</span></td>
          </tr>)}</tbody>
        </table></div>
        {list.data?.data.length === 0 && <p className="muted center">{L("لا توجد طلبات مطابقة", "No matching orders")}</p>}
      </div>
      {selected && <OrderPanel detail={selected} canRefund={can("pos.refund")} canSend={can("invoices.send")} onChanged={async () => { await open(selected.data.id); setVersion((value) => value + 1); }} />}
    </div>
  </div>;
}

function OrderPanel({ detail, canRefund, canSend, onChanged }: { detail: OrderDetail; canRefund: boolean; canSend: boolean; onChanged: () => Promise<void> }) {
  const { L, tx, sar, dateTime, lang } = useI18n();
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
    }), L("تم تنفيذ الاسترجاع وإعادة المخزون وعكس القيد", "Refund done: stock returned and entries reversed"));
    if (done) {
      setQuantities({}); setReason(""); setRefundKey(crypto.randomUUID());
      await onChanged();
    }
  }

  return <div className="stack">
    <div className="card">
      <div className="row between">
        <h3>{order.receiptNumber}</h3>
        <a className="ghost small" href={detail.invoiceUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {L("الفاتورة", "Invoice")}</a>
      </div>
      <small className="muted">{dateTime(order.createdAt)} · {channelName(order.channel, lang)}{detail.customerName ? ` · ${detail.customerName}` : ""}{order.externalOrderId ? ` · #${order.externalOrderId}` : ""}</small>
      <table><tbody>{order.lines.map((line) => <tr key={line.productId}>
        <td>{line.name}{line.refundedQuantity > 0 && <small className="negative"> ({L("مسترجع", "refunded")} {line.refundedQuantity})</small>}</td>
        <td className="num">{line.quantity} × {sar(line.unitPrice)}</td>
        <td className="num">{sar(line.unitPrice * line.quantity - line.discount)}</td>
      </tr>)}</tbody></table>
      <div className="summary">
        {order.totals.discount > 0 && <p><span>{L("الخصم", "Discount")}</span><b>- {sar(order.totals.discount)}</b></p>}
        <p><span>{L("الضريبة", "VAT")}</span><b>{sar(order.totals.tax)}</b></p>
        <div><span>{L("الإجمالي", "Total")}</span><strong>{sar(order.totals.total)}</strong></div>
      </div>
      <small>{L("الدفع", "Payment")}: {order.payments.map((payment) => `${tx(PAYMENT_METHOD_LABELS[payment.method])} ${sar(payment.amount)}`).join(lang === "ar" ? "، " : ", ") || L("مجاني", "Free")}{order.change ? ` · ${L("الباقي", "Change")} ${sar(order.change)}` : ""}</small>
      {order.loyalty && <small className="positive">{L("نقاط مكتسبة", "Points earned")} {order.loyalty.earned}{order.loyalty.redeemed ? ` · ${L("استُبدل مشروب مجاني", "free drink redeemed")}` : ""}</small>}
      {detail.refunds.length > 0 && <>
        <h4>{L("المرتجعات", "Refunds")}</h4>
        <ul className="list">{detail.refunds.map((entry) => <li key={entry.id}>
          <div><b>{sar(entry.total)}</b><small>{tx(PAYMENT_METHOD_LABELS[entry.method])} · {entry.reason}</small></div><small>{dateTime(entry.createdAt)}</small>
        </li>)}</ul>
      </>}
    </div>

    {canRefund && refundable.length > 0 && <form className="card form" onSubmit={refund}>
      <h3><RotateCcw size={16} /> {L("استرجاع", "Refund")}</h3>
      {refundable.map((line) => <label key={line.productId} className="refund-line">
        <span>{line.name} <small className="muted">({L("متاح", "available")} {line.quantity - line.refundedQuantity})</small></span>
        <input type="number" min={0} max={line.quantity - line.refundedQuantity} value={quantities[line.productId] ?? 0}
          onChange={(event) => setQuantities({ ...quantities, [line.productId]: Math.min(Math.max(Number(event.target.value) || 0, 0), line.quantity - line.refundedQuantity) })} />
      </label>)}
      <button type="button" className="link" onClick={() => setQuantities(Object.fromEntries(refundable.map((line) => [line.productId, line.quantity - line.refundedQuantity])))}>{L("استرجاع الطلب كاملًا", "Refund the whole order")}</button>
      {methods.length > 1 && <label>{L("طريقة الرد", "Refund to")}<select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
        <option value="">{L("تلقائي (حسب طريقة الدفع)", "Automatic (original method)")}</option>{methods.map((value) => <option key={value} value={value}>{tx(PAYMENT_METHOD_LABELS[value])}</option>)}</select></label>}
      <label>{L("السبب", "Reason")}<input required minLength={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={L("مثال: منتج تالف", "e.g. damaged product")} /></label>
      <small className="muted">{L("يُرد المبلغ بطريقة الدفع الأصلية، ويعود المخزون إلى هذا الفرع، ويُعكس القيد ونقاط الولاء تلقائيًا.", "Money goes back by the original method, stock returns to this branch, and the entry and loyalty points are reversed automatically.")}</small>
      {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
      <button className="primary" disabled={action.busy || lines.length === 0}>{L("تنفيذ الاسترجاع", "Refund")}</button>
    </form>}

    {canSend && <form className="card form compact" onSubmit={(event) => {
      event.preventDefault();
      void action.run(() => api(`/api/v1/orders/${order.id}/send-invoice`, { method: "POST", body: { phone } }), L("تم إرسال الفاتورة برسالة نصية", "Invoice sent by SMS"));
    }}>
      <h3><Send size={16} /> {L("إرسال الفاتورة SMS", "Send invoice by SMS")}</h3>
      <div className="row"><input inputMode="tel" placeholder="05XXXXXXXX" aria-label={L("جوال العميل", "Customer mobile")} value={phone} onChange={(event) => setPhone(event.target.value)} />
        <button className="primary small" disabled={action.busy || phone.length < 9}>{L("إرسال", "Send")}</button></div>
    </form>}
  </div>;
}
