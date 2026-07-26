from __future__ import annotations

import json
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Any

from playwright.sync_api import Browser, Error as PlaywrightError, Page, Playwright, sync_playwright

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BASE_URL = sys.argv[1] if len(sys.argv) > 1 else PROJECT_ROOT.joinpath("index.html").as_uri()
EXPECTED_VERSION = "5.1.5"


def assert_equal(actual: Any, expected: Any, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def assert_true(value: Any, label: str) -> None:
    if not value:
        raise AssertionError(label)


def style(page: Page, selector: str, prop: str) -> str:
    return page.locator(selector).evaluate(
        "(el, p) => getComputedStyle(el).getPropertyValue(p).trim()", prop
    )


def static_integrity_checks() -> None:
    required = [
        "index.html", "style.css", "app.js", "service-worker.js",
        "manifest.webmanifest", "data/questions.js", "data/scheme.js",
        "data/verified_legal_data.js", "data/legal_basis.js",
        "data/knowledge_base.js", "icons/icon-192.png", "icons/icon-512.png",
        "icons/icon-180.png",
    ]
    missing = [name for name in required if not PROJECT_ROOT.joinpath(name).is_file()]
    assert_true(not missing, f"missing project assets: {missing}")

    html = PROJECT_ROOT.joinpath("index.html").read_text(encoding="utf-8")
    app = PROJECT_ROOT.joinpath("app.js").read_text(encoding="utf-8")
    worker = PROJECT_ROOT.joinpath("service-worker.js").read_text(encoding="utf-8")
    manifest = json.loads(PROJECT_ROOT.joinpath("manifest.webmanifest").read_text(encoding="utf-8"))

    assert_true(f"V{EXPECTED_VERSION}" in html, "HTML version label")
    assert_true(f"APP_VERSION = '{EXPECTED_VERSION}'" in app, "APP_VERSION")
    assert_true("gpai-v515-" in worker, "service worker cache version")
    assert_true(EXPECTED_VERSION in manifest.get("name", ""), "manifest full name version")
    assert_true(EXPECTED_VERSION in manifest.get("short_name", ""), "manifest short name version")
    assert_true('id="critical-theme"' in html, "critical first-paint theme present")
    assert_true('rel="preload" href="style.css" as="style"' in html, "stylesheet preload present")
    assert_true('background:transparent' in PROJECT_ROOT.joinpath("style.css").read_text(encoding="utf-8"), "sidebar button background reset")

    script_sources = re.findall(r'<script\s+src="([^"]+)"', html)
    stylesheet_sources = re.findall(r'<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"', html)
    missing_refs = [src for src in script_sources + stylesheet_sources if not PROJECT_ROOT.joinpath(src).is_file()]
    assert_true(not missing_refs, f"missing HTML references: {missing_refs}")

    for control_id in ("tutorInput", "search", "bankSection", "bankType", "lawSearch", "wrongStatusFilter"):
        match = re.search(rf'<(?:input|textarea|select)[^>]*\bid="{control_id}"[^>]*>', html)
        assert_true(match and 'aria-label=' in match.group(0), f"accessible label for #{control_id}")


def browser_candidates() -> list[str]:
    configured = os.getenv("CHROMIUM_PATH", "").strip()
    candidates = [configured] if configured else []
    for command in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "chrome"):
        found = shutil.which(command)
        if found and found not in candidates:
            candidates.append(found)
    return candidates


def launch_browser(playwright: Playwright) -> Browser:
    launch_options = {
        "headless": True,
        "args": [
            "--no-sandbox",
            "--allow-file-access-from-files",
            "--disable-web-security",
            "--no-proxy-server",
            "--proxy-bypass-list=*",
        ],
    }
    errors: list[str] = []

    try:
        return playwright.chromium.launch(**launch_options)
    except Exception as exc:
        errors.append(str(exc))

    for executable in browser_candidates():
        path = Path(executable).expanduser()
        if not path.is_file():
            continue
        try:
            return playwright.chromium.launch(executable_path=str(path), **launch_options)
        except Exception as exc:
            errors.append(f"{path}: {exc}")

    raise RuntimeError(
        "Chromium 啟動失敗。請執行 `pip install -r tests/requirements.txt` 與 "
        "`playwright install chromium`，或設定 CHROMIUM_PATH。\n" + "\n".join(errors[-3:])
    )


