import { test, expect, type Page } from "@playwright/test";
import { v1Fixture } from "../fixtures/v1";
import {
  migrateState,
  mergeTracks,
  emptyState,
  type State,
} from "../../src/domain";
async function navigate(page: Page, label: string) {
  await page.getByRole("button", { name: "開啟選單" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: label, exact: true })
    .click();
}
async function seed(page: Page, state: State) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "本機資料診斷" }),
  ).toBeVisible();
  // Isolated test browser only, never the production website or a user's browser.
  await page.evaluate(async (value) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("listening-counter", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("state", "readwrite");
      tx.objectStore("state").put(value, "main");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, state);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "本機資料診斷" }),
  ).toBeVisible();
}
async function snapshot(page: Page): Promise<State> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("listening-counter", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const state = await new Promise<State>((resolve, reject) => {
      const r = db.transaction("state").objectStore("state").get("main");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return state;
  });
}
test("手機：四筆明確 ID 逐筆確認刪除，原始 54 筆／21 首完整保留，統計更新且可恢復", async ({
  page,
}) => {
  const original = migrateState(v1Fixture());
  original.songs[0].title = "WAY 4 LUV";
  const tests = Array.from({ length: 4 }, (_, i) => ({
    id: `test-manual-${i}`,
    songId: original.songs[0].id,
    platformId: i < 2 ? "spotify" : "melon",
    at: 1700000900000,
    createdAt: 1700000900000,
    source: "manual" as const,
  }));
  const state = { ...original, plays: [...original.plays, ...tests] };
  await seed(page, state);
  await expect(page.getByLabel("本機資料診斷")).toContainText(
    "21 首歌曲、58 筆紀錄",
  );
  await page.getByRole("button", { name: "今日", exact: true }).click();
  await page
    .getByRole("button", { name: "查看 WAY 4 LUV 的聆聽紀錄", exact: true })
    .click();
  await expect(page.locator(".record-row")).toHaveCount(7);
  expect(await snapshot(page)).toEqual(state);
  await page
    .getByRole("button", { name: "刪除紀錄 test-manual-0", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "確認刪除單筆紀錄" });
  for (const text of [
    "WAY 4 LUV",
    "Spotify",
    "manual",
    "test-manual-0",
    "聆聽時間",
    "不刪除歌曲或其他紀錄",
  ])
    await expect(dialog).toContainText(text);
  await expect(dialog).not.toContainText("test-manual-1");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(await snapshot(page)).toEqual(state);
  for (let i = 0; i < 4; i++) {
    await page
      .getByRole("button", { name: `刪除紀錄 test-manual-${i}`, exact: true })
      .click();
    await dialog.getByRole("button", { name: "確認刪除這一筆" }).click();
    await expect(page.locator(".record-row")).toHaveCount(6 - i);
    const current = await snapshot(page);
    expect(current.plays).toHaveLength(57 - i);
    expect(current.songs).toEqual(original.songs);
    expect(
      current.plays.filter((p) => !p.id.startsWith("test-manual-")),
    ).toEqual(original.plays);
  }
  const removed = await snapshot(page);
  expect(removed.plays).toEqual(original.plays);
  expect(removed.deletedPlays).toHaveLength(4);
  expect(removed.cursor).toEqual(original.cursor);
  expect(removed.watermarks).toEqual(original.watermarks);
  await navigate(page, "聆聽總覽");
  await page.getByRole("button", { name: "累積", exact: true }).click();
  await expect(page.locator(".stat-number").first()).toHaveText("54");
  await page.getByLabel("平台篩選", { exact: true }).selectOption("spotify");
  await expect(page.locator(".stat-number").first()).toHaveText("0");
  await page.getByLabel("平台篩選", { exact: true }).selectOption("melon");
  await expect(page.locator(".stat-number").first()).toHaveText("0");
  await page
    .getByRole("button", { name: "查看 WAY 4 LUV 的聆聽紀錄", exact: true })
    .click();
  await page
    .getByRole("button", { name: "已刪除紀錄（4）", exact: true })
    .click();
  await expect(page.locator(".record-row")).toHaveCount(4);
  await page.reload();
  await page
    .getByRole("button", { name: "查看 WAY 4 LUV 的聆聽紀錄", exact: true })
    .click();
  await page
    .getByRole("button", { name: "已刪除紀錄（4）", exact: true })
    .click();
  await page
    .getByRole("button", { name: "恢復紀錄 test-manual-0", exact: true })
    .click();
  const restore = page.getByRole("dialog", { name: "確認恢復單筆紀錄" });
  await expect(restore).toContainText("test-manual-0");
  await restore.getByRole("button", { name: "確認恢復這一筆" }).click();
  await expect(
    page.getByRole("button", { name: "已刪除紀錄（3）", exact: true }),
  ).toBeVisible();
  const after = await snapshot(page);
  expect(after.plays).toHaveLength(55);
  expect(after.plays.find((p) => p.id === tests[0].id)).toEqual(tests[0]);
  expect(after.plays.filter((p) => !p.id.startsWith("test-manual-"))).toEqual(
    original.plays,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("手機：Last.fm 刪除後同步不補回，人工恢復後再次同步也不重複", async ({
  page,
}) => {
  const track = {
    name: "WAY 4 LUV",
    artist: { "#text": "PLAVE" },
    date: { uts: "1700000000" },
  };
  const state = mergeTracks(emptyState(), [track], "synthetic");
  state.username = "synthetic";
  const play = state.plays[0];
  await page.route("**/.netlify/functions/lastfm?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ tracks: [track], totalPages: 1 }),
    }),
  );
  await seed(page, state);
  await page
    .getByRole("button", { name: "查看 WAY 4 LUV 的聆聽紀錄", exact: true })
    .click();
  await page
    .getByRole("button", { name: `刪除紀錄 ${play.id}`, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "確認刪除這一筆" })
    .click();
  await expect(
    page.getByRole("button", { name: "目前紀錄（0）", exact: true }),
  ).toBeVisible();
  await navigate(page, "連接與備份");
  await page
    .getByRole("button", { name: "首次匯入全部紀錄", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已新增 0 筆");
  expect((await snapshot(page)).plays).toHaveLength(0);
  await navigate(page, "單筆紀錄管理");
  await page
    .getByRole("button", { name: "已刪除紀錄（1）", exact: true })
    .click();
  await page
    .getByRole("button", { name: `恢復紀錄 ${play.id}`, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "確認恢復這一筆" })
    .click();
  await expect(
    page.getByRole("button", { name: "目前紀錄（1）", exact: true }),
  ).toBeVisible();
  await navigate(page, "連接與備份");
  await page.getByRole("button", { name: "增量同步", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已新增 0 筆");
  expect((await snapshot(page)).plays).toEqual([play]);
});
