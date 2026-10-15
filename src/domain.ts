export interface Song {
  id: string;
  title: string;
  artist: string;
  album: string;
  version: string;
  cover: string;
  goal: number;
  isPlave: boolean;
  originKey?: string;
  originKeys?: string[];
}
export interface Play {
  id: string;
  songId: string;
  at: number;
  platformId: string;
  createdAt: number;
  creationTimeInferred?: boolean;
  batchId?: string;
  source: "manual" | "lastfm" | "import";
  externalKey?: string;
  account?: string;
}
export interface Cursor {
  user: string;
  from: number;
  to: number;
  page: number;
}
export interface State {
  schemaVersion: 2;
  platforms: Platform[];
  ignoredKeys: string[];
  songs: Song[];
  plays: Play[];
  username: string;
  watermarks: Record<string, number>;
  cursor?: Cursor;
}
export interface Platform {
  id: string;
  name: string;
  custom?: boolean;
  archived?: boolean;
}
export const defaultPlatforms = (): Platform[] => [
  { id: "spotify", name: "Spotify" },
  { id: "melon", name: "Melon" },
  { id: "youtube", name: "YouTube Music" },
  { id: "other", name: "其他" },
  { id: "unknown", name: "Last.fm／來源未確認" },
];
export const emptyState = (): State => ({
  schemaVersion: 2,
  platforms: defaultPlatforms(),
  ignoredKeys: [],
  songs: [],
  plays: [],
  username: "",
  watermarks: {},
});
export const normalize = (s: string) =>
  s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
export const watermarkFor = (state: State, user: string): number =>
  Object.hasOwn(state.watermarks, normalize(user))
    ? state.watermarks[normalize(user)]
    : 0;
export const isPlaveArtist = (s: string) =>
  /(^|[^a-z])plave([^a-z]|$)|플레이브/i.test(s.normalize("NFKC"));
