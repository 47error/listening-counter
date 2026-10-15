# v2 實際驗證結果

2026-10-15，Node 24.19.0、Linux（CI 設定使用 Node 22） 開發環境，於 `feat/multi-platform-listening` 分支實際執行：

| 指令 | 結果 |
| --- | --- |
| `npm run typecheck` | 通過，TypeScript 無錯誤 |
| `npm test` | 28／28 通過，保留既有離線領域／Last.fm 同步／Function 測試 |
| `npm run test:db` | 22／22 通過（原有 6 項＋多平台及診斷 16 項），使用 fake-indexeddb 實際讀寫 IndexedDB API |
| `npm run build` | 通過，Vite 正式產物成功產生 |
| `npm run test:e2e` | 10／10 通過，Chromium，393px 與 360px 手機視窗各 5 個操作流程 |
| `git diff --check` | 通過 |

資料層覆蓋：v1 真實資料庫快照遷移及重入、ID／歌曲目標／游標／次數保留、Last.fm 增量去重與刪除防回流、Spotify／Melon 手動批次分開、篩選不改資料、Takeout 預覽及人工確認、重複檔案／不同排版去重、無效檔案、版本不自動合併、明確合併後來源與同步鍵保留、自訂平台名稱驗證／改名／封存、新舊備份往返、無效備份拒絕、疑似重複只提示。

瀏覽器覆蓋：新增歌曲、指定平台 +1、批次新增確認、平台篩選後直接比對 IndexedDB 快照未變、自訂平台新增／改名／封存、JSON 備份下載、Takeout 預填歌曲仍不得直接匯入、選歌仍需勾選、確認後結果、重匯去重、錯誤 JSON 不寫入、頁面無水平溢出。第一個流程監控 pageerror 並確認無錯誤。

曾遇到測試定位同時匹配兩個 status 元素的失敗，已將結果定位限定為匯入結果，之後兩種手機視窗全部通過。

未宣稱已驗證的項目：實體 Android Chrome、使用者私人 Takeout 檔案、已部署網站及真實 Last.fm 帳號／API（同步與 Function 使用模擬回應）。沒有更改正式部署或執行資料清除。CI 已加入同樣測試，但遠端執行狀態需另看 PR checks。

顯示 0 修復驗證：合成 21 首／54 筆 v1 快照（53 Last.fm＋1 手動）可直接載入，原快照未改；切到不同 origin 顯示 0，返回原 origin 仍為 21／54；安全補入保留現有歌曲，重複補入新增 0／0；損壞快照拒絕載入且不變；過期空快照寫入被中止。詳見 [ZERO_DATA_DIAGNOSIS.md](ZERO_DATA_DIAGNOSIS.md)。
