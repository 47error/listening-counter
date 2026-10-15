import { useState } from "react";
import {
  mergeSongs,
  platformName,
  removePlay,
  playConfirmation,
  setPlatform,
  suspectedDuplicates,
  type State,
} from "./domain";
import { importTakeout, previewTakeout, type Preview } from "./takeout";
type Props = {
  state: State;
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  commit: (s: State) => Promise<void>;
  notify: (s: string, bad?: boolean) => void;
};
export function PlatformManager({ state, busy, run, commit }: Props) {
  const [name, setName] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  return (
    <>
      <section className="panel full-width">
        <h2>自訂平台管理</h2>
        <p className="hint">封存平台會保留所有紀錄與統計，可隨時恢復。</p>
        <form
          className="settings-actions"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await commit(setPlatform(state, name));
              setName("");
            });
          }}
        >
          <label className="field">
            新平台名稱
            <input
              required
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            新增平台
          </button>
        </form>
        {state.platforms
          .filter((p) => p.custom)
          .map((p) => (
            <div className="platform-row" key={p.id}>
              <span>
                {p.name}
                {p.archived ? "（已封存）" : ""} ·{" "}
                {state.plays.filter((x) => x.platformId === p.id).length} 次
              </span>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  const n = prompt("重新命名平台", p.name);
                  if (n !== null)
                    void run(async () => commit(setPlatform(state, n, p.id)));
                }}
              >
                重新命名
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      p.archived
                        ? "恢復此平台？"
                        : "封存此平台？相關紀錄全部保留，封存後不再提供新增計數。",
                    )
                  )
                    void run(async () =>
                      commit({
                        ...state,
                        platforms: state.platforms.map((x) =>
                          x.id === p.id ? { ...x, archived: !x.archived } : x,
                        ),
                      }),
                    );
                }}
              >
                {p.archived ? "恢復" : "封存"}
              </button>
            </div>
          ))}
      </section>
      <section className="panel full-width">
        <h2>歌曲合併</h2>
        <p className="hint">
          先備份再合併。保留每筆來源與時間、原始同步識別鍵；採用保留歌曲的資料與目標。Remix、Live、Instrumental
          預設不自動合併，請仔細核對版本。
        </p>
        <div className="form-two">
          <label className="field">
            合併此歌曲
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">選擇歌曲</option>
              {state.songs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} · {s.artist} · {s.version} · {s.album}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            保留此歌曲
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">選擇歌曲</option>
              {state.songs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} · {s.artist} · {s.version} · {s.album}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="secondary"
          disabled={busy || !from || !to || from === to}
          onClick={() => {
            const a = state.songs.find((s) => s.id === from)!,
              b = state.songs.find((s) => s.id === to)!;
            if (
              confirm(
                `確認將「${a.title}／${a.artist}／${a.version}」合併至「${b.title}／${b.artist}／${b.version}」？即使版本不同也合併。紀錄全部保留，目標採用 ${b.goal} 次。`,
              )
            )
              void run(async () => {
                await commit(mergeSongs(state, from, to));
                setFrom("");
                setTo("");
              });
          }}
        >
          確認歌曲與版本後合併
        </button>
      </section>
    </>
  );
}
export function DuplicateReview({ state, busy, run, commit }: Props) {
  const pairs = suspectedDuplicates(state);
  return (
    <section className="panel">
      <h2>疑似重複紀錄檢視</h2>
      <p className="hint">
        同一歌曲、兩分鐘內的不同來源或平台紀錄，最多顯示 100
        組。僅提示，保留或刪除由你決定。
      </p>
      {pairs.length === 0 && <p className="hint">目前沒有符合條件的紀錄。</p>}
      {pairs.map(([a, b]) => (
        <div className="duplicate-pair" key={`${a.id}-${b.id}`}>
          <strong>{state.songs.find((s) => s.id === a.songId)?.title}</strong>
          {[a, b].map((p) => (
            <div className="platform-row" key={p.id}>
              <span>
                {new Date(p.at).toLocaleString("zh-TW")} ·{" "}
                {platformName(state, p.platformId)} · {p.source}
              </span>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      `確認只刪除此筆？\n${playConfirmation(state, p)}\n將移至已刪除紀錄，可自行恢復；不刪除歌曲或其他紀錄。`,
                    )
                  )
                    void run(async () => commit(removePlay(state, p.id)));
                }}
              >
                刪除此筆
              </button>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
export function TakeoutImporter({ state, busy, run, commit, notify }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null),
    [selected, setSelected] = useState<Record<string, string>>({}),
    [mapped, setMapped] = useState<Record<string, string>>({}),
    [limit, setLimit] = useState(50),
    [result, setResult] = useState("");
  return (
    <section className="panel">
      <h2>YouTube Music 本機匯入</h2>
      <p className="hint">
        在 Google Takeout 選「YouTube 和 YouTube Music」→「紀錄」，格式選
        JSON。解壓縮後選 watch-history.json（上限 50
        MB）。檔案只在此瀏覽器解析，不會上傳。
      </p>
      <p className="hint">
        觀看紀錄無法證明有效播放時長；頻道也不一定是歌手。所有候選都需逐筆核對歌名、歌手、版本及是否確實聆聽。一般
        YouTube 事件須額外確認屬於 YouTube
        Music；不確定請略過。HTML、多語系未知事件、廣告、搜尋及無效時間不會自動計入。這不是官方有效串流統計。
      </p>
      <a
        className="inline-link"
        href="https://takeout.google.com/"
        target="_blank"
        rel="noreferrer"
      >
        開啟 Google Takeout
      </a>
      <label className="field">
        選擇 JSON 紀錄
        <input
          type="file"
          accept=".json,.html,application/json,text/html"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setPreview(null);
            setSelected({});
            setMapped({});
            setResult("");
            void run(async () => {
              if (file.size > 50 * 1024 * 1024)
                throw new Error("檔案上限為 50 MB。");
              setPreview(await previewTakeout(await file.text(), state));
              setLimit(50);
            });
          }}
        />
      </label>
      {result && (
        <p role="status" className="notice">
          {result}
        </p>
      )}
      {preview && (
        <>
          <h3>匯入預覽</h3>
          <p className="hint">
            總數 {preview.total} · 待確認 {preview.rows.length} · 失敗{" "}
            {preview.failed} · 重複 {preview.duplicate} · 略過 {preview.skipped}{" "}
            · 已確認 {Object.values(selected).filter(Boolean).length}
          </p>
          {preview.rows.slice(0, limit).map((row) => (
            <div className="import-row" key={row.key}>
              <strong>{row.title}</strong>
              <p className="hint">
                頻道提示：{row.artist || "未知"} ·{" "}
                {new Date(row.at).toLocaleString("zh-TW")} ·{" "}
                {row.music ? "Music 網址" : "一般 YouTube 網址，來源待確認"}
              </p>
              <label className="field">
                對應歌曲（請核對版本）
                <select
                  value={mapped[row.key] ?? row.songId}
                  disabled={busy}
                  onChange={(e) => {
                    setMapped({ ...mapped, [row.key]: e.target.value });
                    setSelected({ ...selected, [row.key]: "" });
                  }}
                >
                  <option value="">略過／尚未找到（可先在我的歌曲新增）</option>
                  {state.songs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title} · {s.artist} · {s.version} · {s.album}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check-filter">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={!!selected[row.key]}
                  onChange={(e) => {
                    const element = e.target
                      .closest(".import-row")
                      ?.querySelector("select") as HTMLSelectElement;
                    const id = element?.value;
                    if (e.target.checked && !id) {
                      notify("請先選擇正確歌曲。", true);
                      return;
                    }
                    setSelected({
                      ...selected,
                      [row.key]: e.target.checked ? id : "",
                    });
                  }}
                />
                我確認此事件是 YouTube Music 聆聽，且歌曲版本正確
              </label>
            </div>
          ))}
          {preview.rows.length > limit && (
            <button className="secondary" onClick={() => setLimit(limit + 50)}>
              顯示更多候選
            </button>
          )}
          <div className="settings-actions">
            <button
              className="primary"
              disabled={busy || !Object.values(selected).some(Boolean)}
              onClick={() => {
                if (
                  confirm(
                    "將已逐筆確認的事件計入 YouTube Music？未確認項目會略過。",
                  )
                )
                  void run(async () => {
                    const r = importTakeout(state, preview, selected);
                    await commit(r.state);
                    setResult(
                      `成功 ${r.success} · 失敗 ${preview.failed} · 重複 ${r.duplicate} · 略過 ${r.skipped}`,
                    );
                    setPreview(null);
                    setSelected({});
                  });
              }}
            >
              確認匯入
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              取消預覽
            </button>
          </div>
        </>
      )}
    </section>
  );
}
