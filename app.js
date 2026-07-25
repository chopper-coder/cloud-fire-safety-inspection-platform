'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const APP_NAME = '政府採購 AI 學習平台';
const APP_VERSION = '5.1.4';
const QUESTION_BANK_VERSION = '2026-07-25-v2-deduplicated';
const LEGAL_ANALYSIS_VERSION = '2026-07-25-v5-enterprise-tutor';
const QUESTION_ID_ALIASES = window.QUESTION_ID_ALIASES || {};
const COMPARISON_SETS = window.VERIFIED_LEGAL_DATA?.comparisons || [];
const runtimeErrors = [];
const BANK_PAGE_SIZE = 50;
const LS = {
  state: 'gpai_v400_state',
  history: 'gpai_v400_history',
  wrong: 'gpai_v400_wrong',
  stats: 'gpai_v400_stats',
  favorites: 'gpai_v400_favorites',
  prefs: 'gpai_v400_prefs',
  questionStats: 'gpai_v420_question_stats',
  enterprise: 'gpai_v500_enterprise'
};
const LEGACY_KEY_MAP = {
  palp_v302_state: LS.state,
  palp_v302_history: LS.history,
  palp_v302_wrong: LS.wrong,
  palp_v302_stats: LS.stats,
  palp_v302_favorites: LS.favorites,
  palp_v302_prefs: LS.prefs,
  palp_v301_state: LS.state,
  palp_v301_history: LS.history,
  palp_v301_wrong: LS.wrong,
  palp_v301_stats: LS.stats,
  palp_v301_favorites: LS.favorites,
  palp_v301_prefs: LS.prefs,
  palp_v30_state: LS.state,
  palp_v30_history: LS.history,
  palp_v30_wrong: LS.wrong,
  palp_v30_stats: LS.stats,
  palp_v30_favorites: LS.favorites,
  palp_v30_prefs: LS.prefs,
  palp_v23_state: LS.state,
  palp_v23_history: LS.history,
  palp_v23_wrong: LS.wrong,
  palp_v23_stats: LS.stats,
  palp_v23_favorites: LS.favorites,
  palp_v23_prefs: LS.prefs,
  plv21_state: LS.state,
  plv21_history: LS.history,
  plv21_wrong: LS.wrong,
  plv21_stats: LS.stats
};
const ALL_STORAGE_KEYS = [...new Set([...Object.values(LS), ...Object.keys(LEGACY_KEY_MAP)])];

function blankState() {
  return {
    kind: 'quick',
    plan: [],
    currentSession: 0,
    completed: [],
    questions: [],
    answers: [],
    marked: [],
    timeSpent: [],
    questionOpenedAt: null,
    index: 0,
    seconds: 0,
    deadlineAt: null,
    unlimited: false,
    finished: false,
    review: 'wrong',
    focusLoss: 0,
    attemptId: '',
    resultsRecorded: false
  };
}

let S = blankState();
let submitting = false;
let autoNextTimer = null;
let toastTimer = null;
let lastTimerSave = null;
let bankPage = 1;
let bankLegalKey = 'all';
let legalIndexCache = null;
let wrongFilter = 'all';
let deferredInstallPrompt = null;
let waitingWorker = null;

function getStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) ?? fallback);
  } catch (error) {
    console.warn('讀取本機資料失敗', key, error);
    return fallback;
  }
}

function setStorage(key, value, silent = false) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error('儲存失敗', error);
    if (!silent) showAppError('瀏覽器儲存空間不足或無法寫入。請先到「設定」匯出備份，再清理部分資料。');
    return false;
  }
}

function removeStorage(key) {
  try { localStorage.removeItem(key); } catch (error) { console.warn('刪除資料失敗', key, error); }
}

function migrateLegacyData() {
  try {
    Object.entries(LEGACY_KEY_MAP).forEach(([oldKey, newKey]) => {
      if (localStorage.getItem(newKey) === null && localStorage.getItem(oldKey) !== null) {
        localStorage.setItem(newKey, localStorage.getItem(oldKey));
      }
    });
  } catch (error) {
    console.warn('舊版資料移轉失敗', error);
  }
}

function validateQuestionBank(source) {
  const valid = [];
  const ids = new Set();
  const fingerprints = new Set();
  let invalid = 0;
  let duplicateContent = 0;
  (Array.isArray(source) ? source : []).forEach((q) => {
    const fingerprint = q ? `${String(q.question || '').replace(/\s+/g, '')}|${(q.options || []).map((option) => String(option).replace(/\s+/g, '')).join('|')}|${q.answer}` : '';
    const okay = q && typeof q.id === 'string' && q.id && !ids.has(q.id)
      && (q.type === 'tf' || q.type === 'mc')
      && typeof q.section === 'string'
      && typeof q.question === 'string'
      && Array.isArray(q.options) && q.options.length >= 2
      && q.options.every((option) => typeof option === 'string' && option.trim())
      && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length;
    if (!okay) { invalid += 1; return; }
    if (fingerprints.has(fingerprint)) { duplicateContent += 1; return; }
    ids.add(q.id); fingerprints.add(fingerprint); valid.push(q);
  });
  return { valid, invalid, duplicateContent };
}

migrateLegacyData();
const bankCheck = validateQuestionBank(window.QUESTION_BANK);
const BANK = bankCheck.valid;
const BANK_BY_ID = new Map(BANK.map((question) => [question.id, question]));
const SCHEME = window.EXAM_SCHEME;
const sections = [...new Set(BANK.map((q) => q.section))];

function showAppError(message) {
  const box = $('#appError');
  if (!box) return;
  box.textContent = message;
  box.classList.remove('hidden');
}

function clearAppError() {
  $('#appError')?.classList.add('hidden');
}

