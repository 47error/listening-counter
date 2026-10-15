import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  emptyState,
  migrateState,
  manualPlays,
  removePlay,
  restorePlay,
  mergeTracks,
  validateBackup,
  filterPlays,
  playConfirmation,
} from "../src/domain";
import { planRecovery } from "../src/recovery";
import { loadState, saveState } from "../src/db";
import { v1Fixture } from "./fixtures/v1";
import { syncBatch } from "../src/sync";
function data() {
  const raw = v1Fixture();
  raw.songs[0].title = "WAY 4 LUV";
  const original = migrateState(raw);
  const state = manualPlays(
    manualPlays(original, original.songs[0].id, "spotify", 1700000900000, 2),
    original.songs[0].id,
    "melon",
    1700000900000,
    2,
  );
  return { original, state, tests: state.plays.slice(54) };
}
beforeEach(async () => {
  vi.stubGlobal("navigator", {
    locks: {
      request: async (
        _n: string,
        _o: unknown,
        callback: (lock: object) => unknown,
      ) => callback({ name: "listening-counter-writer" }),
    },
  });
  await deleteDB("listening-counter");
});
afterEach(() => vi.unstubAllGlobals());
it("58 筆中逐筆選擇四個 ID 刪除，只剩原始 54，21 首歌與所有來源資料完全保留", () => {
  const { original, state, tests } = data(),
    before = structuredClone(state);
  let next = state;
  for (const p of tests) {
    const prior = next;
    next = removePlay(next, p.id, 1800000000000);
    expect(next.plays).toHaveLength(prior.plays.length - 1);
    expect(next.deletedPlays?.at(-1)?.play).toEqual(p);
  }
  expect(next.plays).toEqual(original.plays);
  expect(next.songs).toEqual(original.songs);
  expect(next.watermarks).toEqual(original.watermarks);
  expect(next.cursor).toEqual(original.cursor);
  expect(next.deletedPlays).toHaveLength(4);
  expect(next.songs).toHaveLength(21);
  expect(state).toEqual(before);
  expect(filterPlays(next, "spotify")).toHaveLength(0);
  expect(filterPlays(next, "melon")).toHaveLength(0);
});
it("同歌同平台同時間的手動紀錄以 ID 單獨刪除，不按名稱、時間或批次連帶刪除", () => {
  const { state, tests } = data(),
    first = tests[0],
    second = tests[1];
  expect(first.at).toBe(second.at);
  expect(first.platformId).toBe(second.platformId);
  const next = removePlay(state, first.id);
  expect(next.plays).toHaveLength(57);
  expect(next.plays.find((p) => p.id === second.id)).toEqual(second);
  expect(next.plays.filter((p) => p.songId !== first.songId)).toEqual(
    state.plays.filter((p) => p.songId !== first.songId),
  );
  expect(() => removePlay(next, first.id)).toThrow();
  expect(() => removePlay(state, "missing")).toThrow();
});
it("手動誤刪重新載入後可恢復同一 ID／平台／時間／來源，且不得重複恢復", async () => {
  const { state, tests } = data(),
    play = tests[0];
  const removed = removePlay(state, play.id);
  await saveState(removed);
  const loaded = await loadState();
  expect(loaded.plays).toHaveLength(57);
  const restored = restorePlay(loaded, play.id);
  expect(restored.plays.find((p) => p.id === play.id)).toEqual(play);
  expect(restored.plays).toHaveLength(58);
  expect(restored.deletedPlays).toHaveLength(0);
  expect(() => restorePlay(restored, play.id)).toThrow();
  await saveState(restored, loaded);
  expect((await loadState()).plays).toHaveLength(58);
});
it("Last.fm 刪除後連續同步不補回；明確恢復後仍只有原 ID 一筆", async () => {
  const track = {
    name: "WAY 4 LUV",
    artist: { "#text": "PLAVE" },
    date: { uts: "1700000000" },
  };
  const initial = mergeTracks(emptyState(), [track], "synthetic"),
    play = initial.plays[0];
  let state = removePlay(initial, play.id);
  const fetcher = async () => Response.json({ tracks: [track], totalPages: 1 });
  state = await syncBatch(
    state,
    "synthetic",
    true,
    async () => {},
    () => {},
    fetcher,
  );
  state = await syncBatch(
    state,
    "synthetic",
    false,
    async () => {},
    () => {},
    fetcher,
  );
  expect(state.plays).toHaveLength(0);
  expect(state.ignoredKeys).toContain(play.externalKey);
  expect(state.deletedPlays?.[0].play).toEqual(play);
  state = restorePlay(state, play.id);
  expect(state.ignoredKeys).not.toContain(play.externalKey);
  state = await syncBatch(
    state,
    "synthetic",
    true,
    async () => {},
    () => {},
    fetcher,
  );
  expect(state.plays).toEqual([play]);
});
it("v1／既有 v2 備份仍相容，新 v2 備份往返保留可恢復副本與去重鍵", () => {
  const { state, tests } = data();
  expect(validateBackup(v1Fixture()).plays).toHaveLength(54);
  expect(validateBackup(state)).toMatchObject({
    songs: state.songs,
    plays: state.plays,
  });
  const removed = removePlay(state, tests[0].id);
  const backup = JSON.parse(JSON.stringify(removed));
  const restored = validateBackup(backup);
  expect(restored.deletedPlays).toEqual(removed.deletedPlays);
  expect(restored.ignoredKeys).toEqual(removed.ignoredKeys);
  expect(
    restorePlay(restored, tests[0].id).plays.find((p) => p.id === tests[0].id),
  ).toEqual(tests[0]);
  const plan = planRecovery(emptyState(), backup);
  expect(plan.state.deletedPlays).toEqual(removed.deletedPlays);
  expect(planRecovery(plan.state, backup).addedPlays).toBe(0);
});
it("安全補入舊備份不自動復活已刪除手動紀錄，含刪除標記的備份不刪除現有活躍紀錄", () => {
  const { state, tests } = data(),
    removed = removePlay(state, tests[0].id);
  const back = planRecovery(removed, state);
  expect(back.ignored).toBe(1);
  expect(back.state.plays).toHaveLength(57);
  expect(back.state.deletedPlays).toEqual(removed.deletedPlays);
  const keep = planRecovery(state, removed);
  expect(keep.state.plays).toEqual(state.plays);
  expect(keep.state.deletedPlays).toHaveLength(0);
});
it("無效已刪除副本或與活躍 ID 重複的備份拒絕，不修改輸入", () => {
  const { state, tests } = data();
  const removed = removePlay(state, tests[0].id);
  for (const mutation of [
    (s: typeof removed) => {
      s.deletedPlays![0].deletedAt = 0;
    },
    (s: typeof removed) => {
      s.deletedPlays![0].play.songId = "missing";
    },
    (s: typeof removed) => {
      s.deletedPlays!.push(s.deletedPlays![0]);
    },
    (s: typeof removed) => {
      s.plays.push(s.deletedPlays![0].play);
    },
  ]) {
    const broken = structuredClone(removed);
    mutation(broken);
    const before = structuredClone(broken);
    expect(() => validateBackup(broken)).toThrow();
    expect(broken).toEqual(before);
  }
});
it("原歌曲另被刪除／合併時不猜測恢復目標，副本與備份保留", () => {
  const { state, tests } = data();
  const removed = removePlay(state, tests[0].id);
  const noSong = {
    ...removed,
    songs: removed.songs.filter((s) => s.id !== tests[0].songId),
    plays: removed.plays.filter((p) => p.songId !== tests[0].songId),
  };
  expect(validateBackup(noSong).deletedPlays).toEqual(removed.deletedPlays);
  expect(() => restorePlay(noSong, tests[0].id)).toThrow("歌曲");
});
it("確認內容包含完整 ID、歌名、平台、時間、來源，區分同時間手動紀錄", () => {
  const { state, tests } = data();
  const text = playConfirmation(state, tests[0]);
  for (const value of [
    "WAY 4 LUV",
    "Spotify",
    "manual",
    tests[0].id,
    "聆聽時間",
  ])
    expect(text).toContain(value);
  expect(text).not.toContain(tests[1].id);
});
it("補入備份遇到已刪除 ID 指向不同事件時停止，不把衝突當重複略過", () => {
  const { state, tests } = data(),
    removed = removePlay(state, tests[0].id);
  const changed = structuredClone(state);
  changed.plays.find((p) => p.id === tests[0].id)!.at++;
  expect(() => planRecovery(removed, changed)).toThrow("衝突");
  const changedArchive = structuredClone(removed);
  changedArchive.deletedPlays![0].play.at++;
  expect(() => planRecovery(state, changedArchive)).toThrow("衝突");
});
