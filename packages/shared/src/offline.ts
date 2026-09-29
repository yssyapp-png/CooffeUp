import type { OrderType, PaymentMethod } from "./domain.js";

/**
 * Offline-first sale capture. Every sale is written to a local outbox with its idempotency key
 * before it is sent, so a sale made without network (or whose response was lost) is replayed
 * safely: the server returns the original order for a key it has already processed.
 */

export interface OfflineOrderPayload {
  type: OrderType;
  lines: Array<{ productId: string; quantity: number; discount?: number; unitPrice?: number; notes?: string }>;
  orderDiscount?: number;
  payments: Array<{ method: PaymentMethod; amount: number; reference?: string }>;
  customerId?: string;
  tableId?: string;
  redeemReward?: "free_drink";
}

export interface OutboxEntry {
  /** Doubles as the idempotency key sent to the server. */
  id: string;
  deviceId: string;
  /** Branch where the sale was made; older entries without it belong to the main branch. */
  branchId?: string;
  localReceipt: string;
  payload: OfflineOrderPayload;
  capturedAt: string;
  attempts: number;
  nextAttemptAt: string;
  lastError?: string;
  /** Set when the server rejected the sale permanently; a manager must review it. */
  needsReview?: boolean;
}

export type SyncStatus = "created" | "duplicate" | "rejected";

export interface SyncResult {
  id: string;
  status: SyncStatus;
  receiptNumber?: string;
  error?: string;
}

export interface HeldCart {
  id: string;
  label: string;
  payload: Omit<OfflineOrderPayload, "payments">;
  heldBy: string;
  heldAt: string;
}

/** Exponential backoff capped at five minutes. */
export const backoffMs = (attempts: number) => Math.min(5 * 60_000, 2_000 * 2 ** Math.max(0, attempts - 1));

export function localReceiptNumber(deviceId: string, sequence: number) {
  return `OFF-${deviceId.slice(0, 4).toUpperCase()}-${String(sequence).padStart(5, "0")}`;
}

export function dueEntries(queue: OutboxEntry[], now = new Date(), limit = 25): OutboxEntry[] {
  return queue.filter((entry) => !entry.needsReview && entry.nextAttemptAt <= now.toISOString()).slice(0, limit);
}

/** Applies the server's per-entry verdicts to the queue. */
export function applySyncResults(queue: OutboxEntry[], results: SyncResult[]) {
  const byId = new Map(results.map((result) => [result.id, result]));
  const synced: SyncResult[] = [];
  const remaining: OutboxEntry[] = [];
  for (const entry of queue) {
    const result = byId.get(entry.id);
    if (!result) remaining.push(entry);
    else if (result.status === "created" || result.status === "duplicate") synced.push(result);
    else remaining.push({ ...entry, attempts: entry.attempts + 1, lastError: result.error, needsReview: true });
  }
  return { remaining, synced };
}

/** Marks a whole batch as failed after a network error so it is retried later. */
export function markBatchFailed(queue: OutboxEntry[], ids: string[], error: string, now = new Date()): OutboxEntry[] {
  const failed = new Set(ids);
  return queue.map((entry) => {
    if (!failed.has(entry.id)) return entry;
    const attempts = entry.attempts + 1;
    return { ...entry, attempts, lastError: error, nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)).toISOString() };
  });
}