def storage_shim() -> str:
    return """<script>
(() => {
  const store = Object.create(null);
  Object.defineProperties(store, {
    setItem: { value(key, value) { Object.defineProperty(this, String(key), { value: String(value), writable: true, configurable: true, enumerable: true }); } },
    getItem: { value(key) { return Object.prototype.hasOwnProperty.call(this, String(key)) ? this[String(key)] : null; } },
    removeItem: { value(key) { delete this[String(key)]; } },
    clear: { value() { Object.keys(this).forEach((key) => delete this[key]); } },
    key: { value(index) { return Object.keys(this)[index] ?? null; } },
    length: { get() { return Object.keys(this).length; } }
  });
  Object.defineProperty(window, 'localStorage', { configurable: true, value: store });
  window.__alerts = [];
  window.alert = (message) => window.__alerts.push(String(message));
  window.confirm = () => true;
  try { Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined }); } catch (_) {}
})();
</script>"""


def embedded_html() -> str:
    html = PROJECT_ROOT.joinpath("index.html").read_text(encoding="utf-8")
    css = PROJECT_ROOT.joinpath("style.css").read_text(encoding="utf-8")
    html = re.sub(r'<link\s+rel="manifest"[^>]*>', "", html)
    html = re.sub(r'<link\s+rel="stylesheet"\s+href="style\.css">', f"<style>{css}</style>", html)
    html = html.replace("</head>", f"</head>{storage_shim()}", 1)
    for source in (
        "data/questions.js", "data/scheme.js", "data/verified_legal_data.js",
        "data/legal_basis.js", "data/knowledge_base.js", "app.js",
    ):
        javascript = PROJECT_ROOT.joinpath(source).read_text(encoding="utf-8").replace("</script>", "<\\/script>")
        html = html.replace(f'<script src="{source}"></script>', f"<script>\n{javascript}\n</script>")
    return html


EMBEDDED_HTML: str | None = None
FORCE_EMBEDDED = False


def load_application(page: Page) -> None:
    global EMBEDDED_HTML, FORCE_EMBEDDED
    use_embedded = FORCE_EMBEDDED or len(sys.argv) <= 1 or os.getenv("GPAI_EMBEDDED_TEST", "").strip() == "1"
    if not use_embedded:
        try:
            page.goto(BASE_URL, wait_until="networkidle", timeout=8_000 if BASE_URL.startswith("file:") else 45_000)
        except PlaywrightError as exc:
            if "ERR_BLOCKED_BY_ADMINISTRATOR" not in str(exc):
                raise
            FORCE_EMBEDDED = True
            use_embedded = True
    if use_embedded:
        if EMBEDDED_HTML is None:
            EMBEDDED_HTML = embedded_html()
        page.set_content(EMBEDDED_HTML, wait_until="load", timeout=120_000)
    page.wait_for_selector(".app-shell")
    page.wait_for_function("() => document.querySelectorAll('#compareTopic option').length === 6")


def page_errors(page: Page) -> list[str]:
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
    page.on(
        "console",
        lambda message: errors.append(f"console: {message.text}") if message.type == "error" else None,
    )
    return errors


def relevant_errors(errors: list[str]) -> list[str]:
    ignored = ("service worker", "origin", "manifest")
    return [error for error in errors if not any(token in error.lower() for token in ignored)]


def open_page(page: Page, page_name: str, mode: str) -> None:
    if mode == "mobile":
        direct = page.locator(f'.mobile-bottom-nav [data-page="{page_name}"]:visible')
        if direct.count() == 1:
            direct.click()
        else:
            sheet = page.locator("#mobileMoreSheet")
            if sheet.get_attribute("aria-hidden") != "false":
                trigger = page.locator("#mobileMoreTop:visible")
                assert_equal(trigger.count(), 1, "mobile More trigger count")
                trigger.click()
                page.wait_for_function(
                    "() => document.body.classList.contains('sheet-open') && document.querySelector('#mobileMoreSheet')?.getAttribute('aria-hidden') === 'false'"
                )
            target = page.locator(f'#mobileMoreSheet [data-page="{page_name}"]:visible')
            assert_equal(target.count(), 1, f"mobile visible {page_name} navigation count")
            target.click()
            page.wait_for_function(
                "() => !document.body.classList.contains('sheet-open') && document.querySelector('#mobileMoreSheet')?.getAttribute('aria-hidden') === 'true'"
            )
    else:
        target = page.locator(f'.desktop-sidebar [data-page="{page_name}"]:visible')
        assert_equal(target.count(), 1, f"{mode} visible {page_name} navigation count")
        target.click()

    page.locator(f"#{page_name}").wait_for(state="visible")
    assert_true("hidden" not in (page.locator(f"#{page_name}").get_attribute("class") or "").split(), f"{page_name} visible")


