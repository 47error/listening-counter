import "fake-indexeddb/auto";
import { openDB, deleteDB } from "idb";
import { beforeEach, expect, it } from "vitest";
import {
  emptyState,
  filterPlays,
  manualPlays,
  mergeSongs,
  mergeTracks,
  migrateState,
  removePlay,
  setPlatform,
  suspectedDuplicates,
  validateBackup,
  type State,
} from "../src/domain";
import { loadState, saveState } from "../src/db";
import { importTakeout, previewTakeout } from "../src/takeout";
import { syncBatch } from "../src/sync";
const seed = () =>
  mergeTracks(
    emptyState(),
    [
      {
        name: "Dash",
        artist: { "#text": "PLAVE" },
        date: { uts: "1700000000" },
      },
    ],
    "listener",
  );
const event = {
  title: "Watched Dash",
  titleUrl: "https://music.youtube.com/watch?v=abcdefghijk",
  time: "2023-11-14T22:15:00Z",
  subtitles: [{ name: "PLAVE - Topic" }],
};
beforeEach(async () => {
  await deleteDB("listening-counter");
});
it("實際 v1 IndexedDB 快照升級可重複執行，保留總次數、ID、歌曲目標及游標", async () => {
  const v2 = seed();
  const legacy = {
    ...v2,
    schemaVersion: 1,
    cursor: { user: "listener", from: 0, to: 1700001000, page: 2 },
    plays: v2.plays.map(({ platformId, createdAt, ...p }) => p),
  };
  const db = await openDB("listening-counter", 1, {
    upgrade(db) {
      db.createObjectStore("state");
    },
  });
  await db.put("state", legacy, "main");
  db.close();
  const s = await loadState();
  expect(s.plays).toHaveLength(legacy.plays.length);
  expect(s.songs).toEqual(legacy.songs);
  expect(s.plays[0]).toMatchObject({
    id: legacy.plays[0].id,
    at: legacy.plays[0].at,
    platformId: "unknown",
    createdAt: legacy.plays[0].at,
  });
  expect(s.cursor).toEqual(legacy.cursor);
  expect(migrateState(s)).toEqual(s);
  await saveState(s);
  expect(await loadState()).toEqual(s);
  expect(validateBackup(legacy).plays).toEqual(s.plays);
});
it("Last.fm 增量重疊同步不增加紀錄，刪除後重掃仍不回流", async () => {
  const initial = seed();
  const response = async () =>
    Response.json({
      tracks: [
        {
          name: "Dash",
          artist: { "#text": "PLAVE" },
          date: { uts: "1700000000" },
        },
      ],
      totalPages: 1,
    });
  let next = await syncBatch(
    initial,
    "listener",
    false,
    async () => {},
    () => {},
    response,
  );
  expect(next.plays).toHaveLength(1);
  next = removePlay(next, next.plays[0].id);
  next = await syncBatch(
    next,
    "listener",
    true,
    async () => {},
    () => {},
    response,
  );
  expect(next.plays).toHaveLength(0);
});
it("Spotify 與 Melon 手動批次分開統計，名稱與時間相同仍保留每次聆聽", () => {
  const initial = seed(),
    id = initial.songs[0].id;
  const s = manualPlays(
    manualPlays(initial, id, "spotify", 1700000100000, 2),
    id,
    "melon",
    1700000100000,
    3,
  );
  const before = structuredClone(s);
  expect(filterPlays(s, "spotify")).toHaveLength(2);
  expect(filterPlays(s, "melon")).toHaveLength(3);
  expect(s.plays).toHaveLength(6);
  expect(new Set(s.plays.map((p) => p.id)).size).toBe(6);
  expect(s).toEqual(before);
});
it("Takeout 預覽不寫入、必須選擇確認，重複檔案及不同排列格式仍去重", async () => {
  const s = seed(),
    before = structuredClone(s);
  const preview = await previewTakeout(JSON.stringify([event, event]), s);
  expect(preview.duplicate).toBe(1);
  expect(preview.rows[0].songId).toBe(s.songs[0].id);
  expect(s).toEqual(before);
  expect(importTakeout(s, preview, {}).state).toEqual(s);
  const r = importTakeout(s, preview, { [preview.rows[0].key]: s.songs[0].id });
  expect(r.success).toBe(1);
  expect(r.state.plays.at(-1)).toMatchObject({
    source: "import",
    platformId: "youtube",
    at: Date.parse(event.time),
    batchId: preview.batchId,
  });
  expect(
    (await previewTakeout(JSON.stringify([event], null, 2), r.state)).duplicate,
  ).toBe(1);
  expect(
    importTakeout(r.state, preview, { [preview.rows[0].key]: s.songs[0].id })
      .success,
  ).toBe(0);
});
it("無效檔案、HTML、孤立事件及未確認播放不破壞既有資料", async () => {
  const s = seed(),
    before = structuredClone(s);
  for (const text of ["bad", "{}", "<html><script>alert(1)</script></html>"])
    await expect(previewTakeout(text, s)).rejects.toThrow();
  const preview = await previewTakeout(
    JSON.stringify([
      {},
      { ...event, time: "bad" },
      { ...event, title: "Searched for Dash" },
      { ...event, details: [{ name: "From Google Ads" }] },
      { ...event, titleUrl: "https://evil.test/watch?v=abcdefghijk" },
    ]),
    s,
  );
  expect(preview.rows).toHaveLength(0);
  expect(preview.failed).toBe(2);
  expect(preview.skipped).toBe(3);
  expect(s).toEqual(before);
});
it("同名不同版本不自動比對或合併，明確合併後保留事件和來源鍵", async () => {
  let s = seed();
  const original = s.songs[0];
  s.songs.push({
    ...original,
    id: "live",
    version: "Live",
    originKey: undefined,
  });
  const preview = await previewTakeout(JSON.stringify([event]), s);
  expect(preview.rows[0].songId).toBe(original.id);
  s = manualPlays(s, "live", "melon", 1700000000000, 1);
  const play = s.plays.at(-1)!;
  const merged = mergeSongs(s, original.id, "live");
  expect(merged.songs).toHaveLength(1);
  expect(merged.plays.at(-1)).toEqual(play);
  expect(merged.plays[0].externalKey).toBe(s.plays[0].externalKey);
  const synced = mergeTracks(
    merged,
    [
      {
        name: "Dash",
        artist: { "#text": "PLAVE" },
        date: { uts: "1700000001" },
      },
    ],
    "listener",
  );
  expect(synced.songs).toHaveLength(1);
  expect(synced.plays.at(-1)?.songId).toBe("live");
});
it("自訂平台驗證、改名與封存不刪除資料", () => {
  let s = setPlatform(seed(), " Apple   Music ");
  const id = s.platforms.at(-1)!.id;
  s = manualPlays(s, s.songs[0].id, id, 1700000000000, 2);
  s = setPlatform(s, "Stationhead", id);
  expect(s.platforms.at(-1)?.name).toBe("Stationhead");
  expect(filterPlays(s, "other")).toHaveLength(2);
  for (const n of [" ", "Spotify", "Ｓｐｏｔｉｆｙ", "stationhead"])
    expect(() => setPlatform(s, n)).toThrow();
  const archived = {
    ...s,
    platforms: s.platforms.map((p) =>
      p.id === id ? { ...p, archived: true } : p,
    ),
  };
  expect(filterPlays(archived, "other")).toHaveLength(2);
  expect(() =>
    manualPlays(archived, s.songs[0].id, id, 1700000000000, 1),
  ).toThrow();
});
it("新版備份往返保留所有平台來源、匯入批次、封存及去重鍵", async () => {
  let s = setPlatform(seed(), "Apple Music");
  s = manualPlays(s, s.songs[0].id, s.platforms.at(-1)!.id, 1700000000000, 2);
  const p = await previewTakeout(JSON.stringify([event]), s);
  s = importTakeout(s, p, { [p.rows[0].key]: s.songs[0].id }).state;
  s = removePlay(s, s.plays[0].id);
  const restored = validateBackup(JSON.parse(JSON.stringify(s)));
  expect(restored).toEqual(s);
  await saveState(restored);
  expect(await loadState()).toEqual(s);
  expect(
    (await previewTakeout(JSON.stringify([event]), restored)).duplicate,
  ).toBe(1);
});
it("備份缺平台、時間、批次或重複平台時拒絕，傳入快照不變", () => {
  const mutations: ((s: State) => void)[] = [
    (s) => (s.plays[0].platformId = "missing"),
    (s) => (s.plays[0].createdAt = NaN),
    (s) => s.platforms.push(s.platforms[0]),
    (s) => (s.platforms[0].name = ""),
    (s) => {
      s.plays[0].source = "import";
    },
  ];
  for (const mutate of mutations) {
    const s = seed();
    mutate(s);
    const before = structuredClone(s);
    expect(() => validateBackup(s)).toThrow();
    expect(s).toEqual(before);
  }
});
it("疑似重複僅提示，不自動判斷跨來源是否同一次", () => {
  const s = seed(),
    next = manualPlays(s, s.songs[0].id, "spotify", s.plays[0].at + 1000, 1),
    before = structuredClone(next);
  expect(suspectedDuplicates(next)).toHaveLength(1);
  expect(next).toEqual(before);
});

