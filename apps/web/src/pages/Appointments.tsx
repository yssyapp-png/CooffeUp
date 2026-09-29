import { useState } from "react";
import { APPOINTMENT_STATUS_LABELS, type AppointmentStatus, type Product } from "@cooffeup/shared";
import { api } from "../api";
import { Notice, PageHeader, todayRiyadh, useAction, useLoad } from "../components";
import { useI18n } from "../i18n";

interface AppointmentView { id: string; customerName: string; serviceProductId: string; staffId: string; staffName?: string; startsAt: string; durationMinutes: number; status: AppointmentStatus; statusLabel: string; notes?: string }

const NEXT: Partial<Record<AppointmentStatus, AppointmentStatus[]>> = { booked: ["checked_in", "no_show", "cancelled"], checked_in: ["completed", "cancelled"] };

export function Appointments() {
  const { L, tx, dateTime, productName: localName } = useI18n();
  const [date, setDate] = useState(todayRiyadh());
  const [version, setVersion] = useState(0);
  const list = useLoad(() => api<{ data: AppointmentView[] }>(`/api/v1/appointments?date=${date}`), [date, version]);
  const services = useLoad(() => api<{ data: Product[] }>("/api/v1/products"));
  const staff = useLoad(() => api<{ data: Array<{ id: string; name: string }> }>("/api/v1/auth/staff-directory"));
  const [form, setForm] = useState({ customerName: "", serviceProductId: "", staffId: "", time: "10:00", durationMinutes: "30", notes: "" });
  const action = useAction();
  const productName = (id: string) => { const product = services.data?.data.find((candidate) => candidate.id === id); return product ? localName(product) : id; };

  async function book(event: React.FormEvent) {
    event.preventDefault();
    // Times are entered in Saudi time (UTC+3, no daylight saving).
    const startsAt = new Date(`${date}T${form.time}:00+03:00`).toISOString();
    const ok = await action.run(() => api("/api/v1/appointments", { method: "POST", body: { ...form, startsAt, durationMinutes: Number(form.durationMinutes), notes: form.notes || undefined } }), L("تم حجز الموعد", "Appointment booked"));
    if (ok !== undefined) { setForm({ ...form, customerName: "", notes: "" }); setVersion((value) => value + 1); }
  }

  async function move(appointment: AppointmentView, status: AppointmentStatus) {
    await action.run(() => api(`/api/v1/appointments/${appointment.id}`, { method: "PATCH", body: { status } }));
    setVersion((value) => value + 1);
  }

  return <div className="page">
    <PageHeader eyebrow={L("صالونات · عيادات · مغاسل", "Salons · clinics · laundries")} title={L("المواعيد", "Appointments")} actions={<input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label={L("التاريخ", "Date")} />} />
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    <div className="split">
      <form className="card form" onSubmit={book}>
        <h3>{L("حجز موعد جديد", "New appointment")}</h3>
        <label>{L("اسم العميل", "Customer name")}<input required minLength={2} value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} /></label>
        <label>{L("الخدمة", "Service")}<select required value={form.serviceProductId} onChange={(event) => setForm({ ...form, serviceProductId: event.target.value })}>
          <option value="">{L("اختر الخدمة", "Choose a service")}</option>{services.data?.data.map((product) => <option key={product.id} value={product.id}>{localName(product)}</option>)}</select></label>
        <label>{L("الموظف", "Staff member")}<select required value={form.staffId} onChange={(event) => setForm({ ...form, staffId: event.target.value })}>
          <option value="">{L("اختر الموظف", "Choose a staff member")}</option>{staff.data?.data.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        <div className="row"><label>{L("الوقت", "Time")}<input type="time" required value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} /></label>
          <label>{L("المدة (دقيقة)", "Duration (min)")}<input type="number" min={5} max={600} required value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: event.target.value })} /></label></div>
        <label>{L("ملاحظات", "Notes")}<input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
        <button className="primary" disabled={action.busy}>{L("حجز", "Book")}</button>
      </form>
      <div className="card">
        <h3>{L("مواعيد", "Appointments on")} {date}</h3>
        {(list.data?.data ?? []).length === 0 ? <p className="muted">{L("لا توجد مواعيد", "No appointments")}</p> : <ul className="timeline">{list.data!.data.map((appointment) => <li key={appointment.id} className={appointment.status}>
          <b>{dateTime(appointment.startsAt, { hour: "2-digit", minute: "2-digit" })}</b>
          <div><span>{appointment.customerName} · {productName(appointment.serviceProductId)}</span><small>{appointment.staffName} · {appointment.durationMinutes} {L("دقيقة", "min")} · {tx(appointment.statusLabel)}</small></div>
          <div className="row">{(NEXT[appointment.status] ?? []).map((status) => <button key={status} className="ghost small" onClick={() => move(appointment, status)}>{tx(APPOINTMENT_STATUS_LABELS[status])}</button>)}</div>
        </li>)}</ul>}
      </div>
    </div>
  </div>;
}