function toast(message) {
  const box = $('#toast');
  if (!box) return;
  clearTimeout(toastTimer);
  box.textContent = message;
  box.classList.remove('hidden');
  toastTimer = setTimeout(() => box.classList.add('hidden'), 2600);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function attemptId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function localDayKey(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function closeMobileMore() {
  document.body.classList.remove('sheet-open');
  $('#mobileMoreSheet')?.setAttribute('aria-hidden', 'true');
}

function openMobileMore() {
  closeQuestionNav();
  document.body.classList.add('sheet-open');
  $('#mobileMoreSheet')?.setAttribute('aria-hidden', 'false');
}

function closeQuestionNav() {
  document.body.classList.remove('question-nav-open');
  $('#mobileQuestionNav')?.setAttribute('aria-expanded', 'false');
}

function openQuestionNav() {
  closeMobileMore();
  document.body.classList.add('question-nav-open');
  $('#mobileQuestionNav')?.setAttribute('aria-expanded', 'true');
}

function updateActiveNavigation(pageId) {
  $$('[data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === pageId));
  const morePages = new Set(['tutor', 'cases', 'compare', 'analytics', 'bank', 'lawIndex', 'favorites', 'templates', 'history', 'settings']);
  $('#mobileMore')?.classList.toggle('active', morePages.has(pageId));
}

function show(pageId) {
  const target = document.getElementById(pageId);
  if (!target) {
    showAppError(`找不到頁面：${pageId}`);
    return false;
  }
  const leavingRunningExam = pageId !== 'exam' && !S.finished && Array.isArray(S.questions) && S.questions.length > 0;
  if (leavingRunningExam && !$('#exam')?.classList.contains('hidden')) toast('測驗倒數仍會持續，可從首頁繼續作答。');

  $$('.page').forEach((page) => page.classList.add('hidden'));
  target.classList.remove('hidden');
  closeMobileMore();
  closeQuestionNav();
  updateActiveNavigation(pageId);
  window.scrollTo({ top: 0, behavior: 'auto' });

  if (pageId === 'dashboard') dashboard();
  if (pageId === 'learning') renderLearningCenter();
  if (pageId === 'tutor') { /* 保留目前對話 */ }
  if (pageId === 'cases') renderCases();
  if (pageId === 'compare') renderV5Comparison();
  if (pageId === 'analytics') renderAnalytics();
  if (pageId === 'bank') renderBank();
  if (pageId === 'lawIndex') renderLawIndex();
  if (pageId === 'wrong') renderWrong();
  if (pageId === 'favorites') renderFavorites();
  if (pageId === 'history') renderHistory();
  if (pageId === 'settings') loadPrefs();
  return true;
}

function startOfDay(value = Date.now()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function normalizedWrongRecord(value = {}) {
  const record = value && typeof value === 'object' ? value : {};
  const repetitions = Math.max(0, Number(record.repetitions ?? record.rightStreak) || 0);
  const intervalDays = Math.max(1, Number(record.intervalDays) || (repetitions >= 3 ? 30 : repetitions === 2 ? 7 : repetitions === 1 ? 3 : 1));
  const nextReview = Number(record.nextReview) || Number(record.last) || Date.now();
  return {
    count: Math.max(0, Number(record.count) || 0),
    right: Math.max(0, Number(record.right) || 0),
    repetitions,
    intervalDays,
    nextReview,
    last: Number(record.last) || Date.now(),
    lastAnswer: Number.isInteger(record.lastAnswer) ? record.lastAnswer : null,
    status: record.status || (repetitions >= 3 ? '已掌握' : repetitions ? '學習中' : '待複習')
  };
}

function isWrongDue(record, now = Date.now()) {
  return normalizedWrongRecord(record).nextReview <= now;
}

function wrongSummary(wrong = getStorage(LS.wrong, {})) {
  const rows = Object.entries(wrong || {}).filter(([id]) => BANK_BY_ID.has(id));
  const due = rows.filter(([, record]) => isWrongDue(record)).length;
  const learning = rows.filter(([, record]) => {
    const normalized = normalizedWrongRecord(record);
    return normalized.repetitions > 0 && normalized.repetitions < 3;
  }).length;
  const mastered = rows.filter(([, record]) => normalizedWrongRecord(record).repetitions >= 3).length;
  return { total: rows.length, due, learning, mastered };
}

function nextReviewSchedule(repetitions) {
  const intervals = [1, 3, 7, 14, 30, 90, 180];
  const safe = Math.max(0, Math.min(Number(repetitions) || 0, intervals.length - 1));
  return intervals[safe];
}

function ensureLegalIndex() {
  if (!legalIndexCache) legalIndexCache = window.LEGAL_ANALYSIS?.buildIndex(BANK) || [];
  return legalIndexCache;
}

function legalRefsFor(question) {
  return window.LEGAL_ANALYSIS?.infer(question)?.refs || [];
}

function canonicalQuestionId(id) {
  return QUESTION_ID_ALIASES[id] || id;
}

function normalizedQuestionStat(value = {}) {
  const row = value && typeof value === 'object' ? value : {};
  return {
    seenCount: Math.max(0, Number(row.seenCount) || 0),
    correctCount: Math.max(0, Number(row.correctCount) || 0),
    lastSeen: Math.max(0, Number(row.lastSeen) || 0),
    lastAnswer: Number.isInteger(row.lastAnswer) ? row.lastAnswer : null,
    totalSeconds: Math.max(0, Number(row.totalSeconds) || 0),
    lastCorrect: Boolean(row.lastCorrect)
  };
}

function getQuestionStats() {
  const source = getStorage(LS.questionStats, {});
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  return source;
}

function questionStatsSummary(source = getQuestionStats()) {
  const rows = Object.entries(source).filter(([id, value]) => BANK_BY_ID.has(canonicalQuestionId(id)) && normalizedQuestionStat(value).seenCount > 0);
  const uniqueSeen = new Set(rows.map(([id]) => canonicalQuestionId(id))).size;
  const totalSeconds = rows.reduce((sum, [, value]) => sum + normalizedQuestionStat(value).totalSeconds, 0);
  const totalSeen = rows.reduce((sum, [, value]) => sum + normalizedQuestionStat(value).seenCount, 0);
  return { uniqueSeen, coverage: BANK.length ? Math.round((uniqueSeen / BANK.length) * 1000) / 10 : 0, totalSeconds, totalSeen, averageSeconds: totalSeen ? Math.round(totalSeconds / totalSeen) : 0 };
}

function isRecentlySeen(questionId, days) {
  if (!days) return false;
  const stat = normalizedQuestionStat(getQuestionStats()[canonicalQuestionId(questionId)]);
  return stat.lastSeen > 0 && Date.now() - stat.lastSeen < days * 86400000;
}

function prioritizeFresh(pool, days = getPrefs().avoidRecentDays) {
  const unique = [...new Map((pool || []).map((question) => [question.id, question])).values()];
  if (!days) return shuffle(unique);
  const fresh = unique.filter((question) => !isRecentlySeen(question.id, days));
  const recent = unique.filter((question) => isRecentlySeen(question.id, days));
  return [...shuffle(fresh), ...shuffle(recent)];
}

function commitQuestionTime() {
  if (!Array.isArray(S.questions) || !S.questions.length || !Number.isInteger(S.index)) return;
  if (!Array.isArray(S.timeSpent) || S.timeSpent.length !== S.questions.length) S.timeSpent = Array(S.questions.length).fill(0);
  const openedAt = Number(S.questionOpenedAt) || Date.now();
  const elapsed = Math.max(0, Math.min(600, Math.round((Date.now() - openedAt) / 1000)));
  S.timeSpent[S.index] = Math.max(0, Number(S.timeSpent[S.index]) || 0) + elapsed;
  S.questionOpenedAt = Date.now();
}

function learningData() {
  const stats = getStorage(LS.stats, { answered: 0, correct: 0, raw: 0, max: 0, tests: 0, official: 0, by: {}, type: {} });
  const history = getStorage(LS.history, []).filter((row) => row && Number.isFinite(Number(row.date)) && Number.isFinite(Number(row.pct)));
  const wrong = getStorage(LS.wrong, {});
  const wrongStats = wrongSummary(wrong);
  const qSummary = questionStatsSummary();
  const uniqueDays = [...new Set(history.map((row) => localDayKey(Number(row.date))).filter(Boolean))].sort().reverse();
  const daySet = new Set(uniqueDays);
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!daySet.has(localDayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  for (let i = 0; i < 366; i += 1) {
    if (!daySet.has(localDayKey(cursor))) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  const answered = Math.max(0, Number(stats.answered) || 0);
  const correct = Math.max(0, Number(stats.correct) || 0);
  const raw = Math.max(0, Number(stats.raw) || 0);
  const max = Math.max(0, Number(stats.max) || 0);
  const accuracy = answered ? Math.round((correct / answered) * 100) : 0;
  const weightedAccuracy = max ? Math.round((raw / max) * 100) : accuracy;
  const topics = sections.map((section) => {
    const value = stats.by?.[section] || { a: 0, c: 0, raw: 0, max: 0 };
    const topicAnswered = Math.max(0, Number(value.a) || 0);
    const topicCorrect = Math.max(0, Number(value.c) || 0);
    const topicRaw = Math.max(0, Number(value.raw) || 0);
    const topicMax = Math.max(0, Number(value.max) || 0);
    return { name: section, answered: topicAnswered, correct: topicCorrect, raw: topicRaw, max: topicMax, pct: topicMax ? Math.round((topicRaw / topicMax) * 100) : (topicAnswered ? Math.round((topicCorrect / topicAnswered) * 100) : 0) };
  }).sort((a, b) => (a.answered ? a.pct : 101) - (b.answered ? b.pct : 101));
  const weak = topics.filter((topic) => topic.answered >= 5).slice(0, 5);
  const recent30 = history.filter((row) => Date.now() - Number(row.date) <= 30 * 86400000);
  const recentAverage = recent30.length ? Math.round(recent30.reduce((sum, row) => sum + Number(row.pct), 0) / recent30.length) : 0;
  const officialRows = history.filter((row) => String(row.kind || '').startsWith('official'));
  const officialAverage = officialRows.length ? Math.round(officialRows.reduce((sum, row) => sum + Number(row.pct), 0) / officialRows.length) : 0;
  const readiness = Math.min(100, Math.round(weightedAccuracy * 0.42 + Math.min(qSummary.coverage * 0.35, 25) + Math.min(streak * 3, 18) + Math.min(wrongStats.mastered, 10)));
  const confidence = qSummary.uniqueSeen < 20 ? '資料不足' : qSummary.uniqueSeen < 100 ? '初步分析' : qSummary.uniqueSeen < 500 ? '一般可信度' : '較完整分析';
  return { stats: { ...stats, answered, correct, raw, max }, history, wrong, wrongStats, qSummary, streak, accuracy, weightedAccuracy, topics, weak, readiness, confidence, recentAverage, officialAverage };
}

function learnerLevel(data) {
  const coverage = Number(data?.qSummary?.coverage) || 0;
  const weighted = Number(data?.weightedAccuracy) || 0;
  const tiers = [
    { min: 70, name: '採購學習專家' },
    { min: 40, name: '進階學習者' },
    { min: 20, name: '穩定成長者' },
    { min: 5, name: '基礎實踐者' },
    { min: 0, name: '新手學習者' }
  ];
  const index = tiers.findIndex((tier) => coverage >= tier.min);
  const tier = tiers[index];
  const nextMin = index > 0 ? tiers[index - 1].min : 100;
  const span = Math.max(1, nextMin - tier.min);
  const coverageProgress = Math.min(100, Math.round(((coverage - tier.min) / span) * 100));
  const qualityBonus = weighted >= 80 ? 10 : weighted >= 70 ? 5 : 0;
  return [tier.name, Math.min(100, coverageProgress + qualityBonus)];
}

function hasResumableState() {
  const restored = normalizeRestoredState(getStorage(LS.state, null), false);
  if (!restored) return false;
  if (!restored.finished) return restored.questions.length > 0;
  return restored.kind === 'official-full' && restored.currentSession < restored.plan.length - 1;
}

function dashboard() {
  const data = learningData();
  const stats = data.stats;
  const hour = new Date().getHours();
  $('#welcomeTitle').textContent = `${hour < 12 ? '早安' : hour < 18 ? '午安' : '晚安'}，開始今天的採購學習`;
  const [level, progress] = learnerLevel(data);
  $('#learnerLevel').textContent = level;
  $('#levelProgress').style.width = `${Math.min(progress, 100)}%`;
  $('#levelText').textContent = `已接觸 ${data.qSummary.uniqueSeen.toLocaleString()}／${BANK.length.toLocaleString()} 題，覆蓋率 ${data.qSummary.coverage}%`;
  $('#metrics').innerHTML = `
    <div class="metric"><span>題庫覆蓋率</span><b>${data.qSummary.coverage}%</b><small>${data.qSummary.uniqueSeen.toLocaleString()}／${BANK.length.toLocaleString()} 題</small></div>
    <div class="metric"><span>加權得分率</span><b>${data.weightedAccuracy}%</b><small>是非2分、選擇5分</small></div>
    <div class="metric"><span>題數答對率</span><b>${data.accuracy}%</b><small>${stats.correct.toLocaleString()}／${stats.answered.toLocaleString()} 題</small></div>
    <div class="metric"><span>連續學習</span><b>${data.streak} 天</b><small>最近30日平均 ${data.recentAverage}%</small></div>
    <div class="metric"><span>今日到期錯題</span><b>${data.wrongStats.due}</b><small>錯題總數 ${data.wrongStats.total} 題</small></div>`;
  $('#streakBadge').textContent = `連續 ${data.streak} 天`;
  const focus = data.weak[0];
  $('#dailyPlan').innerHTML = `
    <div class="plan-item"><i>1</i><div><b>${focus ? `強化「${esc(focus.name)}」` : '完成基礎能力檢測'}</b><span>${focus ? `目前答對率 ${focus.pct}%，建議先完成 20 題` : '先完成一組快速練習，系統才能產生弱點建議'}</span></div><button id="planPractice">開始</button></div>
    <div class="plan-item"><i>2</i><div><b>複習錯題</b><span>今日到期 ${data.wrongStats.due} 題，錯題總數 ${data.wrongStats.total} 題</span></div><button data-page="wrong">查看</button></div>
    <div class="plan-item"><i>3</i><div><b>閱讀一個採購文件主題</b><span>建立題目以外的文件應用能力</span></div><button data-page="templates">前往</button></div>`;
  $('#readinessScore').textContent = data.readiness;
  $('#readinessRing').style.setProperty('--score', `${data.readiness * 3.6}deg`);
  $('#readinessText').innerHTML = `<b>${data.readiness >= 80 ? '狀態良好' : data.readiness >= 55 ? '持續進步中' : '建議先建立穩定練習節奏'}</b><p>準備度依加權得分率、題庫覆蓋率、錯題掌握與連續學習綜合估算；目前分析可信度：${data.confidence}。不代表任何考試結果。</p>`;
  const topics = data.topics.filter((topic) => topic.answered).slice(0, 8);
  $('#topicProgress').innerHTML = topics.length
    ? topics.map((topic) => `<div class="progress-row"><span>${esc(topic.name)}</span><div class="mini-bar"><i style="width:${topic.pct}%"></i></div><b>${topic.pct}%</b></div>`).join('')
    : '<div class="empty-insight">尚無足夠資料，完成一組測驗後即可顯示弱點。</div>';
  const recent = [...data.history].reverse().slice(0, 5);
  $('#recentActivity').innerHTML = recent.length
    ? recent.map((row) => `<div class="activity-row"><div><b>${kindLabel(row.kind, row.questionCount)}</b><span>${new Date(Number(row.date)).toLocaleDateString('zh-TW')}</span></div><strong>${Math.round(Number(row.pct))}%</strong></div>`).join('')
    : '<div class="empty-insight">尚無學習紀錄。</div>';
  renderEnterpriseMission();
  const resume = $('#resumeBtn');
  const canResume = hasResumableState();
  resume.disabled = !canResume;
  resume.textContent = canResume ? '繼續未完成測驗' : '目前沒有未完成測驗';
}

function buildAdaptive(count = 20) {
  if (!BANK.length) return showAppError('題庫沒有可用題目。');
  const requested = Math.max(1, Math.min(Number(count) || 20, BANK.length));
  const data = learningData();
  const wrong = getStorage(LS.wrong, {});
  const avoidDays = getPrefs().avoidRecentDays;
  const used = new Set();
  const picked = [];
  const take = (pool, amount, allowRecent = false) => {
    const ordered = allowRecent ? shuffle(pool) : prioritizeFresh(pool, avoidDays);
    ordered.filter((q) => !used.has(q.id)).slice(0, Math.max(0, amount)).forEach((q) => { used.add(q.id); picked.push(q); });
  };
  take(BANK.filter((q) => wrong[q.id] && isWrongDue(wrong[q.id])), Math.round(requested * 0.3), true);
  take(BANK.filter((q) => wrong[q.id]), Math.round(requested * 0.15));
  take(BANK.filter((q) => q.section === data.weak[0]?.name), Math.round(requested * 0.3));
  take(BANK.filter((q) => q.section === data.weak[1]?.name), Math.round(requested * 0.2));
  take(BANK, requested - picked.length);
  const questions = picked.slice(0, requested);
  if (!questions.length) return alert('目前沒有可用題目。');
  S = createExamState('adaptive', questions, Math.max(20, requested * 1.2) * 60, false);
  S.practiceLabel = avoidDays ? `智慧練習｜避開最近${avoidDays}日題目` : 'AI 智慧練習';
  saveState();
  startExam();
}

function renderLearningCenter() {
  const data = learningData();
  const focus = data.weak[0];
  $('#coachTitle').textContent = data.stats.answered
    ? (data.accuracy >= 80 ? '表現穩定，適合進入整合練習' : data.accuracy >= 60 ? '基礎正在建立，建議針對弱點補強' : '先從高頻錯題與核心概念開始')
    : '先完成第一組測驗，讓系統認識你的學習狀況';
  $('#coachMessage').textContent = data.stats.answered
    ? `你已接觸 ${data.qSummary.uniqueSeen.toLocaleString()} 題（覆蓋率 ${data.qSummary.coverage}%），加權得分率 ${data.weightedAccuracy}%、題數答對率 ${data.accuracy}%。目前建議以「${focus?.name || '綜合基礎'}」作為優先複習方向；分析可信度為「${data.confidence}」。`
    : '完成快速50題或智慧練習後，平台會依科目答對率產生個人化建議。';
  $('#focusTopic').textContent = focus?.name || '綜合基礎能力';
  $('#focusReason').textContent = focus
    ? `你在此主題已作答 ${focus.answered} 題，答對率 ${focus.pct}%。智慧練習會優先抽入此主題、錯題及相關題目。`
    : '目前尚無足夠紀錄，推薦先進行綜合基礎練習。';
  const priority = data.weak.length ? data.weak : [{ name: '綜合基礎能力', pct: 0, answered: 0 }];
  $('#priorityTopics').innerHTML = priority.map((topic, index) => `<div class="priority-row"><span class="priority-rank">${index + 1}</span><div><b>${esc(topic.name)}</b><small>已作答 ${topic.answered} 題</small></div><div class="priority-score">${topic.answered ? `${topic.pct}%` : '待檢測'}</div></div>`).join('');
  const recentSeven = data.history.filter((row) => Date.now() - Number(row.date) < 7 * 86400000).length;
  $('#learningRhythm').innerHTML = `<div class="rhythm-stat"><b>${data.streak}</b><span>連續學習天數</span></div><div class="rhythm-stat"><b>${data.history.length}</b><span>完成測驗次數</span></div><div class="rhythm-stat"><b>${recentSeven}</b><span>最近7日測驗</span></div><p class="rhythm-tip">${data.streak >= 3 ? '目前節奏穩定，建議維持每日10至20題。' : '建議建立固定的小量練習，比一次完成大量題目更容易維持。'}</p>`;
  const mastered = data.topics.filter((topic) => topic.answered >= 10 && topic.pct >= 80).length;
  const developing = data.topics.filter((topic) => topic.answered && topic.pct >= 60 && topic.pct < 80).length;
  const priorityCount = data.topics.filter((topic) => topic.answered && topic.pct < 60).length;
  $('#abilityDistribution').innerHTML = `<div class="ability-item"><span>熟練主題</span><b>${mastered}</b></div><div class="ability-item"><span>成長中主題</span><b>${developing}</b></div><div class="ability-item"><span>優先補強主題</span><b>${priorityCount}</b></div><div class="ability-legend"><i class="mastered"></i>80%以上　<i class="developing"></i>60–79%　<i class="priority"></i>60%以下</div>`;
}

function matchesSource(question, source) {
  return question.section === source || question.section.includes(source) || source.includes(question.section);
}

function poolForCourse(course, type, used) {
  const needed = type === 'tf' ? course.tf : course.mc;
  let pool = BANK.filter((q) => q.type === type && !used.has(q.id) && course.sources.some((source) => matchesSource(q, source)));
  if (pool.length < needed) pool = BANK.filter((q) => q.type === type && !used.has(q.id));
  return shuffle(pool);
}

function createOfficialSession(sessionDef, used = new Set()) {
  const questions = [];
  sessionDef.courses.forEach((course) => {
    const trueFalse = poolForCourse(course, 'tf', used).slice(0, course.tf);
    trueFalse.forEach((q) => used.add(q.id));
    const multipleChoice = poolForCourse(course, 'mc', used).slice(0, course.mc);
    multipleChoice.forEach((q) => used.add(q.id));
    [...trueFalse, ...multipleChoice].forEach((q) => questions.push({ ...q, advancedCourse: course.name, officialSession: sessionDef.id, courseScore: course.score }));
  });
  return shuffle(questions);
}

function createExamState(kind, questions, seconds, unlimited) {
  const duration = Math.max(0, Math.round(Number(seconds) || 0));
  return {
    ...blankState(),
    kind,
    questions,
    answers: Array(questions.length).fill(null),
    marked: Array(questions.length).fill(false),
    timeSpent: Array(questions.length).fill(0),
    questionOpenedAt: Date.now(),
    seconds: duration,
    deadlineAt: unlimited ? null : Date.now() + duration * 1000,
    unlimited,
    attemptId: attemptId()
  };
}

function buildOfficial(full, sessionNo = 1) {
  if (!SCHEME?.sessions?.length) return showAppError('模擬測驗方案資料遺失。');
  const definitions = full ? SCHEME.sessions : [SCHEME.sessions.find((session) => session.id === sessionNo)].filter(Boolean);
  if (!definitions.length) return alert('找不到指定節次。');
  const usedAcrossSessions = new Set();
  const plan = definitions.map((definition) => ({ id: definition.id, name: definition.name, score: definition.score, questions: createOfficialSession(definition, usedAcrossSessions) }));
  if (plan.some((session) => !session.questions.length)) return alert('部分節次無法建立題目，請檢查題庫資料。');
  S = {
    ...blankState(),
    kind: full ? 'official-full' : 'official-single',
    plan,
    currentSession: 0,
    attemptId: attemptId()
  };
  loadCurrentSession();
  saveState();
  startExam();
}

function loadCurrentSession() {
  const current = S.plan[S.currentSession];
  if (!current?.questions?.length) throw new Error('目前節次沒有題目');
  S.questions = current.questions;
  S.answers = Array(current.questions.length).fill(null);
  S.marked = Array(current.questions.length).fill(false);
  S.timeSpent = Array(current.questions.length).fill(0);
  S.questionOpenedAt = Date.now();
  S.index = 0;
  S.seconds = 4800;
  S.deadlineAt = Date.now() + 4800 * 1000;
  S.unlimited = false;
  S.finished = false;
  S.focusLoss = 0;
}

function buildQuick() {
  const selectedSection = $('#section').value;
  const pool = BANK.filter((q) => selectedSection === 'all' || q.section === selectedSection);
  if (!pool.length) return alert('此條件沒有可用題目。');
  const count = Math.min(50, pool.length);
  const wrong = getStorage(LS.wrong, {});
  const trueFalse = prioritizeFresh(pool.filter((q) => q.type === 'tf'));
  const multipleChoice = prioritizeFresh(pool.filter((q) => q.type === 'mc'));
  let picked = [...trueFalse.slice(0, Math.min(15, count)), ...multipleChoice.slice(0, Math.min(35, Math.max(0, count - Math.min(15, count))))];
  if (picked.length < count) {
    picked = [...picked, ...prioritizeFresh(pool.filter((q) => !picked.some((chosen) => chosen.id === q.id))).slice(0, count - picked.length)];
  }
  if ($('#prioritizeWrong').checked) {
    const priorityWrong = shuffle(pool.filter((q) => wrong[q.id])).slice(0, Math.min(10, count));
    picked = [...priorityWrong, ...picked.filter((q) => !priorityWrong.some((wrongQuestion) => wrongQuestion.id === q.id))].slice(0, count);
  }
  const minutes = Number($('#duration').value) || 0;
  S = createExamState('quick', shuffle(picked), minutes * 60, minutes === 0);
  saveState();
  startExam();
}

function syncRemainingTime() {
  if (S.unlimited || S.finished || !S.deadlineAt) return S.seconds;
  S.seconds = Math.max(0, Math.ceil((Number(S.deadlineAt) - Date.now()) / 1000));
  return S.seconds;
}

function saveState() {
  S.appVersion = APP_VERSION;
  S.questionBankVersion = QUESTION_BANK_VERSION;
  S.legalAnalysisVersion = LEGAL_ANALYSIS_VERSION;
  S.savedAt = Date.now();
  setStorage(LS.state, S);
}

function hydrateQuestion(savedQuestion) {
  if (!savedQuestion || typeof savedQuestion !== 'object') return null;
  const base = BANK_BY_ID.get(canonicalQuestionId(savedQuestion.id));
  if (!base) return null;
  const metadata = {};
  ['advancedCourse', 'officialSession', 'courseScore'].forEach((key) => {
    if (savedQuestion[key] !== undefined) metadata[key] = savedQuestion[key];
  });
  return { ...base, ...metadata };
}

function hydrateRecord(record) {
  if (!record || typeof record !== 'object' || !Array.isArray(record.questions) || !Array.isArray(record.answers)) return null;
  const questions = record.questions.map(hydrateQuestion);
  if (questions.some((question) => !question) || questions.length !== record.answers.length) return null;
  const answers = record.answers.map((answer, index) => Number.isInteger(answer) && answer >= 0 && answer < questions[index].options.length ? answer : null);
  return {
    ...record,
    questions,
    answers,
    marked: Array.isArray(record.marked) && record.marked.length === questions.length ? record.marked.map(Boolean) : Array(questions.length).fill(false),
    timeSpent: Array.isArray(record.timeSpent) && record.timeSpent.length === questions.length ? record.timeSpent.map((value) => Math.max(0, Number(value) || 0)) : Array(questions.length).fill(0),
    result: calcOne(questions, answers),
    focusLoss: Math.max(0, Number(record.focusLoss) || 0)
  };
}

function normalizeRestoredState(value, syncClock = true) {
  if (!value || typeof value !== 'object') return null;
  if (!Array.isArray(value.questions) || !Array.isArray(value.answers)) return null;
  const state = { ...blankState(), ...value };
  const questions = value.questions.map(hydrateQuestion);
  if (questions.some((question) => !question) || questions.length !== value.questions.length) return null;
  state.questions = questions;
  state.answers = value.answers.length === state.questions.length
    ? value.answers.map((answer, index) => Number.isInteger(answer) && answer >= 0 && answer < state.questions[index].options.length ? answer : null)
    : Array(state.questions.length).fill(null);
  state.marked = Array.isArray(value.marked) && value.marked.length === state.questions.length ? value.marked.map(Boolean) : Array(state.questions.length).fill(false);
  state.timeSpent = Array.isArray(value.timeSpent) && value.timeSpent.length === state.questions.length ? value.timeSpent.map((item) => Math.max(0, Number(item) || 0)) : Array(state.questions.length).fill(0);
  state.questionOpenedAt = Date.now();
  state.index = Math.max(0, Math.min(Number(value.index) || 0, Math.max(0, state.questions.length - 1)));
  state.completed = Array.isArray(value.completed) ? value.completed.map(hydrateRecord).filter(Boolean) : [];
  state.plan = Array.isArray(value.plan) ? value.plan.map((session) => {
    if (!session || !Array.isArray(session.questions)) return null;
    const sessionQuestions = session.questions.map(hydrateQuestion);
    if (sessionQuestions.some((question) => !question)) return null;
    return { ...session, questions: sessionQuestions };
  }).filter(Boolean) : [];
  state.currentSession = Math.max(0, Math.min(Number(value.currentSession) || 0, Math.max(0, state.plan.length - 1)));
  state.attemptId = value.attemptId || attemptId();
  state.seconds = Math.max(0, Number(value.seconds) || 0);
  state.deadlineAt = value.deadlineAt ? Number(value.deadlineAt) : (!state.unlimited && !state.finished ? Date.now() + state.seconds * 1000 : null);
  state.questionBankVersion = QUESTION_BANK_VERSION;
  state.legalAnalysisVersion = LEGAL_ANALYSIS_VERSION;
  if (syncClock && !state.unlimited && !state.finished && state.deadlineAt) {
    state.seconds = Math.max(0, Math.ceil((state.deadlineAt - Date.now()) / 1000));
  }
  return state;
}

function startExam() {
  if (!Array.isArray(S.questions) || !S.questions.length) {
    alert('目前沒有可用題目，請重新建立測驗。');
    show('setup');
    return;
  }
  clearTimeout(autoNextTimer);
  submitting = false;
  S.index = Math.max(0, Math.min(Number(S.index) || 0, S.questions.length - 1));
  if (!Array.isArray(S.answers) || S.answers.length !== S.questions.length) S.answers = Array(S.questions.length).fill(null);
  if (!Array.isArray(S.marked) || S.marked.length !== S.questions.length) S.marked = Array(S.questions.length).fill(false);
  if (!Array.isArray(S.timeSpent) || S.timeSpent.length !== S.questions.length) S.timeSpent = Array(S.questions.length).fill(0);
  S.questionOpenedAt = Date.now();
  syncRemainingTime();
  show('exam');
  buildNav();
  renderQuestion();
  timeText();
  warningState();
  if (!S.unlimited && S.seconds <= 0 && !S.finished) setTimeout(() => submit(true), 0);
}

function examName() {
  if (S.kind === 'quick') return `快速${S.questions.length}題`;
  if (S.kind === 'adaptive') return 'AI 智慧練習';
  if (S.kind === 'wrong-review') return '錯題間隔複習';
  if (S.kind === 'law-practice' || S.kind === 'comparison-practice') return S.practiceLabel || '法條專項練習';
  const current = S.plan[S.currentSession];
  return current ? `${current.name}模擬｜${current.score}分` : '模擬測驗';
}

function buildNav() {
  $('#qnav').innerHTML = S.questions.map((_, index) => `<button data-i="${index}" aria-label="第${index + 1}題">${index + 1}</button>`).join('');
  const courses = [...new Set(S.questions.map((q) => q.advancedCourse).filter(Boolean))];
  $('#courseLegend').innerHTML = courses.map((course) => `<div>${esc(course)}</div>`).join('');
}

function goToQuestion(index, closeMobile = false) {
  if (!Number.isInteger(index) || index < 0 || index >= S.questions.length) return;
  clearTimeout(autoNextTimer);
  commitQuestionTime();
  S.index = index;
  S.questionOpenedAt = Date.now();
  saveState();
  renderQuestion();
  if (closeMobile && window.matchMedia('(max-width: 900px)').matches) closeQuestionNav();
}

function renderQuestion() {
  if (!Array.isArray(S.questions) || !S.questions.length) return;
  S.index = Math.max(0, Math.min(Number(S.index) || 0, S.questions.length - 1));
  const question = S.questions[S.index];
  if (!question) return;
  $('#examTitle').textContent = examName();
  $('#examStatus').textContent = `第 ${S.index + 1} / ${S.questions.length} 題`;
  $('#progressBar').style.width = `${((S.index + 1) / S.questions.length) * 100}%`;
  $('#typeTag').textContent = question.type === 'tf' ? '是非題・2分' : '選擇題・5分';
  $('#courseTag').textContent = question.advancedCourse || (S.kind === 'adaptive' ? 'AI 智慧練習' : '快速練習');
  $('#sectionTag').textContent = question.section;
  $('#qtext').textContent = question.question;
  $('#opts').innerHTML = question.options.map((option, index) => `<button class="option ${S.answers[S.index] === index ? 'selected' : ''}" data-i="${index}"><span class="key">${question.type === 'tf' ? (index ? '×' : '○') : String.fromCharCode(65 + index)}</span><span>${esc(option)}</span></button>`).join('');
  $('#mark').textContent = S.marked[S.index] ? '★ 已標記' : '☆ 標記';
  $$('#qnav button').forEach((button, index) => {
    button.className = '';
    if (S.answers[index] !== null) button.classList.add('answered');
    if (S.marked[index]) button.classList.add('marked');
    if (index === S.index) button.classList.add('active');
  });
  $('#answeredCount').textContent = `已答 ${S.answers.filter((answer) => answer !== null).length} 題`;
  $('#markedCount').textContent = `標記 ${S.marked.filter(Boolean).length} 題`;
  $('#prev').disabled = S.index === 0;
  $('#next').textContent = S.index === S.questions.length - 1 ? '檢查並交卷' : '下一題';
}

function timeText() {
  const timer = $('#timer');
  if (S.unlimited) { timer.textContent = '不限時'; return; }
  syncRemainingTime();
  const minutes = Math.floor(S.seconds / 60);
  const seconds = S.seconds % 60;
  timer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function warningState() {
  const bar = $('#warningBar');
  const top = $('.examtop');
  if (!bar || !top) return;
  bar.className = 'warningbar hidden';
  top.classList.remove('warning10', 'warning5', 'warning1');
  if (S.unlimited) return;
  syncRemainingTime();
  let cssClass = '';
  let message = '';
  if (S.seconds <= 60) { cssClass = 'w1'; message = '最後1分鐘，時間到將自動交卷。'; top.classList.add('warning1'); }
  else if (S.seconds <= 300) { cssClass = 'w5'; message = '最後5分鐘，請優先完成未作答題目。'; top.classList.add('warning5'); }
  else if (S.seconds <= 600) { cssClass = 'w10'; message = '剩餘10分鐘，請檢查未作答及標記題目。'; top.classList.add('warning10'); }
  if (cssClass) { bar.className = `warningbar ${cssClass}`; bar.textContent = message; }
}

setInterval(() => {
  if (S.finished || S.unlimited || !S.questions?.length || !S.deadlineAt) return;
  const remaining = syncRemainingTime();
  if (!$('#exam')?.classList.contains('hidden')) {
    timeText();
    warningState();
  }
  if (remaining !== lastTimerSave && remaining % 10 === 0) {
    lastTimerSave = remaining;
    saveState();
  }
  if (remaining <= 0 && !submitting) submit(true);
}, 1000);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && !S.finished && S.questions?.length) {
    S.focusLoss = (S.focusLoss || 0) + 1;
    syncRemainingTime();
    saveState();
  }
});

function calcOne(questions, answers) {
  let raw = 0;
  let max = 0;
  let correct = 0;
  const by = {};
  questions.forEach((question, index) => {
    const weight = question.type === 'tf' ? 2 : 5;
    const okay = answers[index] === question.answer;
    max += weight;
    if (okay) { raw += weight; correct += 1; }
    const key = question.advancedCourse || question.section;
    by[key] ??= { a: 0, c: 0, raw: 0, max: 0 };
    by[key].a += 1;
    by[key].max += weight;
    if (okay) { by[key].c += 1; by[key].raw += weight; }
  });
  return { raw, max, correct, score: max ? Math.round((raw / max) * 100) : 0, by };
}

function submit(force = false) {
  if (submitting || S.finished || !S.questions?.length) return;
  const unanswered = S.answers.filter((answer) => answer === null).length;
  const marked = S.marked.filter(Boolean).length;
  if (!force) {
    syncRemainingTime();
    const remaining = S.unlimited ? '不限時' : `${Math.floor(S.seconds / 60)}分${S.seconds % 60}秒`;
    const summary = `交卷前檢查：\n已作答 ${S.answers.length - unanswered} 題\n未作答 ${unanswered} 題\n已標記 ${marked} 題\n剩餘時間 ${remaining}\n\n確定交卷嗎？`;
    if (!confirm(summary)) return;
  }
  submitting = true;
  clearTimeout(autoNextTimer);
  commitQuestionTime();
  S.finished = true;
  const result = calcOne(S.questions, S.answers);
  const record = {
    session: (S.kind === 'quick' || S.kind === 'adaptive') ? 0 : (S.plan[S.currentSession]?.id || 0),
    name: examName(),
    questions: S.questions,
    answers: [...S.answers],
    marked: [...S.marked],
    timeSpent: [...S.timeSpent],
    result,
    focusLoss: S.focusLoss || 0
  };
  S.completed.push(record);
  updateStats(record);
  saveState();
  submitting = false;
  if (S.kind === 'official-full' && S.currentSession < S.plan.length - 1) {
    showBreak(record);
    return;
  }
  results();
}

function updateStats(record) {
  const stats = getStorage(LS.stats, { answered: 0, correct: 0, raw: 0, max: 0, tests: 0, official: 0, by: {}, type: {}, processedRecords: [], processedTests: [] });
  stats.processedRecords = Array.isArray(stats.processedRecords) ? stats.processedRecords : [];
  stats.processedTests = Array.isArray(stats.processedTests) ? stats.processedTests : [];
  stats.by = stats.by && typeof stats.by === 'object' ? stats.by : {};
  stats.type = stats.type && typeof stats.type === 'object' ? stats.type : {};
  const recordId = `${S.attemptId}:${record.session || 0}`;
  if (stats.processedRecords.includes(recordId)) return;

  const wrong = getStorage(LS.wrong, {});
  const questionStats = getQuestionStats();
  record.questions.forEach((question, index) => {
    const okay = record.answers[index] === question.answer;
    const weight = question.type === 'tf' ? 2 : 5;
    stats.answered = (Number(stats.answered) || 0) + 1;
    stats.max = (Number(stats.max) || 0) + weight;
    if (okay) { stats.correct = (Number(stats.correct) || 0) + 1; stats.raw = (Number(stats.raw) || 0) + weight; }
    stats.by[question.section] ??= { a: 0, c: 0, raw: 0, max: 0 };
    stats.by[question.section].a = (Number(stats.by[question.section].a) || 0) + 1;
    stats.by[question.section].max = (Number(stats.by[question.section].max) || 0) + weight;
    if (okay) { stats.by[question.section].c = (Number(stats.by[question.section].c) || 0) + 1; stats.by[question.section].raw = (Number(stats.by[question.section].raw) || 0) + weight; }
    stats.type[question.type] ??= { a: 0, c: 0, raw: 0, max: 0 };
    stats.type[question.type].a = (Number(stats.type[question.type].a) || 0) + 1;
    stats.type[question.type].max = (Number(stats.type[question.type].max) || 0) + weight;
    if (okay) { stats.type[question.type].c = (Number(stats.type[question.type].c) || 0) + 1; stats.type[question.type].raw = (Number(stats.type[question.type].raw) || 0) + weight; }

    const id = canonicalQuestionId(question.id);
    const qStat = normalizedQuestionStat(questionStats[id]);
    qStat.seenCount += 1;
    if (okay) qStat.correctCount += 1;
    qStat.lastSeen = Date.now();
    qStat.lastAnswer = Number.isInteger(record.answers[index]) ? record.answers[index] : null;
    qStat.lastCorrect = okay;
    qStat.totalSeconds += Math.max(0, Number(record.timeSpent?.[index]) || 0);
    questionStats[id] = qStat;

    const existing = wrong[id] ? normalizedWrongRecord(wrong[id]) : null;
    if (!okay) {
      wrong[id] = { ...(existing || {}), count: (existing?.count || 0) + 1, last: Date.now(), repetitions: 0, rightStreak: 0, intervalDays: 1, nextReview: startOfDay(Date.now()) + 86400000, status: '待複習', lastAnswer: qStat.lastAnswer };
    } else if (existing) {
      const repetitions = existing.repetitions + 1;
      const intervalDays = nextReviewSchedule(repetitions);
      wrong[id] = { ...existing, right: existing.right + 1, repetitions, rightStreak: repetitions, intervalDays, nextReview: startOfDay(Date.now()) + intervalDays * 86400000, last: Date.now(), status: repetitions >= 3 ? '已掌握' : '學習中' };
    }
  });

  stats.processedRecords.push(recordId);
  stats.processedRecords = stats.processedRecords.slice(-1500);
  const finalAttempt = S.kind !== 'official-full' || S.currentSession >= S.plan.length - 1;
  if (finalAttempt && !stats.processedTests.includes(S.attemptId)) {
    stats.tests = (Number(stats.tests) || 0) + 1;
    if (S.kind === 'official-full') stats.official = (Number(stats.official) || 0) + 1;
    stats.processedTests.push(S.attemptId);
    stats.processedTests = stats.processedTests.slice(-800);
  }
  setStorage(LS.stats, stats);
  setStorage(LS.wrong, wrong);
  setStorage(LS.questionStats, questionStats);
}

function showBreak(record) {
  show('breakPage');
  $('#breakTitle').textContent = `${S.plan[S.currentSession].name}已交卷`;
  $('#breakSummary').textContent = `本節共 ${record.questions.length} 題，已答 ${record.answers.filter((answer) => answer !== null).length} 題；答案已鎖定。`;
  $('#breakScores').innerHTML = `<div class="metric"><b>${record.result.raw}/${record.result.max}</b><span>本節原始分數</span></div><div class="metric"><b>${record.result.score}%</b><span>本節答對率</span></div><div class="metric"><b>${record.result.correct}</b><span>答對題數</span></div><div class="metric"><b>${record.focusLoss}</b><span>離開頁面次數</span></div>`;
  const next = S.plan[S.currentSession + 1];
  $('#nextSessionBtn').textContent = next ? `開始${next.name}` : '查看結果';
}

function nextSession() {
  if (S.currentSession >= S.plan.length - 1) { results(); return; }
  S.currentSession += 1;
  loadCurrentSession();
  saveState();
  startExam();
}

function allRecords() {
  if (S.completed.length) return S.completed;
  return [{ session: 0, name: examName(), questions: S.questions, answers: S.answers, marked: S.marked, result: calcOne(S.questions, S.answers), focusLoss: S.focusLoss || 0 }];
}

function kindLabel(kind, questionCount = 50) {
  if (kind === 'official-full') return '三節模擬';
  if (kind === 'official-single') return '單節練習';
  if (kind === 'adaptive') return 'AI 智慧練習';
  if (kind === 'wrong-review') return '錯題間隔複習';
  if (kind === 'law-practice') return '法條專項練習';
  if (kind === 'comparison-practice') return '易混淆法條比較';
  return `快速${Number(questionCount) || 50}題`;
}

function results() {
  show('results');
  const records = allRecords();
  const totalRaw = records.reduce((sum, record) => sum + record.result.raw, 0);
  const totalMax = records.reduce((sum, record) => sum + record.result.max, 0);
  const correct = records.reduce((sum, record) => sum + record.result.correct, 0);
  const totalQuestions = records.reduce((sum, record) => sum + record.questions.length, 0);
  const percentage = totalMax ? Math.round((totalRaw / totalMax) * 100) : 0;
  const questionAccuracy = totalQuestions ? Math.round((correct / totalQuestions) * 100) : 0;
  const official = S.kind.startsWith('official');
  $('#score').textContent = official ? totalRaw : percentage;
  $('#scoreUnit').textContent = official ? `／${totalMax}` : '分';
  $('#resultTitle').textContent = percentage >= 80 ? '已達模擬合格目標' : percentage >= 70 ? '接近目標，請加強弱項' : '建議依科目重新複習';
  $('#resultSummary').textContent = official
    ? `總得分 ${totalRaw}/${totalMax}（加權 ${percentage}%），答對 ${correct}/${totalQuestions} 題（題數 ${questionAccuracy}%）。`
    : `答對 ${correct}/${totalQuestions} 題（題數 ${questionAccuracy}%），2／5 分加權得分率 ${percentage}%。`;
  const wrong = totalQuestions - correct;
  const focusLoss = records.reduce((sum, record) => sum + record.focusLoss, 0);
  $('#resultMetrics').innerHTML = `<div class="metric"><b>${correct}</b><span>答對題數</span></div><div class="metric"><b>${wrong}</b><span>錯誤／未答</span></div><div class="metric"><b>${percentage}%</b><span>加權得分率</span></div><div class="metric"><b>${questionAccuracy}%</b><span>題數答對率</span></div><div class="metric"><b>${focusLoss}</b><span>離開頁面次數</span></div>`;
  renderSessionReport(records);
  renderTopicReport(records);
  renderReview();
  if (!S.resultsRecorded) {
    const history = getStorage(LS.history, []);
    if (!history.some((row) => row.attemptId === S.attemptId)) {
      history.push({ attemptId: S.attemptId, date: Date.now(), kind: S.kind, raw: totalRaw, max: totalMax, pct: percentage, weightedPct: percentage, correct, questionAccuracy, questionCount: totalQuestions });
      setStorage(LS.history, history.slice(-500));
    }
    S.resultsRecorded = true;
    saveState();
  }
}

function renderSessionReport(records) {
  $('#sessionReportCard h3').textContent = S.kind.startsWith('official') ? '節次與科目成績' : '科目成績';
  $('#sessionReport').innerHTML = records.map((record) => `<div class="session-block"><h4><span>${esc(record.name)}</span><b>${record.result.raw}/${record.result.max}（${record.result.score}%）</b></h4>${Object.entries(record.result.by).map(([key, value]) => { const pct = value.max ? Math.round((value.raw / value.max) * 100) : 0; return `<div class="course-score"><span>${esc(key)}</span><div class="mini-bar"><i style="width:${pct}%"></i></div><b>${value.raw}/${value.max}</b></div>`; }).join('')}</div>`).join('');
}

function renderTopicReport(records) {
  const by = {};
  records.forEach((record) => Object.entries(record.result.by).forEach(([key, value]) => {
    by[key] ??= { a: 0, c: 0, raw: 0, max: 0 };
    ['a', 'c', 'raw', 'max'].forEach((property) => { by[key][property] += Number(value[property]) || 0; });
  }));
  const rows = Object.entries(by).sort((a, b) => (a[1].max ? a[1].raw / a[1].max : 0) - (b[1].max ? b[1].raw / b[1].max : 0));
  $('#resultTopics').innerHTML = rows.length ? rows.map(([key, value], index) => {
    const pct = value.max ? Math.round((value.raw / value.max) * 100) : 0;
    return `<div class="topic-result ${index === 0 ? 'recommend' : ''}"><span>${index === 0 ? '優先複習｜' : ''}${esc(key)}</span><div class="mini-bar"><i style="width:${pct}%"></i></div><b>${pct}%</b></div>`;
  }).join('') : '<div class="empty-insight">沒有可分析的科目資料。</div>';
}

function referenceGroupTitle(origin) {
  if (origin === '題庫已驗證法源') return '題庫已驗證法源';
  if (origin === '題目明示法源') return '題目明示法源';
  if (origin === '補充參考法源') return '補充參考';
  if (origin === '關鍵字推定法源') return '關鍵字推定';
  return '科目範圍';
}

function legalAnalysisHtml(question, selectedAnswer, compact = false, context = 'browse') {
  const analysis = window.LEGAL_ANALYSIS?.getAnalysis(question, selectedAnswer, context) || {
    correctText: question.options?.[question.answer] || '',
    wrongReason: '',
    reason: question.explanation || '',
    focus: '題目中的法定要件與例外規定',
    refs: [],
    optionAnalysis: [],
    source: safeSource(question.source),
    sourceUrl: '#',
    confidence: '題庫資料',
    dataAsOfLabel: '未標示'
  };
  const statusHtml = analysis.wrongReason
    ? `<div class="wrong-analysis"><b>${analysis.wrong ? '錯誤原因' : '未作答分析'}</b><p>${esc(analysis.wrongReason)}</p></div>`
    : '';
  const grouped = new Map();
  analysis.refs.forEach((ref) => {
    const group = referenceGroupTitle(ref.origin);
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(ref);
  });
  const refsHtml = grouped.size
    ? [...grouped.entries()].map(([group, refs]) => `<div class="law-group"><h6>${esc(group)}</h6>${refs.map((ref) => `<article class="law-reference ${ref.verifiedSummary ? 'verified-law' : ''}"><div class="law-reference-head"><span>${esc(ref.origin)}</span><b>${esc(ref.label)}</b></div><p>${esc(ref.summary)}</p><div class="law-meta">${ref.revisionDate ? `<span>法規修正日期：${esc(ref.revisionDate)}</span>` : '<span>修正日期：請開啟官方全文確認</span>'}${ref.verifiedSummary ? `<span>核心摘要已核對（${esc(ref.verifiedAt || analysis.dataAsOfLabel)}）</span>` : '<span>摘要僅供索引</span>'}</div><div class="law-links"><a href="${esc(ref.url)}" target="_blank" rel="noopener noreferrer">開啟官方法規全文 ↗</a><button class="law-filter" data-law-key="${esc(ref.key)}">查看同法條題目</button></div></article>`).join('')}</div>`).join('')
    : '<p class="legal-empty">未能辨識具體條次。平台不會把科目推定當成本題唯一依據，請依題庫出處與官方最新資料查核。</p>';
  const optionHtml = analysis.optionAnalysis?.length
    ? `<details class="option-analysis" ${compact ? '' : 'open'}><summary>逐選項判讀</summary><div>${analysis.optionAnalysis.map((row) => `<article class="option-analysis-row ${row.correct ? 'correct' : ''} ${row.selected ? 'selected' : ''}"><div><b>選項 ${row.index + 1}</b><span>${row.correct ? '題庫答案' : row.selected ? '你的選擇' : '非題庫答案'}</span></div><p>${esc(row.text)}</p><small>${esc(row.reason)}</small></article>`).join('')}</div></details>`
    : '';
  return `<section class="legal-analysis ${compact ? 'compact-legal' : ''}">
    ${statusHtml}
    <div class="analysis-section"><h5>答案解析</h5><p>${esc(analysis.reason)}</p></div>
    <div class="analysis-section"><h5>判斷關鍵</h5><p>${esc(analysis.focus)}</p></div>
    ${optionHtml}
    <div class="analysis-section"><div class="analysis-title-row"><h5>法源依據</h5><span class="basis-confidence">${esc(analysis.confidence)}</span></div><div class="law-reference-list">${refsHtml}</div></div>
    <div class="analysis-section source-detail"><h5>題庫出處</h5><p>${esc(analysis.source)}</p><a href="${esc(analysis.sourceUrl)}" target="_blank" rel="noopener noreferrer">查看工程會官方資料入口 ↗</a></div>
    <p class="legal-note">法源資料核對日：${esc(analysis.dataAsOfLabel)}。已核對標記僅表示法規名稱、修正日期、官方連結與核心摘要經對照，不代表本題答案及法源關係已逐題人工認證。標示「關鍵字推定」或「科目範圍」者不是本題已確認的唯一法條；實務案件仍應以最新法規、函釋、招標文件、契約及個案事實為準。</p>
  </section>`;
}

function renderReview() {
  const rows = [];
  allRecords().forEach((record) => record.questions.forEach((question, index) => rows.push({ question, answer: record.answers[index], okay: record.answers[index] === question.answer, session: record.session, recordName: record.name })));
  const filtered = rows.filter((row) => S.review === 'all' || !row.okay);
  $('#reviewCount').textContent = `${filtered.length}題`;
  $('#reviewList').innerHTML = filtered.length ? filtered.map(({ question, answer, okay, session, recordName }) => {
    const answerText = answer === null || !question.options[answer] ? '未作答' : question.options[answer];
    return `<div class="review-item"><div class="tags"><span>${session ? `第${session}節` : esc(recordName || (S.kind === 'adaptive' ? 'AI 智慧練習' : `快速${S.questions.length}題`))}</span><span>${esc(question.advancedCourse || question.section)}</span><span>${question.type === 'tf' ? '是非題' : '選擇題'}</span></div><h4>${esc(question.question)}</h4><p>${question.options.map((option, index) => `(${index + 1}) ${esc(option)}`).join('　')}</p><span class="pill ${okay ? 'ok' : 'bad'}">你的答案：${esc(answerText)}</span><span class="pill ok">正確答案：${esc(question.options[question.answer])}</span>${legalAnalysisHtml(question, answer, false, 'review')}</div>`;
  }).join('') : '<div class="empty-insight">這次沒有錯題。</div>';
}

function filteredBankRows() {
  const term = $('#search').value.trim().toLowerCase();
  const selectedSection = $('#bankSection').value;
  const selectedType = $('#bankType').value;
  let legalIds = null;
  if (bankLegalKey !== 'all') {
    const entry = ensureLegalIndex().find((item) => item.key === bankLegalKey);
    legalIds = new Set(entry?.questionIds || []);
  }
  return BANK.filter((question) => {
    if (selectedSection !== 'all' && question.section !== selectedSection) return false;
    if (selectedType !== 'all' && question.type !== selectedType) return false;
    if (legalIds && !legalIds.has(question.id)) return false;
    if (!term) return true;
    const base = `${question.question} ${(question.options || []).join(' ')} ${question.section || ''} ${question.source || ''} ${question.number || ''} ${question.explanation || ''}`.toLowerCase();
    if (base.includes(term)) return true;
    return legalRefsFor(question).some((ref) => `${ref.label} ${ref.origin}`.toLowerCase().includes(term));
  });
}

function renderBank() {
  const rows = filteredBankRows();
  const pageCount = Math.max(1, Math.ceil(rows.length / BANK_PAGE_SIZE));
  bankPage = Math.max(1, Math.min(bankPage, pageCount));
  const start = (bankPage - 1) * BANK_PAGE_SIZE;
  const pageRows = rows.slice(start, start + BANK_PAGE_SIZE);
  const legalEntry = bankLegalKey === 'all' ? null : ensureLegalIndex().find((entry) => entry.key === bankLegalKey);
  $('#bankCount').innerHTML = `找到 ${rows.length.toLocaleString()} 題｜第 ${bankPage}/${pageCount} 頁${legalEntry ? `｜法源篩選：<b>${esc(legalEntry.label)}</b> <button id="clearLegalFilter" class="text-button">清除</button>` : ''}`;
  $('#bankList').innerHTML = pageRows.length ? pageRows.map((q) => `<article class="bank-item"><div class="tags"><span>${q.type === 'tf' ? '是非題' : '選擇題'}</span><span>${esc(q.section)}</span><span>原編號 ${esc(q.number)}</span></div><h3>${esc(q.question)}</h3><p>${q.options.map((option, index) => `(${index + 1}) ${esc(option)}`).join('　')}</p><div class="bank-actions"><button class="answer-toggle">顯示詳細答案</button><button class="favorite-toggle ${isFavorite(q.id) ? 'active' : ''}" data-id="${esc(q.id)}">${isFavorite(q.id) ? '★ 已收藏' : '☆ 收藏'}</button></div><div class="answer-box hidden"><div class="correct-answer-line"><b>正確答案：</b>${esc(q.options[q.answer])}</div>${legalAnalysisHtml(q, undefined, true, 'browse')}</div></article>`).join('') : '<div class="card wrong-empty">沒有符合條件的題目。</div>';
  $('#bankPagination').innerHTML = `<button id="bankPrev" class="secondary" ${bankPage <= 1 ? 'disabled' : ''}>上一頁</button><span>第 ${bankPage} / ${pageCount} 頁</span><button id="bankNext" class="secondary" ${bankPage >= pageCount ? 'disabled' : ''}>下一頁</button>`;
}

function renderLawIndex() {
  const term = ($('#lawSearch')?.value || '').trim().toLowerCase();
  const entries = ensureLegalIndex().filter((entry) => !term || `${entry.label} ${entry.origin}`.toLowerCase().includes(term));
  const directTotal = entries.reduce((sum, entry) => sum + entry.directCount, 0);
  const inferredTotal = entries.reduce((sum, entry) => sum + entry.inferredCount, 0);
  const verifiedEntries = entries.filter((entry) => entry.verifiedSummary).length;
  $('#lawIndexStats').innerHTML = `<div class="metric"><b>${entries.length}</b><span>法條索引</span></div><div class="metric"><b>${verifiedEntries}</b><span>核心摘要已核對</span></div><div class="metric"><b>${directTotal}</b><span>題目明示／結構化</span></div><div class="metric"><b>${inferredTotal}</b><span>補充或推定關聯</span></div><div class="metric"><b>${window.LEGAL_ANALYSIS?.DATA_AS_OF_LABEL || '未標示'}</b><span>資料核對日</span></div>`;
  $('#lawIndexList').innerHTML = entries.length ? entries.map((entry) => `<article class="law-index-row"><div><span>${esc(entry.origin)}</span><h3>${esc(entry.label)}</h3><p>${esc(entry.summary)}</p><small>直接關聯 ${entry.directCount} 題｜補充／推定 ${entry.inferredCount} 題</small></div><div class="law-index-actions"><a href="${esc(entry.url)}" target="_blank" rel="noopener noreferrer">官方全文 ↗</a><button class="primary law-filter" data-law-key="${esc(entry.key)}">查看 ${entry.questionIds.length} 題</button></div></article>`).join('') : '<div class="card wrong-empty">沒有符合條件的法條索引。</div>';
}

function wrongDateText(record) {
  const normalized = normalizedWrongRecord(record);
  if (normalized.nextReview <= Date.now()) return '今日到期';
  return `下次複習：${new Date(normalized.nextReview).toLocaleDateString('zh-TW')}`;
}

function buildWrongPractice(mode = 'due') {
  const wrong = getStorage(LS.wrong, {});
  const pool = BANK.filter((question) => wrong[question.id] && (mode === 'all' || isWrongDue(wrong[question.id])));
  if (!pool.length) return alert(mode === 'due' ? '目前沒有到期錯題。' : '目前沒有錯題紀錄。');
  const questions = shuffle(pool).slice(0, 50);
  S = createExamState('wrong-review', questions, 0, true);
  saveState();
  startExam();
}

function renderWrong() {
  const wrong = getStorage(LS.wrong, {});
  const summary = wrongSummary(wrong);
  if ($('#wrongSummary')) $('#wrongSummary').innerHTML = `<div class="metric"><b>${summary.total}</b><span>錯題總數</span></div><div class="metric"><b>${summary.due}</b><span>今日到期</span></div><div class="metric"><b>${summary.learning}</b><span>學習中</span></div><div class="metric"><b>${summary.mastered}</b><span>已掌握待追蹤</span></div>`;
  const rows = BANK.filter((question) => {
    const record = wrong[question.id];
    if (!record) return false;
    const normalized = normalizedWrongRecord(record);
    if (wrongFilter === 'due') return isWrongDue(normalized);
    if (wrongFilter === 'learning') return normalized.repetitions > 0 && normalized.repetitions < 3;
    if (wrongFilter === 'mastered') return normalized.repetitions >= 3;
    return true;
  }).sort((a, b) => Number(normalizedWrongRecord(wrong[a.id]).nextReview) - Number(normalizedWrongRecord(wrong[b.id]).nextReview) || Number(normalizedWrongRecord(wrong[b.id]).last || 0) - Number(normalizedWrongRecord(wrong[a.id]).last || 0));
  $('#wrongList').innerHTML = rows.length ? rows.map((q) => { const record = normalizedWrongRecord(wrong[q.id]); return `<article class="bank-item"><div class="tags"><span>${q.type === 'tf' ? '是非題' : '選擇題'}</span><span>${esc(q.section)}</span><span>錯誤 ${record.count} 次</span><span>${esc(record.status)}</span><span>${esc(wrongDateText(record))}</span></div><h3>${esc(q.question)}</h3><p>${q.options.map((option, index) => `(${index + 1}) ${esc(option)}`).join('　')}</p><div class="answer-box"><div class="correct-answer-line"><b>正確答案：</b>${esc(q.options[q.answer])}</div>${legalAnalysisHtml(q, record.lastAnswer, true, 'review')}</div><button class="favorite-toggle ${isFavorite(q.id) ? 'active' : ''}" data-id="${esc(q.id)}">${isFavorite(q.id) ? '★ 已收藏' : '☆ 收藏'}</button></article>`; }).join('') : '<div class="card wrong-empty">此篩選目前沒有題目。</div>';
}

function safeSource(source = '') {
  return String(source || '題庫未標示原始來源').replace(/\s+/g, ' ').trim();
}

function favorites() { return getStorage(LS.favorites, {}); }
function isFavorite(id) { return Boolean(favorites()[id]); }
function toggleFavorite(id) {
  const collection = favorites();
  if (collection[id]) delete collection[id];
  else collection[id] = { saved: Date.now() };
  setStorage(LS.favorites, collection);
}

function renderFavorites() {
  const collection = favorites();
  const rows = BANK.filter((q) => collection[q.id]).sort((a, b) => Number(collection[b.id]?.saved) - Number(collection[a.id]?.saved));
  $('#favoriteList').innerHTML = rows.length ? rows.map((q) => `<article class="bank-item"><div class="tags"><span>${q.type === 'tf' ? '是非題' : '選擇題'}</span><span>${esc(q.section)}</span></div><h3>${esc(q.question)}</h3><p>${q.options.map((option, index) => `(${index + 1}) ${esc(option)}`).join('　')}</p><div class="answer-box"><div class="correct-answer-line"><b>正確答案：</b>${esc(q.options[q.answer])}</div>${legalAnalysisHtml(q, undefined, true, 'browse')}</div><button class="favorite-toggle active" data-id="${esc(q.id)}">★ 移除收藏</button></article>`).join('') : '<div class="card wrong-empty">目前沒有收藏題目。</div>';
}

function topWrongLaws(limit = 8) {
  const wrong = getStorage(LS.wrong, {});
  const counts = new Map();
  Object.entries(wrong).forEach(([id, record]) => {
    const question = BANK_BY_ID.get(canonicalQuestionId(id));
    if (!question) return;
    const weight = Math.max(1, normalizedWrongRecord(record).count);
    legalRefsFor(question).filter((ref) => ['題庫已驗證法源', '題目明示法源', '關鍵字推定法源'].includes(ref.origin)).slice(0, 3).forEach((ref) => {
      const current = counts.get(ref.key) || { ...ref, count: 0 };
      current.count += weight;
      counts.set(ref.key, current);
    });
  });
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

function renderAnalytics() {
  const data = learningData();
  const stats = data.stats;
  const officialRows = data.history.filter((row) => String(row.kind || '').startsWith('official'));
  $('#analyticsMetrics').innerHTML = `<div class="metric"><span>題庫覆蓋率</span><b>${data.qSummary.coverage}%</b><small>${data.qSummary.uniqueSeen}/${BANK.length}題</small></div><div class="metric"><span>加權得分率</span><b>${data.weightedAccuracy}%</b><small>${stats.raw || 0}/${stats.max || 0}分</small></div><div class="metric"><span>題數答對率</span><b>${data.accuracy}%</b><small>${stats.correct || 0}/${stats.answered || 0}題</small></div><div class="metric"><span>正式模擬平均</span><b>${data.officialAverage}%</b><small>${officialRows.length}次紀錄</small></div><div class="metric"><span>平均作答時間</span><b>${data.qSummary.averageSeconds}秒</b><small>依已記錄題次估算</small></div>`;
  const trend = data.history.slice(-20);
  $('#analyticsTrend').innerHTML = trend.length ? `<div class="trend-chart">${trend.map((row) => `<div class="trend-column" title="${esc(kindLabel(row.kind, row.questionCount))} ${Math.round(Number(row.pct))}%"><i style="height:${Math.max(4, Math.min(100, Number(row.pct) || 0))}%"></i><span>${new Date(Number(row.date)).toLocaleDateString('zh-TW',{month:'numeric',day:'numeric'})}</span></div>`).join('')}</div><p class="chart-note">最近 ${trend.length} 次測驗；柱高為2／5分加權得分率。</p>` : '<div class="empty-insight">完成測驗後顯示趨勢。</div>';
  const typeRows = ['tf','mc'].map((type) => ({ type, value: stats.type?.[type] || { a: 0, c: 0, raw: 0, max: 0 } }));
  $('#analyticsTypes').innerHTML = typeRows.map(({type,value}) => { const weighted = value.max ? Math.round(value.raw/value.max*100) : 0; const question = value.a ? Math.round(value.c/value.a*100) : 0; return `<div class="analytics-row"><div><b>${type==='tf'?'是非題':'選擇題'}</b><small>${value.c || 0}/${value.a || 0}題</small></div><div class="dual-score"><span>加權 ${weighted}%</span><span>題數 ${question}%</span></div></div>`; }).join('');
  const topicRows = data.topics.filter((topic) => topic.answered).slice(0, 12);
  $('#analyticsTopics').innerHTML = topicRows.length ? topicRows.map((topic) => `<div class="progress-row"><span>${esc(topic.name)}</span><div class="mini-bar"><i style="width:${topic.pct}%"></i></div><b>${topic.pct}%</b></div>`).join('') : '<div class="empty-insight">尚無科目資料。</div>';
  const lawRows = topWrongLaws();
  $('#analyticsLaws').innerHTML = lawRows.length ? lawRows.map((ref,index) => `<div class="law-weak-row"><i>${index+1}</i><div><b>${esc(ref.label)}</b><small>${esc(ref.origin)}</small></div><span>${ref.count}次</span><button class="law-filter text-button" data-law-key="${esc(ref.key)}">練習</button></div>`).join('') : '<div class="empty-insight">尚無可分析的錯題法條。</div>';
  const audit = window.LEGAL_ANALYSIS?.audit(BANK) || {};
  $('#legalAuditMetrics').innerHTML = `<div class="metric"><b>${audit.verifiedArticleKeys || 0}</b><span>已核對核心條文</span></div><div class="metric"><b>${audit.withVerifiedArticleSummary || 0}</b><span>可連結核對摘要題目</span></div><div class="metric"><b>${audit.explicit || 0}</b><span>題目明示法源</span></div><div class="metric"><b>${audit.inferredOnly || 0}</b><span>僅關鍵字推定</span></div><div class="metric"><b>${audit.scopeOnly || 0}</b><span>僅科目範圍</span></div>`;
  $('#legalAuditNote').textContent = window.LEGAL_ANALYSIS?.VERIFICATION?.scopeNote || '法源標記僅供學習索引。';
  const weak = data.weak[0];
  const recs = [
    data.wrongStats.due ? `先完成今日到期的 ${data.wrongStats.due} 題錯題複習。` : '今日沒有到期錯題，可進行新題覆蓋。',
    data.qSummary.coverage < 30 ? `題庫覆蓋率目前 ${data.qSummary.coverage}%，建議啟用智慧練習並避開最近7日題目。` : `題庫覆蓋率已達 ${data.qSummary.coverage}%，可提高正式模擬與整合題比例。`,
    weak ? `目前最弱科目為「${weak.name}」（加權 ${weak.pct}%），建議先做20題專項。` : '完成更多題目後，平台會產生科目弱點建議。',
    data.weightedAccuracy !== data.accuracy ? `加權得分率 ${data.weightedAccuracy}% 與題數答對率 ${data.accuracy}% 不同，代表選擇題表現對總分影響較大。` : '目前加權得分率與題數答對率相近。'
  ];
  $('#analyticsRecommendations').innerHTML = recs.map((text,index) => `<div class="recommendation-row"><i>${index+1}</i><span>${esc(text)}</span></div>`).join('');
}

function populateSpecialPractice() {
  const select = $('#lawPracticeSelect');
  if (select) {
    const entries = ensureLegalIndex().filter((entry) => entry.directCount >= 2).sort((a,b) => b.directCount-a.directCount).slice(0,150);
    select.innerHTML = entries.map((entry) => `<option value="${esc(entry.key)}">${esc(entry.label)}｜直接${entry.directCount}題</option>`).join('');
  }
  const comparison = $('#comparisonSelect');
  if (comparison) comparison.innerHTML = COMPARISON_SETS.map((set) => `<option value="${esc(set.id)}">${esc(set.name)}</option>`).join('');
}

function buildLawPractice(key, count = 20) {
  const entry = ensureLegalIndex().find((item) => item.key === key);
  if (!entry) return alert('找不到指定法條。');
  const direct = (entry.directQuestionIds || []).map((id) => BANK_BY_ID.get(id)).filter(Boolean);
  const inferred = (entry.inferredQuestionIds || []).map((id) => BANK_BY_ID.get(id)).filter(Boolean);
  const pool = [...prioritizeFresh(direct), ...prioritizeFresh(inferred)].filter((question,index,array) => array.findIndex((item) => item.id === question.id) === index);
  const questions = pool.slice(0, Math.max(1, Math.min(Number(count) || 20, 50)));
  if (!questions.length) return alert('此法條目前沒有可用題目。');
  S = createExamState('law-practice', questions, 0, true);
  S.practiceLabel = `${entry.label}專項`;
  saveState(); startExam();
}

function buildComparisonPractice(setId, count = 20) {
  const set = COMPARISON_SETS.find((item) => item.id === setId);
  if (!set) return alert('找不到指定比較組合。');
  const articleSet = new Set(set.articles.map((row) => `${row.law}:${row.article}`));
  const direct = [];
  const inferred = [];
  BANK.forEach((question) => {
    const refs = legalRefsFor(question).filter((ref) => articleSet.has(`${ref.name}:${ref.article}`));
    if (refs.some((ref) => ['題庫已驗證法源','題目明示法源'].includes(ref.origin))) direct.push(question);
    else if (refs.length) inferred.push(question);
  });
  const pool = [...prioritizeFresh(direct), ...prioritizeFresh(inferred)].filter((question,index,array) => array.findIndex((item) => item.id === question.id) === index);
  const questions = pool.slice(0, Math.max(1, Math.min(Number(count) || 20, 50)));
  if (!questions.length) return alert('此比較組合目前沒有可用題目。');
  S = createExamState('comparison-practice', questions, 0, true);
  S.practiceLabel = set.name;
  saveState(); startExam();
}

function storageUsage() {
  let bytes = 0;
  Object.keys(localStorage).forEach((key) => { bytes += key.length + (localStorage.getItem(key)?.length || 0); });
  return bytes;
}

function exportDiagnostics() {
  const audit = window.LEGAL_ANALYSIS?.audit(BANK) || {};
  const payload = { app: APP_NAME, version: APP_VERSION, generatedAt: new Date().toISOString(), userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, online: navigator.onLine, storageBytes: storageUsage(), bank: { valid: BANK.length, invalid: bankCheck.invalid, duplicateContent: bankCheck.duplicateContent, aliases: QUESTION_ID_ALIASES }, legalAudit: audit, learning: learningData(), runtimeErrors: runtimeErrors.slice(-30) };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `${APP_NAME.replace(/\s+/g, '')}_V${APP_VERSION}_診斷_${new Date().toISOString().slice(0,10)}.json`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
}

function showUpdateBanner(worker) {
  waitingWorker = worker || waitingWorker;
  $('#updateBanner')?.classList.remove('hidden');
}

async function registerServiceWorker() {
  const status = $('#pwaStatus');
  if (!('serviceWorker' in navigator)) { if (status) status.textContent = '此瀏覽器不支援離線安裝。'; return; }
  try {
    const registration = await navigator.serviceWorker.register('./service-worker.js');
    if (status) status.textContent = navigator.onLine ? '離線快取已啟用；第一次完整載入後可離線使用。' : '目前為離線模式。';
    if (registration.waiting) showUpdateBanner(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(worker); });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
  } catch (error) {
    runtimeErrors.push({ time: Date.now(), type: 'service-worker', message: String(error?.message || error) });
    if (status) status.textContent = '離線快取註冊失敗，仍可使用一般網頁模式。';
  }
}

function renderHistory() {
  const rows = [...getStorage(LS.history, [])].filter((row) => row && Number.isFinite(Number(row.pct))).reverse();
  const weightedAverage = rows.length ? Math.round(rows.reduce((sum, row) => sum + Number(row.pct), 0) / rows.length) : 0;
  const questionRows = rows.filter((row) => Number.isFinite(Number(row.questionAccuracy)));
  const questionAverage = questionRows.length ? Math.round(questionRows.reduce((sum, row) => sum + Number(row.questionAccuracy), 0) / questionRows.length) : 0;
  const best = rows.length ? Math.max(...rows.map((row) => Number(row.pct))) : 0;
  const coverage = questionStatsSummary().coverage;
  $('#historySummary').innerHTML = `<div class="metric"><b>${rows.length}</b><span>完成測驗</span></div><div class="metric"><b>${weightedAverage}%</b><span>平均加權得分</span></div><div class="metric"><b>${questionAverage}%</b><span>平均題數答對率</span></div><div class="metric"><b>${best}%</b><span>最佳加權成績</span></div><div class="metric"><b>${coverage}%</b><span>題庫覆蓋率</span></div>`;
  $('#historyList').innerHTML = rows.length ? rows.map((row) => `<div class="history-row"><div><b>${kindLabel(row.kind, row.questionCount)}</b><span>${new Date(Number(row.date)).toLocaleString('zh-TW')}</span><small>加權 ${Math.round(Number(row.pct))}%${Number.isFinite(Number(row.questionAccuracy)) ? `｜題數 ${Math.round(Number(row.questionAccuracy))}%` : ''}</small></div><strong>${Number(row.raw) || 0}/${Number(row.max) || 0}</strong><em>${Math.round(Number(row.pct))}%</em></div>`).join('') : '<div class="wrong-empty">尚無學習紀錄。</div>';
}

function getPrefs() {
  return { largeText: false, compactMode: false, autoNext: false, avoidRecentDays: 7, ...getStorage(LS.prefs, {}) };
}

function applyPrefs() {
  const prefs = getPrefs();
  document.body.classList.toggle('large-text', Boolean(prefs.largeText));
  document.body.classList.toggle('compact', Boolean(prefs.compactMode));
}

function loadPrefs() {
  const prefs = getPrefs();
  $('#largeText').checked = Boolean(prefs.largeText);
  $('#compactMode').checked = Boolean(prefs.compactMode);
  $('#autoNext').checked = Boolean(prefs.autoNext);
  if ($('#avoidRecentDays')) $('#avoidRecentDays').value = String(Math.max(0, Number(prefs.avoidRecentDays) || 0));
  applyPrefs();
}

function savePrefs() {
  setStorage(LS.prefs, { largeText: $('#largeText').checked, compactMode: $('#compactMode').checked, autoNext: $('#autoNext').checked, avoidRecentDays: Math.max(0, Number($('#avoidRecentDays')?.value) || 0) });
  applyPrefs();
}

function exportData() {
  const payload = {
    app: APP_NAME,
    version: APP_VERSION,
    questionBankVersion: QUESTION_BANK_VERSION,
    legalAnalysisVersion: LEGAL_ANALYSIS_VERSION,
    exportedAt: new Date().toISOString(),
    data: Object.fromEntries(Object.values(LS).map((key) => [key, getStorage(key, null)]))
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${APP_NAME.replace(/\s+/g, '')}_V${APP_VERSION}_備份_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function validImportedValue(destination, value) {
  if (destination === LS.history) return Array.isArray(value) && value.length <= 5000;
  if ([LS.state, LS.wrong, LS.stats, LS.favorites, LS.prefs, LS.questionStats, LS.enterprise].includes(destination)) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }
  return false;
}

function safeNonNegative(value, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(0, number)) : 0;
}

function sanitizeScoreBucket(value) {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const a = Math.round(safeNonNegative(row.a, 10000000));
  const c = Math.min(a, Math.round(safeNonNegative(row.c, 10000000)));
  const max = safeNonNegative(row.max, 50000000);
  const raw = Math.min(max, safeNonNegative(row.raw, 50000000));
  return { a, c, raw, max };
}

function sanitizeStats(value) {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const by = {};
  Object.entries(row.by && typeof row.by === 'object' && !Array.isArray(row.by) ? row.by : {}).slice(0, 100).forEach(([key, bucket]) => {
    if (sections.includes(key)) by[key] = sanitizeScoreBucket(bucket);
  });
  const type = {};
  ['tf', 'mc'].forEach((key) => { if (row.type?.[key]) type[key] = sanitizeScoreBucket(row.type[key]); });
  const answered = Math.round(safeNonNegative(row.answered, 10000000));
  const correct = Math.min(answered, Math.round(safeNonNegative(row.correct, 10000000)));
  const max = safeNonNegative(row.max, 50000000);
  const raw = Math.min(max, safeNonNegative(row.raw, 50000000));
  return {
    answered, correct, raw, max,
    tests: Math.round(safeNonNegative(row.tests, 1000000)),
    official: Math.round(safeNonNegative(row.official, 1000000)),
    by, type,
    processedRecords: Array.isArray(row.processedRecords) ? row.processedRecords.filter((item) => typeof item === 'string' && item.length <= 160).slice(-1500) : [],
    processedTests: Array.isArray(row.processedTests) ? row.processedTests.filter((item) => typeof item === 'string' && item.length <= 160).slice(-800) : []
  };
}

function sanitizeHistory(value) {
  return value.filter((row) => row && typeof row === 'object' && Number.isFinite(Number(row.date)) && Number.isFinite(Number(row.pct))).slice(-500).map((row) => {
    const max = safeNonNegative(row.max, 50000000);
    const raw = Math.min(max, safeNonNegative(row.raw, 50000000));
    const questionCount = Math.round(safeNonNegative(row.questionCount, 10000));
    const correct = Math.min(questionCount, Math.round(safeNonNegative(row.correct, 10000)));
    const pct = Math.min(100, safeNonNegative(row.pct, 100));
    return {
      attemptId: typeof row.attemptId === 'string' ? row.attemptId.slice(0, 160) : '',
      date: Number(row.date),
      kind: typeof row.kind === 'string' ? row.kind.slice(0, 40) : 'quick',
      raw, max, pct,
      weightedPct: Math.min(100, safeNonNegative(row.weightedPct ?? pct, 100)),
      correct,
      questionAccuracy: Math.min(100, safeNonNegative(row.questionAccuracy, 100)),
      questionCount
    };
  });
}

function sanitizeImportedValue(destination, value) {
  if (destination === LS.history) return sanitizeHistory(value);
  if (destination === LS.state) return normalizeRestoredState(value, false);
  if (destination === LS.stats) return sanitizeStats(value);
  if (destination === LS.wrong) return Object.fromEntries(Object.entries(value).slice(0, BANK.length).map(([id, record]) => [canonicalQuestionId(id), record]).filter(([id]) => BANK_BY_ID.has(id)).map(([id, record]) => [id, normalizedWrongRecord(record)]));
  if (destination === LS.favorites) return Object.fromEntries(Object.entries(value).slice(0, BANK.length).map(([id, record]) => [canonicalQuestionId(id), record]).filter(([id]) => BANK_BY_ID.has(id)).map(([id, record]) => [id, { saved: Math.max(0, Number(record?.saved) || Date.now()) }]));
  if (destination === LS.questionStats) return Object.fromEntries(Object.entries(value).slice(0, BANK.length).map(([id, record]) => [canonicalQuestionId(id), record]).filter(([id]) => BANK_BY_ID.has(id)).map(([id, record]) => [id, normalizedQuestionStat(record)]));
  if (destination === LS.prefs) return { largeText: Boolean(value.largeText), compactMode: Boolean(value.compactMode), autoNext: Boolean(value.autoNext), avoidRecentDays: Math.min(365, Math.max(0, Number(value.avoidRecentDays) || 7)) };
  if (destination === LS.enterprise) return normalizeEnterpriseState(value);
  return null;
}

async function importData(file) {
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error('備份檔超過8MB');
    const payload = JSON.parse(await file.text());
    const acceptedApps = new Set([APP_NAME, '政府採購 AI 學習平台']);
    if (!payload || !acceptedApps.has(payload.app) || !payload.data || typeof payload.data !== 'object') throw new Error('不是本平台的有效備份');
    if (!confirm(`即將匯入 V${payload.version || '未知'} 備份，並覆蓋目前學習資料。系統會先下載目前資料備份，確定繼續嗎？`)) return;
    exportData();
    const importMap = new Map(Object.values(LS).map((key) => [key, key]));
    Object.entries(LEGACY_KEY_MAP).forEach(([oldKey, newKey]) => importMap.set(oldKey, newKey));
    let imported = 0;
    Object.entries(payload.data).forEach(([key, value]) => {
      const destination = importMap.get(key);
      if (!destination || value === null || !validImportedValue(destination, value)) return;
      const sanitized = sanitizeImportedValue(destination, value);
      if (sanitized !== null && setStorage(destination, sanitized, true)) imported += 1;
    });
    if (!imported) throw new Error('備份中沒有可匯入的資料');
    S = blankState();
    migrateReviewRecords();
    applyPrefs();
    dashboard();
    toast('備份資料已匯入');
  } catch (error) {
    alert(`無法匯入：${error.message}`);
  } finally {
    $('#importData').value = '';
  }
}

function resetAllData() {
  ALL_STORAGE_KEYS.forEach(removeStorage);
  location.reload();
}

function refreshCurrentList() {
  const visible = $('.page:not(.hidden)')?.id;
  if (visible === 'bank') renderBank();
  if (visible === 'wrong') renderWrong();
  if (visible === 'lawIndex') renderLawIndex();
  if (visible === 'favorites') renderFavorites();
  dashboard();
}

function scheduleAutoNext(answeredIndex) {
  clearTimeout(autoNextTimer);
  if (!getPrefs().autoNext || answeredIndex >= S.questions.length - 1) return;
  autoNextTimer = setTimeout(() => {
    if (S.finished || S.index !== answeredIndex || S.answers[answeredIndex] === null) return;
    goToQuestion(answeredIndex + 1);
  }, 320);
}

function handleButtonClick(event, button) {
  const id = button.id;
  if (id === 'mobileMore' || id === 'mobileMoreTop') { event.preventDefault(); openMobileMore(); return true; }
  if (id === 'closeMobileMore') { event.preventDefault(); closeMobileMore(); return true; }
  if (id === 'mobileQuestionNav') { event.preventDefault(); openQuestionNav(); return true; }
  if (id === 'closeQuestionNav') { event.preventDefault(); closeQuestionNav(); return true; }
  if (id === 'nextUnanswered') {
    event.preventDefault();
    const next = S.answers.findIndex((answer, index) => index > S.index && answer === null);
    const first = S.answers.findIndex((answer) => answer === null);
    const target = next >= 0 ? next : first;
    if (target >= 0) goToQuestion(target, true); else alert('目前沒有未作答題目。');
    return true;
  }
  if (id === 'nextMarked') {
    event.preventDefault();
    const next = S.marked.findIndex((marked, index) => index > S.index && marked);
    const first = S.marked.findIndex(Boolean);
    const target = next >= 0 ? next : first;
    if (target >= 0) goToQuestion(target, true); else alert('目前沒有標記題目。');
    return true;
  }
  if (id === 'clearHistoryOnly' || id === 'clearHistory') {
    event.preventDefault();
    if (confirm('只清除完成測驗紀錄，保留累積統計與 AI 分析，確定繼續？')) {
      removeStorage(LS.history);
      renderHistory();
      dashboard();
    }
    return true;
  }
  if (id === 'clearLearningStats') {
    event.preventDefault();
    if (confirm('這會清除測驗紀錄、累積答題統計與 AI 弱點分析，但保留錯題、收藏與顯示設定，確定繼續？')) {
      removeStorage(LS.history); removeStorage(LS.stats); removeStorage(LS.state);
      S = blankState();
      renderHistory(); dashboard();
    }
    return true;
  }
  if (id === 'askTutor') { event.preventDefault(); askTutor(); return true; }
  if (id === 'prevCase') { event.preventDefault(); v5CaseIndex = (v5CaseIndex - 1 + V5_CASES.length) % V5_CASES.length; renderCases(); return true; }
  if (id === 'nextCase') { event.preventDefault(); v5CaseIndex = (v5CaseIndex + 1) % V5_CASES.length; renderCases(); return true; }
  if (id === 'randomCase') {
    event.preventDefault();
    if (V5_CASES.length > 1) {
      let next = v5CaseIndex;
      while (next === v5CaseIndex) next = Math.floor(Math.random() * V5_CASES.length);
      v5CaseIndex = next;
    }
    renderCases();
    return true;
  }
  if (id === 'renderComparison') { event.preventDefault(); renderV5Comparison(); return true; }
  if (id === 'practiceComparisonV5') {
    event.preventDefault();
    const topic = $('#compareTopic')?.value || 'award-price';
    buildComparisonPractice(topic, 20);
    return true;
  }
  if (id === 'bankPrev') { event.preventDefault(); bankPage = Math.max(1, bankPage - 1); renderBank(); window.scrollTo({ top: 0, behavior: 'smooth' }); return true; }
  if (id === 'bankNext') { event.preventDefault(); bankPage += 1; renderBank(); window.scrollTo({ top: 0, behavior: 'smooth' }); return true; }
  if (id === 'startLawPractice') { event.preventDefault(); buildLawPractice($('#lawPracticeSelect')?.value, Number($('#lawPracticeCount')?.value) || 20); return true; }
  if (id === 'startComparisonPractice') { event.preventDefault(); buildComparisonPractice($('#comparisonSelect')?.value, Number($('#comparisonCount')?.value) || 20); return true; }
  if (id === 'exportDiagnostics' || id === 'exportDiagnosticsSettings') { event.preventDefault(); exportDiagnostics(); return true; }
  if (id === 'installApp') { event.preventDefault(); if (deferredInstallPrompt) { deferredInstallPrompt.prompt(); deferredInstallPrompt.userChoice.finally(() => { deferredInstallPrompt = null; button.disabled = true; }); } return true; }
  if (id === 'checkUpdate') { event.preventDefault(); navigator.serviceWorker?.getRegistration()?.then((registration) => registration?.update()).then(() => toast('已檢查更新')); return true; }
  if (id === 'applyUpdate') { event.preventDefault(); if (waitingWorker) waitingWorker.postMessage({ type: 'SKIP_WAITING' }); else location.reload(); return true; }
  if (id === 'dismissUpdate') { event.preventDefault(); $('#updateBanner')?.classList.add('hidden'); return true; }
  if (id === 'clearLegalFilter') { event.preventDefault(); bankLegalKey = 'all'; bankPage = 1; renderBank(); return true; }
  if (id === 'practiceDueWrong') { event.preventDefault(); buildWrongPractice('due'); return true; }
  if (id === 'practiceAllWrong') { event.preventDefault(); buildWrongPractice('all'); return true; }
  if (['dailyStart', 'planPractice', 'startFocusQuiz'].includes(id)) { event.preventDefault(); buildAdaptive(20); return true; }
  if (id === 'adaptiveStart') { event.preventDefault(); buildAdaptive(Number($('#adaptiveCount')?.value) || 20); return true; }
  if (id === 'fullOfficial') { event.preventDefault(); buildOfficial(true); return true; }
  if (id === 'singleOfficial') { event.preventDefault(); buildOfficial(false, Number($('#officialSession')?.value) || 1); return true; }
  if (id === 'quickStart') { event.preventDefault(); buildQuick(); return true; }
  if (id === 'resumeBtn') {
    event.preventDefault();
    const restored = normalizeRestoredState(getStorage(LS.state, null));
    if (!restored || (restored.finished && !(restored.kind === 'official-full' && restored.currentSession < restored.plan.length - 1))) {
      alert('目前沒有未完成測驗。');
      dashboard();
      return true;
    }
    S = restored;
    if (S.kind === 'official-full' && S.finished && S.currentSession < S.plan.length - 1) showBreak(S.completed[S.completed.length - 1]);
    else startExam();
    return true;
  }
  if (id === 'prev') { event.preventDefault(); if (S.index > 0) goToQuestion(S.index - 1); return true; }
  if (id === 'next') { event.preventDefault(); if (S.index >= S.questions.length - 1) submit(); else goToQuestion(S.index + 1); return true; }
  if (id === 'mark') { event.preventDefault(); S.marked[S.index] = !S.marked[S.index]; saveState(); renderQuestion(); return true; }
  if (id === 'submitBtn') { event.preventDefault(); submit(); return true; }
  if (id === 'nextSessionBtn') { event.preventDefault(); nextSession(); return true; }
  if (id === 'wrongView') { event.preventDefault(); S.review = 'wrong'; renderReview(); return true; }
  if (id === 'allView') { event.preventDefault(); S.review = 'all'; renderReview(); return true; }
  if (id === 'clearWrong') { event.preventDefault(); if (confirm('確定清除全部錯題紀錄？')) { removeStorage(LS.wrong); renderWrong(); dashboard(); } return true; }
  if (id === 'clearFavorites') { event.preventDefault(); if (confirm('確定清除全部收藏？')) { removeStorage(LS.favorites); renderFavorites(); dashboard(); } return true; }
  if (id === 'exportData') { event.preventDefault(); exportData(); return true; }
  if (id === 'resetAll') { event.preventDefault(); if (confirm('這會清除所有版本的測驗進度、統計、錯題、收藏及紀錄，確定繼續？')) resetAllData(); return true; }
  return false;
}

document.addEventListener('click', (event) => {
  const pageButton = event.target.closest('[data-page]');
  if (pageButton) {
    event.preventDefault();
    show(pageButton.dataset.page);
    return;
  }
  const button = event.target.closest('button');
  if (!button) return;
  if (handleButtonClick(event, button)) return;

  if (button.matches('#qnav button')) {
    event.preventDefault();
    goToQuestion(Number(button.dataset.i), true);
    return;
  }
  if (button.classList.contains('option')) {
    event.preventDefault();
    const answer = Number(button.dataset.i);
    if (!Number.isInteger(answer) || answer < 0 || answer >= (S.questions[S.index]?.options?.length || 0)) return;
    const answeredIndex = S.index;
    S.answers[answeredIndex] = answer;
    saveState();
    renderQuestion();
    scheduleAutoNext(answeredIndex);
    return;
  }
  if (button.classList.contains('answer-toggle')) {
    event.preventDefault();
    const answerBox = button.closest('.bank-item')?.querySelector('.answer-box');
    if (!answerBox) return;
    answerBox.classList.toggle('hidden');
    button.textContent = answerBox.classList.contains('hidden') ? '顯示詳細答案' : '隱藏詳細答案';
    return;
  }
  if (button.classList.contains('law-filter')) {
    event.preventDefault();
    bankLegalKey = button.dataset.lawKey || 'all';
    bankPage = 1;
    show('bank');
    return;
  }
  if (button.matches('[data-tutor-prompt]')) { event.preventDefault(); askTutor(button.dataset.tutorPrompt); return; }
  if (button.matches('[data-case-answer]')) { event.preventDefault(); answerCase(Number(button.dataset.caseAnswer)); return; }
  if (button.classList.contains('tutor-open-question')) { event.preventDefault(); openTutorQuestion(button.dataset.id); return; }
  if (button.classList.contains('topic-practice')) { event.preventDefault(); buildTopicPractice(button.dataset.topicId, 20); return; }
  if (button.classList.contains('comparison-practice')) { event.preventDefault(); buildComparisonPractice(button.dataset.comparisonId, 20); return; }
  if (button.classList.contains('open-comparison')) { event.preventDefault(); const id=button.dataset.comparisonId; show('compare'); if($('#compareTopic')) $('#compareTopic').value=id; renderV5Comparison(id); return; }
  if (button.classList.contains('favorite-toggle')) {
    event.preventDefault();
    toggleFavorite(button.dataset.id);
    refreshCurrentList();
  }
});

$('#mobileOverlay').addEventListener('click', () => { closeMobileMore(); closeQuestionNav(); });
$('#search').addEventListener('input', () => { bankPage = 1; renderBank(); });
$('#bankSection').addEventListener('change', () => { bankPage = 1; renderBank(); });
$('#bankType').addEventListener('change', () => { bankPage = 1; renderBank(); });
$('#lawSearch')?.addEventListener('input', renderLawIndex);
$('#wrongStatusFilter')?.addEventListener('change', (event) => { wrongFilter = event.target.value || 'all'; renderWrong(); });
$('#largeText').addEventListener('change', savePrefs);
$('#compactMode').addEventListener('change', savePrefs);
$('#autoNext').addEventListener('change', savePrefs);
$('#avoidRecentDays')?.addEventListener('change', savePrefs);
$('#importData').addEventListener('change', (event) => event.target.files[0] && importData(event.target.files[0]));
$('#tutorInput')?.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); askTutor(); } });
$('#compareTopic')?.addEventListener('change', renderV5Comparison);

