import QRCode from "qrcode";
import { formatSar, zatcaQrPayload, type OrderRecord } from "@cooffeup/shared";
import type { Settings } from "../store.js";

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** Public simplified tax invoice page linked from the SMS sent to the customer. */
export async function renderInvoicePage(order: OrderRecord, settings: Settings): Promise<string> {
  const qr = await QRCode.toString(zatcaQrPayload({
    sellerName: settings.sellerName, vatNumber: settings.sellerVat, timestamp: order.createdAt, total: order.totals.total, vat: order.totals.tax
  }), { type: "svg", margin: 1, width: 180 });
  const date = new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(new Date(order.createdAt));
  const rows = order.lines.map((line) => `<tr><td>${escape(line.name)}</td><td>${line.quantity}</td><td>${formatSar(line.unitPrice)}</td><td>${formatSar(line.unitPrice * line.quantity - line.discount)}</td></tr>`).join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>فاتورة ${escape(order.receiptNumber)}</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f1e9;color:#16231d;margin:0;padding:16px}main{max-width:480px;margin:auto;background:#fff;border-radius:16px;padding:20px}
h1{font-size:20px;margin:0}small{color:#6b7280}table{width:100%;border-collapse:collapse;margin:16px 0;font-size:14px}td,th{padding:6px 4px;border-bottom:1px solid #eee;text-align:right}
.totals p{display:flex;justify-content:space-between;margin:6px 0}.grand{font-weight:800;font-size:18px}.qr{text-align:center;margin-top:12px}.status{color:#a74335;font-weight:700}</style></head>
<body><main><h1>${escape(settings.sellerName)}</h1><small>فاتورة ضريبية مبسطة · الرقم الضريبي ${escape(settings.sellerVat)}</small>
<p>رقم الفاتورة: <b>${escape(order.receiptNumber)}</b><br>التاريخ: ${escape(date)}${order.status !== "paid" ? `<br><span class="status">${order.status === "refunded" ? "مسترجعة بالكامل" : "مسترجعة جزئيًا"}</span>` : ""}</p>
<table><thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>المجموع</th></tr></thead><tbody>${rows}</tbody></table>
<div class="totals"><p><span>المجموع قبل الضريبة</span><span>${formatSar(order.totals.taxable)}</span></p><p><span>ضريبة القيمة المضافة</span><span>${formatSar(order.totals.tax)}</span></p>
<p class="grand"><span>الإجمالي</span><span>${formatSar(order.totals.total)}</span></p></div><div class="qr">${qr}</div></main></body></html>`;
}