import { v1Fixture } from "./fixtures/v1";
import { loadStateWithInfo } from "../src/db";
import { planRecovery } from "../src/recovery";
it("21 首／54 筆 v1 實際讀取遷移：53 Last.fm＋1 手動，且不寫入原快照", async () => {
  const raw = v1Fixture();
  const before = structuredClone(raw);
  const db = await openDB("listening-counter", 1, {
    upgrade(db) {
      db.createObjectStore("state");
    },
  });
  await db.put("state", raw, "main");
  const { state, info } = await loadStateWithInfo();
  expect(info).toEqual({
    snapshotPresent: true,
    storedSchemaVersion: 1,
    databaseVersion: 1,
  });
  expect(state.songs).toEqual(raw.songs);
  expect(state.plays).toHaveLength(54);
  expect(state.plays.filter((p) => p.source === "lastfm")).toHaveLength(53);
  expect(state.plays.filter((p) => p.source === "manual")).toHaveLength(1);
  expect(filterPlays(state, "unknown")).toHaveLength(54);
  expect(state.cursor).toEqual(raw.cursor);
  expect(state.watermarks).toEqual(raw.watermarks);
  expect(await db.get("state", "main")).toEqual(before);
  expect(migrateState(state)).toEqual(state);
  db.close();
});
it("v1 JSON 安全補入空帳本後可重複還原，不丟來源及次數", async () => {
  const raw = v1Fixture(),
    before = structuredClone(raw);
  const plan = planRecovery(emptyState(), JSON.parse(JSON.stringify(raw)));
  expect(plan.addedSongs).toBe(21);
  expect(plan.addedPlays).toBe(54);
  expect(plan.state.plays.filter((p) => p.source === "manual")).toHaveLength(1);
  expect(plan.state.plays.every((p) => p.platformId === "unknown")).toBe(true);
  await saveState(plan.state, emptyState());
  const repeat = planRecovery(await loadState(), raw);
  expect(repeat.addedSongs).toBe(0);
  expect(repeat.addedPlays).toBe(0);
  expect(repeat.duplicate).toBe(54);
  expect(raw).toEqual(before);
});
it("補入保留已有歌曲、手動紀錄及目標；ID 衝突整批拒絕", async () => {
  const initial = seed(),
    current = manualPlays(
      initial,
      initial.songs[0].id,
      "spotify",
      1700000000000,
      1,
    );
  const plan = planRecovery(current, v1Fixture());
  expect(plan.state.songs).toHaveLength(22);
  expect(plan.state.plays).toHaveLength(56);
  expect(plan.state.songs[0]).toEqual(current.songs[0]);
  expect(plan.state.plays.slice(0, 2)).toEqual(current.plays);
  await saveState(current);
  const raw = v1Fixture();
  const oldId = raw.songs[0].id;
  raw.songs[0].id = current.songs[0].id;
  raw.plays.forEach((p) => {
    if (p.songId === oldId) p.songId = current.songs[0].id;
  });
  expect(() => planRecovery(current, raw)).toThrow();
  expect(await loadState()).toEqual(current);
});

