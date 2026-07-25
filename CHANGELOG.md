# CHANGELOG

## V5.1.4 Test Reliability Fix Edition — 2026-07-26

### 測試可靠性修正
- 修正 `open_page()` 點擊後等待不存在的 `#page-tutor`、`#page-cases`、`#page-compare`，改為等待實際頁面 ID。
- 手機「更多」抽屜改用 `aria-hidden` 與 `body.sheet-open` 判斷，不再依賴會把畫面外元素視為可見的 `is_visible()`。
- 手機導覽後驗證抽屜已確實關閉，避免透明遮罩或移出畫面的抽屜干擾後續點擊。
- Playwright 啟動失敗時自動嘗試系統 Chromium，仍保留 `CHROMIUM_PATH` 指定能力。
- 新增管理環境用內嵌隔離模式，避免 `ERR_BLOCKED_BY_ADMINISTRATOR` 使測試無法執行。

### 核心回歸測試擴充
- 驗證正式三節題數為 78／69／78、配分為 270／240／270、總計 225 題及 780 分。
- 驗證各科是非題與選擇題配置完全符合 `data/scheme.js`。
- 驗證三節跨節題目不重複，並執行 30 輪隨機抽題壓力測試。
- 驗證各科原始來源題池足以供應設定題數，不需退回全題庫補題。
- 新增快速 50 題、作答、標記、下一題、交卷、100 分結果、歷史與統計寫入測試。
- 新增損壞測驗進度拒絕、異常統計正規化及案例進度還原測試。
- 加入版本、HTML 引用、PWA 快取及無障礙標籤的靜態完整性檢查。
- 新增 `tests/requirements.txt`，固定 Playwright 版本。

### 備份與資料完整性修正
- 修正 `gpai_v500_enterprise` 案例研習進度匯出後無法匯入。
- 測驗進度匯入前改用題庫 ID 重新水合，題目不存在或陣列不一致時拒絕匯入。
- 歷史、統計、錯題、收藏、偏好、題目統計與案例資料改為白名單欄位及數值範圍正規化。
- 限制匯入陣列與物件筆數，避免異常備份造成儲存膨脹或介面效能問題。

### 介面與版本同步
- 補上 AI 老師輸入框、題庫搜尋與篩選、法規搜尋及錯題篩選的 `aria-label`。
- APP_VERSION 更新為 `5.1.4`。
- PWA 快取更新為 `gpai-v514-20260726`。
- Web App Manifest、HTML 標題、平台說明、README 與測試報告同步更新。

## V5.1.3 Test Reliability Edition — 2026-07-25

### 測試工具修正
- 修正手機 viewport 測試使用 `.first` 選到隱藏桌面導覽按鈕，導致點擊逾時。
- 新增 `open_page()` 共用導覽函式：桌面與平板精確使用 `.desktop-sidebar`；手機先開啟 `#mobileMoreSheet`，再選取抽屜內可見按鈕。
- AI 採購老師、案例研習及法條比較三段測試全部改用可見且唯一的導航元素。
- 每次導覽前斷言可見目標數量為 1，讓導覽重複、CSS 隱藏失效或抽屜未開啟時立即回報明確原因。
- 移除寫死的 `/usr/bin/chromium`；預設使用 Playwright 安裝的 Chromium。
- 新增可選 `CHROMIUM_PATH` 支援及不存在路徑的明確錯誤訊息。
- Chromium 啟動失敗時提供 `pip install playwright`、`playwright install chromium` 操作提示。
- 修正 `tests/run_smoke_test.sh` 無 URL 參數時仍傳入空字串的問題。

### 版本同步
- APP_VERSION 更新為 `5.1.3`。
- PWA 快取更新為 `gpai-v513-20260725`。
- Web App Manifest、HTML 標題、平台說明、README 與測試報告同步更新。

### 正式網站
- 本版不變更題庫、知識庫、答題邏輯、案例資料或版面規則。
- V5.1.2 的 CSS 回歸修復完整保留。

## V5.1.2 CSS Regression Fix Edition — 2026-07-25

- 恢復桌面側邊欄 `.desktop-sidebar.top` 固定定位、寬度、背景、垂直排列與捲動規則。
- 恢復 901–1180px 平板側邊欄內距。
- 恢復手機版隱藏桌面側邊欄及內容 `margin-left:0`。
- 新增桌面、平板、手機 viewport 的版面屬性斷言。

## V5.1.1 Stability & Code Hygiene Edition — 2026-07-25

- 修正匯出檔名殘留舊版號與舊產品名稱。
- 移除死狀態欄位 `statsTestCounted`。
- 修正舊格式錯題資料排序可能產生 NaN。
- 正式三節模擬改為跨節題目去重。
- AI 題庫檢索加入延遲建立的索引快取。
- 移除比較選單靜態 option。
- 清理舊版 CSS 技術債。
- 新增 Headless Chromium 煙霧測試。

## V5.1.0 Enterprise Knowledge Edition — 2026-07-25

- 新增 `data/knowledge_base.js`，統一管理知識主題、案例與法條比較資料。
- AI 採購老師改為資料驅動檢索。
- 案例研習與法條比較中心改為共用知識資料層。
- 新增 8 個核心主題、10 個案例與 6 組法條比較。
