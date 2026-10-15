import { migrateState, validateBackup, type State } from "./domain";
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
export const sameSnapshot = (a: State, b: State) =>
  canonical(a) === canonical(b);
// Build a complete plan before any write. Conflicts never overwrite existing records.
export function planRecovery(current: State, input: unknown) {
  const backup = validateBackup(input),
    next = migrateState(current);
  const fail = (kind: string): never => {
    throw new Error(
      `${kind}與現有資料衝突，未寫入任何資料。請先下載目前備份，再個別核對；不會自動覆蓋。`,
    );
  };
  for (const platform of backup.platforms) {
    const existing = next.platforms.find((p) => p.id === platform.id);
    if (existing) {
      if (canonical(existing) !== canonical(platform)) fail("平台");
    } else {
      if (
        next.platforms.some(
          (p) =>
            p.name.normalize("NFKC").trim().toLowerCase() ===
            platform.name.normalize("NFKC").trim().toLowerCase(),
        )
      )
        fail("平台名稱");
      next.platforms.push(platform);
    }
  }
  for (const song of backup.songs) {
    const existing = next.songs.find((s) => s.id === song.id);
    if (existing) {
      if (canonical(existing) !== canonical(song)) fail("歌曲");
    } else next.songs.push(song);
  }
  let duplicate = 0,
    ignored = 0;
  for (const play of backup.plays) {
    const deleted = next.deletedPlays?.find(
      (e) =>
        e.play.id === play.id ||
        (!!play.externalKey && e.play.externalKey === play.externalKey),
    );
    if (deleted) {
      if (
        deleted.play.id === play.id
          ? canonical(deleted.play) !== canonical(play)
          : ["songId", "at", "source", "platformId", "account"].some(
              (k) =>
                deleted.play[k as keyof typeof play] !==
                play[k as keyof typeof play],
            )
      )
        fail("已刪除紀錄");
      ignored++;
      continue;
    }
    const existing = next.plays.find((p) => p.id === play.id);
    if (existing) {
      if (canonical(existing) !== canonical(play)) fail("紀錄 ID");
      duplicate++;
      continue;
    }
    if (play.externalKey && next.ignoredKeys.includes(play.externalKey)) {
      ignored++;
      continue;
    }
    const external =
      play.externalKey &&
      next.plays.find((p) => p.externalKey === play.externalKey);
    if (external) {
      if (
        ["songId", "at", "source", "platformId", "account"].some(
          (k) =>
            external[k as keyof typeof external] !==
            play[k as keyof typeof play],
        )
      )
        fail("外部紀錄");
      duplicate++;
      continue;
    }
    next.plays.push(play);
  }
  next.ignoredKeys = [...new Set([...next.ignoredKeys, ...backup.ignoredKeys])];
  // A backup never deletes an existing active record or revives an archived record.
  if (backup.deletedPlays !== undefined) {
    const archived = [...(next.deletedPlays || [])];
    for (const entry of backup.deletedPlays) {
      const active = next.plays.find(
        (p) =>
          p.id === entry.play.id ||
          (!!entry.play.externalKey &&
            p.externalKey === entry.play.externalKey),
      );
      if (active) {
        if (
          active.id === entry.play.id
            ? canonical(active) !== canonical(entry.play)
            : ["songId", "at", "source", "platformId", "account"].some(
                (k) =>
                  active[k as keyof typeof active] !==
                  entry.play[k as keyof typeof active],
              )
        )
          fail("已刪除紀錄");
        continue;
      }
      const existing = archived.find(
        (e) =>
          e.play.id === entry.play.id ||
          (!!entry.play.externalKey &&
            e.play.externalKey === entry.play.externalKey),
      );
      if (existing) {
        if (canonical(existing) !== canonical(entry)) fail("已刪除紀錄");
      } else archived.push(entry);
    }
    next.deletedPlays = archived;
  }
  next.watermarks = { ...backup.watermarks, ...current.watermarks };
  if (!current.username) next.username = backup.username;
  migrateState(next); // Validate the combined graph before presenting or committing it.
  return {
    state: next,
    addedSongs: next.songs.length - current.songs.length,
    addedPlays: next.plays.length - current.plays.length,
    duplicate,
    ignored,
    archivedPlays: backup.deletedPlays?.length || 0,
    addedArchivedPlays:
      (next.deletedPlays?.length || 0) - (current.deletedPlays?.length || 0),
    backupSongs: backup.songs.length,
    backupPlays: backup.plays.length,
  };
}
