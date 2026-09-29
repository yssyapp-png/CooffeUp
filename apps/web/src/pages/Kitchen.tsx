import { useEffect, useState } from "react";
import { formatSar, TABLE_STATUS_LABELS, type KitchenStatus, type KitchenTicket, type TableStatus } from "@cooffeup/shared";
import { Clock } from "lucide-react";
import { api } from "../api";
import { Notice, PageHeader, useAction, useLoad } from "../components";
import { useSession } from "../session";

interface TableView { id: string; label: string; area: string; seats: number; status: TableStatus; statusLabel: string; openTotal: number; orderCount: number; occupiedSince?: string }
type TicketView = KitchenTicket & { statusLabel: string };

const NEXT: Partial<Record<KitchenStatus, { status: KitchenStatus; label: string }>> = {
  new: { status: "preparing", label: "بدء التحضير" }, preparing: { status: "ready", label: "جاهز" }, ready: { status: "served", label: "تم التقديم" }
};

const minutesSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);

export function Kitchen() {
  const { can, hasFeature } = useSession();
  const [tick, setTick] = useState(0);
  const showKitchen = hasFeature("kitchen") && can("kitchen.view");
  const showTables = hasFeature("tables") && can("tables.manage");
  const tickets = useLoad(() => (showKitchen ? api<{ data: TicketView[] }>("/api/v1/kitchen/tickets") : Promise.resolve({ data: [] })), [tick]);
  const tables = useLoad(() => (showTables ? api<{ data: TableView[] }>("/api/v1/tables") : Promise.resolve({ data: [] })), [tick]);
  const action = useAction();

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 8_000);
    return () => clearInterval(timer);
  }, []);

  const update = async (url: string, status: string) => {
    await action.run(() => api(url, { method: "PATCH", body: { status } }));
    setTick((value) => value + 1);
  };

  const areas = [...new Set((tables.data?.data ?? []).map((table) => table.area))];
  return <div className="page">
    <PageHeader eyebrow="تحديث تلقائي كل بضع ثوانٍ" title="المطبخ والطاولات" />
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}

    {showKitchen && <>
      <h2 className="section-title">شاشة المطبخ</h2>
      <div className="kds">{(tickets.data?.data ?? []).length === 0 ? <p className="muted">لا توجد طلبات قيد التحضير</p> : tickets.data!.data.map((ticket) => {
        const age = minutesSince(ticket.createdAt);
        const next = NEXT[ticket.status];
        return <article key={ticket.id} className={`ticket ${ticket.status} ${age > 15 ? "late" : ""}`}>
          <header><b>{ticket.receiptNumber}</b><span><Clock size={13} /> {age} د</span></header>
          <small>{ticket.tableLabel ?? (ticket.orderType === "delivery" ? "توصيل" : "سفري")} · {ticket.statusLabel}</small>
          <ul>{ticket.items.map((item, index) => <li key={index}><b>{item.quantity}×</b> {item.name}{item.notes && <em>{item.notes}</em>}</li>)}</ul>
          {next && <button className="primary small" disabled={action.busy} onClick={() => update(`/api/v1/kitchen/tickets/${ticket.id}`, next.status)}>{next.label}</button>}
        </article>;
      })}</div>
    </>}

    {showTables && <>
      <h2 className="section-title">الطاولات</h2>
      {areas.map((area) => <div key={area}>
        <h3 className="muted">{area}</h3>
        <div className="tables">{tables.data!.data.filter((table) => table.area === area).map((table) => <article key={table.id} className={`table-card ${table.status}`}>
          <b>{table.label}</b><small>{table.seats} مقاعد · {table.statusLabel}</small>
          {table.status === "occupied" && <small>{table.orderCount} طلبات · {formatSar(table.openTotal)}{table.occupiedSince && ` · منذ ${minutesSince(table.occupiedSince)} د`}</small>}
          <select aria-label={`حالة ${table.label}`} value={table.status} onChange={(event) => update(`/api/v1/tables/${table.id}`, event.target.value)}>
            {Object.entries(TABLE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </article>)}</div>
      </div>)}
    </>}
  </div>;
}
