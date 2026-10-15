import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { loadState, lockWriter, saveState } from '../src/db';
import { emptyState, mergeTracks } from '../src/domain';
beforeEach(async () => { await deleteDB('listening-counter'); });
afterEach(() => { vi.unstubAllGlobals(); });
describe('IndexedDB 本機資料層', () => {
  it('新資料庫回傳空白狀態', async () => { expect(await loadState()).toEqual(emptyState()); });
  it('歌曲與不同來源紀錄可完整儲存後讀回', async () => {
    const state = mergeTracks(emptyState(), [{ name: 'Dash', artist: { '#text': 'PLAVE' }, date: { uts: '1700000000' } }], 'listener');
    state.plays.push({ id: 'manual-test', songId: state.songs[0].id, at: 1700000100000, source: 'manual' });
    await saveState(state); expect(await loadState()).toEqual(state);
  });
  it('讀出的快照不會直接修改已儲存資料', async () => {
    await saveState({ ...emptyState(), username: 'original' });
    const loaded = await loadState(); loaded.username = 'edited';
    expect((await loadState()).username).toBe('original');
  });
  it('第二個完整快照可取代第一個快照', async () => {
    await saveState({ ...emptyState(), username: 'first' });
    await saveState({ ...emptyState(), username: 'second' });
    expect((await loadState()).username).toBe('second');
  });
});
describe('分頁寫入鎖', () => {
  it('不支援 Web Locks 時拒絕寫入', async () => {
    vi.stubGlobal('navigator', {});
    await expect(lockWriter(() => {})).rejects.toThrow('不支援');
  });
  it('鎖由其他頁籤持有時拒絕載入可寫入快照', async () => {
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, callback: (lock: null) => Promise<void>) => callback(null) } });
    const opened = vi.fn(); await expect(lockWriter(opened)).rejects.toThrow('其他分頁'); expect(opened).not.toHaveBeenCalled();
  });
});
