# 政府採購 AI 學習平台 V5.1.4 Test Reliability Fix Edition

政府採購 AI 學習平台是一套可直接部署於 GitHub Pages 的純前端學習系統。題庫、學習紀錄、AI 採購老師、案例研習與法條比較均在使用者瀏覽器本機運作，不需後端伺服器或 API 金鑰。

## 主要功能

- 3,664 題政府採購學習題庫
- AI 採購老師：法條號與主題辨識、白話摘要、易混淆提醒及相關題目
- 案例研習：10 個資料驅動案例、逐案判斷、主要法源與延伸練習
- 法條比較中心：6 組常見易混淆規定，可建立比較練習
- 正式三節模擬、智慧弱點練習、法條專項及錯題間隔複習
- 答對率、加權得分率、題庫覆蓋率與學習趨勢
- PWA 安裝、離線快取與本機資料備份
- 電腦、平板及手機響應式介面

## V5.1.4 更新重點

- 修正 Playwright 導覽後等待不存在的 `#page-*` 元素，改為等待實際頁面 ID。
- 修正手機「更多」抽屜使用 `is_visible()` 判斷錯誤；現在依 `aria-hidden` 與 `body.sheet-open` 確認開關狀態。
- 修正備份匯入遺漏案例研習進度 `gpai_v500_enterprise`。
- 測驗進度、歷史、統計、錯題、收藏、偏好、題目統計及案例資料，全部加入型別、數量、題目 ID 與數值範圍正規化。
- 損壞或已不相容的測驗進度不再寫入本機儲存。
- 補齊六個搜尋／篩選控制項的無障礙標籤。
- Playwright 可自動尋找系統 Chromium；受管理環境禁止 `file://` 或 localhost 時，可改用內嵌隔離測試模式。
- 新增正式三節配置、225 題跨節去重、780 分配分、快速 50 題、交卷統計及備份驗證測試。
- 正式三節抽題另執行 30 輪隨機壓力檢查。

## GitHub Pages 部署

1. 解壓縮完整版。
2. 將解壓後的全部檔案與資料夾上傳到儲存庫根目錄。
3. 確認 `index.html` 位於根目錄。
4. GitHub Pages 使用 `main` 分支及 `/ (root)`。

本版 Service Worker 快取名稱：

```text
gpai-v514-20260726
```

更新後若仍顯示舊版，可重新整理頁面；必要時在瀏覽器開發者工具的 Application／應用程式頁籤中清除舊 Service Worker 與網站資料。

## 執行完整回歸測試

安裝固定版本測試套件：

```bash
pip install -r tests/requirements.txt
playwright install chromium
```

在專案根目錄執行：

```bash
python tests/smoke_test.py
```

或在 macOS／Linux：

```bash
./tests/run_smoke_test.sh
```

測試已部署網站：

```bash
python tests/smoke_test.py https://example.github.io/project/
```

使用系統 Chromium：

```bash
CHROMIUM_PATH=/usr/bin/chromium python tests/smoke_test.py
```

受管理環境禁止瀏覽器讀取本機網址時：

```bash
GPAI_EMBEDDED_TEST=1 CHROMIUM_PATH=/usr/bin/chromium python tests/smoke_test.py
```

## 測試涵蓋範圍

- 1440px 桌機、1024px 平板、390px 手機響應式版面
- 手機底部導覽與「更多」抽屜開關
- AI 採購老師、案例作答與法條比較
- 完整三節 78／69／78 題、270／240／270 分
- 225 題跨節不重複與總分 780 分
- 每科是非題、選擇題數量及來源題池容量
- 快速測驗 15 題是非、35 題選擇，共 50 題
- 作答、標記、下一題、強制交卷、成績及統計寫入
- 有效測驗進度接受、損壞進度拒絕
- 案例進度備份還原與異常統計資料正規化
- HTML 引用檔案、版本、PWA 快取與無障礙標籤靜態檢查

## 重要聲明

本平台為獨立開發的教育訓練與自我學習工具，與政府機關、考試主辦單位無隸屬、授權、合作或認證關係。知識摘要、案例及題目解析僅供學習參考；實際案件應依最新法規、函釋、招標文件、契約及完整事實判斷。
