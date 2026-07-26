# V5.1.5 Theme Initialization Fix Edition

- 修正無痕模式與首次載入時，外部 CSS 尚未完成下載造成左側欄短暫白底的問題。
- 在 HTML 首屏加入最小化關鍵配色，完整樣式表尚未載入時也維持深藍側邊欄。
- 預載 `style.css`，降低首次載入的無樣式閃爍。
- 明確重設側邊欄導覽按鈕背景與邊框，避免瀏覽器預設白色按鈕樣式。
- 統一桌機側邊欄、手機頂部列、底部導覽與更多功能抽屜的藍綠配色。
- 新增「僅有關鍵樣式」測試，確保即使完整 CSS 尚未載入，左側欄仍不是白色。

# CHANGELOG

## V5.1.4 Test Reliability Fix Edition — 2026-07-26

- 修正測試等待不存在的 `#page-*` 元素。
- 修正手機更多抽屜關閉時仍被 Playwright 視為可見的判斷問題。
- 修正案例研習進度可匯出但無法匯入。
- 強化測驗進度、統計、錯題、收藏與案例資料的匯入驗證。
- 新增正式三節 225 題／780 分、跨節去重及 30 輪隨機壓力測試。

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
