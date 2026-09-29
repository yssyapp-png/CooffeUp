import { useState } from "react";
import type { DeliveryPlatform, EcommercePlatform } from "@cooffeup/shared";
import { Bike, RefreshCw, ShoppingCart } from "lucide-react";
import { api } from "../api";
import { Notice, PageHeader, useAction, useLoad } from "../components";

interface EcommerceView { platform: EcommercePlatform; enabled: boolean; storeId?: string; stockEndpoint?: string; lastSyncAt?: string; hasWebhookSecret: boolean; hasAccessToken: boolean; webhookUrl: string }
interface DeliveryView { platform: DeliveryPlatform; nameAr: string; enabled: boolean; commissionBps: number; autoAccept: boolean; hasWebhookSecret: boolean; webhookUrl: string }
interface SyncJobView { id: string; platform: EcommercePlatform; sku: string; quantity: number; status: string; lastError?: string; updatedAt: string }
interface LogView { id: string; source: string; externalId: string; event: string; status: string; message?: string; createdAt: string }
interface IntegrationsData { ecommerce: EcommerceView[]; delivery: DeliveryView[]; syncJobs: SyncJobView[]; log: LogView[] }

const STORE_NAMES: Record<EcommercePlatform, string> = { zid: "زد", salla: "سلة" };
const JOB_STATUS: Record<string, string> = { pending: "بالانتظار", sent: "تمت", failed: "فشلت", needs_configuration: "تحتاج إعداد" };

export function Integrations() {
  const [version, setVersion] = useState(0);
  const data = useLoad(() => api<{ data: IntegrationsData }>("/api/v1/integrations"), [version]);
  const action = useAction();
  const reload = () => setVersion((value) => value + 1);

  return <div className="page">
    <PageHeader eyebrow="المتاجر الإلكترونية وتطبيقات التوصيل" title="الربط والمنصات" actions={<button className="ghost" onClick={reload}><RefreshCw size={15} /> تحديث</button>} />
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    {data.error && <Notice tone="error">{data.error}</Notice>}

    <h2 className="section-title"><ShoppingCart size={18} /> المتاجر الإلكترونية</h2>
    <p className="muted">تُسجَّل طلبات المتجر تلقائيًا في الكاشير وتُخصم من المخزون، ويُرسل كل تغيير في المخزون أو السعر إلى المتجر فورًا.</p>
    <div className="cards">{data.data?.data.ecommerce.map((connection) => <EcommerceCard key={connection.platform} connection={connection} action={action} onSaved={reload} />)}</div>

    <h2 className="section-title"><Bike size={18} /> تطبيقات التوصيل</h2>
    <p className="muted">تصل طلبات كل التطبيقات إلى شاشة "الطلبات الموحدة". يُربط كل صنف برمز المنتج (SKU) لديك.</p>
    <div className="cards">{data.data?.data.delivery.map((connection) => <DeliveryCard key={connection.platform} connection={connection} action={action} onSaved={reload} />)}</div>

    <div className="split">
      <div className="card">
        <h3>مزامنة المخزون مع المتاجر</h3>
        {(data.data?.data.syncJobs ?? []).length === 0 ? <p className="muted">لا توجد عمليات مزامنة</p> : <div className="table-wrap"><table>
          <thead><tr><th>المتجر</th><th>الرمز</th><th>الكمية</th><th>الحالة</th><th /></tr></thead>
          <tbody>{data.data!.data.syncJobs.slice(0, 30).map((job) => <tr key={job.id}><td>{STORE_NAMES[job.platform]}</td><td dir="ltr">{job.sku}</td><td className="num">{job.quantity}</td>
            <td><span className={`pill ${job.status}`} title={job.lastError}>{JOB_STATUS[job.status] ?? job.status}</span></td>
            <td>{job.status !== "sent" && <button className="ghost small" onClick={async () => { await action.run(() => api(`/api/v1/integrations/sync-jobs/${job.id}/retry`, { method: "POST" })); reload(); }}>إعادة</button>}</td></tr>)}</tbody>
        </table></div>}
      </div>
      <div className="card">
        <h3>سجل الطلبات الواردة</h3>
        {(data.data?.data.log ?? []).length === 0 ? <p className="muted">لا توجد أحداث</p> : <ul className="list">{data.data!.data.log.slice(0, 30).map((entry) => <li key={entry.id}>
          <div><b>{entry.source} · #{entry.externalId}</b><small>{entry.event}{entry.message ? ` — ${entry.message}` : ""}</small></div><span className={`pill ${entry.status}`}>{entry.status}</span>
        </li>)}</ul>}
      </div>
    </div>
  </div>;
}

