import { useState } from "react";
import { PICKUP_STATUS_LABELS, type PickupStatus, type PickupTicket } from "@cooffeup/shared";
import { Clock, Search } from "lucide-react";
import { api } from "../api";
import { Notice, PageHeader, useAction, useLoad } from "../components";

interface TicketView extends PickupTicket { statusLabel: string; customerName?: string }

const dateTime = new Intl.DateTimeFormat("ar-SA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });
const COLUMNS: PickupStatus[] = ["received", "ready"];

/** Laundry-style flow: items received with the order, marked ready (optionally texting the customer), then handed over. */
export function Pickups() {
  const [query, setQuery] = useState("");
  const [version, setVersion] = useState(0);
  const tickets = useLoad(() => api<{ data: TicketView[] }>(`/api/v1/pickup-tickets${query ? `?q=${encodeURIComponent(query)}` : ""}`), [query, version]);
  const action = useAction();

  async function move(ticket: TicketView, status: PickupStatus, notify = false) {
    const result = await action.run(() => api<{ notified: { status: string; error?: string } }>(`/api/v1/pickup-tickets/${ticket.id}`, { method: "PATCH", body: { status, notify } }));
    if (result && notify) {
      action.setMessage(result.notified.status === "sent" ? { tone: "success", text: "تم إبلاغ العميل برسالة نصية" }
        : { tone: "error", text: result.notified.status === "skipped" ? "لا يوجد جوال مسجّل للعميل" : `تعذر إرسال الرسالة: ${result.notified.error ?? ""}` });
    }
    setVersion((value) => value + 1);
  }

  const now = new Date().toISOString();
  return <div className="page">
    <PageHeader eyebrow="استلام الملابس والطلبات وتسليمها" title="الاستلام والتسليم" actions={
      <div className="search"><Search size={17} /><input aria-label="بحث" placeholder="رقم الإيصال" value={query} onChange={(event) => setQuery(event.target.value)} /></div>} />
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    {tickets.error && <Notice tone="error">{tickets.error}</Notice>}
    <div className="board two">{COLUMNS.map((column) => {
      const items = (tickets.data?.data ?? []).filter((ticket) => ticket.status === column);
      return <section key={column} className="column">
        <h3>{PICKUP_STATUS_LABELS[column]} <span className="count">{items.length}</span></h3>
        {items.map((ticket) => <article key={ticket.id} className={`card ${column === "received" && ticket.dueAt < now ? "late-card" : ""}`}>
          <header className="row between"><b>{ticket.receiptNumber}</b><small><Clock size={12} /> {dateTime.format(new Date(ticket.dueAt))}</small></header>
          {ticket.customerName && <small>{ticket.customerName}</small>}
          <ul>{ticket.items.map((item, index) => <li key={index}>{item.quantity} × {item.name}{item.notes && <em> — {item.notes}</em>}</li>)}</ul>
          {column === "received" && ticket.dueAt < now && <small className="negative">متأخر عن الموعد</small>}
          <div className="row wrap">
            {column === "received" && <>
              <button className="primary small" disabled={action.busy} onClick={() => move(ticket, "ready", true)}>جاهز + إبلاغ العميل</button>
              <button className="ghost small" disabled={action.busy} onClick={() => move(ticket, "ready")}>جاهز</button>
            </>}
            {column === "ready" && <>
              <button className="primary small" disabled={action.busy} onClick={() => move(ticket, "collected")}>تم التسليم</button>
              <button className="ghost small" disabled={action.busy} onClick={() => move(ticket, "received")}>إرجاع للتجهيز</button>
            </>}
          </div>
        </article>)}
      </section>;
    })}</div>
  </div>;
}