it("不存在與毀損快照分開處理，拒絕將 null 當成空帳本", async () => {
  expect((await loadStateWithInfo()).info.snapshotPresent).toBe(false);
  const db = await openDB("listening-counter", 1);
  expect(await db.getKey("state", "main")).toBeUndefined();
  for (const raw of [null, false, 0, {}, { schemaVersion: 99 }]) {
    await db.put("state", raw, "main");
    await expect(loadState()).rejects.toThrow();
    expect(await db.get("state", "main")).toEqual(raw);
  }
  db.close();
});
it("寫入前比對最新快照，過期空狀態不得蓋掉已有的 21 首／54 筆", async () => {
  const expected = await loadState(),
    current = migrateState(v1Fixture());
  await saveState(current);
  await expect(saveState(emptyState(), expected)).rejects.toThrow("避免覆蓋");
  expect(await loadState()).toEqual(current);
});
it("多次分頁同步使用最新已提交快照仍可繼續", async () => {
  let persisted = emptyState();
  await saveState(persisted);
  const result = await syncBatch(
    persisted,
    "synthetic",
    true,
    async (s) => {
      await saveState(s, persisted);
      persisted = s;
    },
    () => {},
    async (url) => {
      const page = Number(
        new URL(
          url instanceof Request ? url.url : url,
          "https://example.test",
        ).searchParams.get("page"),
      );
      return Response.json({
        tracks: [
          {
            name: "測試",
            artist: { "#text": "PLAVE" },
            date: { uts: String(1700000000 + page) },
          },
        ],
        totalPages: 2,
      });
    },
  );
  expect(result.plays).toHaveLength(2);
  expect(await loadState()).toEqual(result);
});