def critical_first_paint_checks(browser: Browser) -> None:
    html = PROJECT_ROOT.joinpath("index.html").read_text(encoding="utf-8")
    html = re.sub(r'<link\s+rel="stylesheet"\s+href="style\.css">', "", html)
    html = re.sub(r'<script[^>]*>.*?</script>', "", html, flags=re.S)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.set_content(html, wait_until="domcontentloaded")
    sidebar = page.locator(".desktop-sidebar.top")
    sidebar.wait_for(state="visible")
    background = style(page, ".desktop-sidebar.top", "background-color")
    image = style(page, ".desktop-sidebar.top", "background-image")
    button_background = page.locator(".desktop-sidebar nav button").first.evaluate("el => getComputedStyle(el).backgroundColor")
    assert_true(background not in {"rgb(255, 255, 255)", "rgba(255, 255, 255, 1)"}, "critical sidebar must not be white")
    assert_true(image != "none", "critical sidebar gradient present")
    assert_equal(button_background, "rgba(0, 0, 0, 0)", "critical nav button transparent")
    assert_true(float(style(page, ".app-content", "margin-left").replace("px", "")) > 200, "critical content offset")
    page.close()


def run_viewport(browser: Browser, width: int, height: int, mode: str) -> None:
    page = browser.new_page(viewport={"width": width, "height": height})
    errors = page_errors(page)
    load_application(page)

    if mode == "desktop":
        assert_equal(style(page, ".desktop-sidebar.top", "position"), "fixed", "desktop sidebar position")
        assert_equal(style(page, ".desktop-sidebar.top", "display"), "flex", "desktop sidebar display")
        assert_true(float(style(page, ".desktop-sidebar.top", "width").replace("px", "")) > 200, "desktop sidebar width")
        assert_true(float(style(page, ".app-content", "margin-left").replace("px", "")) > 200, "desktop content offset")
        assert_equal(style(page, ".mobile-bottom-nav", "display"), "none", "desktop mobile nav hidden")
    elif mode == "tablet":
        assert_equal(style(page, ".desktop-sidebar.top", "position"), "fixed", "tablet sidebar position")
        assert_equal(style(page, ".desktop-sidebar.top", "padding-left"), "12px", "tablet sidebar padding")
        assert_true(float(style(page, ".app-content", "margin-left").replace("px", "")) >= 220, "tablet content offset")
    else:
        assert_equal(style(page, ".desktop-sidebar.top", "display"), "none", "mobile sidebar hidden")
        assert_equal(style(page, ".app-content", "margin-left"), "0px", "mobile content margin")
        assert_true(style(page, ".mobile-bottom-nav", "display") != "none", "mobile bottom nav visible")
        assert_equal(page.locator("#mobileMoreSheet").get_attribute("aria-hidden"), "true", "mobile sheet initially closed")

    assert_equal(page.locator("#compareTopic option").count(), 6, "comparison options populated from data")

    open_page(page, "tutor", mode)
    page.fill("#tutorInput", "第53條跟第54條差在哪？")
    page.click("#askTutor")
    page.wait_for_function("() => document.querySelectorAll('#tutorMessages .tutor-message').length >= 3")
    assert_true("第53" in page.locator("#tutorMessages").inner_text(), "tutor response rendered")

    open_page(page, "cases", mode)
    assert_true(page.locator("#caseOptions button").count() >= 2, "case options rendered")
    page.locator("#caseOptions button").first.click()
    assert_true(not page.locator("#caseFeedback").is_hidden(), "case feedback rendered")

    open_page(page, "compare", mode)
    page.click("#renderComparison")
    assert_true(page.locator("#comparisonTable").inner_text().strip() != "", "comparison rendered")

    if mode == "mobile":
        open_page(page, "settings", mode)
        assert_equal(page.locator("#mobileMoreSheet").get_attribute("aria-hidden"), "true", "mobile sheet closes after navigation")

    assert_true(not relevant_errors(errors), "browser errors: " + json.dumps(relevant_errors(errors), ensure_ascii=False))
    page.close()


