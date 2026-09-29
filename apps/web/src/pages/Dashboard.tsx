import { useEffect, useState } from "react";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@cooffeup/shared";
import { AlertTriangle, Bike, ChefHat, PackageCheck, RefreshCw, Store, Tent } from "lucide-react";
import { api } from "../api";
import { Notice, PageHeader, useLoad } from "../components";
import { useI18n } from "../i18n";
import { channelName } from "../labels";

interface DashboardData {
  today: string;
  sales: number;
  refunded: number;
  netSales: number;
  orders: number;
  averageTicket: number;
  customers: number;
  byChannel: { pos: number; online: number; delivery: number };
  byPayment: Partial<Record<PaymentMethod, number>>;
  week: Array<{ day: string; sales: number; orders: number }>;
  branches: Array<{ id: string; name: string; kind: "permanent" | "temporary"; isOpen: boolean; shiftOpen: boolean; sales: number; orders: number }>;
  lowStock: Array<{ id: string; nameAr: string; nameEn: string; stock: number; reorderLevel: number }>;
  waiting: { platformOrders: number; platforms: string[]; kitchen: number; pickups: number };
  alerts: { storeSync: number; webhooks: number; offlineConflicts: number; integrationErrors: number };
}


/** Owner's single view of every channel and branch, refreshed every minute. */
export function Dashboard() {
  const { L, tx, sar, lang } = useI18n();
  const dayLabel = (day: string) => new Intl.DateTimeFormat(lang === "ar" ? "ar-SA" : "en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
  const [version, setVersion] = useState(0);
  const { data, error } = useLoad(() => api<{ data: DashboardData }>("/api/v1/dashboard"), [version]);
  const [showTable, setShowTable] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setVersion((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  const d = data?.data;
  const alerts = d ? [
    d.alerts.storeSync && `${d.alerts.storeSync} ${L("عملية مزامنة مع المتجر تحتاج مراجعة", "store sync jobs need attention")}`,
    d.alerts.webhooks && `${d.alerts.webhooks} ${L("إرسال للنظام المحاسبي فشل", "deliveries to the accounting system failed")}`,
    d.alerts.offlineConflicts && `${d.alerts.offlineConflicts} ${L("بيع دون اتصال بتعارض مخزون", "offline sales with a stock conflict")}`,
    d.alerts.integrationErrors && `${d.alerts.integrationErrors} ${L("طلب وارد لم يُسجَّل (رموز منتجات غير معرفة)", "incoming orders not recorded (unknown SKUs)")}`
  ].filter(Boolean) as string[] : [];
  const peak = Math.max(1, ...(d?.week.map((day) => day.sales) ?? [1]));

  return <div className="page">
    <PageHeader eyebrow={L("كل القنوات والفروع في مكان واحد", "Every channel and branch in one place")} title={L("لوحة التحكم", "Dashboard")} actions={<button className="ghost" onClick={() => setVersion((value) => value + 1)}><RefreshCw size={15} /> {L("تحديث", "Refresh")}</button>} />
    {error && <Notice tone="error">{error}</Notice>}
    {d && <>
      <div className="stats hero">
        <div><small>{L("مبيعات اليوم", "Sales today")}</small><b>{sar(d.sales)}</b></div>
        <div><small>{L("صافي بعد المرتجعات", "Net of refunds")}</small><b>{sar(d.netSales)}</b></div>
        <div><small>{L("عدد الطلبات", "Orders")}</small><b>{d.orders}</b></div>
        <div><small>{L("متوسط الفاتورة", "Average ticket")}</small><b>{sar(d.averageTicket)}</b></div>
        <div><small>{L("عملاء مسجّلون اليوم", "Known customers today")}</small><b>{d.customers}</b></div>
      </div>

      {alerts.length > 0 && <div className="notice warning alerts" role="status"><AlertTriangle size={16} /><ul>{alerts.map((alert) => <li key={alert}>{alert}</li>)}</ul></div>}

      <div className="split">
        <div className="card">
          <div className="row between"><h3>{L("المبيعات آخر 7 أيام", "Sales, last 7 days")}</h3><button className="link" onClick={() => setShowTable(!showTable)}>{showTable ? L("عرض الرسم", "Show chart") : L("عرض كجدول", "Show as table")}</button></div>
          {showTable ? <table><thead><tr><th>{L("اليوم", "Day")}</th><th>{L("الطلبات", "Orders")}</th><th>{L("المبيعات", "Sales")}</th></tr></thead>
            <tbody>{d.week.map((day) => <tr key={day.day}><td>{dayLabel(day.day)}</td><td className="num">{day.orders}</td><td className="num">{sar(day.sales)}</td></tr>)}</tbody></table>
            : <div className="bars" role="img" aria-label={`${L("المبيعات اليومية", "Daily sales")}: ${d.week.map((day) => `${dayLabel(day.day)} ${sar(day.sales)}`).join(", ")}`}>
              {d.week.map((day) => <div key={day.day} className="bar-col" tabIndex={0}>
                <span className="tip">{sar(day.sales)} · {day.orders} {L("طلب", "orders")}</span>
                <div className="bar" style={{ height: `${Math.max((day.sales / peak) * 100, day.sales ? 2 : 0)}%` }} />
                <small>{dayLabel(day.day)}</small>
              </div>)}
            </div>}
        </div>
        <div className="stack">
          <div className="card">
            <h3>{L("حسب القناة (اليوم)", "By channel (today)")}</h3>
            <div className="stats">
              <div><small>{L("الكاشير", "Till")}</small><b>{sar(d.byChannel.pos)}</b></div>
              <div><small>{L("المتجر الإلكتروني", "Online store")}</small><b>{sar(d.byChannel.online)}</b></div>
              <div><small>{L("تطبيقات التوصيل", "Delivery apps")}</small><b>{sar(d.byChannel.delivery)}</b></div>
            </div>
            <h4>{L("حسب طريقة الدفع", "By payment method")}</h4>
            <ul className="list">{Object.entries(d.byPayment).filter(([, value]) => value).map(([method, value]) => <li key={method}><span>{tx(PAYMENT_METHOD_LABELS[method as PaymentMethod])}</span><b>{sar(value!)}</b></li>)}</ul>
          </div>
          <div className="card">
            <h3>{L("بانتظار التنفيذ", "Waiting")}</h3>
            <ul className="list">
              <li><span><Bike size={15} /> {L("طلبات تطبيقات التوصيل الجديدة", "New delivery-app orders")}{d.waiting.platforms.length ? ` (${d.waiting.platforms.map((platform) => channelName(platform, lang)).join(", ")})` : ""}</span><b>{d.waiting.platformOrders}</b></li>
              <li><span><ChefHat size={15} /> {L("تذاكر المطبخ قيد التحضير", "Kitchen tickets in progress")}</span><b>{d.waiting.kitchen}</b></li>
              <li><span><PackageCheck size={15} /> {L("طلبات لم تُسلَّم للعملاء", "Orders not yet collected")}</span><b>{d.waiting.pickups}</b></li>
            </ul>
          </div>
        </div>
      </div>

      <div className="split">
        <div className="card">
          <h3>{L("الفروع اليوم", "Branches today")}</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>{L("الفرع", "Branch")}</th><th>{L("الحالة", "Status")}</th><th>{L("الوردية", "Shift")}</th><th>{L("الطلبات", "Orders")}</th><th>{L("المبيعات", "Sales")}</th></tr></thead>
            <tbody>{d.branches.map((branch) => <tr key={branch.id}>
              <td>{branch.kind === "temporary" ? <Tent size={14} /> : <Store size={14} />} {tx(branch.name)}</td>
              <td>{branch.isOpen ? L("يعمل", "Trading") : L("خارج فترة العمل", "Outside trading dates")}</td><td>{branch.shiftOpen ? L("مفتوحة", "Open") : L("مغلقة", "Closed")}</td>
              <td className="num">{branch.orders}</td><td className="num">{sar(branch.sales)}</td>
            </tr>)}</tbody>
          </table></div>
        </div>
        <div className="card">
          <h3>{L("منتجات قاربت على النفاد", "Low stock")}</h3>
          {d.lowStock.length === 0 ? <p className="muted">{L("لا توجد منتجات تحت حد إعادة الطلب", "Nothing below its reorder level")}</p> : <ul className="list">{d.lowStock.slice(0, 8).map((product) => <li key={product.id}>
            <span>{lang === "ar" ? product.nameAr : product.nameEn || product.nameAr}</span><span className={product.stock <= 0 ? "negative" : ""}>{product.stock} / {L("حد", "min")} {product.reorderLevel}</span>
          </li>)}</ul>}
        </div>
      </div>
    </>}
  </div>;
}