window.addEventListener('pagehide', () => {
  if (!S.finished && S.questions?.length) { commitQuestionTime(); syncRemainingTime(); saveState(); }
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 900) { closeMobileMore(); closeQuestionNav(); }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { closeMobileMore(); closeQuestionNav(); return; }
  const tag = event.target?.tagName?.toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag) || event.target?.isContentEditable) return;
  if ($('#exam').classList.contains('hidden') || S.finished || !S.questions[S.index]) return;
  if (/^[1-9]$/.test(event.key)) {
    const answer = Number(event.key) - 1;
    if (answer < S.questions[S.index].options.length) {
      event.preventDefault();
      const answeredIndex = S.index;
      S.answers[answeredIndex] = answer;
      saveState(); renderQuestion(); scheduleAutoNext(answeredIndex);
    }
  } else if (event.key === 'ArrowLeft' && S.index > 0) { event.preventDefault(); goToQuestion(S.index - 1); }
  else if (event.key === 'ArrowRight' && S.index < S.questions.length - 1) { event.preventDefault(); goToQuestion(S.index + 1); }
  else if (event.key.toLowerCase() === 'm') { event.preventDefault(); S.marked[S.index] = !S.marked[S.index]; saveState(); renderQuestion(); }
  else if (event.key === 'Enter') { event.preventDefault(); if (S.index < S.questions.length - 1) goToQuestion(S.index + 1); else submit(); }
});

