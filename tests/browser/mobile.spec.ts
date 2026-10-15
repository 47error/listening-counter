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
    page
      .getByLabel("選擇 JSON 紀錄")
      .setInputFiles({
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
  await expect(page.locator("section.panel")).toContainText("重複 1");
  expect(await snapshot(page)).toEqual(before);
  await upload("{bad");
  await expect(page.getByRole("alert")).toContainText("無法解析");
  expect(await snapshot(page)).toEqual(before);
  await noOverflow(page);
});