type Action = ReturnType<typeof useAction>;

function EcommerceCard({ connection, action, onSaved }: { connection: EcommerceView; action: Action; onSaved: () => void }) {
  const [form, setForm] = useState({ enabled: connection.enabled, storeId: connection.storeId ?? "", webhookSecret: "", accessToken: "", stockEndpoint: connection.stockEndpoint ?? "" });
  return <form className="card form" onSubmit={async (event) => {
    event.preventDefault();
    await action.run(() => api(`/api/v1/integrations/ecommerce/${connection.platform}`, { method: "PUT", body: {
      enabled: form.enabled, storeId: form.storeId || undefined, webhookSecret: form.webhookSecret || undefined,
      accessToken: form.accessToken || undefined, stockEndpoint: form.stockEndpoint || undefined
    } }), `تم حفظ إعدادات ${STORE_NAMES[connection.platform]}`);
    onSaved();
  }}>
    <div className="row between"><h3>متجر {STORE_NAMES[connection.platform]}</h3><label className="switch"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /> مفعّل</label></div>
    <label>رابط الإشعارات (Webhook) — ألصقه في لوحة المتجر<input readOnly dir="ltr" value={connection.webhookUrl} onFocus={(event) => event.target.select()} /></label>
    <label>معرّف المتجر<input value={form.storeId} onChange={(event) => setForm({ ...form, storeId: event.target.value })} /></label>
    <label>مفتاح توقيع الإشعارات {connection.hasWebhookSecret && <small>(محفوظ ومشفّر)</small>}<input type="password" autoComplete="off" value={form.webhookSecret} onChange={(event) => setForm({ ...form, webhookSecret: event.target.value })} placeholder={connection.hasWebhookSecret ? "اتركه فارغًا للإبقاء عليه" : ""} /></label>
    <label>رمز الوصول (Access token) {connection.hasAccessToken && <small>(محفوظ ومشفّر)</small>}<input type="password" autoComplete="off" value={form.accessToken} onChange={(event) => setForm({ ...form, accessToken: event.target.value })} /></label>
    <label>رابط تحديث المخزون من بوابة المطورين (يحتوي {"{sku}"})<input dir="ltr" value={form.stockEndpoint} onChange={(event) => setForm({ ...form, stockEndpoint: event.target.value })} placeholder="https://.../products/{sku}" /></label>
    {connection.lastSyncAt && <small className="muted">آخر مزامنة: {new Date(connection.lastSyncAt).toLocaleString("ar-SA")}</small>}
    <div className="row">
      <button className="primary" disabled={action.busy}>حفظ</button>
      {connection.enabled && <button type="button" className="ghost" onClick={async () => { await action.run(() => api(`/api/v1/integrations/ecommerce/${connection.platform}/sync`, { method: "POST" }), "تمت جدولة مزامنة كل المنتجات"); onSaved(); }}>مزامنة كل المنتجات</button>}
    </div>
  </form>;
}

function DeliveryCard({ connection, action, onSaved }: { connection: DeliveryView; action: Action; onSaved: () => void }) {
  const [form, setForm] = useState({ enabled: connection.enabled, webhookSecret: "", commission: String(connection.commissionBps / 100), autoAccept: connection.autoAccept });
  return <form className="card form compact" onSubmit={async (event) => {
    event.preventDefault();
    await action.run(() => api(`/api/v1/integrations/delivery/${connection.platform}`, { method: "PUT", body: {
      enabled: form.enabled, webhookSecret: form.webhookSecret || undefined, commissionBps: Math.round(Number(form.commission) * 100), autoAccept: form.autoAccept
    } }), `تم حفظ إعدادات ${connection.nameAr}`);
    onSaved();
  }}>
    <div className="row between"><h3>{connection.nameAr}</h3><label className="switch"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /> مفعّل</label></div>
    <label>رابط الإشعارات<input readOnly dir="ltr" value={connection.webhookUrl} onFocus={(event) => event.target.select()} /></label>
    <label>مفتاح التوقيع {connection.hasWebhookSecret && <small>(محفوظ)</small>}<input type="password" autoComplete="off" value={form.webhookSecret} onChange={(event) => setForm({ ...form, webhookSecret: event.target.value })} /></label>
    <div className="row"><label>العمولة %<input inputMode="decimal" value={form.commission} onChange={(event) => setForm({ ...form, commission: event.target.value })} /></label>
      <label className="check"><input type="checkbox" checked={form.autoAccept} onChange={(event) => setForm({ ...form, autoAccept: event.target.checked })} /> قبول تلقائي</label></div>
    <button className="primary small" disabled={action.busy}>حفظ</button>
  </form>;
}