window.addEventListener('error', (event) => {
  console.error(event.error || event.message);
  runtimeErrors.push({ time: Date.now(), type: 'error', message: String(event.message || event.error || 'unknown'), source: event.filename || '', line: event.lineno || 0 });
  showAppError('平台執行時發生錯誤。請重新整理頁面；若仍出現，請保留此版本檔案進行檢查。');
});
window.addEventListener('unhandledrejection', (event) => {
  console.error(event.reason);
  runtimeErrors.push({ time: Date.now(), type: 'promise', message: String(event.reason?.message || event.reason || 'unknown') });
  showAppError('平台處理資料時發生錯誤。請重新整理頁面後再試。');
});

function migrateReviewRecords() {
  const wrong = getStorage(LS.wrong, {});
  if (wrong && typeof wrong === 'object' && !Array.isArray(wrong)) {
    const normalized = Object.fromEntries(Object.entries(wrong).map(([id, record]) => [canonicalQuestionId(id), record]).filter(([id]) => BANK_BY_ID.has(id)).map(([id, record]) => [id, normalizedWrongRecord(record)]));
    if (JSON.stringify(normalized) !== JSON.stringify(wrong)) setStorage(LS.wrong, normalized, true);
  }
  const favoritesData = getStorage(LS.favorites, {});
  if (favoritesData && typeof favoritesData === 'object' && !Array.isArray(favoritesData)) {
    const normalizedFavorites = Object.fromEntries(Object.entries(favoritesData).map(([id, record]) => [canonicalQuestionId(id), record]).filter(([id]) => BANK_BY_ID.has(id)));
    if (JSON.stringify(normalizedFavorites) !== JSON.stringify(favoritesData)) setStorage(LS.favorites, normalizedFavorites, true);
  }
  const qStats = getQuestionStats();
  const normalizedStats = {};
  Object.entries(qStats).forEach(([id, record]) => {
    const canonical = canonicalQuestionId(id);
    if (!BANK_BY_ID.has(canonical)) return;
    const existing = normalizedQuestionStat(normalizedStats[canonical]);
    const incoming = normalizedQuestionStat(record);
    normalizedStats[canonical] = { seenCount: existing.seenCount + incoming.seenCount, correctCount: existing.correctCount + incoming.correctCount, lastSeen: Math.max(existing.lastSeen, incoming.lastSeen), lastAnswer: incoming.lastSeen >= existing.lastSeen ? incoming.lastAnswer : existing.lastAnswer, totalSeconds: existing.totalSeconds + incoming.totalSeconds, lastCorrect: incoming.lastSeen >= existing.lastSeen ? incoming.lastCorrect : existing.lastCorrect };
  });
  if (JSON.stringify(normalizedStats) !== JSON.stringify(qStats)) setStorage(LS.questionStats, normalizedStats, true);
}


