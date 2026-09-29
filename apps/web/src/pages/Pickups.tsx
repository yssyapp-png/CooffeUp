import { useState } from "react";
import { PICKUP_STATUS_LABELS, type PickupStatus, type PickupTicket } from "@cooffeup/shared";
import { Clock, Search } from "lucide-react";
import { api } from "../api";
import { Notice, PageHeader, useAction, useLoad } from "../components";
import { useI18n } from "../i18n";

interface TicketView extends PickupTicket { statusLabel: string; customerName?: string }

const COLUMNS: PickupStatus[] = ["received", "ready"];

/** Laundry-style flow: items received with the order, marked ready (optionally texting the customer), then handed over. */
export function Pickups() {
  const { L, tx, dateTime } = useI18n();
  const [query, setQuery] = useState("");
  const [version, setVersion] = useState(0);
  const tickets = useLoad(() => api<{ data: TicketView[] }>(`/api/v1/pickup-tickets${query ? `?q=${encodeURIComponent(query)}` : ""}`), [query, version]);
  const action = useAction();

  async function move(ticket: TicketView, status: PickupStatus, notify = false) {
    const result = await action.run(() => api<{ notified: { status: string; error?: string } }>(`/api/v1/pickup-tickets/${ticket.id}`, { method: "PATCH", body: { status, notify } }));
    if (result && notify) {
      action.setMessage(result.notified.status === "sent" ? { tone: "success", text: L("تم إبلاغ العميل برسالة نصية", "Customer notified by SMS") }
        : { tone: "error", text: result.notified.status === "skipped" ? L("لا يوجد جوال مسجّل للعميل", "The customer has no mobile number on file") : `${L("تعذر إرسال الرسالة", "Could not send the SMS")}: ${result.notified.error ?? ""}` });
    }
    setVersion((value) => value + 1);
  }

  const now = new Date().toISOString();
  return <div className="page">
    <PageHeader eyebrow={L("استلام الملابس والطلبات وتسليمها", "Receive items and hand them back")} title={L("الاستلام والتسليم", "Pickups")} actions={
      <div className="search"><Search size={17} /><input aria-label={L("بحث", "Search")} placeholder={L("رقم الإيصال", "Receipt number")} value={query} onChange={(event) => setQuery(event.target.value)} /></div>} />
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    {tickets.error && <Notice tone="error">{tickets.error}</Notice>}
    <div className="board two">{COLUMNS.map((column) => {
      const items = (tickets.data?.data ?? []).filter((ticket) => ticket.status === column);
      return <section key={column} className="column">
        <h3>{tx(PICKUP_STATUS_LABELS[column])} <span className="count">{items.length}</span></h3>
        {items.map((ticket) => <article key={ticket.id} className={`card ${column === "received" && ticket.dueAt < now ? "late-card" : ""}`}>
          <header className="row between"><b>{ticket.receiptNumber}</b><small><Clock size={12} /> {dateTime(ticket.dueAt, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></header>
          {ticket.customerName && <small>{ticket.customerName}</small>}
          <ul>{ticket.items.map((item, index) => <li key={index}>{item.quantity} × {item.name}{item.notes && <em> — {item.notes}</em>}</li>)}</ul>
          {column === "received" && ticket.dueAt < now && <small className="negative">{L("متأخر عن الموعد", "Overdue")}</small>}
          <div className="row wrap">
            {column === "received" && <>
              <button className="primary small" disabled={action.busy} onClick={() => move(ticket, "ready", true)}>{L("جاهز + إبلاغ العميل", "Ready + notify customer")}</button>
              <button className="ghost small" disabled={action.busy} onClick={() => move(ticket, "ready")}>{L("جاهز", "Ready")}</button>
            </>}
            {column === "ready" && <>
              <button className="primary small" disabled={action.busy} onClick={() => move(ticket, "collected")}>{L("تم التسليم", "Collected")}</button>
              <button className="ghost small" disabled={action.busy} onClick={() => move(ticket, "received")}>{L("إرجاع للتجهيز", "Back to processing")}</button>
            </>}
          </div>
        </article>)}
      </section>;
    })}</div>
  </div>;
}
