import { useEffect, useState } from "react";
import { formatSar, PAYMENT_METHOD_LABELS, type PaymentMethod } from "@cooffeup/shared";
import { AlertTriangle, Bike, ChefHat, PackageCheck, RefreshCw, Store, Tent } from "lucide-react";
import { api } from "../api";
import { Notice, PageHeader, useLoad } from "../components";

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
  lowStock: Array<{ id: string; nameAr: string; stock: number; reorderLevel: number }>;
  waiting: { platformOrders: number; platforms: string[]; kitchen: number; pickups: number };
  alerts: { storeSync: number; webhooks: number; offlineConflicts: number; integrationErrors: number };
}

const dayLabel = (day: string) => new Intl.DateTimeFormat("ar-SA", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

/** Owner's single view of every channel and branch, refreshed every minute. */
export function Dashboard() {
  const [version, setVersion] = useState(0);
  const { data, error } = useLoad(() => api<{ data: DashboardData }>("/api/v1/dashboard"), [version]);
  const [showTable, setShowTable] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setVersion((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  const d = data?.data;
  const alerts = d ? [
    d.alerts.storeSync && `${d.alerts.storeSync} عملية مزامنة مع المتجر تحتاج مراجعة`,
    d.alerts.webhooks && `${d.alerts.webhooks} إرسال للنظام المحاسبي فشل`,
    d.alerts.offlineConflicts && `${d.alerts.offlineConflicts} بيع دون اتصال بتعارض مخزون`,
    d.alerts.integrationErrors && `${d.alerts.integrationErrors} طلب وارد لم يُسجَّل (رموز منتجات غير معرفة)`
  ].filter(Boolean) as string[] : [];
  const peak = Math.max(1, ...(d?.week.map((day) => day.sales) ?? [1]));

  return <div className="page">
    <PageHeader eyebrow="كل القنوات والفروع في مكان واحد" title="لوحة التحكم" actions={<button className="ghost" onClick={() => setVersion((value) => value + 1)}><RefreshCw size={15} /> تحديث</button>} />
    {error && <Notice tone="error">{error}</Notice>}
    {d && <>
      <div className="stats hero">
        <div><small>مبيعات اليوم</small><b>{formatSar(d.sales)}</b></div>
        <div><small>صافي بعد المرتجعات</small><b>{formatSar(d.netSales)}</b></div>
        <div><small>عدد الطلبات</small><b>{d.orders}</b></div>
        <div><small>متوسط الفاتورة</small><b>{formatSar(d.averageTicket)}</b></div>
        <div><small>عملاء مسجّلون اليوم</small><b>{d.customers}</b></div>
      </div>

      {alerts.length > 0 && <div className="notice warning alerts" role="status"><AlertTriangle size={16} /><ul>{alerts.map((alert) => <li key={alert}>{alert}</li>)}</ul></div>}

      <div className="split">
        <div className="card">
          <div className="row between"><h3>المبيعات آخر 7 أيام</h3><button className="link" onClick={() => setShowTable(!showTable)}>{showTable ? "عرض الرسم" : "عرض كجدول"}</button></div>
          {showTable ? <table><thead><tr><th>اليوم</th><th>الطلبات</th><th>المبيعات</th></tr></thead>
            <tbody>{d.week.map((day) => <tr key={day.day}><td>{dayLabel(day.day)}</td><td className="num">{day.orders}</td><td className="num">{formatSar(day.sales)}</td></tr>)}</tbody></table>
            : <div className="bars" role="img" aria-label={`المبيعات اليومية: ${d.week.map((day) => `${dayLabel(day.day)} ${formatSar(day.sales)}`).join("، ")}`}>
              {d.week.map((day) => <div key={day.day} className="bar-col" tabIndex={0}>
                <span className="tip">{formatSar(day.sales)} · {day.orders} طلب</span>
                <div className="bar" style={{ height: `${Math.max((day.sales / peak) * 100, day.sales ? 2 : 0)}%` }} />
                <small>{dayLabel(day.day)}</small>
              </div>)}
            </div>}
        </div>
        <div className="stack">
          <div className="card">
            <h3>حسب القناة (اليوم)</h3>
            <div className="stats">
              <div><small>الكاشير</small><b>{formatSar(d.byChannel.pos)}</b></div>
              <div><small>المتجر الإلكتروني</small><b>{formatSar(d.byChannel.online)}</b></div>
              <div><small>تطبيقات التوصيل</small><b>{formatSar(d.byChannel.delivery)}</b></div>
            </div>
            <h4>حسب طريقة الدفع</h4>
            <ul className="list">{Object.entries(d.byPayment).filter(([, value]) => value).map(([method, value]) => <li key={method}><span>{PAYMENT_METHOD_LABELS[method as PaymentMethod]}</span><b>{formatSar(value!)}</b></li>)}</ul>
          </div>
          <div className="card">
            <h3>بانتظار التنفيذ</h3>
            <ul className="list">
              <li><span><Bike size={15} /> طلبات تطبيقات التوصيل الجديدة{d.waiting.platforms.length ? ` (${d.waiting.platforms.join("، ")})` : ""}</span><b>{d.waiting.platformOrders}</b></li>
              <li><span><ChefHat size={15} /> تذاكر المطبخ قيد التحضير</span><b>{d.waiting.kitchen}</b></li>
              <li><span><PackageCheck size={15} /> طلبات لم تُسلَّم للعملاء</span><b>{d.waiting.pickups}</b></li>
            </ul>
          </div>
        </div>
      </div>

      <div className="split">
        <div className="card">
          <h3>الفروع اليوم</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>الفرع</th><th>الحالة</th><th>الوردية</th><th>الطلبات</th><th>المبيعات</th></tr></thead>
            <tbody>{d.branches.map((branch) => <tr key={branch.id}>
              <td>{branch.kind === "temporary" ? <Tent size={14} /> : <Store size={14} />} {branch.name}</td>
              <td>{branch.isOpen ? "يعمل" : "خارج فترة العمل"}</td><td>{branch.shiftOpen ? "مفتوحة" : "مغلقة"}</td>
              <td className="num">{branch.orders}</td><td className="num">{formatSar(branch.sales)}</td>
            </tr>)}</tbody>
          </table></div>
        </div>
        <div className="card">
          <h3>منتجات قاربت على النفاد</h3>
          {d.lowStock.length === 0 ? <p className="muted">لا توجد منتجات تحت حد إعادة الطلب</p> : <ul className="list">{d.lowStock.slice(0, 8).map((product) => <li key={product.id}>
            <span>{product.nameAr}</span><span className={product.stock <= 0 ? "negative" : ""}>{product.stock} / حد {product.reorderLevel}</span>
          </li>)}</ul>}
        </div>
      </div>
    </>}
  </div>;
}
