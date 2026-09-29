import { useState } from "react";
import { formatSar, type ShiftRecord } from "@cooffeup/shared";
import { api } from "../api";
import { Notice, PageHeader, sarInput, useAction, useLoad } from "../components";

interface ShiftView extends ShiftRecord { summary: { orders: number; cashSales: number; cashRefunds: number; cashExpenses: number; expectedCash: number } }

export function Shift() {
  const [version, setVersion] = useState(0);
  const current = useLoad(() => api<{ data: ShiftView | null }>("/api/v1/shifts/current"), [version]);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [closed, setClosed] = useState<ShiftView | null>(null);
  const action = useAction();
  const shift = current.data?.data;

  async function open(event: React.FormEvent) {
    event.preventDefault();
    await action.run(() => api("/api/v1/shifts/open", { method: "POST", body: { openingFloat: sarInput(amount) } }), "تم فتح الوردية");
    setAmount(""); setVersion((value) => value + 1);
  }

  async function close(event: React.FormEvent) {
    event.preventDefault();
    if (!shift) return;
    const result = await action.run(() => api<{ data: ShiftView }>(`/api/v1/shifts/${shift.id}/close`, { method: "POST", body: { countedCash: sarInput(amount), notes: notes || undefined } }));
    if (result) { setClosed(result.data); setAmount(""); setNotes(""); setVersion((value) => value + 1); }
  }

  return <div className="page narrow">
    <PageHeader eyebrow="فتح الصندوق وإغلاقه ومطابقة النقد" title="الوردية والصندوق" />
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    {closed && <div className="card">
      <h3>تقرير إغلاق الصندوق</h3>
      <div className="stats">
        <div><small>النقد المتوقع</small><b>{formatSar(closed.expectedCash!)}</b></div>
        <div><small>النقد المعدود</small><b>{formatSar(closed.countedCash!)}</b></div>
        <div className={closed.variance === 0 ? "" : closed.variance! < 0 ? "negative" : "positive"}><small>الفرق</small><b>{formatSar(closed.variance!)}</b></div>
        <div><small>عدد الطلبات</small><b>{closed.summary.orders}</b></div>
      </div>
      {closed.variance !== 0 && <p className="muted">تم تسجيل الفرق تلقائيًا في حساب "عجز وزيادة الصندوق".</p>}
    </div>}
    {!shift ? <form className="card form" onSubmit={open}>
      <h3>لا توجد وردية مفتوحة</h3>
      <label>رصيد الافتتاح (ر.س)<input inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="500.00" /></label>
      <button className="primary" disabled={action.busy}>فتح الوردية</button>
    </form> : <form className="card form" onSubmit={close}>
      <h3>الوردية مفتوحة منذ {new Date(shift.openedAt).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}</h3>
      <div className="stats">
        <div><small>رصيد الافتتاح</small><b>{formatSar(shift.openingFloat)}</b></div>
        <div><small>مبيعات نقدية</small><b>{formatSar(shift.summary.cashSales)}</b></div>
        <div><small>مرتجعات ومصروفات نقدية</small><b>{formatSar(shift.summary.cashRefunds + shift.summary.cashExpenses)}</b></div>
        <div><small>عدد الطلبات</small><b>{shift.summary.orders}</b></div>
      </div>
      <label>النقد المعدود في الدرج (ر.س)<input inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <label>ملاحظات<input value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      <button className="primary" disabled={action.busy}>إغلاق الصندوق</button>
    </form>}
  </div>;
}
