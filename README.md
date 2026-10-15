# listening-counter
A music listening counter for fans

---

# Listening Counter

繁體中文、手機優先的非官方 PLAVE 粉絲聆聽手帳。React 19 + TypeScript + Vite + Tailwind CSS 4；IndexedDB 本機儲存；Netlify Functions 代理 Last.fm 官方 API。

**目前是功能程式碼已建立、完成離線邏輯測試的版本，尚未通過正式建置驗證，也尚未部署。** 本環境無法連到 `proxy:8080`，未能安裝套件。請先閱讀 [驗證報告](VERIFICATION.md)，不要把目前版本當成已驗收的正式網站。

## 已實作

- 歌曲新增、編輯、刪除；歌手、專輯、自由文字版本、HTTPS 封面；無圖時自動產生文字封面。
- 手動 +1、每次時間紀錄、紀錄刪除，清楚顯示手動與 Last.fm 來源。
- Last.fm 公開使用者名稱連接；首次全歷史分頁匯入、續傳、增量同步、重新掃描。
- 同帳號＋時間＋正規化歌曲／歌手／專輯組成外部事件鍵；相同事件去重，不同時間保留。不擅自合併手動與 Scrobble。
- 自動辨識 PLAVE／플레이브，預設只顯示 PLAVE；可關閉篩選並手動修正分類、版本。原始標題的 Live、Remix 等只做初步分類，不保證辨識所有版本。
- 當地時間的每日、週一開始的每週、每月、累積統計；最近七天圖表；每首歌的累積目標及進度條。
- JSON 下載備份、格式檢查、確認後取代還原。還原是取代，不是合併。
- IndexedDB 交易寫入及單分頁寫入鎖；同步錯誤保留已儲存資料與分頁進度。
- Last.fm 金鑰僅於 Functions 讀取環境變數；沒有 Spotify 密碼、非官方 API 或會員系統。

## 本機啟動（網路恢復後）

需要 Node.js **22.15 以上**與 npm。先安裝套件，再執行：

```sh
npm install
npm test
npm run test:db
npm run typecheck
npm run build
npm run dev
```

`.npmrc` 已設定每次連線 15 秒逾時、最多一次重試。若使用 Linux / GitHub Codespaces，請加上**總時間限制**，並在失敗後停止，不要連續重試：

```sh
timeout 120s npm install --no-audit --no-fund
timeout 30s npm test
timeout 60s npm run test:db
timeout 60s npm run typecheck
timeout 60s npm run build
```

第一次安裝成功後會產生 `package-lock.json`，請一併提交 GitHub。之後使用 `timeout 120s npm ci`。沒有 lock 檔之前不要執行 `npm ci`。GitHub Actions 已處理這兩種情況，且每個步驟都有時間上限。

`npm run dev` 只提供前端，手動功能可用，但不提供 Netlify Functions。測試真實 Last.fm 請使用部署後的 Netlify 網址，或在已安裝 Netlify CLI 的電腦使用 `netlify dev`。不要把 Last.fm 金鑰加到 `VITE_` 變數。

## 不需要安裝套件的離線測試

```sh
npm test
```

這會使用 Node.js 內建測試器與型別移除工具，直接測試 `src/domain.ts`、`src/sync.ts`、`netlify/functions/lastfm.ts`。不連外、不需要真實 API 金鑰。測試器出現 `ExperimentalWarning` 是 Node 型別移除 API 的提示。

這些測試**不等於 TypeScript 型別檢查**，也不驗證 React 畫面、Tailwind、Vite、IndexedDB 或真實 Last.fm。`npm run test:db` 的另外 6 項測試需要套件，尚未在本環境執行。

## Last.fm 憑證與隱私

1. 前往 <https://www.last.fm/api/account/create> 申請 Last.fm API 帳號。
2. 應用程式名稱填 `Listening Counter`，網址填你的網站網址；若申請流程要求其他欄位，依 Last.fm 當下說明填寫。
3. 此工具的 `user.getrecenttracks` 只需要 **API Key**，不需要 Shared Secret，也不需要 Last.fm／Spotify 密碼。
4. 在 Netlify 專案的 **Project configuration / Site configuration → Environment variables** 新增 `LASTFM_API_KEY`，值填 API Key，範圍包含 Functions。儲存後重新部署。
5. 不要把金鑰放進程式碼、GitHub、備份檔或任何 `VITE_` 變數。

使用者須自行在 Last.fm 啟用官方支援的 Scrobbling，並讓 Last.fm 近期紀錄可讀取。本工具只讀現有 Scrobble，不會控制播放或回填 Spotify 官方串流次數。Last.fm 自身的公開／隱私設定由使用者管理；網站不會變更該設定。

網站會暫時代理使用者名稱與 Last.fm 公開紀錄，不自行建立雲端聆聽資料庫；主機平台仍可能有一般請求日誌。本機資料不預設公開、不跨裝置同步。備份包含使用者名稱與時間，請勿提交公開儲存庫。清除瀏覽器資料、換手機或換網站網域前，先下載 JSON 備份。

## Android 手機 → GitHub → Netlify

以下流程使用 Android Chrome。窄畫面請在 Chrome 選單勾選「電腦版網站」。不必在手機安裝 Node.js。

### 1. 準備原始碼

下載本次提供的 `listening-counter-source.zip` 到手機「下載」資料夾。它包含原始碼、測試與設定，沒有私人聆聽紀錄、API 金鑰、node_modules 或 dist。

### 2. 建立 GitHub 儲存庫