def official_exam_checks(browser: Browser) -> None:
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = page_errors(page)
    load_application(page)
    open_page(page, "setup", "desktop")
    page.click("#fullOfficial")
    page.locator("#exam").wait_for(state="visible")

    audit = page.evaluate("""() => {
      const expected = new Map(SCHEME.sessions.map((session) => [session.id, session]));
      const plan = S.plan.map((session) => {
        const definition = expected.get(session.id);
        const courseRows = definition.courses.map((course) => {
          const rows = session.questions.filter((question) => question.advancedCourse === course.name);
          return {
            name: course.name,
            actualTf: rows.filter((question) => question.type === 'tf').length,
            actualMc: rows.filter((question) => question.type === 'mc').length,
            expectedTf: course.tf,
            expectedMc: course.mc
          };
        });
        return {
          id: session.id,
          score: session.score,
          expectedScore: definition.score,
          count: session.questions.length,
          expectedCount: definition.courses.reduce((sum, course) => sum + course.tf + course.mc, 0),
          weightedScore: session.questions.reduce((sum, question) => sum + (question.type === 'tf' ? 2 : 5), 0),
          tf: session.questions.filter((question) => question.type === 'tf').length,
          mc: session.questions.filter((question) => question.type === 'mc').length,
          ids: session.questions.map((question) => question.id),
          courseRows
        };
      });
      const allIds = plan.flatMap((session) => session.ids);
      return {
        kind: S.kind,
        currentCount: S.questions.length,
        seconds: S.seconds,
        plan,
        totalQuestions: allIds.length,
        uniqueQuestions: new Set(allIds).size,
        totalScore: plan.reduce((sum, session) => sum + session.score, 0),
        answers: S.answers.length,
        marked: S.marked.length,
        savedState: JSON.parse(localStorage.getItem(LS.state)),
        sourceCapacity: SCHEME.sessions.flatMap((session) => session.courses.flatMap((course) => ['tf','mc'].map((type) => ({
          session:session.id, course:course.name, type,
          needed:type==='tf'?course.tf:course.mc,
          available:BANK.filter((question)=>question.type===type&&course.sources.some((source)=>matchesSource(question,source))).length
        })))),
        stressFailures: Array.from({length:30},(_,iteration)=>{
          const used=new Set();
          const generated=SCHEME.sessions.map((definition)=>({definition,questions:createOfficialSession(definition,used)}));
          const ids=generated.flatMap((row)=>row.questions.map((question)=>question.id));
          const bad=generated.some(({definition,questions})=>questions.length!==definition.courses.reduce((sum,course)=>sum+course.tf+course.mc,0)||questions.reduce((sum,question)=>sum+(question.type==='tf'?2:5),0)!==definition.score);
          return bad||ids.length!==new Set(ids).size?iteration:null;
        }).filter((value)=>value!==null)
      };
    }""")

    assert_equal(audit["kind"], "official-full", "official full kind")
    assert_equal([row["count"] for row in audit["plan"]], [78, 69, 78], "official session question counts")
    assert_equal([row["score"] for row in audit["plan"]], [270, 240, 270], "official session scores")
    assert_equal(audit["totalQuestions"], 225, "official total question count")
    assert_equal(audit["uniqueQuestions"], 225, "official cross-session uniqueness")
    assert_equal(audit["totalScore"], 780, "official total score")
    assert_equal(audit["seconds"], 4800, "official session duration")
    assert_equal(audit["answers"], 78, "official answer slots")
    assert_equal(audit["marked"], 78, "official mark slots")
    assert_true(audit["savedState"] is not None, "official state saved")
    assert_true(not audit["stressFailures"], f"official random stress failures: {audit['stressFailures']}")
    for capacity in audit["sourceCapacity"]:
        assert_true(capacity["available"] >= capacity["needed"], f"insufficient source pool: {capacity}")

    for session in audit["plan"]:
        assert_equal(session["count"], session["expectedCount"], f"session {session['id']} configured count")
        assert_equal(session["score"], session["expectedScore"], f"session {session['id']} configured score")
        assert_equal(session["weightedScore"], session["score"], f"session {session['id']} weighted score")
        for course in session["courseRows"]:
            assert_equal(course["actualTf"], course["expectedTf"], f"{course['name']} true/false count")
            assert_equal(course["actualMc"], course["expectedMc"], f"{course['name']} multiple-choice count")

    page.locator("#opts .option").first.click()
    page.click("#mark")
    page.click("#next")
    interaction = page.evaluate("() => ({index:S.index, firstAnswer:S.answers[0], firstMarked:S.marked[0]})")
    assert_equal(interaction["index"], 1, "next question navigation")
    assert_true(isinstance(interaction["firstAnswer"], int), "answer recorded")
    assert_true(interaction["firstMarked"], "mark recorded")

    assert_true(not relevant_errors(errors), "official exam browser errors: " + json.dumps(relevant_errors(errors), ensure_ascii=False))
    page.close()


