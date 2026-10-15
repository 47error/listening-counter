import { mergeTracks, normalize, watermarkFor, type State, type Track } from './domain';
export interface RecentResponse { tracks: Track[]; totalPages: number }
export async function syncBatch(initial: State, user: string, full: boolean, commit: (s: State) => Promise<void>, progress: (s: string) => void, fetcher: typeof fetch = fetch): Promise<State> {
  user = normalize(user);
  let state = structuredClone(initial);
  const active = state.cursor?.user === user ? state.cursor : undefined;
  const cursor = active || { user, from: full ? 0 : Math.max(0, watermarkFor(state, user) - 172800), to: Math.floor(Date.now() / 1000), page: 1 };
  for (let n = 0; n < 10; n++) {
    progress(`正在讀取第 ${cursor.page} 頁…（每批最多 10 頁）`);
    const query = new URLSearchParams({ user, from: String(cursor.from), to: String(cursor.to), page: String(cursor.page) });
    const response = await fetcher(`/.netlify/functions/lastfm?${query}`, { signal: AbortSignal.timeout(25000) });
    if (!response.ok) { let message = 'Last.fm 同步失敗，請稍後再試。'; try { message = (await response.json()).error || message; } catch { /* 保留安全訊息 */ } throw new Error(message); }
    const data = await response.json() as RecentResponse;
    if (!Array.isArray(data.tracks) || !Number.isSafeInteger(data.totalPages) || data.totalPages < 0) throw new Error('Last.fm 回傳資料格式異常。');
    state = mergeTracks(state, data.tracks, user); state.username = user;
    if (cursor.page >= data.totalPages) {
      state.watermarks = { ...state.watermarks, [user]: cursor.to }; delete state.cursor;
      await commit(state); return state;
    }
    cursor.page++; state.cursor = { ...cursor }; await commit(state);
  }
  return state;
}
