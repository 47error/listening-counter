# Android Chrome 預覽網站啟動被鎖：診斷與修復

## 已確認的程式原因

「網站已在其他分頁開啟」只在 Web Locks 的 `ifAvailable` 回呼取得 null 時產生，**不是 IndexedDB blocked 事件**。舊版在啟動讀取前取得 `listening-counter-writer`，以永不結束的 Promise 持有整個頁面生命週期，沒有 React 清理時的主動釋放。只要同 origin 仍有持鎖頁面，其他頁面連讀取都被拒絕。

這確認了回報訊息的來源及程式設計問題；未直接存取使用者 Android 裝置，不能斷言持鎖者是某個分頁、保留頁面或瀏覽器異常，也不宣稱已實體 Android 真機重現。

使用者已確認正式網址仍有 21 首歌曲；正式與 deploy-preview-2 是不同 origin，IndexedDB 與 Web Locks 都分開。正常開啟正式網站本身不會占用預覽網站的鎖。本次未修改正式資料或部署設定，PR 不合併。

## 修復

- 啟動只做 readonly 載入，不取得寫入鎖。即使舊版頁面仍長期持鎖，新版仍可讀取與下載備份。
- 每次實際寫入才取得相同名稱的獨占鎖；持鎖直到 transaction 完成，成功或失敗回呼結束即釋放，不永久等待、不強制 steal。
- 保留同一 transaction 內的預期快照比對。多頁可同時檢視；資料過期的頁面寫入被拒絕，不能覆蓋其他分頁的新資料。
- 原資料庫仍為版本 1，快照 schemaVersion 仍為 2。只有真正新建資料庫（oldVersion 0）建立 state store；既有 schema 缺失／較高版本不重建或降版。
- versionchange（idb blocking）時主動關閉本程式連線；載入／交易完成或失敗後 finally 關閉；terminated 也處理關閉。
- blocked 立即回報獨立錯誤；開啟超過 10 秒回報逾時。IndexedDB 開啟請求無原生取消方法，因此逾時／blocked 後才成功的連線會立即關閉，避免留下隱藏連線。
- 診斷不讀取或上傳私人紀錄：僅 origin、錯誤代碼／階段、安全環境與功能支援、Android／Chrome 主版本、同名寫入鎖持有／等候數量。排除帳號、歌曲、API key、raw error message 與 Web Locks clientId。診斷查詢逾時不阻擋資料讀取。

## 安全錯誤代碼

| 代碼 | 意義／安全處理 |
| --- | --- |
| LOCK_BUSY | 寫入鎖被占用，本次未寫入；仍可閱讀／下載備份，待釋放後重試。不代表一定有可見重複分頁。 |
| LOCK_UNSUPPORTED | 無 Web Locks，保留讀取能力，拒絕寫入；使用最新版 Android Chrome。 |
| LOCK_REQUEST | 瀏覽器拒絕鎖 API 請求，沒有執行寫入，不誤報其他分頁。 |
| DB_BLOCKED | IndexedDB 開啟遇到未完成版本變更，不是 Web Locks。稍後重試，不清除資料。 |
| DB_OPEN_TIMEOUT | 開啟超過 10 秒，停止等待但不刪除資料；晚到連線自動關閉。 |
| DB_VERSION | 既有資料庫版本高於程式支援值，停止，不降版或重建。 |
| DB_SCHEMA | 缺少預期 store，停止，不自行修復。 |
| DB_PERMISSION／DB_UNSUPPORTED | 網站儲存權限拒絕或不支援 IndexedDB，不誤報寫入鎖。 |
| DB_QUOTA／DB_ABORT／DB_CONNECTION／DB_TRANSACTION／DB_INTERNAL | 容量不足、交易中止／失效、連線失效或瀏覽器內部錯誤，分別提示，保存原資料。 |
| SNAPSHOT_INVALID／SNAPSHOT_CHANGED | 快照格式異常或過期，停止寫入。 |

## Android Chrome 驗收（不清資料）

1. 重新開啟 PR #2 預覽連結，確認可看到「本機資料診斷」及「安全錯誤診斷」。正式網站與預覽資料不共用；預覽空白不表示正式 21 首歌曲遺失。
2. 展開診斷：正常為 READY，閒置時 writerHeld 應為 0。按「更新診斷」僅查詢狀態，不寫資料。
3. 新增測試歌曲，成功後更新診斷確認鎖回到 0。重新整理後歌曲仍在。
4. 同網址開兩頁：兩頁均應能讀取。第一頁新增後，第二頁若仍是過期快照，寫入會顯示 SNAPSHOT_CHANGED；重新整理再操作，不覆蓋第一頁。
5. 若顯示 LOCK_BUSY，保留診斷 code／phase／writerHeld。舊版頁面仍持鎖時不強制搶走鎖，仍允許閱讀與備份；不再用啟動錯誤要求反覆清分頁，更不需要清除網站資料。
6. 若仍無法載入，提供安全診斷中的 code、phase、nativeName、Chrome 主版本即可，不必提供私人歌曲或金鑰。

## 回歸驗證界線

fake-indexeddb：全新資料庫、21／54 原資料、較高資料庫版本、缺 store、實際 versionchange 自動關連線、寫入容量失敗與釋鎖。blocked／開啟逾時以受控 openDB 回呼模擬，驗證分類與晚到連線關閉。

Chromium 手機視窗：同源舊版長期鎖下仍可啟動、失敗寫入未留空快照、鎖診斷不含 clientId／歌曲、釋放後重試成功且不殘留鎖、兩頁過期快照保護、不支援 Web Locks 可讀不可寫、DB_VERSION 正確顯示且資料不變，並保留既有遷移與匯入測試。這不是實體 Android 或使用者裝置資料測試。
