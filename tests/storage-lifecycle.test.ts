import "fake-indexeddb/auto";
import * as idb from "idb";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  loadStateWithInfo,
  loadState,
  openDatabase,
  saveState,
  lockWriter,
} from "../src/db";
import { emptyState, migrateState } from "../src/domain";
import { StorageFailure, storageFailure } from "../src/storage-errors";
import { v1Fixture } from "./fixtures/v1";
vi.mock("idb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("idb")>();
  return { ...actual, openDB: vi.fn(actual.openDB) };
});
function locks() {
  let held = false;
  vi.stubGlobal("navigator", {
    locks: {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lock: object | null) => unknown,
      ) => {
        if (held) return callback(null);
        held = true;
        try {
          return await callback({ name: "listening-counter-writer" });
        } finally {
          held = false;
        }
      },
    },
  });
}
beforeEach(async () => {
  locks();
  await idb.deleteDB("listening-counter");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("全新 origin 可初始化並讀取，不持有任何生命週期寫入鎖，也不寫空快照", async () => {
  const spy = vi.spyOn(navigator.locks, "request");
  const { state, info } = await loadStateWithInfo();
  expect(state).toEqual(emptyState());
  expect(info).toEqual({
    snapshotPresent: false,
    storedSchemaVersion: undefined,
    databaseVersion: 1,
  });
  expect(spy).not.toHaveBeenCalled();
  const db = await idb.openDB("listening-counter", 1);
  expect([...db.objectStoreNames]).toEqual(["state"]);
  expect(await db.getKey("state", "main")).toBeUndefined();
  db.close();
});
it("同源已有舊版長期鎖時仍可讀取 21／54，寫入拒絕且不更動原資料", async () => {
  const state = migrateState(v1Fixture());
  await saveState(state);
  let release!: () => void;
  const held = lockWriter(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  expect((await loadState()).plays).toHaveLength(54);
  await expect(saveState(emptyState(), state)).rejects.toMatchObject({
    code: "LOCK_BUSY",
    phase: "lock",
  });
  expect(await loadState()).toEqual(state);
  release();
  await held;
  await saveState({ ...state, username: "updated" }, state);
  expect((await loadState()).username).toBe("updated");
});
it("成功、失敗與回呼丟錯均釋放鎖，後續操作可重新取得", async () => {
  expect(await lockWriter(async () => 42)).toBe(42);
  await expect(
    lockWriter(async () => {
      throw new Error("test failure");
    }),
  ).rejects.toThrow("test failure");
  expect(await lockWriter(async () => 43)).toBe(43);
});
it("缺 Web Locks 仍可載入與備份，只有寫入拒絕", async () => {
  const initial = migrateState(v1Fixture());
  await saveState(initial);
  vi.stubGlobal("navigator", {});
  expect(await loadState()).toEqual(initial);
  await expect(saveState(emptyState(), initial)).rejects.toMatchObject({
    code: "LOCK_UNSUPPORTED",
  });
  expect(await loadState()).toEqual(initial);
});
it("較高資料庫版本不降版或重建，回報 DB_VERSION 而不是其他分頁", async () => {
  const raw = v1Fixture();
  const db = await idb.openDB("listening-counter", 2, {
    upgrade(db) {
      db.createObjectStore("state");
    },
  });
  await db.put("state", raw, "main");
  await expect(loadState()).rejects.toMatchObject({
    code: "DB_VERSION",
    phase: "open",
    nativeName: "VersionError",
  });
  expect(await db.get("state", "main")).toEqual(raw);
  expect(db.version).toBe(2);
  db.close();
});
it("已有資料庫缺 state 時停止，不擅自重建 schema", async () => {
  const db = await idb.openDB("listening-counter", 1, {
    upgrade(db) {
      db.createObjectStore("other");
    },
  });
  await db.put("other", "keep", "original");
  await expect(loadState()).rejects.toMatchObject({
    code: "DB_SCHEMA",
    phase: "read",
  });
  expect([...db.objectStoreNames]).toEqual(["other"]);
  expect(await db.get("other", "original")).toBe("keep");
  db.close();
});
it("versionchange 會關閉本程式連線，讓其他升級完成且資料不變", async () => {
  const db = await openDatabase();
  const raw = v1Fixture();
  await db.put("state", raw, "main");
  const upgraded = await idb.openDB("listening-counter", 2);
  expect(await upgraded.get("state", "main")).toEqual(raw);
  expect(() => db.transaction("state")).toThrow();
  upgraded.close();
});
it("blocked 明確回報 DB_BLOCKED，晚到的成功連線立即關閉", async () => {
  let finish!: (value: unknown) => void;
  const close = vi.fn();
  vi.spyOn(idb, "openDB").mockImplementationOnce(((
    _name: string,
    _version: number,
    options: { blocked: () => void },
  ) => {
    queueMicrotask(() => options.blocked());
    return new Promise<unknown>((resolve) => {
      finish = resolve;
    });
  }) as unknown as typeof idb.openDB);
  await expect(openDatabase()).rejects.toMatchObject({
    code: "DB_BLOCKED",
    phase: "open",
  });
  finish({ close });
  await Promise.resolve();
  expect(close).toHaveBeenCalledOnce();
});
it("開啟逾時不永遠停在載入畫面，晚到連線仍關閉", async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  const close = vi.fn();
  vi.spyOn(idb, "openDB").mockImplementationOnce(
    (() =>
      new Promise<unknown>((resolve) => {
        finish = resolve;
      })) as typeof idb.openDB,
  );
  const assertion = expect(openDatabase()).rejects.toMatchObject({
    code: "DB_OPEN_TIMEOUT",
  });
  await vi.advanceTimersByTimeAsync(10001);
  await assertion;
  finish({ close });
  await Promise.resolve();
  expect(close).toHaveBeenCalledOnce();
});
it("權限、容量、交易錯誤分類不誤判 Web Locks，診斷不帶入原始私人訊息", () => {
  for (const [name, code] of [
    ["SecurityError", "DB_PERMISSION"],
    ["QuotaExceededError", "DB_QUOTA"],
    ["AbortError", "DB_ABORT"],
    ["UnknownError", "DB_INTERNAL"],
    ["TransactionInactiveError", "DB_TRANSACTION"],
  ]) {
    const result = storageFailure(
      new DOMException("PRIVATE_TRACK_API_KEY", name),
      "write",
    );
    expect(result).toBeInstanceOf(StorageFailure);
    expect(result.code).toBe(code);
    expect(result.phase).toBe("write");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_TRACK_API_KEY");
  }
});
it("寫入失敗顯示真正容量錯誤且釋放鎖，不要求刪資料", async () => {
  const current = migrateState(v1Fixture());
  await saveState(current);
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
    throw new DOMException("PRIVATE_TRACK", "QuotaExceededError");
  });
  await expect(
    saveState({ ...current, username: "not-saved" }, current),
  ).rejects.toMatchObject({ code: "DB_QUOTA", phase: "write" });
  expect(await loadState()).toEqual(current);
  await saveState({ ...current, username: "saved" }, current);
  expect((await loadState()).username).toBe("saved");
});
it("鎖 API 本身拒絕有獨立代碼，不誤判鎖被其他分頁持有", async () => {
  vi.stubGlobal("navigator", {
    locks: {
      request: () => {
        throw new DOMException("PRIVATE_DETAILS", "SecurityError");
      },
    },
  });
  await expect(saveState(emptyState())).rejects.toMatchObject({
    code: "LOCK_REQUEST",
    phase: "lock",
  });
  expect((await loadStateWithInfo()).info.snapshotPresent).toBe(false);
});
