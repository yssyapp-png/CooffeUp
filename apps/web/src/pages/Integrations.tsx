import { useState } from "react";
import type { DeliveryPlatform, EcommercePlatform } from "@cooffeup/shared";
import { Bike, RefreshCw, ShoppingCart } from "lucide-react";
import { api } from "../api";
import { Notice, PageHeader, useAction, useLoad } from "../components";
import { useI18n } from "../i18n";
import { channelName } from "../labels";

interface EcommerceView { platform: EcommercePlatform; enabled: boolean; storeId?: string; stockEndpoint?: string; lastSyncAt?: string; hasWebhookSecret: boolean; hasAccessToken: boolean; webhookUrl: string }
interface DeliveryView { platform: DeliveryPlatform; nameAr: string; enabled: boolean; commissionBps: number; autoAccept: boolean; hasWebhookSecret: boolean; webhookUrl: string }
interface SyncJobView { id: string; platform: EcommercePlatform; sku: string; quantity: number; status: string; lastError?: string; updatedAt: string }
interface LogView { id: string; source: string; externalId: string; event: string; status: string; message?: string; createdAt: string }
interface IntegrationsData { ecommerce: EcommerceView[]; delivery: DeliveryView[]; syncJobs: SyncJobView[]; log: LogView[] }

const JOB_STATUS: Record<string, string> = { pending: "بالانتظار", sent: "تمت", failed: "فشلت", needs_configuration: "تحتاج إعداد" };

export function Integrations() {
  const { L, tx, lang } = useI18n();
  const [version, setVersion] = useState(0);
  const data = useLoad(() => api<{ data: IntegrationsData }>("/api/v1/integrations"), [version]);
  const action = useAction();
  const reload = () => setVersion((value) => value + 1);

  return <div className="page">
    <PageHeader eyebrow={L("المتاجر الإلكترونية وتطبيقات التوصيل", "Online stores and delivery apps")} title={L("الربط والمنصات", "Integrations")} actions={<button className="ghost" onClick={reload}><RefreshCw size={15} /> {L("تحديث", "Refresh")}</button>} />
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    {data.error && <Notice tone="error">{data.error}</Notice>}

    <h2 className="section-title"><ShoppingCart size={18} /> {L("المتاجر الإلكترونية", "Online stores")}</h2>
    <p className="muted">{L("تُسجَّل طلبات المتجر تلقائيًا في الكاشير وتُخصم من المخزون، ويُرسل كل تغيير في المخزون أو السعر إلى المتجر فورًا.", "Store orders are recorded at the till and deducted from stock automatically, and every stock or price change is sent to the store immediately.")}</p>
    <div className="cards">{data.data?.data.ecommerce.map((connection) => <EcommerceCard key={connection.platform} connection={connection} action={action} onSaved={reload} />)}</div>

    <h2 className="section-title"><Bike size={18} /> {L("تطبيقات التوصيل", "Delivery apps")}</h2>
    <p className="muted">{L("تصل طلبات كل التطبيقات إلى شاشة \"الطلبات الموحدة\". يُربط كل صنف برمز المنتج (SKU) لديك.", "Orders from every app arrive in \"All orders\". Each item is matched to your product SKU.")}</p>
    <div className="cards">{data.data?.data.delivery.map((connection) => <DeliveryCard key={connection.platform} connection={connection} action={action} onSaved={reload} />)}</div>

    <div className="split">
      <div className="card">
        <h3>{L("مزامنة المخزون مع المتاجر", "Stock sync with stores")}</h3>
        {(data.data?.data.syncJobs ?? []).length === 0 ? <p className="muted">{L("لا توجد عمليات مزامنة", "No sync jobs")}</p> : <div className="table-wrap"><table>
          <thead><tr><th>{L("المتجر", "Store")}</th><th>{L("الرمز", "SKU")}</th><th>{L("الكمية", "Quantity")}</th><th>{L("الحالة", "Status")}</th><th /></tr></thead>
          <tbody>{data.data!.data.syncJobs.slice(0, 30).map((job) => <tr key={job.id}><td>{channelName(job.platform, lang)}</td><td dir="ltr">{job.sku}</td><td className="num">{job.quantity}</td>
            <td><span className={`pill ${job.status}`} title={job.lastError}>{tx(JOB_STATUS[job.status] ?? job.status)}</span></td>
            <td>{job.status !== "sent" && <button className="ghost small" onClick={async () => { await action.run(() => api(`/api/v1/integrations/sync-jobs/${job.id}/retry`, { method: "POST" })); reload(); }}>{L("إعادة", "Retry")}</button>}</td></tr>)}</tbody>
        </table></div>}
      </div>
      <div className="card">
        <h3>{L("سجل الطلبات الواردة", "Incoming order log")}</h3>
        {(data.data?.data.log ?? []).length === 0 ? <p className="muted">{L("لا توجد أحداث", "No events")}</p> : <ul className="list">{data.data!.data.log.slice(0, 30).map((entry) => <li key={entry.id}>
          <div><b>{entry.source} · #{entry.externalId}</b><small>{entry.event}{entry.message ? ` — ${entry.message}` : ""}</small></div><span className={`pill ${entry.status}`}>{entry.status}</span>
        </li>)}</ul>}
      </div>
    </div>
  </div>;
}

type Action = ReturnType<typeof useAction>;

