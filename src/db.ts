import {
  StorageFailure,
  storageFailure,
  snapshotFailure,
} from "./storage-errors";
import { sameSnapshot } from "./recovery";
import { openDB } from "idb";
import { emptyState, migrateState, type State } from "./domain";
export async function openDatabase() {
  if (typeof indexedDB === "undefined")
    throw new StorageFailure(
      "DB_UNSUPPORTED",
      "open",
      "此瀏覽器無法使用 IndexedDB。仍未寫入或清除資料。",
    );
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  let rejectOpen: (error: unknown) => void;
  let connection: Awaited<ReturnType<typeof openDB>> | undefined;
  const stopped = new Promise<never>((_, reject) => {
    rejectOpen = reject;
  });
  try {
    const opening = openDB("listening-counter", 1, {
      upgrade(db, oldVersion) {
        // Only initial creation. Never repair an existing schema by rebuilding it.
        if (oldVersion === 0) db.createObjectStore("state");
      },
      blocked() {
        cancelled = true;
        rejectOpen(
          new StorageFailure(
            "DB_BLOCKED",
            "open",
            "IndexedDB 開啟被尚未結束的版本變更連線阻擋；這不是寫入鎖衝突。可稍後重試，不需要清除網站資料。",
          ),
        );
      },
      blocking() {
        connection?.close();
      },
      terminated() {
        connection?.close();
      },
    });
    // A blocked/timed-out request cannot be cancelled by IndexedDB. Close late success.
    opening.then(
      (db) => {
        connection = db;
        if (cancelled) db.close();
      },
      () => {},
    );
    timer = setTimeout(() => {
      cancelled = true;
      rejectOpen(
        new StorageFailure(
          "DB_OPEN_TIMEOUT",
          "open",
          "IndexedDB 開啟超過 10 秒，尚未載入資料。這不代表資料已遺失，請稍後重試。",
        ),
      );
    }, 10000);
    return await Promise.race([opening, stopped]);
  } catch (error) {
    throw storageFailure(error, "open");
  } finally {
    clearTimeout(timer!);
  }
}
export interface StorageInfo {
  snapshotPresent: boolean;
  storedSchemaVersion?: number;
  databaseVersion: number;
}
export async function loadStateWithInfo(): Promise<{
  state: State;
  info: StorageInfo;
}> {
  const db = await openDatabase();
  try {
    const tx = db.transaction("state", "readonly");
    void tx.done.catch(() => {});
    const [key, raw] = await Promise.all([
      tx.store.getKey("main"),
      tx.store.get("main"),
    ]);
    await tx.done;
    const snapshotPresent = key !== undefined;
    // Only a genuinely absent key means a new ledger. Corrupt/falsy snapshots must fail closed.
    let state: State;
    try {
      state = snapshotPresent ? migrateState(raw) : emptyState();
    } catch {
      throw snapshotFailure();
    }
    return {
      state,
      info: {
        snapshotPresent,
        storedSchemaVersion: snapshotPresent ? raw.schemaVersion : undefined,
        databaseVersion: db.version,
      },
    };
  } catch (error) {
    throw storageFailure(error, "read");
  } finally {
    db.close();
  }
}
export async function loadState(): Promise<State> {
  return (await loadStateWithInfo()).state;
}
export async function saveState(state: State, expected?: State): Promise<void> {
  return lockWriter(() => writeState(state, expected));
}
async function writeState(state: State, expected?: State): Promise<void> {
  migrateState(state);
  const db = await openDatabase();
  try {
    const tx = db.transaction("state", "readwrite");
    void tx.done.catch(() => {});
    if (expected) {
      const [key, raw] = await Promise.all([
        tx.store.getKey("main"),
        tx.store.get("main"),
      ]);
      let current: State;
      try {
        current = key === undefined ? emptyState() : migrateState(raw);
      } catch (error) {
        tx.abort();
        await tx.done.catch(() => {});
        throw snapshotFailure();
      }
      if (!sameSnapshot(current, expected)) {
        tx.abort();
        await tx.done.catch(() => {});
        throw new StorageFailure(
          "SNAPSHOT_CHANGED",
          "write",
          "本機資料已變更，已停止寫入以避免覆蓋。請重新整理後再預覽操作。",
        );
      }
    }
    await tx.store.put(state, "main");
    await tx.done;
  } catch (error) {
    throw storageFailure(error, "write");
  } finally {
    db.close();
  }
}
// Hold the same origin-scoped lock only for one complete write, never for a page lifetime.
export async function lockWriter<T>(write: () => Promise<T> | T): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks)
    throw new StorageFailure(
      "LOCK_UNSUPPORTED",
      "lock",
      "此瀏覽器不支援安全寫入鎖定，仍可讀取及下載備份；請使用最新版 Chrome。",
    );
  let entered = false;
  try {
    return await navigator.locks.request(
      "listening-counter-writer",
      { ifAvailable: true },
      async (lock) => {
        entered = true;
        if (!lock)
          throw new StorageFailure(
            "LOCK_BUSY",
            "lock",
            "寫入鎖目前被占用，本次未寫入。仍可檢視及下載備份，待鎖釋放後可重試。此訊息不是 IndexedDB blocked 錯誤。",
          );
        return await write();
      },
    );
  } catch (error) {
    if (entered) throw error; // Preserve database/callback errors; never relabel as lock contention.
    throw new StorageFailure(
      "LOCK_REQUEST",
      "lock",
      "瀏覽器拒絕或無法取得安全寫入鎖。仍可檢視及下載備份，未執行寫入。",
    );
  }
}