export const safeCover = (s: string) => {
  try {
    return new URL(s).protocol === "https:" ? s : "";
  } catch {
    return "";
  }
};
export interface Track {
  name: string;
  artist: { "#text": string };
  album?: { "#text": string };
  image?: { "#text": string; size?: string }[];
  date?: { uts: string };
  "@attr"?: { nowplaying?: string };
}
export function mergeTracks(
  state: State,
  tracks: Track[],
  user: string,
): State {
  const next = structuredClone(state);
  const seen = new Set([
    ...next.ignoredKeys,
    ...next.plays.map((p) => p.externalKey).filter(Boolean),
  ]);
  const songs = new Map(
    next.songs.flatMap((s) =>
      [...(s.originKeys || []), ...(s.originKey ? [s.originKey] : [])].map(
        (k) => [k, s] as const,
      ),
    ),
  );
  for (const t of tracks) {
    const at = Number(t.date?.uts) * 1000;
    if (
      t["@attr"]?.nowplaying === "true" ||
      !Number.isSafeInteger(at) ||
      at <= 0 ||
      at > 8640000000000000 ||
      !t.name ||
      !t.artist?.["#text"]
    )
      continue;
    const artist = t.artist["#text"],
      album = t.album?.["#text"] || "";
    const originKey = JSON.stringify([
      normalize(artist),
      normalize(t.name),
      normalize(album),
    ]);
    const externalKey = JSON.stringify([
      "lastfm",
      normalize(user),
      at,
      originKey,
    ]);
    if (seen.has(externalKey)) continue;
    let song =
      songs.get(originKey) ||
      next.songs.find(
        (s) =>
          !s.originKey &&
          normalize(s.artist) === normalize(artist) &&
          normalize(s.title) === normalize(t.name) &&
          normalize(s.album) === normalize(album) &&
          s.version ===
            (/live|remix|instrumental|acoustic|ver\./i.test(t.name)
              ? "其他版本"
              : "原版"),
      );
    if (!song) {
      song = {
        id: crypto.randomUUID(),
        title: t.name,
        artist,
        album,
        version: /live|remix|instrumental|acoustic|ver\./i.test(t.name)
          ? "其他版本"
          : "原版",
        cover: safeCover(t.image?.at(-1)?.["#text"] || ""),
        goal: 100,
        isPlave: isPlaveArtist(artist),
        originKey,
      };
      next.songs.push(song);
    } else if (!song.originKey) song.originKey = originKey;
    songs.set(originKey, song);
    next.plays.push({
      id: crypto.randomUUID(),
      songId: song.id,
      at,
      createdAt: Date.now(),
      platformId: "unknown",
      source: "lastfm",
      externalKey,
      account: normalize(user),
    });
    seen.add(externalKey);
  }
  return next;
}
export type Period = "day" | "week" | "month" | "all";
export function periodStart(period: Period, now = new Date()): number {
  if (period === "all") return 0;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (period === "month") d.setDate(1);
  return d.getTime();
}
export function validateBackup(input: unknown): State {
  const fail = (): never => {
    throw new Error("備份格式不正確或版本不支援，原有資料未變更。");
  };
  if (!input || typeof input !== "object") return fail();
  const raw = structuredClone(input) as Omit<State, "schemaVersion"> & {
    schemaVersion: number;
  };
  const legacy = raw.schemaVersion === 1;
  if (legacy) {
    raw.schemaVersion = 2;
    raw.platforms = defaultPlatforms();
    raw.ignoredKeys = [];
    if (Array.isArray(raw.plays))
      raw.plays = raw.plays.map((p) => ({
        ...p,
        platformId: "unknown",
        createdAt: p?.at,
        creationTimeInferred: true,
      }));
  }
  const s = raw;
  if (
    s.schemaVersion !== 2 ||
    !Array.isArray(s.songs) ||
    !Array.isArray(s.plays) ||
    typeof s.username !== "string" ||
    !s.watermarks ||
    typeof s.watermarks !== "object" ||
    Array.isArray(s.watermarks)
  )
    return fail();
  const str = (v: unknown) => typeof v === "string";
  if (
    !Array.isArray(s.platforms) ||
    !Array.isArray(s.ignoredKeys) ||
    s.ignoredKeys.some((k) => !str(k) || !k)
  )
    return fail();
  const platformIds = new Set<string>(),
    names = new Set<string>();
  for (const p of s.platforms) {
    if (
      !p ||
      !str(p.id) ||
      !p.id ||
      platformIds.has(p.id) ||
      !str(p.name) ||
      !p.name.trim() ||
      p.name.length > 60 ||
      names.has(normalize(p.name)) ||
      (p.custom !== undefined && typeof p.custom !== "boolean") ||
      (p.archived !== undefined && typeof p.archived !== "boolean")
    )
      return fail();
    platformIds.add(p.id);
    names.add(normalize(p.name));
  }
  for (const p of defaultPlatforms())
    if (
      !s.platforms.some(
        (x) => x.id === p.id && !x.custom && !x.archived && x.name === p.name,
      )
    )
      return fail();
  const ids = new Set<string>(),
    plays = new Set<string>(),
    keys = new Set<string>();
  for (const song of s.songs) {
    if (
      !song ||
      !str(song.id) ||
      !song.id ||
      ids.has(song.id) ||
      !str(song.title) ||
      !song.title.trim() ||
      !str(song.artist) ||
      !song.artist.trim() ||
      !str(song.album) ||
      !str(song.version) ||
      !str(song.cover) ||
      !Number.isSafeInteger(song.goal) ||
      song.goal < 0 ||
      typeof song.isPlave !== "boolean" ||
      (song.originKey !== undefined && !str(song.originKey))
    )
      return fail();
    if (
      song.originKeys !== undefined &&
      (!Array.isArray(song.originKeys) || song.originKeys.some((k) => !str(k)))
    )
      return fail();
    ids.add(song.id);
    song.cover = safeCover(song.cover);
  }
  for (const p of s.plays) {
    if (
      !p ||
      !str(p.id) ||
      !p.id ||
      plays.has(p.id) ||
      !ids.has(p.songId) ||
      !Number.isSafeInteger(p.at) ||
      p.at <= 0 ||
      p.at > 8640000000000000 ||
      !["manual", "lastfm", "import"].includes(p.source) ||
      !platformIds.has(p.platformId) ||
      (p.creationTimeInferred !== undefined &&
        typeof p.creationTimeInferred !== "boolean") ||
      !Number.isSafeInteger(p.createdAt) ||
      p.createdAt <= 0 ||
      p.createdAt > 8640000000000000 ||
      (p.batchId !== undefined && (!str(p.batchId) || !p.batchId))
    )
      return fail();
    if (
      p.source === "import" &&
      (!str(p.externalKey) || !p.externalKey || !str(p.batchId) || !p.batchId)
    )
      return fail();
    if (
      p.source === "lastfm" &&
      (!str(p.externalKey) || !p.externalKey || !str(p.account))
    )
      return fail();
    if (
      p.externalKey !== undefined &&
      (!str(p.externalKey) || !p.externalKey || keys.has(p.externalKey))
    )
      return fail();
    plays.add(p.id);
    if (p.externalKey) keys.add(p.externalKey);
  }
  if (
    Object.values(s.watermarks).some((v) => !Number.isSafeInteger(v) || v < 0)
  )
    return fail();
  // 分頁游標不從備份還原，重新掃描並透過事件鍵去重。
  return {
    schemaVersion: 2,
    platforms: s.platforms,
    ignoredKeys: [...new Set(s.ignoredKeys)],
    songs: s.songs,
    plays: s.plays,
    username: s.username,
    watermarks: s.watermarks,
  };
}

