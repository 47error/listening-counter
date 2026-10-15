import { useEffect, useRef, useState } from "react";
import {
  platformName,
  playConfirmation,
  playSourceLabel,
  removePlay,
  restorePlay,
  type Play,
  type Song,
  type State,
} from "./domain";
type Props = {
  state: State;
  songId: string | null;
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  commit: (state: State) => Promise<void>;
  notify: (message: string) => void;
};
export function RecordManager({
  state,
  songId,
  busy,
  run,
  commit,
  notify,
}: Props) {
  const [selectedSong, setSelectedSong] = useState(songId || ""),
    [deleted, setDeleted] = useState(false),
    [limit, setLimit] = useState(50);
  const [pending, setPending] = useState<{
    kind: "delete" | "restore";
    play: Play;
    song: Song;
  } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    setSelectedSong(songId || "");
    setLimit(50);
  }, [songId]);
  useEffect(() => {
    const el = dialog.current;
    if (pending) el?.showModal();
    else el?.close();
    return () => el?.close();
  }, [pending]);
  const songOptions = new Map(state.songs.map((s) => [s.id, s]));
  for (const entry of state.deletedPlays || [])
    if (!songOptions.has(entry.song.id))
      songOptions.set(entry.song.id, entry.song);
  const active = state.plays
    .filter((p) => !selectedSong || p.songId === selectedSong)
    .map((play) => ({
      play,
      song: state.songs.find((s) => s.id === play.songId)!,
      deletedAt: 0,
    }));
  const archived = (state.deletedPlays || []).filter(
    (e) => !selectedSong || e.play.songId === selectedSong,
  );
  const rows = [...(deleted ? archived : active)].sort(
    (a, b) => b.play.at - a.play.at || a.play.id.localeCompare(b.play.id),
  );
  return (
    <section className="panel record-manager" aria-label="單筆聆聽紀錄管理">
      <h2>單筆聆聽紀錄管理</h2>
      <p className="hint">
        逐筆核對後刪除，不會自動判定哪些是測試紀錄。此處列出所選歌曲的所有平台與時間，不受首頁篩選影響。請先下載
        JSON 備份；新備份也會保留已刪除副本。
      </p>
      <label className="field">
        查看哪首歌曲
        <select
          value={selectedSong}
          onChange={(e) => {
            setSelectedSong(e.target.value);
            setLimit(50);
          }}
        >
          <option value="">所有歌曲</option>
          {[...songOptions.values()].map((s) => (
            <option key={s.id} value={s.id}>
              {s.title} · {s.artist} · {s.version}
            </option>
          ))}
        </select>
      </label>
      <div className="settings-actions">
        <button
          className={deleted ? "secondary" : "primary"}
          onClick={() => {
            setDeleted(false);
            setLimit(50);
          }}
        >
          目前紀錄（{active.length}）
        </button>
        <button
          className={deleted ? "primary" : "secondary"}
          onClick={() => {
            setDeleted(true);
            setLimit(50);
          }}
        >
          已刪除紀錄（{archived.length}）
        </button>
      </div>
      <p className="hint">
        單筆刪除會移至已刪除紀錄，不再計入統計。Last.fm／匯入事件保留去重鍵，避免自動補回；可明確選擇恢復。不提供批次刪除或永久清除。
      </p>
      {rows.length === 0 && <p className="hint">此清單沒有紀錄。</p>}
      <div className="record-list">
        {rows.slice(0, limit).map(({ play, song, deletedAt }) => (
          <article
            className="record-row"
            key={play.id}
            data-record-id={play.id}
          >
            <h3>{song.title}</h3>
            <p>
              {song.artist} · {song.version}
            </p>
            <dl>
              <div>
                <dt>平台</dt>
                <dd>{platformName(state, play.platformId)}</dd>
              </div>
              <div>
                <dt>聆聽時間</dt>
                <dd>
                  <time dateTime={new Date(play.at).toISOString()}>
                    {new Date(play.at).toLocaleString("zh-TW", {
                      hour12: false,
                    })}
                  </time>
                  （裝置當地時間）
                </dd>
              </div>
              <div>
                <dt>來源</dt>
                <dd>{playSourceLabel(play.source)}</dd>
              </div>
              <div>
                <dt>紀錄 ID</dt>
                <dd>{play.id}</dd>
              </div>
              {deleted && (
                <div>
                  <dt>刪除時間</dt>
                  <dd>
                    {new Date(deletedAt).toLocaleString("zh-TW", {
                      hour12: false,
                    })}
                  </dd>
                </div>
              )}
            </dl>
            {deleted && !state.songs.some((s) => s.id === play.songId) && (
              <p className="hint">
                原歌曲已刪除或合併；副本保留於備份，請先核對歌曲歸屬，不會自動恢復到其他歌曲。
              </p>
            )}
            <button
              className="secondary"
              disabled={
                busy ||
                (deleted && !state.songs.some((s) => s.id === play.songId))
              }
              aria-label={`${deleted ? "恢復" : "刪除"}紀錄 ${play.id}`}
              onClick={() =>
                setPending({
                  kind: deleted ? "restore" : "delete",
                  play,
                  song: deleted
                    ? state.songs.find((s) => s.id === play.songId) || song
                    : song,
                })
              }
            >
              {deleted ? "恢復此筆" : "刪除此筆"}
            </button>
          </article>
        ))}
      </div>
      {rows.length > limit && (
        <button className="secondary" onClick={() => setLimit(limit + 50)}>
          顯示更多紀錄
        </button>
      )}
      <dialog
        ref={dialog}
        className="modal"
        aria-label={
          pending?.kind === "restore" ? "確認恢復單筆紀錄" : "確認刪除單筆紀錄"
        }
        onCancel={(e) => {
          e.preventDefault();
          if (!busy) setPending(null);
        }}
      >
        {pending && (
          <>
            <h2>
              {pending.kind === "restore"
                ? "確認恢復單筆紀錄"
                : "確認刪除單筆紀錄"}
            </h2>
            <pre className="record-confirmation">
              {playConfirmation(state, pending.play, pending.song)}
            </pre>
            <p className="hint">
              {pending.kind === "restore"
                ? "只恢復這一筆，保留原 ID、來源、平台與時間。外部紀錄恢復後仍以原識別資訊去重。"
                : "只移除上方 ID 的這一筆，不刪除歌曲或其他紀錄。紀錄會移至已刪除區，可自行恢復；同步不會自動補回。"}
            </p>
            <div className="modal-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setPending(null)}
              >
                取消
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  const action = pending;
                  setPending(null);
                  void run(async () => {
                    await commit(
                      action.kind === "restore"
                        ? restorePlay(state, action.play.id)
                        : removePlay(state, action.play.id),
                    );
                    notify(
                      action.kind === "restore"
                        ? "已恢復指定的單筆紀錄。"
                        : "已將指定的單筆紀錄移至已刪除區，可隨時恢復。",
                    );
                  });
                }}
              >
                {pending.kind === "restore"
                  ? "確認恢復這一筆"
                  : "確認刪除這一筆"}
              </button>
            </div>
          </>
        )}
      </dialog>
    </section>
  );
}
