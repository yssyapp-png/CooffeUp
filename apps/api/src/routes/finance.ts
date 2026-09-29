import type { FastifyInstance } from "fastify";
import {
  CHART_OF_ACCOUNTS, EXPENSE_CATEGORY_LABELS, REPORT_CATEGORY_LABELS, REPORTS, expenseEntryLines, finalizeLines, incomeStatement,
  journalToCsv, parseInvoiceText, purchaseEntryLines, reportById, riyadhDate, trialBalance, vatReturn,
  type ExpenseCategory, type ExpenseRecord, type Permission, type PurchaseRecord, type ReportDataset
} from "@cooffeup/shared";
import { z } from "zod";
import { actor, audit, fail, guarded, newId, now, parse, type AppContext } from "../context.js";
import { attemptDelivery, emit } from "../services/events.js";
import { postJournal } from "../services/ledger.js";
import { enqueueStoreSync } from "../services/store-sync.js";
import { isAllowedOutboundUrl, randomToken } from "../security.js";
import { WEBHOOK_EVENTS, type AccountingWebhook } from "../store.js";

const money = z.number().int().nonnegative();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rangeSchema = z.object({ from: isoDate.optional(), to: isoDate.optional() });
const paidFrom = z.enum(["cash", "bank", "payable"]);