const KNOWLEDGE = window.PROCUREMENT_KNOWLEDGE || {topics:[], cases:[], comparisons:[], notice:''};
const V5_CASES = Array.isArray(KNOWLEDGE.cases) ? KNOWLEDGE.cases : [];
const V5_COMPARISONS = Object.fromEntries((Array.isArray(KNOWLEDGE.comparisons)?KNOWLEDGE.comparisons:[]).map(item=>[item.id,item]));
let v5CaseIndex = 0;

function normalizeEnterpriseState(raw){
  const value=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  const caseAttempts=Math.round(safeNonNegative(value.caseAttempts,1000000));
  const caseCorrect=Math.min(caseAttempts,Math.round(safeNonNegative(value.caseCorrect,1000000)));
  const allowedCases=new Set(V5_CASES.map((item)=>item.id));
  const completedCases={};
  Object.entries(value.completedCases&&typeof value.completedCases==='object'&&!Array.isArray(value.completedCases)?value.completedCases:{}).slice(0,V5_CASES.length).forEach(([id,record])=>{
    if(!allowedCases.has(id)||!record||typeof record!=='object'||Array.isArray(record))return;
    const item=V5_CASES.find((entry)=>entry.id===id);
    const selected=Number.isInteger(record.selected)&&record.selected>=0&&record.selected<(item?.options?.length||0)?record.selected:null;
    completedCases[id]={correct:Boolean(record.correct),answeredAt:safeNonNegative(record.answeredAt,4102444800000),selected};
  });
  const lastMissionDay=/^\d{4}-\d{2}-\d{2}$/.test(String(value.lastMissionDay||''))?String(value.lastMissionDay):'';
  return {caseAttempts,caseCorrect,lastMissionDay,completedCases};
}
function getEnterpriseState(){ return normalizeEnterpriseState(getStorage(LS.enterprise,{})); }
function setEnterpriseState(value){ setStorage(LS.enterprise,normalizeEnterpriseState(value),true); }

