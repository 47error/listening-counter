import { test, expect, type Page } from "@playwright/test";
async function navigate(page: Page, tab: string) {
  await page.getByRole("button", { name: "開啟選單" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: tab, exact: true })
    .click();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("listening-counter", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const value = await new Promise<any>((resolve, reject) => {
      const r = db.transaction("state").objectStore("state").get("main");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return value;
  });
}
test("手機：新增歌曲、平台 +1、批次確認、篩選不寫入、平台管理與備份", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "新增歌曲", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("歌曲名稱").fill("Dash");
  await dialog.getByRole("button", { name: "儲存歌曲" }).click();
  await page
    .getByLabel("手動計數平台", { exact: true })
    .selectOption("spotify");
  await page.getByRole("button", { name: "Dash 手動加一次" }).click();
  await expect(page.getByRole("status")).toContainText("Spotify");
  await page.getByLabel("手動計數平台", { exact: true }).selectOption("melon");
  await page.getByRole("button", { name: "指定日期／批次新增" }).click();
  await dialog.getByLabel("次數", { exact: true }).fill("3");
  page.once("dialog", (d) => d.accept());
  await dialog.getByRole("button", { name: "預覽確認新增" }).click();
  await expect(page.getByRole("status")).toContainText("3 筆");
  const before = await snapshot(page);
  expect(before.plays).toHaveLength(4);
  await page.getByLabel("平台篩選", { exact: true }).selectOption("spotify");
  await expect(page.locator(".song-count strong")).toHaveText("1 次聆聽");
  await page.getByLabel("平台篩選", { exact: true }).selectOption("melon");
  await expect(page.locator(".song-count strong")).toHaveText("3 次聆聽");
  expect(await snapshot(page)).toEqual(before);
  await noOverflow(page);
  await navigate(page, "連接與備份");
  await page.getByLabel("新平台名稱").fill("Apple Music");
  await page.getByRole("button", { name: "新增平台", exact: true }).click();
  await expect(
    page.locator(".platform-row").filter({ hasText: "Apple Music" }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept("Stationhead"));
  await page.getByRole("button", { name: "重新命名" }).click();
  await expect(
    page.locator(".platform-row").filter({ hasText: "Stationhead" }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "封存", exact: true }).click();
  await expect(
    page.locator(".platform-row").filter({ hasText: "Stationhead" }),
  ).toContainText("已封存");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下載 JSON 備份" }).click();
  expect((await download).suggestedFilename()).toMatch(
    /listening-counter.*\.json/,
  );
  await noOverflow(page);
  expect(errors).toEqual([]);
});
test("手機：Takeout 必須逐筆確認、重複匯入與錯誤檔案不寫入", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新增歌曲", exact: true }).click();
  await page.getByRole("dialog").getByLabel("歌曲名稱").fill("Dash");
  await page.getByRole("button", { name: "儲存歌曲" }).click();
  await navigate(page, "YouTube Music 匯入");
  const text = JSON.stringify([
    {
      title: "Watched Dash",
      titleUrl: "https://music.youtube.com/watch?v=abcdefghijk",
      time: "2023-11-14T22:15:00Z",
      subtitles: [{ name: "PLAVE - Topic" }],
    },
  ]);
  const upload = async (content: string) =>
    page.getByLabel("選擇 JSON 紀錄").setInputFiles({
      name: "watch-history.json",
      mimeType: "application/json",
      buffer: Buffer.from(content),
    });
  await upload(text);
  await expect(page.getByRole("heading", { name: "匯入預覽" })).toBeVisible();
  const button = page.getByRole("button", { name: "確認匯入", exact: true });
  await expect(button).toBeDisabled();
  await page
    .getByLabel("對應歌曲")
    .selectOption({ label: "Dash · PLAVE · 原版 · " });
  await expect(button).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "我確認此事件是 YouTube Music 聆聽，且歌曲版本正確",
    })
    .check();
  page.once("dialog", (d) => d.accept());
  await button.click();
  await expect(
    page.getByRole("status").filter({ hasText: "成功 1" }),
  ).toBeVisible();
  const before = await snapshot(page);
  await upload(text);
  await expect(
    page.locator("section.panel").filter({ hasText: "YouTube Music 本機匯入" }),
  ).toContainText("重複 1");
  expect(await snapshot(page)).toEqual(before);
  await upload("{bad");
  await expect(page.getByRole("alert")).toContainText("無法解析");
  expect(await snapshot(page)).toEqual(before);
  await noOverflow(page);
});

