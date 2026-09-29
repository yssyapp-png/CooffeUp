import { useEffect, useState, type ReactNode } from "react";
import { formatSar, type ReportColumn, type ReportResult, type ReportRow } from "@cooffeup/shared";
import { errorMessage } from "./api";
import { useI18n, type Language } from "./i18n";
import { toEnglish } from "./labels";

export function formatCell(value: ReportRow[string], kind: ReportColumn["kind"], lang: Language = "ar", translate: (text: string) => string = toEnglish): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" && kind !== "date" && kind !== "datetime") return lang === "ar" ? value : translate(value);
  const locale = lang === "ar" ? "ar-SA" : "en-SA";
  switch (kind) {
    case "money": return formatSar(Number(value), locale);
    case "percent": return `${new Intl.NumberFormat(locale).format(Number(value) / 100)}%`;
    case "number": return new Intl.NumberFormat(locale).format(Number(value));
    case "datetime": return new Intl.DateTimeFormat(lang === "ar" ? "ar-SA" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(new Date(String(value)));
    case "date": return String(value);
    default: return String(value);
  }
}

/** `translate` overrides how text cells become English (channel reports use their own mapping). */
export function DataTable({ result, empty, translate }: { result: ReportResult; empty?: string; translate?: (text: string) => string }) {
  const { lang, L, tx } = useI18n();
  if (!result.rows.length) return <p className="muted center">{empty ?? L("لا توجد بيانات للفترة المحددة", "No data for the selected period")}</p>;
  return <div className="table-wrap">
    <table>
      <thead><tr>{result.columns.map((column) => <th key={column.key}>{tx(column.labelAr)}</th>)}</tr></thead>
      <tbody>{result.rows.map((row, index) => <tr key={index}>{result.columns.map((column) => {
        // Summary-style reports carry the format of their "value" cell on each row.
        const kind = column.key === "value" && typeof row.kind === "string" ? row.kind as ReportColumn["kind"] : column.kind;
        return <td key={column.key} className={kind === "money" || kind === "number" || kind === "percent" ? "num" : ""}>{formatCell(row[column.key], kind, lang, translate)}</td>;
      })}</tr>)}</tbody>
    </table>
  </div>;
}

export function PageHeader({ eyebrow, title, actions }: { eyebrow?: string; title: string; actions?: ReactNode }) {
  return <div className="page-header"><div>{eyebrow && <p>{eyebrow}</p>}<h1>{title}</h1></div>{actions && <div className="actions">{actions}</div>}</div>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "success" | "warning"; children: ReactNode }) {
  return <div className={`notice ${tone}`} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}

/** Loads data on mount and whenever `deps` change; exposes reload for after mutations. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    loader().then((value) => { if (active) { setData(value); setError(""); } }).catch((reason) => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);
  return { data, error, reload: () => setVersion((value) => value + 1) };
}

/** Wraps an async action with busy state and a user-facing message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  async function run<T>(action: () => Promise<T>, success?: string): Promise<T | undefined> {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      if (success) setMessage({ tone: "success", text: success });
      return result;
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error) });
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, message, setMessage, run };
}

export const sarInput = (value: string) => Math.round(Number.parseFloat(value || "0") * 100);
export const toSar = (halalas: number) => (halalas / 100).toFixed(2);
export const todayRiyadh = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