export function migrateState(input: unknown): State {
  const state = validateBackup(input);
  const cursor = (input as State).cursor;
  if (cursor !== undefined) {
    if (
      !cursor ||
      typeof cursor.user !== "string" ||
      ![cursor.from, cursor.to, cursor.page].every(Number.isSafeInteger) ||
      cursor.from < 0 ||
      cursor.to < cursor.from ||
      cursor.page < 1
    )
      throw new Error("同步游標無效，資料未變更。");
    state.cursor = structuredClone(cursor);
  }
  return state;
}
export function platformName(state: State, id: string) {
  return state.platforms.find((p) => p.id === id)?.name || "來源未確認";
}
export function filterPlays(state: State, platform = "all", start = 0) {
  return state.plays.filter(
    (p) =>
      p.at >= start &&
      (platform === "all" ||
        p.platformId === platform ||
        (platform === "other" &&
          state.platforms.some((x) => x.id === p.platformId && x.custom))),
  );
}
export function manualPlays(
  state: State,
  songId: string,
  platformId: string,
  at: number,
  count: number,
): State {
  if (
    !state.songs.some((s) => s.id === songId) ||
    !state.platforms.some((p) => p.id === platformId && !p.archived) ||
    !Number.isSafeInteger(at) ||
    at <= 0 ||
    at > 8640000000000000 ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 10000
  )
    throw new Error("請檢查歌曲、平台、日期及次數（1–10,000）。");
  const createdAt = Date.now(),
    batchId = crypto.randomUUID();
  return {
    ...state,
    plays: [
      ...state.plays,
      ...Array.from({ length: count }, () => ({
        id: crypto.randomUUID(),
        songId,
        platformId,
        at,
        createdAt,
        source: "manual" as const,
        batchId,
      })),
    ],
  };
}
export function setPlatform(state: State, name: string, id?: string): State {
  name = name.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (
    !name ||
    name.length > 60 ||
    /[\u0000-\u001f\u007f]/.test(name) ||
    state.platforms.some(
      (p) => p.id !== id && normalize(p.name) === normalize(name),
    )
  )
    throw new Error("平台名稱不可空白、重複或超過 60 字。");
  if (id && !state.platforms.some((p) => p.id === id && p.custom))
    throw new Error("只能重新命名自訂平台。");
  return {
    ...state,
    platforms: id
      ? state.platforms.map((p) => (p.id === id ? { ...p, name } : p))
      : [...state.platforms, { id: crypto.randomUUID(), name, custom: true }],
  };
}
export function removePlay(state: State, id: string): State {
  const p = state.plays.find((p) => p.id === id);
  return {
    ...state,
    plays: state.plays.filter((p) => p.id !== id),
    ignoredKeys: [
      ...new Set([
        ...state.ignoredKeys,
        ...(p?.externalKey ? [p.externalKey] : []),
      ]),
    ],
  };
}
export function mergeSongs(state: State, from: string, to: string): State {
  const a = state.songs.find((s) => s.id === from),
    b = state.songs.find((s) => s.id === to);
  if (!a || !b || from === to) throw new Error("請選擇兩首不同歌曲。");
  return {
    ...state,
    songs: state.songs
      .filter((s) => s.id !== from)
      .map((s) =>
        s.id === to
          ? {
              ...s,
              originKeys: [
                ...new Set([
                  ...(s.originKeys || []),
                  ...(a.originKeys || []),
                  ...[a.originKey, s.originKey].filter((k): k is string => !!k),
                ]),
              ],
            }
          : s,
      ),
    plays: state.plays.map((p) =>
      p.songId === from ? { ...p, songId: to } : p,
    ),
  };
}
export function suspectedDuplicates(state: State) {
  // Compare only distinct source/platform groups for the same song. Large manual batches
  // in a single group should not trigger a quadratic scan.
  const songs = new Map<string, Map<string, Play[]>>();
  for (const play of state.plays) {
    const groups = songs.get(play.songId) || new Map<string, Play[]>();
    const key = JSON.stringify([play.platformId, play.source]);
    const group = groups.get(key) || [];
    group.push(play);
    groups.set(key, group);
    songs.set(play.songId, groups);
  }
  const pairs: [Play, Play][] = [];
  for (const groups of songs.values()) {
    const lists = [...groups.values()].map((g) =>
      g.sort((a, b) => a.at - b.at),
    );
    for (let i = 0; i < lists.length; i++)
      for (let j = i + 1; j < lists.length; j++) {
        let start = 0;
        for (const a of lists[i]) {
          while (start < lists[j].length && lists[j][start].at < a.at - 120000)
            start++;
          for (
            let k = start;
            k < lists[j].length && lists[j][k].at <= a.at + 120000;
            k++
          ) {
            pairs.push([a, lists[j][k]]);
            if (pairs.length >= 100) return pairs;
          }
        }
      }
  }
  return pairs;
}