1. 用 Chrome 登入 <https://github.com>，按 **+ → New repository**。
2. 名稱填 `listening-counter`，可以選 Public；勾選 **Add a README file**，再建立。
3. 進入儲存庫，按綠色 **Code → Codespaces → Create codespace on main**。
4. Codespaces 需要帳號有可用額度。使用免費額度即可，不需要付費 API；若帳號無可用額度，先停止此路徑，不要啟用付費資源。可改在有 Node.js 的電腦上解壓縮後提交 GitHub。
5. Codespaces 開啟後，在左側檔案總管空白處長按或點「…」，選 **Upload**，上傳 ZIP。若手機版看不到選項，改用電腦版網站；也可用編輯器 Command Palette 的上傳命令。
6. 開啟 **Terminal → New Terminal**，貼上下列命令。這是在新建的遠端儲存庫操作，不會變更本次保留的原專案：

```sh
mkdir -p /tmp/listening-counter-upload
unzip listening-counter-source.zip -d /tmp/listening-counter-upload
cp -R /tmp/listening-counter-upload/. .
rm listening-counter-source.zip
```

ZIP 根目錄直接是 `package.json`、`src/` 等檔案，不多包一層資料夾。`cp` 只會在新建儲存庫內用專案說明取代預設 README；不要在已有其他程式的儲存庫執行這個流程。

### 3. 安裝與驗證

在 Codespaces 終端機逐行執行 README 上方的限時安裝與檢查命令。**只有前一個命令成功才進行下一個**。

- 安裝若超過 120 秒，`timeout` 會停止它。請先檢查網路，不要無限重跑。
- 若 TypeScript、測試或建置失敗，先修正或帶回錯誤訊息，暫停正式部署。
- 成功後確認出現 `package-lock.json`、`dist/`。不要提交 `dist/` 或 `node_modules/`。

將程式提交並推上 GitHub：

```sh
git add .
git status --short
git commit -m "Build Listening Counter MVP"
git push origin main
```

提交前檢查清單不應含 `.env`、個人 JSON 備份、API Key 或下載的 ZIP。使用完請在 <https://github.com/codespaces> 停止 Codespace，避免持續佔用額度。

若目前只想先保存原始碼，也可以跳過安裝先提交；這只代表備份程式碼，不代表檢查通過或適合正式發布。

### 4. 連接 Netlify

1. 到 <https://app.netlify.com>，使用 GitHub 登入。
2. 選 **Add new project / Add new site → Import an existing project → GitHub**。
3. 授權選取剛建立的 `listening-counter` 儲存庫。
4. 部署分支選 `main`；Base directory 留空；Build command 為 `npm run build`；Publish directory 為 `dist`。`netlify.toml` 已設定 Functions 為 `netlify/functions`。
5. 如需 Last.fm，在環境變數加上 `LASTFM_API_KEY`；也可先部署手動功能，之後加入再重新部署。
6. 按 **Deploy**，查看部署日誌。主機端套件請求同樣採用 `.npmrc` 的限時／重試設定；若主機整體建置逾時或顯示網路失敗，停止並檢查，不要一直重部署。
7. 日誌成功後開啟 Netlify 提供的 HTTPS 公開網址。可在專案設定修改站名；改網域會形成新的本機儲存空間，先備份再轉移。

### 5. 手機驗收

1. 新增歌曲，填歌手、專輯、版本、目標；編輯後確認內容保留。
2. 按 +1，查看時間軸與「手動紀錄」標籤，重新整理確認資料仍在。
3. 在連接頁輸入 Last.fm 使用者名稱，首次匯入；有「繼續匯入」就繼續，直到完成。
4. 再按增量同步，確認相同 Scrobble 不會加倍。切換每日、每週、每月、累積統計。
5. 關閉「只看 PLAVE」找到分類不正確的歌，編輯修正歌手分類與版本。
6. 下載 JSON，先看還原確認畫面，再測試還原。保持一份未修改備份。
7. 模擬斷線同步，確認錯誤訊息出現且原有資料仍在。再用 Chrome 窄螢幕檢查選單、表單、圖表。

以上瀏覽器與真實 API 驗收尚未由本次執行環境完成。

## 資料與同步限制

- 首次匯入每頁 200 筆，每批最多 10 頁；已存頁面會保留游標。每次前端請求 25 秒逾時，Function 上游請求 12 秒逾時，程式不自動無限重試。
- 增量重查最近 48 小時；更早補交的 Scrobble 需手動「重新掃描全部」。Last.fm 刪除或修改的歷史不會自動刪除本機紀錄。
- 去重依賴 Last.fm 公開的秒級時間與曲目資料。同一秒完全相同的事件無法區分；上游更改歌曲／專輯文字可能形成不同鍵。匯入期間上游若修改歷史，也可能影響頁碼；可重新掃描補齊。
- 刪除歌曲或事件後，未來重新掃描 Last.fm 可能再次匯入；這是目前介面已提示的行為。
- 所有歌手資料會保存在本機，PLAVE 是顯示篩選；可手動修正。版本名稱可自由分類，系統不保證自動辨識所有發行版本。
- 使用快照儲存，適合個人用量。大量歷史資料的效能尚未測量；未實作定時背景同步、多裝置同步或自動雲端備份。
- 公開代理固定只能呼叫 `user.getrecenttracks`，有參數檢查、超時與 no-store；目前沒有持久化的站級限流器。公開後請留意 Netlify 免費額度與 Last.fm 使用規範。
- 不提供會員、公開個人排行榜或資料分享。統計不等於 Spotify 官方有效串流。
