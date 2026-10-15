export interface Song { id: string; title: string; artist: string; album: string; version: string; cover: string; goal: number; isPlave: boolean; originKey?: string }
export interface Play { id: string; songId: string; at: number; source: 'manual' | 'lastfm'; externalKey?: string; account?: string }
export interface Cursor { user: string; from: number; to: number; page: number }
export interface State { schemaVersion: 1; songs: Song[]; plays: Play[]; username: string; watermarks: Record<string, number>; cursor?: Cursor }
export const emptyState = (): State => ({ schemaVersion: 1, songs: [], plays: [], username: '', watermarks: {} });
export const normalize = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export const watermarkFor = (state: State, user: string): number => Object.hasOwn(state.watermarks, normalize(user)) ? state.watermarks[normalize(user)] : 0;
export const isPlaveArtist = (s: string) => /(^|[^a-z])plave([^a-z]|$)|플레이브/i.test(s.normalize('NFKC'));
export const safeCover = (s: string) => { try { return new URL(s).protocol === 'https:' ? s : ''; } catch { return ''; } };
export interface Track { name: string; artist: { '#text': string }; album?: { '#text': string }; image?: { '#text': string; size?: string }[]; date?: { uts: string }; '@attr'?: { nowplaying?: string } }
export function mergeTracks(state: State, tracks: Track[], user: string): State {
  const next = structuredClone(state);
  const seen = new Set(next.plays.map(p => p.externalKey).filter(Boolean));
  const songs = new Map(next.songs.filter(s => s.originKey).map(s => [s.originKey!, s]));
  for (const t of tracks) {
    const at = Number(t.date?.uts) * 1000;
    if (t['@attr']?.nowplaying === 'true' || !Number.isSafeInteger(at) || at <= 0 || at > 8640000000000000 || !t.name || !t.artist?.['#text']) continue;
    const artist = t.artist['#text'], album = t.album?.['#text'] || '';
    const originKey = JSON.stringify([normalize(artist), normalize(t.name), normalize(album)]);
    const externalKey = JSON.stringify(['lastfm', normalize(user), at, originKey]);
    if (seen.has(externalKey)) continue;
    let song = songs.get(originKey) || next.songs.find(s => !s.originKey && normalize(s.artist) === normalize(artist) && normalize(s.title) === normalize(t.name) && normalize(s.album) === normalize(album));
    if (!song) {
      song = { id: crypto.randomUUID(), title: t.name, artist, album, version: /live|remix|instrumental|acoustic|ver\./i.test(t.name) ? '其他版本' : '原版', cover: safeCover(t.image?.at(-1)?.['#text'] || ''), goal: 100, isPlave: isPlaveArtist(artist), originKey };
      next.songs.push(song);
    } else if (!song.originKey) song.originKey = originKey;
    songs.set(originKey, song);
    next.plays.push({ id: crypto.randomUUID(), songId: song.id, at, source: 'lastfm', externalKey, account: normalize(user) });
    seen.add(externalKey);
  }
  return next;
}
export type Period = 'day' | 'week' | 'month' | 'all';
export function periodStart(period: Period, now = new Date()): number {
  if (period === 'all') return 0;
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  if (period === 'week') d.setDate(d.getDate() - (d.getDay() + 6) % 7);
  if (period === 'month') d.setDate(1);
  return d.getTime();
}
export function validateBackup(input: unknown): State {
  const fail = (): never => { throw new Error('備份格式不正確或版本不支援，原有資料未變更。'); };
  if (!input || typeof input !== 'object') return fail();
  const s = structuredClone(input) as State;
  if (s.schemaVersion !== 1 || !Array.isArray(s.songs) || !Array.isArray(s.plays) || typeof s.username !== 'string' || !s.watermarks || typeof s.watermarks !== 'object' || Array.isArray(s.watermarks)) return fail();
  const str = (v: unknown) => typeof v === 'string';
  const ids = new Set<string>(), plays = new Set<string>(), keys = new Set<string>();
  for (const song of s.songs) {
    if (!song || !str(song.id) || !song.id || ids.has(song.id) || !str(song.title) || !song.title.trim() || !str(song.artist) || !song.artist.trim() || !str(song.album) || !str(song.version) || !str(song.cover) || !Number.isSafeInteger(song.goal) || song.goal < 0 || typeof song.isPlave !== 'boolean' || (song.originKey !== undefined && !str(song.originKey))) return fail();
    ids.add(song.id); song.cover = safeCover(song.cover);
  }
  for (const p of s.plays) {
    if (!p || !str(p.id) || !p.id || plays.has(p.id) || !ids.has(p.songId) || !Number.isSafeInteger(p.at) || p.at <= 0 || p.at > 8640000000000000 || !['manual', 'lastfm'].includes(p.source)) return fail();
    if (p.source === 'lastfm' && (!str(p.externalKey) || !p.externalKey || !str(p.account))) return fail();
    if (p.externalKey !== undefined && (!str(p.externalKey) || keys.has(p.externalKey))) return fail();
    plays.add(p.id); if (p.externalKey) keys.add(p.externalKey);
  }
  if (Object.values(s.watermarks).some(v => !Number.isSafeInteger(v) || v < 0)) return fail();
  // 分頁游標不從備份還原，重新掃描並透過事件鍵去重。
  return { schemaVersion: 1, songs: s.songs, plays: s.plays, username: s.username, watermarks: s.watermarks };
}
