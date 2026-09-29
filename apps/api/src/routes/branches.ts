import type { FastifyInstance } from "fastify";
import type { Branch, Permission, StockTransfer } from "@cooffeup/shared";
import { z } from "zod";
import { actor, audit, authenticate, branchOf, fail, guarded, newId, now, parse, type AppContext } from "../context.js";
import { branchIsOpen } from "../services/orders.js";
import { enqueueStoreSync } from "../services/store-sync.js";
import { MAIN_BRANCH_ID } from "../store.js";

const datetime = z.string().datetime();

export function registerBranchRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store } = ctx;
  const guard = (...permissions: Permission[]) => guarded(ctx, ...permissions);

  const present = (branch: Branch) => ({
    ...branch, isOpen: branchIsOpen(branch), hasOpenShift: Boolean(store.openShift(branch.id)),
    units: Object.values(store.stockLevels.get(branch.id) ?? {}).reduce((sum, quantity) => sum + Math.max(quantity, 0), 0)
  });

  /** Moves stock between branches; the company total and inventory value do not change. */
  function transfer(fromBranchId: string, toBranchId: string, lines: Array<{ productId: string; quantity: number }>, staffId: string, note?: string) {
    if (fromBranchId === toBranchId) fail(422, "SAME_BRANCH");
    const from = store.branches.get(fromBranchId) ?? fail(404, "BRANCH_NOT_FOUND", { branchId: fromBranchId });
    const to = store.branches.get(toBranchId) ?? fail(404, "BRANCH_NOT_FOUND", { branchId: toBranchId });
    if (!to.active) fail(409, "BRANCH_INACTIVE", { branchId: to.id });
    const requested = new Map<string, number>();
    for (const line of lines) {
      if (!store.products.has(line.productId)) fail(404, "PRODUCT_NOT_FOUND", { productId: line.productId });
      requested.set(line.productId, (requested.get(line.productId) ?? 0) + line.quantity);
    }
    for (const [productId, quantity] of requested) {
      const available = store.stockAt(from.id, productId);
      if (quantity > available) fail(409, "INSUFFICIENT_STOCK", { productId, available });
    }
    const record: StockTransfer = { id: newId(), fromBranchId: from.id, toBranchId: to.id, lines: [...requested].map(([productId, quantity]) => ({ productId, quantity })), note, staffId, createdAt: now() };
    for (const line of record.lines) {
      store.adjustStock(from.id, line.productId, -line.quantity);
      store.adjustStock(to.id, line.productId, line.quantity);
      store.movements.push({ id: newId(), branchId: from.id, productId: line.productId, quantity: -line.quantity, reason: "transfer_out", refId: record.id, createdAt: record.createdAt });
      store.movements.push({ id: newId(), branchId: to.id, productId: line.productId, quantity: line.quantity, reason: "transfer_in", refId: record.id, createdAt: record.createdAt });
    }
    store.transfers.set(record.id, record);
    // Only matters when one side feeds the online store and the other does not.
    if (from.syncToStore !== to.syncToStore) enqueueStoreSync(ctx, record.lines.map((line) => line.productId));
    return record;
  }

  const branchBody = z.object({
    name: z.string().trim().min(2).max(80),
    kind: z.enum(["permanent", "temporary"]),
    syncToStore: z.boolean().default(true),
    startsAt: datetime.optional(),
    endsAt: datetime.optional(),
    address: z.string().max(200).optional()
  });

  const checkWindow = (branch: Pick<Branch, "kind" | "startsAt" | "endsAt">) => {
    if (branch.kind === "temporary" && !branch.endsAt) fail(422, "TEMPORARY_BRANCH_NEEDS_END_DATE");
    if (branch.startsAt && branch.endsAt && branch.startsAt >= branch.endsAt) fail(422, "INVALID_BRANCH_WINDOW");
  };

  app.get("/api/v1/branches", { preHandler: authenticate(ctx) }, async (request) => ({
    data: [...store.branches.values()].map(present), current: branchOf(request), fixedBranch: actor(request).branchId ?? null,
    fulfilmentBranchId: store.settings.fulfilmentBranchId
  }));

  app.post("/api/v1/branches", guard("branches.manage"), async (request, reply) => {
    const body = parse(branchBody, request.body);
    checkWindow(body);
    const branch: Branch = { id: newId(), ...body, active: true, createdAt: now() };
    store.branches.set(branch.id, branch);
    audit(ctx, request, "branch.created", { type: "branch", id: branch.id }, { kind: branch.kind });
    return reply.code(201).send({ data: present(branch) });
  });

  app.patch<{ Params: { id: string } }>("/api/v1/branches/:id", guard("branches.manage"), async (request) => {
    const branch = store.branches.get(request.params.id) ?? fail(404, "BRANCH_NOT_FOUND");
    const body = parse(branchBody.omit({ kind: true }).partial().extend({ active: z.boolean().optional() }), request.body);
    if (branch.id === MAIN_BRANCH_ID && body.active === false) fail(422, "MAIN_BRANCH_REQUIRED");
    if (body.active === false && store.openShift(branch.id)) fail(409, "SHIFT_STILL_OPEN");
    const syncChanged = body.syncToStore !== undefined && body.syncToStore !== branch.syncToStore;
    const next = { ...branch, ...body };
    checkWindow(next);
    Object.assign(branch, body);
    if (syncChanged || body.active !== undefined) enqueueStoreSync(ctx, store.products.keys());
    audit(ctx, request, "branch.updated", { type: "branch", id: branch.id }, body);
    return { data: present(branch) };
  });

  app.get<{ Params: { id: string } }>("/api/v1/branches/:id/stock", guard("inventory.manage"), async (request) => {
    const branch = store.branches.get(request.params.id) ?? fail(404, "BRANCH_NOT_FOUND");
    return {
      data: [...store.products.values()].map((product) => ({
        productId: product.id, sku: product.sku, nameAr: product.nameAr, nameEn: product.nameEn,
        quantity: store.stockAt(branch.id, product.id), totalStock: product.stock
      }))
    };
  });

  app.get("/api/v1/stock-transfers", guard("inventory.manage"), async () => ({ data: [...store.transfers.values()].reverse().slice(0, 100) }));

  app.post("/api/v1/stock-transfers", guard("branches.manage"), async (request, reply) => {
    const body = parse(z.object({
      fromBranchId: z.string(), toBranchId: z.string(), note: z.string().max(250).optional(),
      lines: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive().max(100_000) })).min(1).max(200)
    }), request.body);
    const record = transfer(body.fromBranchId, body.toBranchId, body.lines, actor(request).id, body.note);
    audit(ctx, request, "stock.transferred", { type: "transfer", id: record.id }, { from: body.fromBranchId, to: body.toBranchId });
    return reply.code(201).send({ data: record });
  });

  /** Ends a booth: its remaining stock goes back to a chosen branch and it stops trading. */
  app.post<{ Params: { id: string } }>("/api/v1/branches/:id/close", guard("branches.manage"), async (request) => {
    const branch = store.branches.get(request.params.id) ?? fail(404, "BRANCH_NOT_FOUND");
    if (branch.kind !== "temporary") fail(422, "ONLY_TEMPORARY_BRANCHES_CLOSE");
    if (!branch.active) fail(409, "BRANCH_INACTIVE");
    if (store.openShift(branch.id)) fail(409, "SHIFT_STILL_OPEN");
    const body = parse(z.object({ returnToBranchId: z.string().default(MAIN_BRANCH_ID) }), request.body ?? {});
    const lines = Object.entries(store.stockLevels.get(branch.id) ?? {}).filter(([, quantity]) => quantity > 0).map(([productId, quantity]) => ({ productId, quantity }));
    const returned = lines.length ? transfer(branch.id, body.returnToBranchId, lines, actor(request).id, `إغلاق ${branch.name}`) : undefined;
    branch.active = false;
    branch.endsAt = now();
    enqueueStoreSync(ctx, store.products.keys());
    audit(ctx, request, "branch.closed", { type: "branch", id: branch.id }, { returnedTo: body.returnToBranchId });
    return { data: present(branch), transfer: returned };
  });
}
