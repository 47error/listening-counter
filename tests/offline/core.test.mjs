import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, mergeTracks, normalize, isPlaveArtist, safeCover, periodStart, validateBackup } from '../../src/domain.ts';
import { syncBatch } from '../../src/sync.ts';
import handler from '../../netlify/functions/lastfm.ts';
const track = (uts = '1700000000', title = 'Dash', artist = 'PLAVE', album = 'Caligo Pt.1') => ({ name: title, artist: { '#text': artist }, album: { '#text': album }, date: { uts } });
const populated = () => mergeTracks(emptyState(), [track()], 'Listener');
const response = (tracks = [], totalPages = 1) => Response.json({ tracks, totalPages });
const req = query => new Request(`https://example.test/.netlify/functions/lastfm?${query}`);
test('正規化名稱與 Unicode', () => assert.equal(normalize('  ＰＬＡＶＥ  '), 'plave'));
test('辨識 PLAVE 英文與韓文，避免誤判相似字', () => {
  for (const a of ['PLAVE', 'plave', '플레이브', 'PLAVE feat. Someone']) assert.equal(isPlaveArtist(a), true);
  assert.equal(isPlaveArtist('NotPLAVEs'), false);
});
test('封面只接受 HTTPS', () => {
  assert.equal(safeCover('https://example.test/a.jpg'), 'https://example.test/a.jpg');
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'http://example.test/a', 'bad']) assert.equal(safeCover(url), '');
});
test('同帳號相同事件只匯入一次，大小寫與空格亦可去重', () => {
  const first = populated(); const original = structuredClone(first);
  const next = mergeTracks(first, [track(), track('1700000000', ' Dash ', 'plave')], 'LISTENER');
  assert.equal(next.plays.length, 1); assert.equal(next.songs.length, 1); assert.deepEqual(first, original);
});
test('同歌曲不同時間保留真實聆聽', () => assert.equal(mergeTracks(populated(), [track('1700000100')], 'listener').plays.length, 2));
test('同時不同歌曲、不同帳號不誤刪', () => {
  const s = mergeTracks(populated(), [track('1700000000', 'WAY 4 LUV')], 'listener');
  assert.equal(s.plays.length, 2); assert.equal(mergeTracks(s, [track()], 'another').plays.length, 3);
});
test('原版與 Live 版本分開建歌', () => {
  const s = mergeTracks(populated(), [track('1700000100', 'Dash (Live)')], 'listener');
  assert.equal(s.songs.length, 2); assert.equal(s.songs[1].version, '其他版本');
});
test('略過正在播放、缺少時間與非法時間', () => {
  const now = { ...track(), '@attr': { nowplaying: 'true' } };
  const missing = { name: 'Dash', artist: { '#text': 'PLAVE' } };
  assert.equal(mergeTracks(emptyState(), [now, missing, track('bad'), track('0'), track('-1')], 'u').plays.length, 0);
});
test('略過超出 JavaScript 日期範圍的時間', () => {
  assert.equal(mergeTracks(emptyState(), [track('8640000000001')], 'u').plays.length, 0);
});
test('手動修正歌手分類與版本，後續同步保留', () => {
  const s = populated(); s.songs[0].isPlave = false; s.songs[0].version = '自訂版本'; s.songs[0].title = '自訂標題';
  const next = mergeTracks(s, [track('1700000100')], 'listener');
  assert.equal(next.songs.length, 1); assert.equal(next.songs[0].isPlave, false); assert.equal(next.songs[0].version, '自訂版本');
});
test('手動與 Last.fm 事件保留不同來源', () => {
  const s = populated(); s.plays.push({ id: 'manual-1', songId: s.songs[0].id, at: s.plays[0].at, source: 'manual', platformId: 'unknown', createdAt: s.plays[0].at });
  const next = mergeTracks(s, [track()], 'listener');
  assert.deepEqual(next.plays.map(p => p.source).sort(), ['lastfm', 'manual']);
});
test('日期統計從當地午夜、週一、每月一日開始', () => {
  const now = new Date(2026, 9, 18, 15, 30); // 週日
  assert.equal(periodStart('day', now), +new Date(2026, 9, 18));
  assert.equal(periodStart('week', now), +new Date(2026, 9, 12));
  assert.equal(periodStart('month', now), +new Date(2026, 9, 1));
  assert.equal(periodStart('all', now), 0);
});
test('有效備份可往返還原，丟棄分頁游標', () => {
  const s = populated(); s.cursor = { user: 'listener', from: 0, to: 1700001000, page: 2 };
  const parsed = validateBackup(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(parsed.plays, s.plays); assert.equal(parsed.cursor, undefined);
});
test('錯誤版本、重複歌曲、孤立事件、負數目標與錯誤來源拒絕還原', () => {
  const mutations = [s => s.schemaVersion = 99, s => s.songs.push(s.songs[0]), s => s.plays[0].songId = 'missing', s => s.songs[0].goal = -1, s => s.plays[0].source = 'spotify', s => s.watermarks.u = 'invalid', s => s.plays[0].at = 8640000000000001];
  for (const mutate of mutations) { const s = populated(); mutate(s); assert.throws(() => validateBackup(s)); }
});
test('備份重複事件與重複外部鍵拒絕還原', () => {
  let s = populated(); s.plays.push({ ...s.plays[0] }); assert.throws(() => validateBackup(s));
  s = populated(); s.plays.push({ ...s.plays[0], id: 'different' }); assert.throws(() => validateBackup(s));
});
test('備份檢查不修改傳入物件', () => {
  const s = populated(); s.songs[0].cover = 'http://example.test/a.jpg'; const before = structuredClone(s);
  const next = validateBackup(s); assert.equal(next.songs[0].cover, ''); assert.deepEqual(s, before);
});
test('首次分頁匯入固定上限，全部成功才更新同步時間', async () => {
  const calls = [], saved = [];
  const result = await syncBatch(emptyState(), 'Listener', false, async s => saved.push(structuredClone(s)), () => {}, async url => {
    calls.push(new URL(url, 'https://example.test')); return response([track(String(1700000000 + calls.length))], 2);
  });
  assert.equal(calls.length, 2); assert.equal(calls[0].searchParams.get('to'), calls[1].searchParams.get('to'));
  assert.equal(calls[0].searchParams.get('from'), '0'); assert.equal(saved[0].watermarks.listener, undefined);
  assert.equal(result.plays.length, 2); assert.equal(result.cursor, undefined); assert.ok(result.watermarks.listener > 0);
});
test('增量同步重查 48 小時並去重', async () => {
  const s = populated(); s.watermarks.listener = 1700000000; let url;
  const next = await syncBatch(s, 'listener', false, async () => {}, () => {}, async u => { url = new URL(u, 'https://example.test'); return response([track()]); });
  assert.equal(url.searchParams.get('from'), String(1700000000 - 172800)); assert.equal(next.plays.length, 1);
});
test('10 頁批次上限，游標可接續並去重', async () => {
  let saved; const calls = [];
  const fetcher = async u => { const p = Number(new URL(u, 'https://example.test').searchParams.get('page')); calls.push(p); return response([track(String(1700000000 + p))], 11); };
  const next = await syncBatch(emptyState(), 'u', true, async s => saved = structuredClone(s), () => {}, fetcher);
  assert.equal(calls.length, 10); assert.equal(next.cursor.page, 11); assert.equal(next.watermarks.u, undefined);
  const done = await syncBatch(saved, 'u', false, async () => {}, () => {}, fetcher);
  assert.equal(calls.at(-1), 11); assert.equal(done.plays.length, 11); assert.equal(done.cursor, undefined);
});
test('第一頁網路失敗完全保留原資料', async () => {
  const s = populated(), original = structuredClone(s); let commits = 0;
  await assert.rejects(syncBatch(s, 'listener', false, async () => commits++, () => {}, async () => { throw new Error('offline'); }), /offline/);
  assert.equal(commits, 0); assert.deepEqual(s, original);
});
test('第二頁失敗保留第一頁與游標，不更新完成時間', async () => {
  const initial = populated(), original = structuredClone(initial); let saved, calls = 0;
  await assert.rejects(syncBatch(initial, 'listener', false, async s => saved = structuredClone(s), () => {}, async () => {
    if (++calls === 2) return Response.json({ error: '限流' }, { status: 502 });
    return response([track('1700000100')], 3);
  }), /限流/);
  assert.equal(saved.plays.length, 2); assert.equal(saved.cursor.page, 2); assert.equal(saved.watermarks.listener, undefined); assert.deepEqual(initial, original);
});
test('寫入失敗不修改傳入快照', async () => {
  const s = populated(), before = structuredClone(s);
  await assert.rejects(syncBatch(s, 'listener', false, async () => { throw new Error('quota'); }, () => {}, async () => response([track('1700000100')])), /quota/);
  assert.deepEqual(s, before);
});
test('格式錯誤的同步回應不寫入資料', async () => {
  let commits = 0;
  await assert.rejects(syncBatch(populated(), 'u', false, async () => commits++, () => {}, async () => Response.json({ tracks: 'bad', totalPages: 1 })), /格式/);
  assert.equal(commits, 0);
});
test('空歷史紀錄正常完成', async () => {
  const next = await syncBatch(emptyState(), 'u', false, async () => {}, () => {}, async () => response([], 0));
  assert.equal(next.plays.length, 0); assert.ok(next.watermarks.u > 0);
});
test('特殊使用者名稱不讀取繼承屬性，也不修改物件原型', async () => {
  for (const user of ['constructor', '__proto__']) {
    let requested; const next = await syncBatch(emptyState(), user, false, async () => {}, () => {}, async u => { requested = new URL(u, 'https://example.test'); return response([]); });
    assert.equal(requested.searchParams.get('from'), '0'); assert.equal(Object.hasOwn(next.watermarks, user), true);
    assert.ok(Number.isSafeInteger(next.watermarks[user]));
  }
});
test('Function 拒絕錯誤方法與參數', async () => {
  assert.equal((await handler(new Request('https://example.test', { method: 'POST' }))).status, 405);
  for (const q of ['user=bad%20name', 'user=u&page=0', 'user=u&page=1.2', 'user=u&from=-1', 'user=u&from=100&to=50', 'user=u&page=1000001']) assert.equal((await handler(req(q))).status, 400);
});
test('Function 無金鑰回報 503，不呼叫外部 API', async () => {
  const old = process.env.LASTFM_API_KEY; delete process.env.LASTFM_API_KEY;
  try { assert.equal((await handler(req('user=u'))).status, 503); } finally { if (old !== undefined) process.env.LASTFM_API_KEY = old; }
});
test('Function 正確代理、限流、異常與逾時都不洩漏金鑰', async () => {
  const oldKey = process.env.LASTFM_API_KEY, oldFetch = globalThis.fetch;
  process.env.LASTFM_API_KEY = 'FAKE_TEST_KEY_NOT_A_REAL_CREDENTIAL';
  try {
    let requested;
    globalThis.fetch = async u => { requested = u; return Response.json({ recenttracks: { track: [track()], '@attr': { totalPages: '1' } } }); };
    let r = await handler(req('user=u&from=0&to=1700000000&page=1'));
    assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(requested.hostname, 'ws.audioscrobbler.com'); assert.equal(requested.searchParams.get('method'), 'user.getrecenttracks'); assert.equal(requested.searchParams.get('limit'), '200');
    assert.equal((await r.json()).tracks.length, 1);
    for (const code of [6, 17, 29, 10]) {
      globalThis.fetch = async () => Response.json({ error: code, message: 'untrusted upstream' }); r = await handler(req('user=u'));
      assert.equal(r.status, 502); assert.doesNotMatch(await r.text(), /FAKE_TEST_KEY|untrusted upstream/);
    }
    globalThis.fetch = async () => Response.json({ recenttracks: { track: null, '@attr': { totalPages: 'bad' } } }); assert.equal((await handler(req('user=u'))).status, 502);
    globalThis.fetch = async () => { throw new Error('network or timeout'); }; assert.equal((await handler(req('user=u'))).status, 504);
  } finally { globalThis.fetch = oldFetch; if (oldKey === undefined) delete process.env.LASTFM_API_KEY; else process.env.LASTFM_API_KEY = oldKey; }
});
