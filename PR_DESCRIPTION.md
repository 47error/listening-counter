Listening Counter 提供繁體中文的個人粉絲聆聽手帳，使用 React、TypeScript、Vite、Tailwind CSS 與 IndexedDB。新增歌曲、手動計數、時間軸、Last.fm 官方 API 匯入與去重、PLAVE 分類、統計、目標進度及 JSON 備份還原的程式碼已建立。

此 PR 是尚未完成正式驗收的開發版本，應以 Draft 建立；尚未部署，請勿把合併視為正式驗收通過。

- 個人聆聽資料留在瀏覽器，不預設公開。
- Last.fm 金鑰僅由 Netlify Functions 讀取 `LASTFM_API_KEY`，不放進前端或 GitHub。
- 不需要 Spotify 密碼，不使用 Spotify 非官方 API；計數不代表官方有效串流。
- README 包含 Android 手機使用 GitHub／Netlify 的部署說明，VERIFICATION.md 記錄檢查結果及限制。

驗證狀態：

- 通過：28 項離線核心／代理模擬測試；JSON 設定、相對路徑與離線測試檔語法檢查。
- 未完成：6 項 IndexedDB／分頁鎖套件測試（`vitest` 尚未安裝）。
- 未完成：TypeScript 型別檢查及正式版 Vite 建置（`tsc` 尚未安裝）。
- 未完成：Android RWD、瀏覽器互動、真實 IndexedDB 持久化與備份下載還原驗收。
- 未完成：真實 Last.fm API、GitHub Actions 及 Netlify 部署驗證。
- 原因：開發環境無法連接 `proxy:8080`，套件安裝未完成；沒有 node_modules、package-lock.json 或 dist。依使用者指示未再次嘗試 npm install。

網路可用後，需依序完成套件安裝、核心測試、資料層測試、型別檢查、正式建置與手機驗收，並提交產生的 package-lock.json。