def quick_result_and_import_checks(browser: Browser) -> None:
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    errors = page_errors(page)
    load_application(page)
    open_page(page, "setup", "desktop")
    page.click("#quickStart")
    page.locator("#exam").wait_for(state="visible")

    quick = page.evaluate("""() => ({
      count:S.questions.length,
      unique:new Set(S.questions.map((question)=>question.id)).size,
      tf:S.questions.filter((question)=>question.type==='tf').length,
      mc:S.questions.filter((question)=>question.type==='mc').length,
      validState:sanitizeImportedValue(LS.state, JSON.parse(localStorage.getItem(LS.state))) !== null,
      invalidState:sanitizeImportedValue(LS.state, {questions:[{id:'missing'}],answers:[0]})
    })""")
    assert_equal(quick["count"], 50, "quick exam count")
    assert_equal(quick["unique"], 50, "quick exam uniqueness")
    assert_equal(quick["tf"], 15, "quick true/false count")
    assert_equal(quick["mc"], 35, "quick multiple-choice count")
    assert_true(quick["validState"], "valid saved state accepted")
    assert_equal(quick["invalidState"], None, "corrupt state rejected")

    page.evaluate("S.answers = S.questions.map((question) => question.answer); submit(true)")
    page.locator("#results").wait_for(state="visible")
    result = page.evaluate("""() => {
      const history=JSON.parse(localStorage.getItem(LS.history));
      const stats=JSON.parse(localStorage.getItem(LS.stats));
      const enterprise=sanitizeImportedValue(LS.enterprise,{caseAttempts:4,caseCorrect:3,lastMissionDay:'2026-07-26',completedCases:{A:{correct:true}}});
      const dirtyStats=sanitizeImportedValue(LS.stats,{answered:-3,correct:99,raw:999,max:10,tests:'2',official:-1,by:{bad:{a:9}},type:{tf:{a:3,c:8,raw:50,max:6}},processedRecords:['ok',7],processedTests:['x']});
      return {history,stats,enterprise,dirtyStats,score:document.querySelector('#score')?.textContent};
    }""")
    assert_equal(len(result["history"]), 1, "history recorded once")
    assert_equal(result["stats"]["answered"], 50, "stats answered count")
    assert_equal(result["stats"]["correct"], 50, "stats correct count")
    assert_equal(result["score"], "100", "perfect quick score")
    assert_equal(result["enterprise"]["caseAttempts"], 4, "enterprise backup restored")
    assert_equal(result["enterprise"]["caseCorrect"], 3, "enterprise correct count restored")
    assert_equal(result["dirtyStats"]["answered"], 0, "negative stats clamped")
    assert_equal(result["dirtyStats"]["correct"], 0, "correct count bounded by answered")
    assert_equal(result["dirtyStats"]["raw"], 10, "raw score bounded by max")
    assert_equal(result["dirtyStats"]["official"], 0, "negative official count clamped")
    assert_equal(result["dirtyStats"]["processedRecords"], ["ok"], "invalid processed record removed")

    assert_true(not relevant_errors(errors), "quick/import browser errors: " + json.dumps(relevant_errors(errors), ensure_ascii=False))
    page.close()


def main() -> None:
    static_integrity_checks()
    with sync_playwright() as playwright:
        browser = launch_browser(playwright)
        try:
            critical_first_paint_checks(browser)
            run_viewport(browser, 1440, 1000, "desktop")
            run_viewport(browser, 1024, 900, "tablet")
            run_viewport(browser, 390, 844, "mobile")
            official_exam_checks(browser)
            quick_result_and_import_checks(browser)
        finally:
            browser.close()
    print("PASS: V5.1.5 critical first paint, responsive UI, mobile navigation, official exam, quick exam, results, and backup validation")


if __name__ == "__main__":
    main()