function renderEnterpriseMission(){
  const box=$('#enterpriseMission'); if(!box) return;
  const data=learningData(); const enterprise=getEnterpriseState();
  const today=localDayKey(Date.now()); const doneToday=data.history.filter(r=>localDayKey(Number(r.date))===today).length;
  const items=[
    {label:'完成一組練習',done:doneToday>0,page:'setup'},
    {label:`複習今日到期錯題（${data.wrongStats.due}）`,done:data.wrongStats.due===0,page:'wrong'},
    {label:'完成一個案例判斷',done:enterprise.lastMissionDay===today,page:'cases'}
  ];
  box.innerHTML=items.map((item,i)=>`<button class="mission-chip ${item.done?'done':''}" data-page="${item.page}"><span>${item.done?'✓':i+1}</span><b>${esc(item.label)}</b></button>`).join('');
}

function lawMatchesFromText(text){
  const normalized=String(text||'').replace(/\s+/g,'');
  const index=ensureLegalIndex();
  const articleMatches=[...normalized.matchAll(/第?([0-9]{1,3}(?:-[0-9]+)?)條/g)].map(m=>m[1]);
  return index.filter(item=>{
    const label=String(item.label||'').replace(/\s+/g,'');
    const key=String(item.key||'').replace(/\s+/g,'');
    const origin=String(item.origin||'').replace(/\s+/g,'');
    return normalized.includes(label)||normalized.includes(key)||normalized.includes(origin)||articleMatches.some(a=>label.includes(`第${a}條`)||key.endsWith(`:${a}`));
  }).slice(0,10);
}
function normalizeTutorText(text){return String(text||'').toLowerCase().replace(/[？?，。；、：:（）()\s]/g,'');}
function detectKnowledgeTopics(prompt){
  const compact=normalizeTutorText(prompt);
  return (KNOWLEDGE.topics||[]).map(topic=>{
    let score=0;
    (topic.aliases||[]).forEach(alias=>{const a=normalizeTutorText(alias); if(a&&compact.includes(a)) score+=a.match(/\d/) ? 8 : Math.min(6,a.length);});
    if(compact.includes(normalizeTutorText(topic.title))) score+=8;
    return {topic,score};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).map(x=>x.topic);
}
let tutorSearchIndex = null;
function buildTutorSearchIndex(){
  if(tutorSearchIndex) return tutorSearchIndex;
  tutorSearchIndex = BANK.map((q) => ({
    q,
    question: normalizeTutorText(q.question),
    section: normalizeTutorText(q.section),
    explanation: normalizeTutorText(q.explanation)
  }));
  return tutorSearchIndex;
}
function findRelatedQuestions(prompt,topics){
  const stop=new Set(['什麼','怎麼','如何','哪些','是否','可以','請問','相關','重點','題目','規定','差在哪','比較']);
  const terms=String(prompt||'').replace(/[？?，。；、：:（）()]/g,' ').split(/\s+/).map(x=>x.trim()).filter(x=>x.length>=2&&!stop.has(x));
  topics.forEach(topic=>(topic.aliases||[]).forEach(x=>terms.push(x)));
  const unique=[...new Set(terms.map(normalizeTutorText).filter(Boolean))];
  return buildTutorSearchIndex().map(item=>{
    const score=unique.reduce((sum,w)=>sum+(item.question.includes(w)?5:0)+(item.section.includes(w)?3:0)+(item.explanation.includes(w)?1:0),0);
    return {q:item.q,score};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||String(a.q.id).localeCompare(String(b.q.id))).slice(0,12);
}
function comparisonForPrompt(prompt){
  const compact=normalizeTutorText(prompt);
  return (KNOWLEDGE.comparisons||[]).find(item=>{
    const hits=(item.articles||[]).filter(a=>compact.includes(String(a))).length;
    return hits>=2 || compact.includes(normalizeTutorText(item.title));
  });
}
function tutorAnswer(prompt){
  const text=String(prompt||'').trim();
  if(!text) return {html:'<p>請先輸入問題。</p>',refs:[]};
  const topics=detectKnowledgeTopics(text);
  const comparison=comparisonForPrompt(text);
  const related=findRelatedQuestions(text,topics);
  const refs=lawMatchesFromText(text+' '+topics.flatMap(t=>(t.laws||[]).map(l=>`${l.law}第${l.article}條`)).join(' '));
  let html='';
  if(comparison){
    html+=`<div class="knowledge-answer"><span class="answer-label">法條比較</span><h3>${esc(comparison.title)}</h3><p>${esc(comparison.summary||'')}</p><div class="knowledge-mini-table">${comparison.rows.map(row=>`<div><b>${esc(row[0])}</b><span>${esc(row[1])}</span><span>${esc(row[2])}</span><span>${esc(row[3])}</span></div>`).join('')}</div><button class="open-comparison" data-comparison-id="${esc(comparison.id)}">開啟完整比較表</button></div>`;
  } else if(topics.length){
    const topic=topics[0];
    html+=`<div class="knowledge-answer"><span class="answer-label">${esc(topic.title)}</span><h3>白話重點</h3><p>${esc(topic.summary)}</p><h4>容易混淆</h4><ul>${(topic.pitfalls||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul><div class="answer-laws">${(topic.laws||[]).map(l=>`<span>${esc(l.law)}第${esc(l.article)}條</span>`).join('')}</div></div>`;
  } else {
    html+='<div class="knowledge-answer"><span class="answer-label">題庫檢索</span><h3>未辨識到明確主題</h3><p>已改用題庫文字比對。建議輸入法條號，或使用「限制性招標、最低標、驗收、最有利標、異議、押標金」等具體關鍵字。</p></div>';
  }
  if(related.length){
    html+=`<div class="answer-related"><h4>相關題目（${related.length}）</h4>${related.slice(0,6).map(x=>`<button class="tutor-open-question" data-id="${esc(x.q.id)}">${esc(String(x.q.question||'').slice(0,56))}${String(x.q.question||'').length>56?'…':''}</button>`).join('')}</div>`;
  }
  html+=`<p class="tutor-warning">${esc(KNOWLEDGE.notice||'內容僅供學習參考。')}</p>`;
  return {html,refs,topics,related};
}
function renderTutorReference(answer){
  const ref=$('#tutorReference'); if(!ref) return;
  const topics=answer.topics||[];
  const blocks=[];
  topics.slice(0,3).forEach(topic=>blocks.push(`<div class="tutor-ref-item"><b>${esc(topic.title)}</b><span>${esc((topic.laws||[]).map(x=>`${x.law}第${x.article}條`).join('、'))}</span><button class="topic-practice" data-topic-id="${esc(topic.id)}">建立主題練習</button></div>`));
  (answer.refs||[]).slice(0,5).forEach(item=>blocks.push(`<div class="tutor-ref-item"><b>${esc(item.label||'法規')}</b><span>直接題 ${Number(item.directCount)||0}｜關聯題 ${Number(item.inferredCount)||0}</span><button class="law-filter" data-law-key="${esc(item.key||'all')}">查看相關題目</button></div>`));
  ref.innerHTML=blocks.length?blocks.join(''):'<p>未辨識到明確法條。請改用條號或更具體的採購主題。</p>';
}
function askTutor(promptOverride){
  const input=$('#tutorInput'); const prompt=String(promptOverride ?? input?.value ?? '').trim();
  if(!prompt){ toast('請輸入問題'); input?.focus(); return; }
  const messages=$('#tutorMessages'); if(!messages) return;
  messages.insertAdjacentHTML('beforeend',`<div class="tutor-message user"><b>你</b><p>${esc(prompt)}</p></div>`);
  try{const answer=tutorAnswer(prompt);messages.insertAdjacentHTML('beforeend',`<div class="tutor-message assistant"><b>AI 採購老師</b>${answer.html}</div>`);renderTutorReference(answer);}catch(error){console.error(error);messages.insertAdjacentHTML('beforeend','<div class="tutor-message assistant"><b>AI 採購老師</b><p>知識檢索發生錯誤。請改用法條號或較短的主題關鍵字再試。</p></div>');}
  messages.scrollTop=messages.scrollHeight;if(input)input.value='';
}
function buildTopicPractice(topicId,count=20){
  const topic=(KNOWLEDGE.topics||[]).find(x=>x.id===topicId); if(!topic){toast('找不到主題資料');return;}
  const related=findRelatedQuestions(topic.title+' '+(topic.aliases||[]).join(' '),[topic]).map(x=>x.q);
  if(!related.length){alert('目前題庫沒有足夠的相關題目。');return;}
  S=createExamState('law-practice',shuffle(related).slice(0,Math.min(count,related.length)),0,true);S.practiceLabel=topic.title;startExam();
}

function renderCases(){
  const item=V5_CASES[v5CaseIndex]; if(!item) return;
  renderCasesMetricsOnly();
  $('#caseCategory').textContent=item.category||'案例'; $('#caseLevel').textContent=item.level||''; $('#caseTitle').textContent=item.title||'';
  $('#caseScenario').innerHTML=`<span>${esc(item.scenario||'')}</span><strong>${esc(item.question||'')}</strong>`;
  $('#caseOptions').innerHTML=(item.options||[]).map((o,i)=>`<button class="case-option" data-case-answer="${i}"><span>${i+1}</span>${esc(o)}</button>`).join('');
  const feedback=$('#caseFeedback'); feedback.classList.add('hidden'); feedback.innerHTML='';
  $('#prevCase').disabled=v5CaseIndex===0; $('#nextCase').textContent=v5CaseIndex===V5_CASES.length-1?'回到第一案':'下一案例';
}
function answerCase(index){
  const item=V5_CASES[v5CaseIndex]; if(!item||!Number.isInteger(index)||index<0||index>=(item.options||[]).length)return;
  const buttons=$$('.case-option'); if(buttons.some(b=>b.disabled))return;
  const ok=index===item.answer; const state=getEnterpriseState();
  state.caseAttempts+=1;if(ok)state.caseCorrect+=1;state.completedCases[item.id]={correct:ok,answeredAt:Date.now(),selected:index};state.lastMissionDay=localDayKey(Date.now());setEnterpriseState(state);
  buttons.forEach((b,i)=>{b.disabled=true;if(i===item.answer)b.classList.add('correct');else if(i===index)b.classList.add('wrong');});
  const topic=(KNOWLEDGE.topics||[]).find(x=>x.id===item.topic);
  const feedback=$('#caseFeedback');
  feedback.innerHTML=`<h4>${ok?'判斷正確':'判斷不正確'}</h4><p>${esc(item.analysis||'')}</p><div class="case-law"><b>主要法源：</b>${esc((item.laws||[]).join('、'))}</div>${topic?`<div class="case-learning"><b>延伸重點：</b>${esc(topic.summary)}</div><button class="topic-practice" data-topic-id="${esc(topic.id)}">練習「${esc(topic.title)}」相關題目</button>`:''}<p class="tutor-warning">${esc(KNOWLEDGE.notice||'')}</p>`;
  feedback.classList.remove('hidden');renderEnterpriseMission();renderCasesMetricsOnly();
}
function renderCasesMetricsOnly(){
  const box=$('#caseMetrics');if(!box)return;const state=getEnterpriseState();const completed=Object.keys(state.completedCases||{}).length;
  box.innerHTML=`<div class="metric"><span>案例總數</span><b>${V5_CASES.length}</b><small>資料驅動案例庫</small></div><div class="metric"><span>完成案例</span><b>${completed}</b><small>不重複案例覆蓋</small></div><div class="metric"><span>累積判斷</span><b>${state.caseAttempts}</b><small>包含重新作答</small></div><div class="metric"><span>答對率</span><b>${state.caseAttempts?Math.round(state.caseCorrect/state.caseAttempts*100):0}%</b><small>案例判斷表現</small></div>`;
}
function populateComparisonCenter(){
  const select=$('#compareTopic');if(!select)return;
  select.innerHTML=(KNOWLEDGE.comparisons||[]).map(item=>`<option value="${esc(item.id)}">${esc(item.title)}</option>`).join('');
}
function renderV5Comparison(idOverride){
  const id=idOverride||$('#compareTopic')?.value;const item=V5_COMPARISONS[id]||(KNOWLEDGE.comparisons||[])[0];const box=$('#comparisonTable');if(!box||!item)return;
  box.innerHTML=`<div class="comparison-intro"><span class="answer-label">KNOWLEDGE COMPARISON</span><h3>${esc(item.title)}</h3><p>${esc(item.summary||'')}</p></div><div class="comparison-table"><div class="comparison-row head"><span>規定</span><span>適用前提</span><span>核心問題</span><span>處理方向</span><span>辨識提醒</span></div>${item.rows.map(r=>`<div class="comparison-row">${r.map(c=>`<span>${esc(c)}</span>`).join('')}</div>`).join('')}</div><div class="comparison-actions"><button class="comparison-practice" data-comparison-id="${esc(item.id)}">建立20題比較練習</button></div><p class="legal-note">${esc(KNOWLEDGE.notice||'')}</p>`;
}
function openTutorQuestion(id){const q=BANK_BY_ID.get(id);if(!q)return;bankPage=1;bankLegalKey='all';show('bank');$('#search').value=String(q.question||'').slice(0,24);renderBank();}

function initialize() {
  if (!BANK.length) {
    showAppError('題庫載入失敗，無法建立測驗。請確認 data/questions.js 檔案完整。');
    return;
  }
  sections.forEach((section) => {
    $('#section').add(new Option(section, section));
    $('#bankSection').add(new Option(section, section));
  });
  migrateReviewRecords();
  populateSpecialPractice();
  populateComparisonCenter();
  renderCases();
  renderV5Comparison();
  applyPrefs();
  dashboard();
  updateActiveNavigation('dashboard');
  registerServiceWorker();
}


window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferredInstallPrompt = event; const button = $('#installApp'); if (button) button.disabled = false; const status = $('#pwaStatus'); if (status) status.textContent = '可安裝到此裝置，安裝後可從主畫面快速開啟。'; });
window.addEventListener('appinstalled', () => { deferredInstallPrompt = null; const button = $('#installApp'); if (button) button.disabled = true; toast('平台已安裝'); });
window.addEventListener('online', () => { const status = $('#pwaStatus'); if (status) status.textContent = '已連線，離線快取仍可使用。'; });
window.addEventListener('offline', () => { const status = $('#pwaStatus'); if (status) status.textContent = '目前為離線模式，學習資料仍儲存在本機。'; });

initialize();
