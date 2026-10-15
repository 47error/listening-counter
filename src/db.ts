import { sameSnapshot } from "./recovery";
import { openDB } from "idb";
import { emptyState, migrateState, type State } from "./domain";
const database = () =>
  openDB("listening-counter", 1, {
    upgrade(db) {
      db.createObjectStore("state");
    },
  });
export interface StorageInfo {
  snapshotPresent: boolean;
  storedSchemaVersion?: number;
  databaseVersion: number;
}
export async function loadStateWithInfo(): Promise<{
  state: State;
  info: StorageInfo;
}> {
  const db = await database();
  try {
    const tx = db.transaction("state", "readonly");
    const [key, raw] = await Promise.all([
      tx.store.getKey("main"),
      tx.store.get("main"),
    ]);
    await tx.done;
    const snapshotPresent = key !== undefined;
    // Only a genuinely absent key means a new ledger. Corrupt/falsy snapshots must fail closed.
    const state = snapshotPresent ? migrateState(raw) : emptyState();
    return {
      state,
      info: {
        snapshotPresent,
        storedSchemaVersion: snapshotPresent ? raw.schemaVersion : undefined,
        databaseVersion: db.version,
      },
    };
  } finally {
    db.close();
  }
}
export async function loadState(): Promise<State> {
  return (await loadStateWithInfo()).state;
}
export async function saveState(state: State, expected?: State): Promise<void> {
  migrateState(state);
  const db = await database();
  try {
    const tx = db.transaction("state", "readwrite");
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
        throw error;
      }
      if (!sameSnapshot(current, expected)) {
        tx.abort();
        await tx.done.catch(() => {});
        throw new Error(
          "本機資料已變更，已停止寫入以避免覆蓋。請重新整理後再預覽操作。",
        );
      }
    }
    await tx.store.put(state, "main");
    await tx.done;
  } finally {
    db.close();
  }
}
// 僅允許一個頁籤寫入，避免第二個頁籤以舊快照覆蓋資料。
export async function lockWriter(onLock: () => void): Promise<void> {
  if (!navigator.locks)
    throw new Error(
      "此瀏覽器不支援安全寫入鎖定，請使用最新版 Chrome、Edge 或 Safari。",
    );
  await navigator.locks.request(
    "listening-counter-writer",
    { ifAvailable: true },
    async (lock) => {
      if (!lock)
        throw new Error("網站已在其他分頁開啟。請先關閉其他分頁，再重新整理。");
      onLock();
      await new Promise<void>(() => {});
    },
  );
}
