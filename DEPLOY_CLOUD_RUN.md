# Google Cloud Run 上線與省錢部署指南

這份指南協助你把《動漫同人原畫拍賣會》部署到 **Google Cloud Run（台灣機房 `asia-east1`）**，取得一組永久的 `https://...run.app` 網址讓朋友隨時點開就玩，同時避免閒置掛網產生高額帳單。

---

## 一、事前確認（領取抵用金與設定預算警報）

1. **確認 Google AI Pro 每月 \$10 抵用金**
   - 用購買 Google AI Pro 的同一個 Google 帳號登入 [Google Cloud Console](https://console.cloud.google.com/) 與 [Google Developer Program](https://developers.google.com/program)，確認帳單帳戶（Billing Account）已完成抵用金連結。
2. **設定 \$5 美元每月預算警報（強烈建議）**
   - 在 Cloud Console 前往 **帳單（Billing）→ 預算與快訊（Budgets & alerts）→ 建立預算**。
   - 設定每月預算金額為 **`5` USD**（觸發比例 50%、90%、100% 寄信通知）。

---

## 二、將專案推上 GitHub

在專案資料夾（`C:\Users\Frank\.gemini\antigravity\scratch\modern-art-online`）開啟終端機執行：

```powershell
git init
git add .
git commit -m "Prepare Modern Art Online for Cloud Run"
```

> `.gitignore` 與 `.dockerignore` 已自動排除 `node_modules/` 以及未使用的 70 張舊 `.png` 圖檔，僅保留實際使用的 `.jpg` 畫作與頭像。

接著在 GitHub 建立一個新 Repository（公開或私人皆可），並把程式推上去：

```powershell
git branch -M main
git remote add origin https://github.com/<你的帳號>/<你的Repo名稱>.git
git push -u origin main
```

---

## 三、在 Google Cloud Console 直接從 GitHub 部署（免裝本機 CLI）

1. 開啟 [Google Cloud Run Console](https://console.cloud.google.com/run)，點擊 **「部署容器 / Deploy container」→「從存放區持續部署（Continuously deploy from a repository）」**。
2. 點擊 **「設定 Cloud Build」**，連結你的 GitHub 帳號與剛剛的 Repository，分支選 `^main$`，建置類型選擇 **`Dockerfile`**（路徑 `/Dockerfile`）。
3. 填入以下關鍵服務設定（務必確認每項都有設對）：
   - **區域（Region）**：`asia-east1`（台灣彰化，連線延遲最低）
   - **驗證（Authentication）**：**允許未經身份驗證的叫用（Allow public access）**（這樣朋友點開連結就能直接玩）
   - **容器通訊埠（Container port）**：`8080`
   - **計費與資源配置（CPU allocation & resources）**：
     - 計費方式：**僅在要求處理期間配置 CPU（Request-based）**（無人遊玩時縮為 0 不計費）
     - 記憶體（Memory）：`512 MiB`
     - CPU：`1`
   - **要求逾時（Request timeout）**：**`3600` 秒**（確保 WebSocket 長對局不會 5 分鐘被中斷）
   - **自動調度資源（Scaling）**：
     - 執行個體數量下限（Min instances）：**`0`**（沒人玩不收費）
     - 執行個體數量上限（Max instances）：**`1`**（重要：房間存在單機記憶體，必須鎖為 1 台才能在同一個房間找到彼此）
   - **工作階段親和性（Session affinity）**：**開啟（Enabled）**
   - **環境變數（可選）**：
     - `IDLE_TIMEOUT_MS`：預設為 `1800000`（30 分鐘未操作自動斷線，防止有人忘記關分頁一直佔住 WebSocket 計費）。如需更短（例如 15 分鐘），可填入 `900000`。
4. 點擊 **「建立（Create）」**，等待約 2～3 分鐘建置完成，畫面上方就會出現 `https://xxxxx-asia-east1.run.app` 永久網址。

---

## 四、設定 Artifact Registry 清理政策（確保映像檔儲存費 \$0）

每次從 GitHub 重新部署都會產生一個新的容器映像檔；Cloud Run 使用的 Artifact Registry 免費額度為 **0.5 GiB / 月**：

1. 前往 Cloud Console **Artifact Registry → cloud-run-source-deploy** 存放庫。
2. 開啟 **清理政策（Cleanup policies）→ 新增政策**，設定 **保留最新數量（Keep most recent versions）：`2`**、刪除較舊版本。
3. 如此儲存空間會維持在約 0.2～0.4 GiB，不超過每月 0.5 GiB 免費額度。

---

## 五、分享給朋友遊玩

1. 用瀏覽器打開產生的 `https://...run.app` 網址（若久未遊玩，首次開啟需等約 1～2 秒喚醒）。
2. 點「**建立房間**」→ 按右上「**複製**」取得邀請連結（`https://...run.app/?room=房號`）貼給朋友即可開局。
3. 本專案已設定：
   - `/assets` 圖檔 **7 天瀏覽器快取**，大幅節省對外流量費用。
   - **閒置 30 分鐘自動斷線**並顯示友善重連按鈕，關分頁後 Cloud Run 約 15 分鐘內自動縮為 0 台停止計費。
