import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Store, StoreSnapshot } from "./store.js";

/**
 * Keeps the in-memory store on disk as a single JSON snapshot. Writes go to a temporary file that
 * is then renamed over the old one, so a crash mid-write never leaves a half-written data file.
 * This is an interim durability layer for a single server; PostgreSQL remains the target.
 */
export class SnapshotPersistence {
  private readonly file: string;
  private timer?: NodeJS.Timeout;
  private dirty = false;

  constructor(dataDir: string, private readonly store: Store, private readonly onError: (error: unknown) => void, private readonly delayMs = 250) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, "cooffeup.json");
  }

  /** Returns true when an existing data file was loaded. */
  load(): boolean {
    if (!existsSync(this.file)) return false;
    this.store.restore(JSON.parse(readFileSync(this.file, "utf8")) as StoreSnapshot);
    return true;
  }

  /** Coalesces bursts of changes into one write shortly after the last one. */
  markDirty() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, this.delayMs);
    this.timer.unref();
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.dirty) return;
    this.dirty = false;
    try {
      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, JSON.stringify(this.store.snapshot()), { mode: 0o600 });
      renameSync(temporary, this.file);
    } catch (error) {
      this.dirty = true;
      this.onError(error);
    }
  }
}