export function registerFinanceRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store } = ctx;
  const guard = (...permissions: Permission[]) => guarded(ctx, ...permissions);
  const journalInRange = (range: { from?: string; to?: string }) =>
    store.journal.filter((entry) => (!range.from || entry.date >= range.from) && (!range.to || entry.date <= range.to));

  // ---------- Purchases & smart invoice reader ----------
  app.post("/api/v1/purchases/parse", guard("purchases.manage"), async (request) => {
    const body = parse(z.object({ text: z.string().min(1).max(20_000) }), request.body);
    const invoice = parseInvoiceText(body.text);
    // Suggest catalogue products for each line by fuzzy name match so the user only confirms.
    const products = [...store.products.values()];
    const lines = invoice.lines.map((line) => {
      const words = line.description.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
      const match = products.find((product) => words.some((word) => `${product.nameAr} ${product.nameEn}`.toLowerCase().includes(word)));
      return { ...line, suggestedProductId: match?.id };
    });
    return { data: { ...invoice, lines } };
  });

  app.get("/api/v1/purchases", guard("purchases.manage"), async () => ({ data: [...store.purchases.values()].reverse() }));

  app.post("/api/v1/purchases", guard("purchases.manage"), async (request, reply) => {
    const body = parse(z.object({
      supplierName: z.string().min(2).max(120), supplierVat: z.string().regex(/^3\d{13}3$/).optional(), invoiceNumber: z.string().max(60).optional(),
      date: isoDate, net: money, vat: money, total: money, paidFrom, source: z.enum(["manual", "ocr"]).default("manual"),
      lines: z.array(z.object({
        productId: z.string().optional(), description: z.string().min(1).max(200), quantity: z.number().int().positive(), unitCost: money, total: money
      })).min(1).max(200)
    }), request.body);
    if (body.net + body.vat !== body.total) fail(422, "TOTALS_MISMATCH", { expected: body.net + body.vat });
    for (const line of body.lines) {
      if (Math.abs(line.quantity * line.unitCost - line.total) > 1) fail(422, "LINE_TOTAL_MISMATCH", { description: line.description });
      if (line.productId && !store.products.has(line.productId)) fail(404, "PRODUCT_NOT_FOUND", { productId: line.productId });
    }
    const linesTotal = body.lines.reduce((sum, line) => sum + line.total, 0);
    if (Math.abs(linesTotal - body.net) > body.lines.length) fail(422, "LINES_DO_NOT_MATCH_NET", { linesTotal });
    if (body.invoiceNumber && [...store.purchases.values()].some((purchase) => purchase.supplierName === body.supplierName && purchase.invoiceNumber === body.invoiceNumber)) {
      fail(409, "DUPLICATE_SUPPLIER_INVOICE");
    }

    const createdAt = now();
    const purchase: PurchaseRecord = { id: newId(), ...body, createdBy: actor(request).id, createdAt };
    for (const line of body.lines) {
      if (!line.productId) continue;
      const product = store.products.get(line.productId)!;
      const onHand = Math.max(product.stock, 0);
      product.cost = Math.round((onHand * (product.cost ?? 0) + line.quantity * line.unitCost) / (onHand + line.quantity));
      product.stock += line.quantity;
      store.movements.push({ id: newId(), productId: product.id, quantity: line.quantity, reason: "purchase", refId: purchase.id, createdAt });
    }
    store.purchases.set(purchase.id, purchase);
    postJournal(ctx, {
      description: `فاتورة مشتريات ${body.invoiceNumber ?? ""} - ${body.supplierName}`.trim(), source: { type: "purchase", id: purchase.id },
      lines: purchaseEntryLines({ net: body.net, vat: body.vat, paidFrom: body.paidFrom }), createdBy: actor(request).id, date: body.date
    });
    enqueueStoreSync(ctx, body.lines.flatMap((line) => (line.productId ? [line.productId] : [])));
    emit(ctx, "purchase.created", purchase);
    audit(ctx, request, "purchase.created", { type: "purchase", id: purchase.id }, { total: body.total, source: body.source });
    return reply.code(201).send({ data: purchase });
  });

  // ---------- Expenses ----------
  app.get("/api/v1/expenses", guard("expenses.manage"), async () => ({ data: [...store.expenses.values()].reverse(), categories: EXPENSE_CATEGORY_LABELS }));

  app.post("/api/v1/expenses", guard("expenses.manage"), async (request, reply) => {
    const body = parse(z.object({
      category: z.enum(Object.keys(EXPENSE_CATEGORY_LABELS) as [ExpenseCategory, ...ExpenseCategory[]]),
      description: z.string().min(2).max(200), net: money.refine((value) => value > 0), vat: money.default(0), paidFrom, date: isoDate.optional()
    }), request.body);
    const expense: ExpenseRecord = {
      id: newId(), ...body, total: body.net + body.vat, date: body.date ?? riyadhDate(now()),
      shiftId: body.paidFrom === "cash" ? store.openShift()?.id : undefined, createdBy: actor(request).id, createdAt: now()
    };
    store.expenses.set(expense.id, expense);
    postJournal(ctx, {
      description: `مصروف: ${body.description}`, source: { type: "expense", id: expense.id },
      lines: expenseEntryLines({ category: body.category, net: body.net, vat: body.vat, paidFrom: body.paidFrom }), createdBy: actor(request).id, date: expense.date
    });
    emit(ctx, "expense.created", expense);
    return reply.code(201).send({ data: expense });
  });

  // ---------- Accounting ----------
  app.get("/api/v1/accounting/accounts", guard("accounting.view"), async () => ({ data: CHART_OF_ACCOUNTS }));

  app.get("/api/v1/accounting/journal", guard("accounting.view"), async (request) => {
    const range = parse(rangeSchema, request.query);
    return { data: journalInRange(range).slice().reverse() };
  });

  app.post("/api/v1/accounting/journal", guard("accounting.manage"), async (request, reply) => {
    const body = parse(z.object({
      date: isoDate, description: z.string().min(3).max(200),
      lines: z.array(z.object({ account: z.string(), debit: money, credit: money, memo: z.string().max(200).optional() })).min(2).max(50)
    }), request.body);
    let lines;
    try {
      lines = finalizeLines(body.lines);
    } catch (error) {
      return fail(422, "UNBALANCED_ENTRY", { message: error instanceof Error ? error.message : String(error) });
    }
    const entry = postJournal(ctx, { description: body.description, source: { type: "manual", id: newId() }, lines, createdBy: actor(request).id, date: body.date });
    audit(ctx, request, "journal.manual", { type: "journal", id: entry?.id });
    return reply.code(201).send({ data: entry });
  });

  app.get("/api/v1/accounting/statements", guard("accounting.view"), async (request) => {
    const entries = journalInRange(parse(rangeSchema, request.query));
    return { data: { trialBalance: trialBalance(entries), incomeStatement: incomeStatement(entries), vat: vatReturn(entries) } };
  });

  app.get("/api/v1/accounting/export", guard("accounting.view"), async (request, reply) => {
    const query = parse(rangeSchema.extend({ format: z.enum(["csv", "json"]).default("csv") }), request.query);
    const entries = journalInRange(query);
    audit(ctx, request, "accounting.exported", { type: "journal" }, { ...query, count: entries.length });
    if (query.format === "json") return { data: entries, accounts: CHART_OF_ACCOUNTS };
    return reply.type("text/csv; charset=utf-8").header("content-disposition", `attachment; filename="journal-${query.from ?? "all"}-${query.to ?? "all"}.csv"`)
      .send(`﻿${journalToCsv(entries)}`);
  });

  // ---------- Accounting-system webhooks (Zid app market, Qoyod, Daftra, custom ERP...) ----------
  const presentWebhook = (webhook: AccountingWebhook) => ({ ...webhook, secretEnc: undefined });

  app.get("/api/v1/accounting/webhooks", guard("accounting.manage"), async () => ({
    data: [...store.webhooks.values()].map(presentWebhook), events: WEBHOOK_EVENTS,
    deliveries: [...store.webhookDeliveries.values()].slice(-50).reverse().map(({ payload: _payload, ...delivery }) => delivery)
  }));

  app.post("/api/v1/accounting/webhooks", guard("accounting.manage"), async (request, reply) => {
    const body = parse(z.object({
      name: z.string().min(2).max(80),
      url: z.string().url().refine((url) => isAllowedOutboundUrl(url, ctx.config.env === "production"), "A public HTTPS URL is required"),
      events: z.array(z.enum(WEBHOOK_EVENTS)).min(1)
    }), request.body);
    const secret = randomToken(32);
    const webhook: AccountingWebhook = { id: newId(), name: body.name, url: body.url, events: body.events, secretEnc: ctx.crypto.encrypt(secret), enabled: true, createdAt: now() };
    store.webhooks.set(webhook.id, webhook);
    audit(ctx, request, "webhook.created", { type: "webhook", id: webhook.id }, { url: body.url });
    // The signing secret is shown once so it can be pasted into the receiving system.
    return reply.code(201).send({ data: presentWebhook(webhook), secret });
  });

  app.patch<{ Params: { id: string } }>("/api/v1/accounting/webhooks/:id", guard("accounting.manage"), async (request) => {
    const webhook = store.webhooks.get(request.params.id) ?? fail(404, "WEBHOOK_NOT_FOUND");
    const body = parse(z.object({ enabled: z.boolean().optional(), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional() }), request.body);
    Object.assign(webhook, body);
    return { data: presentWebhook(webhook) };
  });

  app.delete<{ Params: { id: string } }>("/api/v1/accounting/webhooks/:id", guard("accounting.manage"), async (request, reply) => {
    store.webhooks.delete(request.params.id);
    audit(ctx, request, "webhook.deleted", { type: "webhook", id: request.params.id });
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/api/v1/accounting/webhook-deliveries/:id/retry", guard("accounting.manage"), async (request) => {
    const delivery = store.webhookDeliveries.get(request.params.id) ?? fail(404, "DELIVERY_NOT_FOUND");
    delivery.status = "pending";
    await attemptDelivery(ctx, delivery.id);
    const { payload: _payload, ...rest } = delivery;
    return { data: rest };
  });

  // ---------- Reports ----------
  const dataset = (): ReportDataset => ({
    orders: [...store.orders.values()], refunds: [...store.refunds.values()], products: [...store.products.values()],
    purchases: [...store.purchases.values()], expenses: [...store.expenses.values()], journal: store.journal, shifts: [...store.shifts.values()],
    movements: store.movements, kitchenTickets: [...store.kitchenTickets.values()],
    customers: [...store.customers.values()].map((customer) => ({ id: customer.id, name: customer.name })),
    staff: [...store.staff.values()].map((member) => ({ id: member.id, name: member.name }))
  });

  app.get("/api/v1/reports", guard("reports.view"), async () => ({
    data: REPORTS.map(({ run: _run, ...report }) => report), categories: REPORT_CATEGORY_LABELS
  }));

  app.get<{ Params: { id: string } }>("/api/v1/reports/:id", guard("reports.view"), async (request) => {
    const report = reportById(request.params.id) ?? fail(404, "REPORT_NOT_FOUND");
    const range = parse(rangeSchema, request.query);
    const { run: _run, ...meta } = report;
    return { report: meta, range, data: report.run(dataset(), range) };
  });
}
