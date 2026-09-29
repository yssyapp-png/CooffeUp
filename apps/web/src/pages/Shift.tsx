import { useState } from "react";
import { formatSar, parseSar, type ShiftRecord } from "@cooffeup/shared";
import { api } from "../api";
import { Notice, PageHeader, useAction, useLoad } from "../components";
import { useI18n } from "../i18n";

interface Summary { orders: number; cashSales: number; cashRefunds: number; cashExpenses: number; cashIn: number; cashOut: number; expectedCash: number }
interface ShiftView extends ShiftRecord { summary: Summary }
interface ShiftReport extends Summary { sales: number; refunded: number; netSales: number; tenders: Record<string, number>; refundsByMethod: Record<string, number> }

const METHOD_NAMES: Record<"ar" | "en", Record<string, string>> = {
  ar: { cash: "نقدًا", mada: "مدى", card: "بطاقة ائتمانية", apple_pay: "Apple Pay", stc_pay: "STC Pay", online: "المتجر الإلكتروني", delivery_platform: "منصات التوصيل" },
  en: { cash: "Cash", mada: "mada", card: "Credit card", apple_pay: "Apple Pay", stc_pay: "STC Pay", online: "Online store", delivery_platform: "Delivery apps" }
};

export function Shift() {
  const { t, lang, locale } = useI18n();
  const sar = (value: number) => formatSar(value, locale);
  const [version, setVersion] = useState(0);
  const current = useLoad(() => api<{ data: ShiftView | null }>("/api/v1/shifts/current"), [version]);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [movement, setMovement] = useState({ type: "cash_out" as "cash_in" | "cash_out", amount: "", reason: "" });
  const [report, setReport] = useState<(ShiftReport & { shift: ShiftRecord }) | null>(null);
  const action = useAction();
  const shift = current.data?.data;
  const reload = () => setVersion((value) => value + 1);

  async function open(event: React.FormEvent) {
    event.preventDefault();
    const float = parseSar(amount);
    if (float === null) return action.setMessage({ tone: "error", text: t("invalidAmount") });
    await action.run(() => api("/api/v1/shifts/open", { method: "POST", body: { openingFloat: float } }), t("shiftOpened"));
    setAmount(""); setReport(null); reload();
  }

  async function move(event: React.FormEvent) {
    event.preventDefault();
    const value = parseSar(movement.amount);
    if (!shift || value === null || value === 0) return action.setMessage({ tone: "error", text: t("invalidAmount") });
    const saved = await action.run(() => api(`/api/v1/shifts/${shift.id}/movements`, { method: "POST", body: { type: movement.type, amount: value, reason: movement.reason } }), t("movementSaved"));
    if (saved) { setMovement({ ...movement, amount: "", reason: "" }); reload(); }
  }

  async function close(event: React.FormEvent) {
    event.preventDefault();
    const counted = parseSar(amount);
    if (!shift || counted === null) return action.setMessage({ tone: "error", text: t("invalidAmount") });
    const result = await action.run(() => api(`/api/v1/shifts/${shift.id}/close`, { method: "POST", body: { countedCash: counted, notes: notes || undefined } }));
    if (!result) return;
    setAmount(""); setNotes("");
    const detail = await action.run(() => api<{ data: ShiftReport & { shift: ShiftRecord } }>(`/api/v1/shifts/${shift.id}/report`));
    if (detail) setReport(detail.data);
    reload();
  }

  return <div className="page narrow">
    <PageHeader eyebrow={t("shiftEyebrow")} title={t("shiftTitle")} />
    {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
    {report && <div className="card">
      <h3>{t("closeReport")}</h3>
      <div className="stats">
        <div><small>{t("expectedCash")}</small><b>{sar(report.shift.expectedCash!)}</b></div>
        <div><small>{t("countedCash")}</small><b>{sar(report.shift.countedCash!)}</b></div>
        <div className={report.shift.variance === 0 ? "" : report.shift.variance! < 0 ? "negative" : "positive"}><small>{t("variance")}</small><b>{sar(report.shift.variance!)}</b></div>
        <div><small>{t("netSales")}</small><b>{sar(report.netSales)}</b></div>
        <div><small>{t("refunded")}</small><b>{sar(report.refunded)}</b></div>
        <div><small>{t("cashIn")} / {t("cashOut")}</small><b>{sar(report.cashIn)} / {sar(report.cashOut)}</b></div>
      </div>
      <h4>{t("tenders")}</h4>
      <table><tbody>{Object.entries(report.tenders).filter(([method, value]) => value !== 0 || report.refundsByMethod[method] !== 0).map(([method, value]) =>
        <tr key={method}><td>{METHOD_NAMES[lang][method] ?? method}</td><td className="num">{sar(value)}</td><td className="num negative">{report.refundsByMethod[method] ? `- ${sar(report.refundsByMethod[method])}` : ""}</td></tr>)}</tbody></table>
      {report.shift.variance !== 0 && <p className="muted">{t("varianceBooked")}</p>}
    </div>}
    {!shift ? <form className="card form" onSubmit={open}>
      <h3>{t("noOpenShift")}</h3>
      <label>{t("openingFloat")}<input inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="500.00" /></label>
      <button className="primary" disabled={action.busy}>{t("openShift")}</button>
    </form> : <>
      <div className="card">
        <h3>{t("shiftOpenSince")} {new Date(shift.openedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</h3>
        <div className="stats">
          <div><small>{t("openingFloat")}</small><b>{sar(shift.openingFloat)}</b></div>
          <div><small>{t("cashSales")}</small><b>{sar(shift.summary.cashSales)}</b></div>
          <div><small>{t("refundsExpenses")}</small><b>{sar(shift.summary.cashRefunds + shift.summary.cashExpenses)}</b></div>
          <div><small>{t("cashIn")} / {t("cashOut")}</small><b>{sar(shift.summary.cashIn)} / {sar(shift.summary.cashOut)}</b></div>
          <div><small>{t("orders")}</small><b>{shift.summary.orders}</b></div>
        </div>
      </div>
      <form className="card form" onSubmit={move}>
        <div className="segmented inline">
          <button type="button" className={movement.type === "cash_in" ? "selected" : ""} onClick={() => setMovement({ ...movement, type: "cash_in" })}>{t("cashIn")}</button>
          <button type="button" className={movement.type === "cash_out" ? "selected" : ""} onClick={() => setMovement({ ...movement, type: "cash_out" })}>{t("cashOut")}</button>
        </div>
        <div className="grid-2">
          <label>{t("amount")}<input inputMode="decimal" required value={movement.amount} onChange={(event) => setMovement({ ...movement, amount: event.target.value })} /></label>
          <label>{t("movementReason")}<input required minLength={3} value={movement.reason} onChange={(event) => setMovement({ ...movement, reason: event.target.value })} /></label>
        </div>
        <button className="ghost" disabled={action.busy}>{t("recordMovement")}</button>
      </form>
      <form className="card form" onSubmit={close}>
        <label>{t("countedCash")}<input inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label>{t("notes")}<input value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <button className="primary" disabled={action.busy}>{t("closeShift")}</button>
      </form>
    </>}
  </div>;
}
