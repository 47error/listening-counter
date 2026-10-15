// Synthetic fixture matching reported counts, never a user's private backup.
export function v1Fixture() {
  const songs = Array.from({ length: 21 }, (_, i) => ({
    id: `song-${i}`,
    title: `測試歌曲 ${i}`,
    artist: "PLAVE",
    album: "合成專輯",
    version: i === 1 ? "Live" : "原版",
    cover: "",
    goal: 100 + i,
    isPlave: true,
  }));
  const plays = Array.from({ length: 54 }, (_, i) => {
    const songId = songs[i % 21].id,
      at = 1700000000000 + i * 1000;
    return i === 53
      ? { id: `play-${i}`, songId, at, source: "manual" as const }
      : {
          id: `play-${i}`,
          songId,
          at,
          source: "lastfm" as const,
          externalKey: JSON.stringify(["lastfm", "synthetic", at, songId]),
          account: "synthetic",
        };
  });
  return {
    schemaVersion: 1,
    songs,
    plays,
    username: "synthetic",
    watermarks: { synthetic: 1700001000 },
    cursor: { user: "synthetic", from: 0, to: 1700001000, page: 2 },
  };
}
