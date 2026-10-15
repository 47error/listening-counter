import { openDB } from 'idb';
import { emptyState, type State } from './domain';
const database = () => openDB('listening-counter', 1, { upgrade(db) { db.createObjectStore('state'); } });
export async function loadState(): Promise<State> { const db = await database(); try { return await db.get('state', 'main') || emptyState(); } finally { db.close(); } }
export async function saveState(state: State): Promise<void> { const db = await database(); try { const tx = db.transaction('state', 'readwrite'); await tx.store.put(state, 'main'); await tx.done; } finally { db.close(); } }
// 僅允許一個頁籤寫入，避免第二個頁籤以舊快照覆蓋資料。
export async function lockWriter(onLock: () => void): Promise<void> {
  if (!navigator.locks) throw new Error('此瀏覽器不支援安全寫入鎖定，請使用最新版 Chrome、Edge 或 Safari。');
  await navigator.locks.request('listening-counter-writer', { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('網站已在其他分頁開啟。請先關閉其他分頁，再重新整理。');
    onLock(); await new Promise<void>(() => {});
  });
}
