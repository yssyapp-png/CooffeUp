import { useState } from "react";
import type { ReportCategory, ReportResult } from "@cooffeup/shared";
import { Download, Play } from "lucide-react";
import { api } from "../api";
import { DataTable, formatCell, Notice, PageHeader, todayRiyadh, useAction, useLoad } from "../components";

interface ReportMeta { id: string; nameAr: string; category: ReportCategory; descriptionAr: string; usesRange: boolean }

const monthStart = () => `${todayRiyadh().slice(0, 8)}01`;

function toCsv(result: ReportResult) {
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [result.columns.map((column) => column.labelAr), ...result.rows.map((row) => result.columns.map((column) => formatCell(row[column.key], column.kind)))];
  return `﻿${lines.map((line) => line.map(escape).join(",")).join("\n")}`;
}

export function Reports() {
  const catalog = useLoad(() => api<{ data: ReportMeta[]; categories: Record<ReportCategory, string> }>("/api/v1/reports"));
  const [selected, setSelected] = useState<ReportMeta | null>(null);
  const [range, setRange] = useState({ from: monthStart(), to: todayRiyadh() });
  const [result, setResult] = useState<ReportResult | null>(null);
  const action = useAction();

  async function run(report: ReportMeta) {
    setSelected(report);
    setResult(null);
    const query = report.usesRange ? `?from=${range.from}&to=${range.to}` : "";
    const response = await action.run(() => api<{ data: ReportResult }>(`/api/v1/reports/${report.id}${query}`));
    if (response) setResult(response.data);
  }

  function exportCsv() {
    if (!result || !selected) return;
    const url = URL.createObjectURL(new Blob([toCsv(result)], { type: "text/csv;charset=utf-8" }));
    Object.assign(document.createElement("a"), { href: url, download: `${selected.id}-${range.from}-${range.to}.csv` }).click();
    URL.revokeObjectURL(url);
  }

  const categories = catalog.data ? Object.entries(catalog.data.categories) as Array<[ReportCategory, string]> : [];
  return <div className="page">
    <PageHeader eyebrow={`${catalog.data?.data.length ?? ""} تقريرًا دوريًا`} title="التقارير" actions={<>
      <label className="inline-field">من<input type="date" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} /></label>
      <label className="inline-field">إلى<input type="date" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} /></label>
    </>} />
    {catalog.error && <Notice tone="error">{catalog.error}</Notice>}
    <div className="reports">
      <nav className="report-list" aria-label="التقارير">{categories.map(([category, label]) => <div key={category}>
        <h4>{label}</h4>
        {catalog.data!.data.filter((report) => report.category === category).map((report) => <button key={report.id} className={selected?.id === report.id ? "active" : ""} onClick={() => run(report)}>
          {report.nameAr}
        </button>)}
      </div>)}</nav>
      <section className="card report-view">
        {!selected ? <p className="muted center">اختر تقريرًا من القائمة</p> : <>
          <div className="row between">
            <div><h3>{selected.nameAr}</h3><small className="muted">{selected.descriptionAr}{selected.usesRange ? ` · ${range.from} إلى ${range.to}` : " · الوضع الحالي"}</small></div>
            <div className="row"><button className="ghost small" onClick={() => run(selected)}><Play size={14} /> تحديث</button>
              <button className="ghost small" onClick={exportCsv} disabled={!result}><Download size={14} /> CSV</button>
              <button className="ghost small" onClick={() => window.print()} disabled={!result}>طباعة</button></div>
          </div>
          {action.message && <Notice tone={action.message.tone}>{action.message.text}</Notice>}
          {action.busy && <p className="muted">جارٍ التحميل…</p>}
          {result?.summary && <div className="stats">{result.summary.map((item) => <div key={item.labelAr}><small>{item.labelAr}</small><b>{formatCell(item.value, item.kind)}</b></div>)}</div>}
          {result && <DataTable result={result} />}
        </>}
      </section>
    </div>
  </div>;
}