import { v1Fixture } from "../fixtures/v1";
test("手機：既有 v1 21 首／54 筆直接載入，取消分類後不會變 0 且未寫回原資料", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "本機資料診斷" }),
  ).toBeVisible();
  const legacy = v1Fixture();
  await page.evaluate(async (raw) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("listening-counter", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("state", "readwrite");
      tx.objectStore("state").put(raw, "main");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, legacy);
  await page.reload();
  await expect(page.getByLabel("本機資料診斷")).toContainText(
    "未篩選總數：21 首歌曲、54 筆紀錄",
  );
  await expect(page.locator(".song-card")).toHaveCount(21);
  await page.getByRole("checkbox", { name: "只看 PLAVE" }).uncheck();
  await page.getByLabel("平台篩選", { exact: true }).selectOption("unknown");
  await expect(page.locator(".stat-number").first()).toHaveText("54");
  await expect(page.locator(".song-card")).toHaveCount(21);
  expect(await snapshot(page)).toEqual(legacy);
  await noOverflow(page);
  await page.goto("http://localhost:4173/");
  await expect(page.getByLabel("本機資料診斷")).toContainText(
    "目前網址找不到既有快照",
  );
  await expect(page.getByLabel("本機資料診斷")).toContainText(
    "0 首歌曲、0 筆紀錄",
  );
  await page.goto("http://127.0.0.1:4173/");
  await expect(page.getByLabel("本機資料診斷")).toContainText(
    "21 首歌曲、54 筆紀錄",
  );
  expect(await snapshot(page)).toEqual(legacy);
});
test("手機：不同 origin 空資料提示與 v1 備份安全補入預覽，不取代現有歌曲", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByLabel("本機資料診斷")).toContainText(
    "目前網址找不到既有快照",
  );
  expect(await snapshot(page)).toBeUndefined();
  await page.getByRole("button", { name: "新增歌曲", exact: true }).click();
  await page.getByRole("dialog").getByLabel("歌曲名稱").fill("本機新歌");
  await page.getByRole("button", { name: "儲存歌曲" }).click();
  const original = await snapshot(page);
  await navigate(page, "連接與備份");
  const upload = () =>
    page.getByLabel("選擇 JSON 備份").setInputFiles({
      name: "synthetic-v1.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(v1Fixture())),
    });
  await upload();
  await expect(page.getByRole("dialog")).toContainText(
    "將補入 21 首歌曲、54 筆紀錄",
  );
  expect(await snapshot(page)).toEqual(original);
  await page.getByRole("button", { name: "確認補入缺少資料" }).click();
  await expect(page.getByLabel("本機資料診斷")).toContainText(
    "22 首歌曲、54 筆紀錄",
  );
  const restored = await snapshot(page);
  expect(restored.songs).toContainEqual(original.songs[0]);
  expect(restored.plays.filter((p: any) => p.source === "lastfm")).toHaveLength(
    53,
  );
  expect(restored.plays.filter((p: any) => p.source === "manual")).toHaveLength(
    1,
  );
  await upload();
  await expect(page.getByRole("dialog")).toContainText(
    "將補入 0 首歌曲、0 筆紀錄",
  );
  await page.getByRole("button", { name: "確認補入缺少資料" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await snapshot(page)).toEqual(restored);
  await noOverflow(page);
});

test("手機：損壞快照顯示錯誤並停止，不能當作空帳本寫入", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "本機資料診斷" }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("listening-counter", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("state", "readwrite");
      tx.objectStore("state").put(null, "main");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("原始資料未變更");
  await expect(
    page.getByRole("button", { name: "新增歌曲", exact: true }),
  ).toHaveCount(0);
  expect(await snapshot(page)).toBeNull();
});