function EcommerceCard({ connection, action, onSaved }: { connection: EcommerceView; action: Action; onSaved: () => void }) {
  const { L, lang, dateTime } = useI18n();
  const storeName = channelName(connection.platform, lang);
  const [form, setForm] = useState({ enabled: connection.enabled, storeId: connection.storeId ?? "", webhookSecret: "", accessToken: "", stockEndpoint: connection.stockEndpoint ?? "" });
  return <form className="card form" onSubmit={async (event) => {
    event.preventDefault();
    await action.run(() => api(`/api/v1/integrations/ecommerce/${connection.platform}`, { method: "PUT", body: {
      enabled: form.enabled, storeId: form.storeId || undefined, webhookSecret: form.webhookSecret || undefined,
      accessToken: form.accessToken || undefined, stockEndpoint: form.stockEndpoint || undefined
    } }), `${L("تم حفظ إعدادات", "Saved settings for")} ${storeName}`);
    onSaved();
  }}>
    <div className="row between"><h3>{L("متجر", "Store:")} {storeName}</h3><label className="switch"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /> {L("مفعّل", "Enabled")}</label></div>
    <label>{L("رابط الإشعارات (Webhook) — ألصقه في لوحة المتجر", "Webhook URL — paste it in the store dashboard")}<input readOnly dir="ltr" value={connection.webhookUrl} onFocus={(event) => event.target.select()} /></label>
    <label>{L("معرّف المتجر", "Store ID")}<input value={form.storeId} onChange={(event) => setForm({ ...form, storeId: event.target.value })} /></label>
    <label>{L("مفتاح توقيع الإشعارات", "Webhook signing secret")} {connection.hasWebhookSecret && <small>({L("محفوظ ومشفّر", "saved, encrypted")})</small>}<input type="password" autoComplete="off" value={form.webhookSecret} onChange={(event) => setForm({ ...form, webhookSecret: event.target.value })} placeholder={connection.hasWebhookSecret ? L("اتركه فارغًا للإبقاء عليه", "Leave empty to keep it") : ""} /></label>
    <label>{L("رمز الوصول (Access token)", "Access token")} {connection.hasAccessToken && <small>({L("محفوظ ومشفّر", "saved, encrypted")})</small>}<input type="password" autoComplete="off" value={form.accessToken} onChange={(event) => setForm({ ...form, accessToken: event.target.value })} /></label>
    <label>{L("رابط تحديث المخزون من بوابة المطورين (يحتوي {sku})", "Stock update URL from the developer portal (contains {sku})")}<input dir="ltr" value={form.stockEndpoint} onChange={(event) => setForm({ ...form, stockEndpoint: event.target.value })} placeholder="https://.../products/{sku}" /></label>
    {connection.lastSyncAt && <small className="muted">{L("آخر مزامنة", "Last sync")}: {dateTime(connection.lastSyncAt)}</small>}
    <div className="row">
      <button className="primary" disabled={action.busy}>{L("حفظ", "Save")}</button>
      {connection.enabled && <button type="button" className="ghost" onClick={async () => { await action.run(() => api(`/api/v1/integrations/ecommerce/${connection.platform}/sync`, { method: "POST" }), L("تمت جدولة مزامنة كل المنتجات", "Full product sync scheduled")); onSaved(); }}>{L("مزامنة كل المنتجات", "Sync all products")}</button>}
    </div>
  </form>;
}

function DeliveryCard({ connection, action, onSaved }: { connection: DeliveryView; action: Action; onSaved: () => void }) {
  const { L, lang } = useI18n();
  const platformName = channelName(connection.platform, lang);
  const [form, setForm] = useState({ enabled: connection.enabled, webhookSecret: "", commission: String(connection.commissionBps / 100), autoAccept: connection.autoAccept });
  return <form className="card form compact" onSubmit={async (event) => {
    event.preventDefault();
    await action.run(() => api(`/api/v1/integrations/delivery/${connection.platform}`, { method: "PUT", body: {
      enabled: form.enabled, webhookSecret: form.webhookSecret || undefined, commissionBps: Math.round(Number(form.commission) * 100), autoAccept: form.autoAccept
    } }), `${L("تم حفظ إعدادات", "Saved settings for")} ${platformName}`);
    onSaved();
  }}>
    <div className="row between"><h3>{platformName}</h3><label className="switch"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /> {L("مفعّل", "Enabled")}</label></div>
    <label>{L("رابط الإشعارات", "Webhook URL")}<input readOnly dir="ltr" value={connection.webhookUrl} onFocus={(event) => event.target.select()} /></label>
    <label>{L("مفتاح التوقيع", "Signing secret")} {connection.hasWebhookSecret && <small>({L("محفوظ", "saved")})</small>}<input type="password" autoComplete="off" value={form.webhookSecret} onChange={(event) => setForm({ ...form, webhookSecret: event.target.value })} /></label>
    <div className="row"><label>{L("العمولة %", "Commission %")}<input inputMode="decimal" value={form.commission} onChange={(event) => setForm({ ...form, commission: event.target.value })} /></label>
      <label className="check"><input type="checkbox" checked={form.autoAccept} onChange={(event) => setForm({ ...form, autoAccept: event.target.checked })} /> {L("قبول تلقائي", "Auto-accept")}</label></div>
    <button className="primary small" disabled={action.busy}>{L("حفظ", "Save")}</button>
  </form>;
}
