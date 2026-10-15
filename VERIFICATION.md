# 檢查報告

本次保留 `/workspace/listening-counter` 既有專案，沒有重新建立專案、刪除功能或重新安裝套件。

## 環境與網路

- Node.js：v24.19.0；npm：11.9.0。
- 既有程式檔案仍在；專案入口、資料層、介面、同步與 Netlify Function 均已確認。
- `node_modules`：不存在。
- `package-lock.json`：不存在；尚未完成第一次套件安裝。
- 沒有殘留的 npm 安裝程序。
- 使用 `timeout 12s curl --head --silent --show-error --connect-timeout 3 --max-time 8 --retry 0 https://registry.npmjs.org/react`。
- 結果：退出碼 7，`Failed to connect to proxy port 8080`，立即結束。
- 因代理失敗，依指示停止安裝，不再重試連線。這是目前執行環境的連線問題，尚無證據顯示 npm registry 本身故障。

## 通過的檢查

`timeout 30s npm test`：**28 項通過，0 項失敗**，不到 1 秒結束。測試不使用外部網路、付費 API 或真實金鑰。

覆蓋範圍：

- Unicode／名稱正規化與 PLAVE 英韓文辨識。
- HTTPS 封面網址限制。
- 同事件去重，不同時間、不同曲目、不同帳號保留。
- 原版與 Live 標題分類、手動分類修正保留。
- 跳過正在播放、缺少時間與非法時間。
- 手動與 Last.fm 來源獨立保留。
- 本機日／週／月起算時間。
- JSON 備份往返驗證、錯誤格式／版本／重複鍵／孤立事件拒絕還原。
- 首次分頁、固定時間上限、10 頁批次上限與續傳。
- 48 小時重查、同步完成時間只在全部成功後更新。
- 第一頁、後續頁、寫入失敗時原始快照保留；已儲存頁保留續傳位置。
- 空歷史與異常回應處理。
- Netlify Function 方法／參數驗證、缺少金鑰、固定官方端點、no-store、上游錯誤與連線例外。

補充檢查也通過：

- 兩份離線 `.mjs` 測試／載入檔的 `node --check` 語法檢查。
- 19 份必要程式、設定、測試及說明檔存在且非空。
- `package.json`、`tsconfig.json` 可解析。
- 前端相對路徑 import 可找到對應檔案。
- `.env.example` 的 API Key 為空白範例；前端沒有硬編碼 Last.fm 金鑰。

離線測試器只移除 TypeScript 型別後執行邏輯，**不提供型別檢查，也不處理 TSX 畫面編譯**。上游成功／錯誤／連線例外使用 mock 模擬，未連接真實 Last.fm，亦未等待真實逾時。

## 發現並修正的問題

先執行回歸測試，得到 25 通過、3 失敗，針對失敗進行小範圍修正後，28 項全部通過：

1. 匯入時間戳可能超出 JavaScript 日期範圍：現在跳過，避免時間軸日期格式化失敗。
2. 備份驗證會直接更動傳入的封面網址：現在先複製，不修改原始物件。
3. `constructor`／`__proto__` 等使用者名稱會讀到物件繼承屬性：改為只讀自身屬性，並安全更新同步時間。

另修正一個無效的手機 CSS 屬性 `inset-right` 為 `right`；其實際視覺效果尚未由瀏覽器驗證。

## 尚未通過／無法執行

以下命令均設 15 秒總上限並快速結束，沒有長時間等待：

| 命令／項目 | 本次結果 | 原因 |
| --- | --- | --- |
| `npm run typecheck` | 退出碼 127，未完成 | `tsc: not found`，套件未安裝 |
| `npm run test:db` | 退出碼 127，未完成 | `vitest: not found`；6 項測試已撰寫，未執行 |
| `npm run build` | 退出碼 127，未完成 | 前置 typecheck 找不到 tsc，尚未執行 Vite |
| React／Tailwind／TSX 瀏覽器驗證 | 未執行 | 沒有建置套件與可用成品 |
| IndexedDB 真實瀏覽器持久化、Web Locks | 未驗證 | 離線核心測試未涵蓋瀏覽器儲存 |
| Android RWD、互動、備份下載還原 | 未驗證 | 尚未有可執行網站驗收 |
| 真實 Last.fm 匯入／限流／逾時 | 未驗證 | 無網路、未設定 API Key |
| GitHub Actions、Netlify 實際部署 | 未執行 | 尚未推送／連接 GitHub 或 Netlify |

因此沒有 `dist` 成品，也沒有已部署的公開網址。不能聲稱目前版本已完成正式驗收。

## GitHub 狀態與下一步

**可以將目前原始碼提交到 GitHub 作為開發版本。** 原始碼不依賴 node_modules 才能提交，但不代表已可正式發布。本次沒有建立 GitHub 遠端儲存庫，也沒有代為推送。

- 專案已包含 `.gitignore`、CI、Netlify 設定、28 項離線測試與另外 6 項待跑測試。
- 原本 CI 直接使用 `npm ci`，在尚無 lock 檔時一定失敗；已改成檢查 lock 檔是否存在，選擇 ci 或 install，且移除依賴 lock 檔的快取設定。
- CI 安裝最多 120 秒、每次請求 15 秒、最多一次重試，整個 job 最多 10 分鐘。其他檢查也有時間上限。
- 在網路正常環境完成第一次安裝後，提交產生的 `package-lock.json`，讓日後版本可重現。
- 下一個驗收順序：套件安裝 → `npm test` → `npm run test:db` → `npm run typecheck` → `npm run build` → Netlify 部署與手機驗收。
- Last.fm 僅需在 Netlify 設定 `LASTFM_API_KEY`；不需 Shared Secret 或 Spotify 密碼。

Android 使用 GitHub／Netlify 的完整步驟請見 [README.md](README.md)。
