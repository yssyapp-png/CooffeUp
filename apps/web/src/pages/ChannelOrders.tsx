import { useEffect, useState } from "react";
import { EXTERNAL_STATUS_LABELS, formatSar, nextExternalStatuses, ORDER_TYPE_LABELS, type ExternalOrderStatus, type KitchenTicket, type NormalizedExternalOrder } from "@cooffeup/shared";
import { Bike, RefreshCw, Store, Utensils } from "lucide-react";
import { api } from "../api";
import { Notice, PageHeader, useAction, useLoad } from "../components";
import { useSession } from "../session";

interface ExternalOrderView {
  id: string;
  platform: string;
  platformName: string;
  status: ExternalOrderStatus;
  statusLabel: string;
  payload: NormalizedExternalOrder;
  orderId?: string;
  rejectionReason?: string;
  receivedAt: string;
}

const ACTION_LABELS: Partial<Record<ExternalOrderStatus, string>> = {
  accepted: "قبول", rejected: "رفض", preparing: "بدء التحضير", ready: "جاهز", picked_up: "تم الاستلام", delivered: "تم التوصيل", cancelled: "إلغاء"
};
const COLUMNS: Array<{ id: string; label: string; statuses: ExternalOrderStatus[] }> = [
  { id: "new", label: "جديدة", statuses: ["new"] },
  { id: "kitchen", label: "قيد التحضير", statuses: ["accepted", "preparing"] },
  { id: "ready", label: "جاهزة للاستلام", statuses: ["ready"] },
  { id: "done", label: "مكتملة / ملغاة", statuses: ["picked_up", "delivered", "rejected", "cancelled"] }
];

/** One screen for dine-in, takeaway and every delivery app's orders. */
export function ChannelOrders() {
  const { can, hasFeature } = useSession();
  const [tick, setTick] = useState(0);
  const external = useLoad(() => api<{ data: ExternalOrderView[] }>("/api/v1/delivery/orders"), [tick]);
  const kitchen = useLoad(() => (hasFeature("kitchen") && can("kitchen.view") ? api<{ data: Array<KitchenTicket & { statusLabel: string }> }>("/api/v1/kitchen/tickets") : Promise.resolve({ data: [] })), [tick]);
  const action = useAction();

  // New platform orders must be seen quickly, so the board refreshes on its own.
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 10_000);
    return () => clearInterval(timer);
  }, []);

  async function move(order: ExternalOrderView, status: ExternalOrderStatus) {
    const reason = status === "rejected" || status === "cancelled" ? window.prompt("سبب الرفض أو الإلغاء") ?? undefined : undefined;
    await action.run(() => api(`/api/v1/delivery/orders/${order.id}/status`, { method: "POST", body: { status, reason } }));
    setTick((value) => value + 1);
  }

  const inStore = (kitchen.data?.data ?? []).filter((ticket) => ticket.channel === "pos");
  return <div className="page">
    <PageHeader eyebrow="محلي · سفري · تطبيقات التوصيل" title="الطلبات الموحدة" actions={<button className="ghost" onClick={() => setTick((value) => value + 1)}><RefreshCw size={16} /> تحديث</button>} />
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    {external.error && <Notice tone="error">{external.error}</Notice>}
    <div className="board">
      {COLUMNS.map((column) => {
        const orders = (external.data?.data ?? []).filter((order) => column.statuses.includes(order.status));
        const local = column.id === "kitchen" ? inStore.filter((ticket) => ticket.status !== "ready") : column.id === "ready" ? inStore.filter((ticket) => ticket.status === "ready") : [];
        return <section key={column.id} className="column">
          <h3>{column.label} <span className="count">{orders.length + local.length}</span></h3>
          {local.map((ticket) => <article key={ticket.id} className="card in-store">
            <header><span className="tag"><Store size={13} /> {ORDER_TYPE_LABELS[ticket.orderType]}</span><b>{ticket.receiptNumber}</b></header>
            {ticket.tableLabel && <small><Utensils size={12} /> {ticket.tableLabel}</small>}
            <ul>{ticket.items.map((item, index) => <li key={index}>{item.quantity} × {item.name}</li>)}</ul>
            <small className="muted">{ticket.statusLabel}</small>
          </article>)}
          {orders.map((order) => <article key={order.id} className={`card platform ${order.platform}`}>
            <header><span className="tag"><Bike size={13} /> {order.platformName}</span><b>#{order.payload.externalId}</b></header>
            {order.payload.customerName && <small>{order.payload.customerName}</small>}
            <ul>{order.payload.items.map((item, index) => <li key={index}>{item.quantity} × {item.name}{item.notes && <em> — {item.notes}</em>}</li>)}</ul>
            <div className="row between"><b>{formatSar(order.payload.total)}</b><small className="muted">{new Date(order.receivedAt).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}</small></div>
            {order.rejectionReason && <small className="error-text">{order.rejectionReason}</small>}
            <div className="row wrap">{nextExternalStatuses(order.status).map((status) => <button key={status} disabled={action.busy}
              className={status === "rejected" || status === "cancelled" ? "ghost danger small" : "primary small"} onClick={() => move(order, status)}>{ACTION_LABELS[status] ?? EXTERNAL_STATUS_LABELS[status]}</button>)}</div>
          </article>)}
        </section>;
      })}
    </div>
  </div>;
}
