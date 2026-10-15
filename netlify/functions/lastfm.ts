import type { Track } from '../../src/domain';
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') return json({ error: '僅支援 GET。' }, 405);
  const q = new URL(request.url).searchParams;
  const user = q.get('user') || '';
  const integer = (key: string, fallback: number) => q.has(key) && /^\d+$/.test(q.get(key)!) ? Number(q.get(key)) : q.has(key) ? NaN : fallback;
  const page = integer('page', 1), from = integer('from', 0), to = integer('to', Math.floor(Date.now() / 1000));
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(user) || ![page, from, to].every(Number.isSafeInteger) || page < 1 || page > 1000000 || from < 0 || to < from || to > Math.floor(Date.now() / 1000) + 60) return json({ error: '使用者名稱或分頁參數不正確。' }, 400);
  const key = process.env.LASTFM_API_KEY;
  if (!key) return json({ error: '站長尚未設定 LASTFM_API_KEY。手動計數仍可正常使用。' }, 503);
  const url = new URL('https://ws.audioscrobbler.com/2.0/');
  url.search = new URLSearchParams({ method: 'user.getrecenttracks', api_key: key, user, format: 'json', limit: '200', page: String(page), from: String(from), to: String(to), extended: '0' }).toString();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) return json({ error: 'Last.fm 暫時無法連線，請稍後重試。' }, 502);
    const data = await response.json();
    if (data.error) return json({ error: data.error === 6 ? '找不到 Last.fm 使用者，請確認名稱。' : data.error === 17 ? '此使用者的近期紀錄不公開。' : data.error === 29 ? 'Last.fm 請求過多，請稍後重試。' : 'Last.fm 拒絕請求，請確認 API 金鑰與公開紀錄設定。' }, 502);
    const recent = data.recenttracks;
    const totalPages = Number(recent?.['@attr']?.totalPages);
    const tracks = recent?.track;
    if (!Number.isSafeInteger(totalPages) || totalPages < 0 || !Array.isArray(tracks) || tracks.some((t: Track) => !t || typeof t.name !== 'string' || typeof t.artist?.['#text'] !== 'string' || (t.album !== undefined && typeof t.album?.['#text'] !== 'string') || (t.image !== undefined && (!Array.isArray(t.image) || t.image.some(i => typeof i?.['#text'] !== 'string'))))) return json({ error: 'Last.fm 回傳格式異常，資料未清除。' }, 502);
    return json({ tracks, totalPages });
  } catch { return json({ error: 'Last.fm 連線逾時或失敗，原有資料已保留。' }, 504); }
}