test("手機：舊版同源長期寫入鎖不阻擋啟動，失敗寫入有安全診斷，釋放後可重試", async ({
  page,
  context,
}) => {
  const holder = await context.newPage();
  await holder.goto("/");
  await expect(
    holder.getByRole("heading", { name: "本機資料診斷" }),
  ).toBeVisible();
  await holder.evaluate(
    () =>
      new Promise<void>((ready) => {
        void navigator.locks.request("listening-counter-writer", async () => {
          await new Promise<void>((release) => {
            (window as any).releaseRegressionLock = release;
            ready();
          });
        });
      }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "本機資料診斷" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "資料暫時無法開啟" }),
  ).toHaveCount(0);
  expect(await snapshot(page)).toBeUndefined();
  await page.getByRole("button", { name: "新增歌曲", exact: true }).click();
  await page.getByRole("dialog").getByLabel("歌曲名稱").fill("鎖定回歸歌曲");
  await page.getByRole("button", { name: "儲存歌曲" }).click();
  await expect(page.getByRole("alert")).toContainText("寫入鎖目前被占用");
  expect(await snapshot(page)).toBeUndefined();
  // The dialog remains open after failed save. Close it to inspect diagnostics.
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  const diagnostic = page
    .locator(".safe-diagnostics")
    .filter({ hasText: "LOCK_BUSY" });
  await expect(diagnostic).toContainText('"writerHeld": 1');
  await expect(diagnostic).toContainText('"phase": "lock"');
  await expect(diagnostic).not.toContainText("clientId");
  await expect(diagnostic).not.toContainText("鎖定回歸歌曲");
  await holder.evaluate(() => {
    (window as any).releaseRegressionLock();
  });
  await expect
    .poll(async () =>
      page.evaluate(
        async () =>
          ((await navigator.locks.query()).held || []).filter(
            (l) => l.name === "listening-counter-writer",
          ).length,
      ),
    )
    .toBe(0);
  await page.getByRole("button", { name: "新增歌曲", exact: true }).click();
  await page.getByRole("dialog").getByLabel("歌曲名稱").fill("解鎖後歌曲");
  await page.getByRole("button", { name: "儲存歌曲" }).click();
  await expect(page.locator(".song-card")).toHaveCount(1);
  await expect
    .poll(async () =>
      page.evaluate(
        async () =>
          ((await navigator.locks.query()).held || []).filter(
            (l) => l.name === "listening-counter-writer",
          ).length,
      ),
    )
    .toBe(0);
  await holder.close();
});
test("手機：兩分頁可同時讀取，過期快照拒絕覆蓋；重新整理後可安全新增", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "本機資料診斷" }),
  ).toBeVisible();
  const second = await context.newPage();
  await second.goto("/");
  await expect(
    second.getByRole("heading", { name: "本機資料診斷" }),
  ).toBeVisible();
  async function add(target: Page, title: string) {
    await target.getByRole("button", { name: "新增歌曲", exact: true }).click();
    await target.getByRole("dialog").getByLabel("歌曲名稱").fill(title);
    await target.getByRole("button", { name: "儲存歌曲" }).click();
  }
  await add(page, "第一頁歌曲");
  await expect(page.locator(".song-card")).toHaveCount(1);
  await add(second, "過期頁歌曲");
  await expect(second.getByRole("alert")).toContainText("避免覆蓋");
  expect((await snapshot(page)).songs.map((s: any) => s.title)).toEqual([
    "第一頁歌曲",
  ]);
  await second.reload();
  await expect(second.locator(".song-card")).toHaveCount(1);
  await add(second, "第二頁歌曲");
  await expect(second.locator(".song-card")).toHaveCount(2);
  await page.reload();
  await expect(page.locator(".song-card")).toHaveCount(2);
  await second.close();
});
test("手機：不支援 Web Locks 時可開啟空帳本，寫入明確拒絕", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "本機資料診斷" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新增歌曲", exact: true }).click();
  await page.getByRole("dialog").getByLabel("歌曲名稱").fill("不可寫入");
  await page.getByRole("button", { name: "儲存歌曲" }).click();
  await expect(page.getByRole("alert")).toContainText("不支援安全寫入鎖定");
  expect(await snapshot(page)).toBeUndefined();
});

test("手機：資料庫版本錯誤顯示 DB_VERSION，不誤報分頁且保留原資料", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "本機資料診斷" }),
  ).toBeVisible();
  const legacy = v1Fixture();
  await page.evaluate(async (raw) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("listening-counter", 2);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("state", "readwrite");
      tx.objectStore("state").put(raw, "main");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, legacy);
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("資料庫版本高於");
  await expect(page.locator(".safe-diagnostics")).toContainText("DB_VERSION");
  await expect(page.locator(".safe-diagnostics")).toContainText("VersionError");
  await expect(page.locator(".safe-diagnostics")).not.toContainText(
    "LOCK_BUSY",
  );
  const actual = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("listening-counter", 2);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const raw = await new Promise((resolve, reject) => {
      const r = db.transaction("state").objectStore("state").get("main");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return raw;
  });
  expect(actual).toEqual(legacy);
});
