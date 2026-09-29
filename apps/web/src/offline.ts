import { useCallback, useEffect, useRef, useState } from "react";
import {
  applySyncResults, dueEntries, localReceiptNumber, markBatchFailed,
  type HeldCart, type OfflineOrderPayload, type OutboxEntry, type Product, type SyncResult
} from "@cooffeup/shared";
import { api, ApiError, currentBranch } from "./api";

/**
 * Local persistence for offline selling: the product catalogue, the outbox of sales waiting to be
 * synced, and held carts. localStorage is enough for a till's volume and survives reloads.
 */
const KEYS = { outbox: "cu.outbox", catalog: "cu.catalog", held: "cu.held", device: "cu.device", sequence: "cu.sequence" };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the sale still goes to the server when online.
  }
}

export function deviceId(): string {
  let id = read<string | null>(KEYS.device, null);
  if (!id) {
    id = crypto.randomUUID();
    write(KEYS.device, id);
  }
  return id;
}

export const cachedCatalog = () => read<Product[]>(KEYS.catalog, []);
export const cacheCatalog = (products: Product[]) => write(KEYS.catalog, products);
export const readOutbox = () => read<OutboxEntry[]>(KEYS.outbox, []);
const writeOutbox = (entries: OutboxEntry[]) => {
  write(KEYS.outbox, entries);
  window.dispatchEvent(new Event("cu-outbox"));
};

export function queueOfflineSale(id: string, payload: OfflineOrderPayload): OutboxEntry {
  const sequence = read<number>(KEYS.sequence, 0) + 1;
  write(KEYS.sequence, sequence);
  const capturedAt = new Date().toISOString();
  const entry: OutboxEntry = { id, deviceId: deviceId(), branchId: currentBranch() ?? "main", localReceipt: localReceiptNumber(deviceId(), sequence), payload, capturedAt, attempts: 0, nextAttemptAt: capturedAt };
  writeOutbox([...readOutbox(), entry]);
  return entry;
}

export const readHeldCarts = () => read<HeldCart[]>(KEYS.held, []);
export const writeHeldCarts = (carts: HeldCart[]) => write(KEYS.held, carts);

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/** Retries queued sales whenever the device is online, with backoff for network failures. */
export function useOutboxSync(enabled: boolean) {
  const online = useOnline();
  const [queue, setQueue] = useState<OutboxEntry[]>(readOutbox);
  const [lastSync, setLastSync] = useState<SyncResult[]>([]);
  const running = useRef(false);

  useEffect(() => {
    const refresh = () => setQueue(readOutbox());
    window.addEventListener("cu-outbox", refresh);
    return () => window.removeEventListener("cu-outbox", refresh);
  }, []);

  const syncNow = useCallback(async () => {
    if (running.current || !enabled || !navigator.onLine) return;
    // One request per branch, so each sale lands in the stock and shift of the branch that made it.
    const due = dueEntries(readOutbox());
    if (!due.length) return;
    const branch = due[0].branchId ?? "main";
    const batch = due.filter((entry) => (entry.branchId ?? "main") === branch);
    running.current = true;
    try {
      const { data } = await api<{ data: SyncResult[] }>("/api/v1/sync/orders", {
        method: "POST",
        body: { deviceId: deviceId(), entries: batch.map(({ id, localReceipt, capturedAt, payload }) => ({ id, localReceipt, capturedAt, payload })) },
        headers: { "x-branch-id": branch }
      });
      const { remaining } = applySyncResults(readOutbox(), data);
      writeOutbox(remaining);
      setLastSync(data);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) {
        writeOutbox(markBatchFailed(readOutbox(), batch.map((entry) => entry.id), error instanceof Error ? error.message : "sync failed"));
      }
    } finally {
      running.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!online || !enabled) return;
    void syncNow();
    const timer = setInterval(() => void syncNow(), 15_000);
    return () => clearInterval(timer);
  }, [online, enabled, syncNow]);

  const discard = (id: string) => writeOutbox(readOutbox().filter((entry) => entry.id !== id));
  return { online, queue, pending: queue.filter((entry) => !entry.needsReview).length, needsReview: queue.filter((entry) => entry.needsReview), lastSync, syncNow, discard };
}
