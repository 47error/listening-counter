import { normalize, type State } from "./domain";
export interface Candidate {
  key: string;
  title: string;
  artist: string;
  at: number;
  songId: string;
  music: boolean;
}
export interface Preview {
  batchId: string;
  rows: Candidate[];
  failed: number;
  duplicate: number;
  skipped: number;
  total: number;
}
// Watch history has no duration or reliable artist identity. Every candidate requires human confirmation.
export async function previewTakeout(
  text: string,
  state: State,
): Promise<Preview> {
  if (text.length > 50 * 1024 * 1024) throw new Error("檔案上限為 50 MB。");
  if (/^\s*</.test(text))
    throw new Error(
      "HTML 日期與語系格式無法可靠判定，目前僅支援 JSON 預覽。請在 Takeout 將紀錄格式改為 JSON 後重新匯出。",
    );
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error("無法解析 JSON，資料未變更。");
  }
  if (!Array.isArray(input) || input.length > 200000)
    throw new Error(
      "請選擇 Takeout watch-history.json 陣列（最多 200,000 筆）。",
    );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  const result: Preview = {
    batchId: `takeout-${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`,
    rows: [],
    failed: 0,
    duplicate: 0,
    skipped: 0,
    total: input.length,
  };
  const seen = new Set([
    ...state.ignoredKeys,
    ...state.plays.map((p) => p.externalKey),
  ]);
  for (const raw of input) {
    if (
      !raw ||
      typeof raw !== "object" ||
      typeof raw.title !== "string" ||
      typeof raw.titleUrl !== "string" ||
      typeof raw.time !== "string"
    ) {
      result.failed++;
      continue;
    }
    let url: URL;
    try {
      url = new URL(raw.titleUrl);
    } catch {
      result.failed++;
      continue;
    }
    if (
      !["www.youtube.com", "youtube.com", "music.youtube.com"].includes(
        url.hostname,
      ) ||
      url.protocol !== "https:" ||
      url.pathname !== "/watch" ||
      !/^[\w-]{11}$/.test(url.searchParams.get("v") || "") ||
      !/^(Watched |已觀看\s*|觀看了\s*|시청한 동영상[:：]?\s*)/.test(
        raw.title,
      ) ||
      (Array.isArray(raw.details) &&
        raw.details.some((d: { name?: string }) =>
          /ads|廣告/i.test(typeof d === "string" ? d : d?.name || ""),
        ))
    ) {
      result.skipped++;
      continue;
    }
    const at = Date.parse(raw.time);
    if (
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(
        raw.time,
      ) ||
      !Number.isSafeInteger(at) ||
      at <= 0 ||
      at > Date.now() + 86400000
    ) {
      result.failed++;
      continue;
    }
    if (
      new Date(Date.parse(raw.time.slice(0, 19) + "Z"))
        .toISOString()
        .slice(0, 19) !== raw.time.slice(0, 19)
    ) {
      result.failed++;
      continue;
    }
    const key = JSON.stringify([
      "youtube-takeout",
      url.searchParams.get("v"),
      at,
    ]);
    if (seen.has(key)) {
      result.duplicate++;
      continue;
    }
    seen.add(key);
    const title = raw.title
      .replace(/^(Watched |已觀看\s*|觀看了\s*|시청한 동영상[:：]?\s*)/, "")
      .trim();
    if (!title) {
      result.failed++;
      continue;
    }
    const artist =
      Array.isArray(raw.subtitles) && typeof raw.subtitles[0]?.name === "string"
        ? raw.subtitles[0].name.replace(/ - Topic$/, "").trim()
        : "";
    const matches = state.songs.filter(
      (s) =>
        normalize(s.title) === normalize(title) &&
        normalize(s.artist) === normalize(artist) &&
        s.version === "原版",
    );
    result.rows.push({
      key,
      title,
      artist,
      at,
      songId: matches.length === 1 ? matches[0].id : "",
      music: url.hostname === "music.youtube.com",
    });
  }
  return result;
}
export function importTakeout(
  state: State,
  preview: Preview,
  selections: Record<string, string>,
): { state: State; success: number; duplicate: number; skipped: number } {
  const next = structuredClone(state),
    seen = new Set([
      ...next.ignoredKeys,
      ...next.plays.map((p) => p.externalKey),
    ]);
  let success = 0,
    duplicate = preview.duplicate,
    skipped = preview.skipped;
  for (const row of preview.rows) {
    const songId = selections[row.key];
    if (!songId || !next.songs.some((s) => s.id === songId)) {
      skipped++;
      continue;
    }
    if (seen.has(row.key)) {
      duplicate++;
      continue;
    }
    next.plays.push({
      id: crypto.randomUUID(),
      songId,
      platformId: "youtube",
      source: "import",
      at: row.at,
      createdAt: Date.now(),
      externalKey: row.key,
      batchId: preview.batchId,
    });
    seen.add(row.key);
    success++;
  }
  return { state: next, success, duplicate, skipped };
}
