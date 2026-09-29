import { useCallback, useEffect, useRef, useState } from "react";
import NetInfo from "@react-native-community/netinfo";
import * as Crypto from "expo-crypto";
import { applySyncResults, dueEntries, localReceiptNumber, markBatchFailed, type OfflineOrderPayload, type OutboxEntry, type SyncResult } from "@cooffeup/shared";
import { api, ApiError, currentBranch } from "./api";
import { readJson, writeJson } from "./storage";

/** Same offline model as the web till: sales are queued on the phone and replayed with their idempotency keys. */
const KEYS = { outbox: "cooffeup.outbox", device: "cooffeup.device", sequence: "cooffeup.sequence" };

export const newId = () => Crypto.randomUUID();

async function deviceId() {
  let id = await readJson<string | null>(KEYS.device, null);
  if (!id) {
    id = newId();
    await writeJson(KEYS.device, id);
  }
  return id;
}

export async function queueSale(id: string, payload: OfflineOrderPayload): Promise<OutboxEntry> {
  const sequence = (await readJson<number>(KEYS.sequence, 0)) + 1;
  await writeJson(KEYS.sequence, sequence);
  const device = await deviceId();
  const capturedAt = new Date().toISOString();
  const entry: OutboxEntry = { id, deviceId: device, branchId: currentBranch(), localReceipt: localReceiptNumber(device, sequence), payload, capturedAt, attempts: 0, nextAttemptAt: capturedAt };
  await writeJson(KEYS.outbox, [...(await readJson<OutboxEntry[]>(KEYS.outbox, [])), entry]);
  return entry;
}

export function useOutbox(enabled: boolean) {
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<OutboxEntry[]>([]);
  const running = useRef(false);

  useEffect(() => NetInfo.addEventListener((state) => setOnline(Boolean(state.isConnected && state.isInternetReachable !== false))), []);

  const refresh = useCallback(async () => setQueue(await readJson<OutboxEntry[]>(KEYS.outbox, [])), []);

  const syncNow = useCallback(async () => {
    if (running.current || !enabled) return;
    const due = dueEntries(await readJson<OutboxEntry[]>(KEYS.outbox, []));
    if (!due.length) return;
    running.current = true;
    const branch = due[0].branchId ?? "main";
    const batch = due.filter((entry) => (entry.branchId ?? "main") === branch);
    try {
      const { data } = await api<{ data: SyncResult[] }>("/api/v1/sync/orders", {
        method: "POST", headers: { "x-branch-id": branch },
        body: { deviceId: batch[0].deviceId, entries: batch.map(({ id, localReceipt, capturedAt, payload }) => ({ id, localReceipt, capturedAt, payload })) }
      });
      await writeJson(KEYS.outbox, applySyncResults(await readJson<OutboxEntry[]>(KEYS.outbox, []), data).remaining);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) {
        await writeJson(KEYS.outbox, markBatchFailed(await readJson<OutboxEntry[]>(KEYS.outbox, []), batch.map((entry) => entry.id), error instanceof Error ? error.message : "sync failed"));
      }
    } finally {
      running.current = false;
      await refresh();
    }
  }, [enabled, refresh]);

  useEffect(() => {
    void refresh();
    if (!online || !enabled) return;
    void syncNow();
    const timer = setInterval(() => void syncNow(), 15_000);
    return () => clearInterval(timer);
  }, [online, enabled, syncNow, refresh]);

  const discard = async (id: string) => {
    await writeJson(KEYS.outbox, (await readJson<OutboxEntry[]>(KEYS.outbox, [])).filter((entry) => entry.id !== id));
    await refresh();
  };
  return { online, pending: queue.filter((entry) => !entry.needsReview).length, needsReview: queue.filter((entry) => entry.needsReview), syncNow, refresh, discard };
}
