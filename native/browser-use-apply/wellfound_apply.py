"""
wellfound_apply.py

Autonomous Wellfound job application bot.
Uses a persistent Playwright browser profile (user stays logged in)
and iterates through jobs, reading JD, generating cover letters via LLM,
filling application forms and submitting.

Payload JSON shape:
{
  "profile": { ...career profile... },
  "filters": {
    "role": "Full-Stack Engineer",
    "location": "Bengaluru",
    "jobType": "Full Time",
    "remote": false,
    "maxJobs": 20
  },
  "llm": { "model": "gpt-4o", "apiKey": "...", "baseUrl": "" },
  "dryRun": true,
  "profileDir": "/path/to/wellfound-profile"
}
"""

import asyncio
import sys
import json
import os
import re
import argparse
try:
    from patchright.async_api import async_playwright
    USING_PATCHRIGHT = True
except ImportError:
    from playwright.async_api import async_playwright
    USING_PATCHRIGHT = False


# ─────────────────────────────────────────────────────────────────
# Logging helpers (stdout JSON lines consumed by Electron)
# ─────────────────────────────────────────────────────────────────

def log(msg: str):
    print(json.dumps({"type": "log", "message": msg}), flush=True)


def status(action: str, job_id: str = None):
    payload = {"type": "status", "status": "running", "action": action}
    if job_id:
        payload["jobId"] = job_id
    print(json.dumps(payload), flush=True)


def emit_result(job_id: str, outcome: str, message: str = ""):
    print(json.dumps({"type": "result", "jobId": job_id, "status": outcome, "message": message}), flush=True)


def done(total: int, applied: int):
    print(json.dumps({"type": "done", "total": total, "applied": applied}), flush=True)


# ─────────────────────────────────────────────────────────────────
# LLM call (OpenAI-compatible)
# ─────────────────────────────────────────────────────────────────

async def call_llm(llm_cfg: dict, system_prompt: str, user_prompt: str) -> str:
    import urllib.request
    base_url = (llm_cfg.get("baseUrl") or "https://api.openai.com/v1").rstrip("/")
    model    = llm_cfg.get("model", "gpt-4o")
    api_key  = llm_cfg.get("apiKey", "")
    url = f"{base_url}/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt}
        ],
        "max_tokens": 800,
        "temperature": 0.7,
    }
    data = json.dumps(payload).encode("utf-8")
    req  = urllib.request.Request(url, data=data, method="POST",
               headers={"Content-Type": "application/json",
                        "Authorization": f"Bearer {api_key}"})
    try:
        loop = asyncio.get_event_loop()
        def _do():
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode())
        resp = await loop.run_in_executor(None, _do)
        return resp["choices"][0]["message"]["content"].strip()
    except Exception as e:
        return f"[LLM Error: {e}]"


def clean_llm_text(text: str) -> str:
    """Strips all markdown formatting, bold/italics **, subject lines, code blocks, headers, JSON formatting, and bracketed placeholders."""
    if not text:
        return ""
    # Remove markdown codeblocks ```json ... ``` or ``` ... ```
    text = re.sub(r'```[a-zA-Z]*\n?', '', text)
    text = re.sub(r'```', '', text)
    # Remove Subject: / Re: / Dear Recruiter: headers at start
    text = re.sub(r'^(Subject|Re|Dear\s+Recruiter|Dear\s+Hiring\s+Manager):\s*.*?\n+', '', text, flags=re.IGNORECASE)
    # Remove markdown bold/italics (**text** or __text__ or *text*)
    text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)
    text = re.sub(r'__(.*?)__', r'\1', text)
    text = re.sub(r'\*(.*?)\*', r'\1', text)
    # Remove markdown headers (# Header)
    text = re.sub(r'^#+\s*', '', text, flags=re.MULTILINE)

    # Clean up bracketed placeholders (e.g. [Current Company], [Specific Feature], [Your Name])
    text = re.sub(r'\[(?:Current\s+)?Company(?:\s+Name)?\]', 'the company', text, flags=re.IGNORECASE)
    text = re.sub(r'\[(?:Specific\s+)?Feature(?:/Project)?\]', 'key features', text, flags=re.IGNORECASE)
    text = re.sub(r'\[(?:Specific\s+)?Project\]', 'core projects', text, flags=re.IGNORECASE)
    text = re.sub(r'\[(?:Your\s+)?Name\]', '', text, flags=re.IGNORECASE)
    # Strip any remaining bracketed placeholders like [Anything Here]
    text = re.sub(r'\[[A-Za-z0-9\s/_\-]{2,40}\]', '', text)

    # Strip wrapping quotes if any
    text = text.strip()
    if text.startswith('"') and text.endswith('"'):
        text = text[1:-1].strip()
    return text


def clean_cover_letter(text: str) -> str:
    """Alias for backwards compatibility."""
    return clean_llm_text(text)


async def generate_cover_letter(llm_cfg, profile, jd_text, job_title, company) -> str:
    sys_prompt = (
        "You are the candidate writing a short, direct job application message for a recruiter. "
        "CRITICAL CONSTRAINTS:\n"
        "1. Write 2 short paragraphs max (80-120 words total). Be concise and to the point.\n"
        "2. PURE PLAIN TEXT ONLY. Do NOT use any Markdown formatting whatsoever (NO bold `**`, NO italics, NO `#` headers, NO code blocks, NO bullet points).\n"
        "3. NO Subject line, NO date, NO address header, NO salutation like 'Dear Recruiter', NO formal signature.\n"
        "4. ZERO HALLUCINATION & NO PLACEHOLDERS: Include ONLY tools, technologies, experience, and roles explicitly stated in the candidate's profile/resume. NEVER invent companies, features, tools, or projects. NEVER write bracketed placeholders like [Company] or [Feature].\n"
        "5. Speak directly in first-person ('I have experience with...'). Focus strictly on facts from the candidate's real background that match the job description.\n"
        "6. Return pure plain text only."
    )
    
    raw_resume = profile.get("resumeText") or profile.get("summary") or ""
    if isinstance(raw_resume, (dict, list)):
        resume_context = json.dumps(raw_resume, indent=2)
    else:
        resume_context = str(raw_resume or "")

    skills = profile.get("topSkills", [])
    if isinstance(skills, list):
        skills_str = ", ".join(str(s) for s in skills)
    else:
        skills_str = str(skills or "")

    candidate = (
        f"Name: {profile.get('fullName','')}\n"
        f"Role: {profile.get('currentRole','')}\n"
        f"Skills: {skills_str}\n"
        f"Experience: {profile.get('totalYearsExperience','')} years\n"
        f"Location: {profile.get('location','')}\n"
    )
    if resume_context.strip():
        candidate += f"\nDetailed Background / Resume:\n{resume_context[:2500]}\n"

    user_prompt = (
        f"Job: {job_title} at {company}\n\nCandidate Profile:\n{candidate}\n\n"
        f"Job Description:\n{jd_text[:3000]}\n\nWrite the plain-text application message:"
    )
    raw_letter = await call_llm(llm_cfg, sys_prompt, user_prompt)
    return clean_llm_text(raw_letter)


async def answer_question(llm_cfg, profile, question, jd_text) -> str:
    sys_prompt = (
        "You are filling out a job application form question. "
        "CRITICAL RULES:\n"
        "1. Answer concisely (1-2 sentences max).\n"
        "2. PURE PLAIN TEXT ONLY. Absolutely NO markdown (NO bold **, NO italics, NO headers, NO JSON, NO backticks).\n"
        "3. Use ONLY true facts from the candidate's profile/resume. Never invent skills or experiences not listed."
    )
    skills = profile.get("topSkills", [])
    skills_str = ", ".join(str(s) for s in skills) if isinstance(skills, list) else str(skills or "")
    candidate = (
        f"Name: {profile.get('fullName','')}\n"
        f"Role: {profile.get('currentRole','')}\n"
        f"Skills: {skills_str}\n"
        f"Experience: {profile.get('totalYearsExperience','')} years\n"
        f"Email: {profile.get('email','')}\n"
        f"LinkedIn: {profile.get('linkedinUrl','')}"
    )
    raw_ans = await call_llm(llm_cfg, sys_prompt,
        f"Question: {question}\n\nJob (brief):\n{jd_text[:1500]}\n\nCandidate:\n{candidate}\n\nAnswer:")
    return clean_llm_text(raw_ans)


# ─────────────────────────────────────────────────────────────────
# Wellfound DOM helpers
# ─────────────────────────────────────────────────────────────────

async def apply_filters(page, filters: dict):
    log("[Filters] Navigating to wellfound.com/jobs...")
    await page.goto("https://wellfound.com/jobs", wait_until="domcontentloaded", timeout=30000)
    await page.wait_for_timeout(2500)

    role = filters.get("role", "")
    if role:
        log(f"[Filters] Setting role: {role}")
        try:
            sel = "input[placeholder*='Role' i], input[placeholder*='Job title' i], " \
                  "input[placeholder*='Search roles' i]"
            inp = await page.query_selector(sel)
            if inp:
                await inp.click()
                await inp.fill("")
                await inp.type(role, delay=60)
                await page.wait_for_timeout(800)
                sug = await page.query_selector(".styles_suggestion__, [class*='suggestion']")
                if sug:
                    await sug.click()
                else:
                    await page.keyboard.press("Enter")
                await page.wait_for_timeout(1200)
        except Exception as e:
            log(f"[Filters] role filter error: {e}")

    location = filters.get("location", "")
    if location:
        log(f"[Filters] Setting location: {location}")
        try:
            inp = await page.query_selector(
                "input[placeholder*='Location' i], input[placeholder*='City' i]")
            if inp:
                await inp.click()
                await inp.fill("")
                await inp.type(location, delay=60)
                await page.wait_for_timeout(800)
                sug = await page.query_selector("[class*='suggestion']")
                if sug:
                    await sug.click()
                else:
                    await page.keyboard.press("Enter")
                await page.wait_for_timeout(1200)
        except Exception as e:
            log(f"[Filters] location filter error: {e}")

    job_type = filters.get("jobType", "")
    if job_type:
        log(f"[Filters] Setting job type: {job_type}")
        try:
            filter_btn = await page.query_selector("button:has-text('Filters')")
            if filter_btn:
                await filter_btn.click()
                await page.wait_for_timeout(700)
                option = await page.query_selector(f"label:has-text('{job_type}')")
                if option:
                    await option.click()
                    await page.wait_for_timeout(400)
                close = await page.query_selector("button:has-text('Apply'), button:has-text('Done')")
                if close:
                    await close.click()
                    await page.wait_for_timeout(800)
        except Exception as e:
            log(f"[Filters] job type filter error: {e}")

    log("[Filters] Done. Clicking View Results / closing filter card...")
    # Click "View results" or "Apply" button inside filter modal if present
    for view_sel in [
        "button:has-text('View results')",
        "button:has-text('View ')",
        "button:has-text('View')",
        "button:has-text('Apply filters')",
        "button:has-text('Apply')",
        "button:has-text('Done')",
        "[data-test='view-results-button']",
    ]:
        try:
            btn = await page.query_selector(view_sel)
            if btn and await btn.is_visible():
                btn_txt = (await btn.inner_text()).strip()
                log(f"[Filters] Clicking '{btn_txt}' button...")
                await btn.click()
                await page.wait_for_timeout(1500)
                break
        except Exception:
            pass

    # Ensure no leftover filter overlay is blocking page
    await close_all_modals(page)
    await page.wait_for_timeout(1000)


async def close_all_modals(page):
    """
    Guarantees dismissal of any open job detail modal or overlay.
    Attempts mouse/JS click on top-right X icon, sends Escape,
    and as a failsafe, navigates back to clean /jobs feed if the modal persists.
    """
    for _ in range(2):
        try:
            # Evaluate JS to find and click the top-right X button (top < 300px, right > 60% viewport width)
            closed_via_js = await page.evaluate("""() => {
                let els = Array.from(document.querySelectorAll('button, svg, [aria-label*="close" i], [class*="close" i], span, div, a'));
                for (let el of els) {
                    let r = el.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0 && r.width < 90 && r.height < 90 && r.right > window.innerWidth * 0.60 && r.top < 300) {
                        el.click();
                        return true;
                    }
                }
                return false;
            }""")
            if closed_via_js:
                log("[Modal] Closed modal via top-right X button.")
                await page.wait_for_timeout(800)
            else:
                await page.keyboard.press("Escape")
                await page.wait_for_timeout(500)
        except Exception:
            try:
                await page.keyboard.press("Escape")
                await page.wait_for_timeout(500)
            except Exception:
                pass

    # Hard-reset Failsafe: check if modal is still in DOM or if URL contains job_listing_slug
    try:
        current_url = page.url
        modal_still_open = await page.evaluate("""() => {
            let dialog = document.querySelector('[role="dialog"], [class*="modal"], [class*="drawer"]');
            if (dialog && dialog.offsetWidth > 0 && dialog.offsetHeight > 0) return true;
            return false;
        }""")

        if modal_still_open or "job_listing_slug" in current_url:
            log("[Modal] Modal overlay still detected. Resetting to clean /jobs feed...")
            clean_url = current_url.split("?")[0] if "wellfound.com/jobs" in current_url else "https://wellfound.com/jobs"
            await page.goto(clean_url, wait_until="domcontentloaded", timeout=15000)
            await page.wait_for_timeout(1500)
            log("[Modal] Reset to clean /jobs feed complete.")
    except Exception as e:
        log(f"[Modal] Failsafe warning: {e}")


async def wait_for_submission_and_close(page, timeout=12):
    """
    Waits after clicking Apply for the submission request to complete and the success screen
    ("Congrats! Your application has been submitted") or top-right X button to render,
    then clicks the X button or sends Escape to dismiss the modal cleanly.
    """
    log("[Modal] Waiting for submission network request & success screen to appear...")
    deadline = asyncio.get_running_loop().time() + timeout
    
    success_appeared = False
    while asyncio.get_running_loop().time() < deadline:
        try:
            body_text = await page.evaluate("() => document.body.innerText || ''")
            txt = body_text.lower()
            if "congrats" in txt or "application has been submitted" in txt or "want to improve your odds" in txt:
                log("[Modal] Application submission success screen detected!")
                success_appeared = True
                await page.wait_for_timeout(3000) # Give UI 1s to stabilize
                break
        except Exception:
            pass
        await asyncio.sleep(0.5)

    if not success_appeared:
        log("[Modal] Submission wait timeout reached, closing modal...")
        await page.wait_for_timeout(5000)

    await close_all_modals(page)


async def get_learn_more_buttons(page):
    """
    Finds 'Learn more' buttons on the main job feed only.
    Excludes buttons nested inside job detail drawers, modals, or recommendation panels.
    """
    all_btns = await page.query_selector_all("button:has-text('Learn more'), a:has-text('Learn more')")
    valid_btns = []
    for btn in all_btns:
        try:
            is_inside_modal = await btn.evaluate("""(el) => {
                let p = el.parentElement;
                while (p) {
                    if (p.getAttribute('role') === 'dialog' ||
                        p.classList.contains('styles_modal__') ||
                        (p.className && typeof p.className === 'string' && (
                            p.className.includes('modal') ||
                            p.className.includes('drawer') ||
                            p.className.includes('similar') ||
                            p.className.includes('recommendation')
                        ))) {
                        return true;
                    }
                    p = p.parentElement;
                }
                return false;
            }""")
            if not is_inside_modal and await btn.is_visible():
                valid_btns.append(btn)
        except Exception:
            pass
    return valid_btns


async def scrape_jd(page) -> str:
    selectors = [
        "[data-test='job-description']",
        ".job-description",
        "[class*='description']",
        ".prose",
        "section",
    ]
    for sel in selectors:
        try:
            el = await page.query_selector(sel)
            if el:
                txt = (await el.inner_text()).strip()
                if len(txt) > 100:
                    return txt[:5000]
        except Exception:
            pass
    # fallback
    try:
        main = await page.query_selector("main, [role='main'], article")
        if main:
            return (await main.inner_text()).strip()[:5000]
    except Exception:
        pass
    return ""


async def _get_label(page, el) -> str:
    try:
        eid = await el.get_attribute("id")
        if eid:
            lbl = await page.query_selector(f"label[for='{eid}']")
            if lbl:
                t = (await lbl.inner_text()).strip()
                if t: return t
    except Exception:
        pass
    for attr in ("aria-label", "placeholder", "name"):
        try:
            v = await el.get_attribute(attr)
            if v and v.strip(): return v.strip()
        except Exception:
            pass
    try:
        t = await el.evaluate("""(el) => {
            let p = el.parentElement;
            while (p) {
                if (p.tagName==='LABEL') return p.innerText;
                let l = p.querySelector('label');
                if (l) return l.innerText;
                p = p.parentElement;
            }
            return '';
        }""")
        if t and t.strip(): return t.strip()
    except Exception:
        pass
    return ""


async def fill_application_form(page, cover_letter, profile, jd_text, llm_cfg, dry_run) -> bool:
    log("[Form] Scanning application form...")
    await page.wait_for_timeout(1000)

    # Cover letter textarea
    filled_textarea = None
    for sel in [
        "textarea[name*='cover' i]",
        "textarea[placeholder*='cover' i]",
        "textarea[placeholder*='introduce' i]",
        "textarea",
    ]:
        try:
            el = await page.query_selector(sel)
            if el and await el.is_visible() and await el.is_editable():
                await el.click()
                await el.evaluate("(el) => el.value = ''")
                await el.fill(cover_letter)
                filled_textarea = el
                log("[Form] Filled cover letter.")
                break
        except Exception:
            pass

    # Other visible text inputs
    inputs = await page.query_selector_all("input[type='text'], input[type='email'], textarea")
    for inp in inputs:
        try:
            if not (await inp.is_visible() and await inp.is_editable()): continue
            val = await inp.input_value()
            if val: continue
            label = await _get_label(page, inp)
            if not label: continue
            ll = label.lower()
            if any(k in ll for k in ("search", "filter")): continue
            if "name" in ll:
                await inp.fill(profile.get("fullName", ""))
            elif "email" in ll:
                await inp.fill(profile.get("email", ""))
            elif "phone" in ll:
                await inp.fill(profile.get("phone", ""))
            elif "linkedin" in ll:
                await inp.fill(profile.get("linkedinUrl", ""))
            elif "github" in ll:
                await inp.fill(profile.get("githubUrl", ""))
            elif "portfolio" in ll or "website" in ll:
                await inp.fill(profile.get("portfolioUrl", ""))
            elif "location" in ll:
                await inp.fill(profile.get("location", ""))
            else:
                log(f"[Form] LLM answering: {label[:60]}")
                ans = await answer_question(llm_cfg, profile, label, jd_text)
                await inp.fill(ans)
        except Exception as e:
            log(f"[Form] Skipped input: {e}")

    # Find the black Apply/Send button directly attached to the filled form card
    submit_btn = None

    if filled_textarea:
        try:
            btn_handle = await filled_textarea.evaluate_handle("""(ta) => {
                let p = ta.parentElement;
                while (p && p.tagName !== 'BODY' && p.tagName !== 'HTML') {
                    let btns = Array.from(p.querySelectorAll('button'));
                    for (let b of btns) {
                        let txt = (b.innerText || '').strip ? (b.innerText || '').strip() : (b.innerText || '').trim();
                        let t = txt.toLowerCase();
                        if (t === 'apply' || t === 'send application' || t === 'send' || b.getAttribute('type') === 'submit') {
                            return b;
                        }
                    }
                    p = p.parentElement;
                }
                return null;
            }""")
            if btn_handle:
                btn_el = btn_handle.as_element()
                if btn_el and await btn_el.is_visible():
                    submit_btn = btn_el
                    log("[Form] Found attached Apply button relative to textarea.")
        except Exception as e:
            log(f"[Form] Relative button lookup error: {e}")

    # Fallback: search for visible Apply button in the upper-right section of the viewport (x > 400, y < 700)
    if not submit_btn:
        btns = await page.query_selector_all("button:has-text('Apply'), button:has-text('Send application'), button:has-text('Send')")
        for b in btns:
            try:
                if await b.is_visible():
                    box = await b.bounding_box()
                    if box and box['y'] < 700 and box['x'] > 350:
                        submit_btn = b
                        log(f"[Form] Found upper-right Apply button at y={int(box['y'])}, x={int(box['x'])}")
                        break
            except Exception:
                pass

    if dry_run:
        log("[Form] DRY RUN — form filled in application card. Skipping submit click.")
        return True

    if submit_btn and await submit_btn.is_visible() and await submit_btn.is_enabled():
        log("[Form] Submitting application (clicking attached Apply button)...")
        await submit_btn.click()
        await wait_for_submission_and_close(page)
        log("[Form] Application submitted successfully!")
        return True
    else:
        log("[Form] WARNING: Attached Apply submit button not found.")
        return False


# ─────────────────────────────────────────────────────────────────
# Per-job processing
# ─────────────────────────────────────────────────────────────────

async def process_job(page, job_idx, profile, llm_cfg, dry_run) -> bool:
    job_id = f"wf-{job_idx}"
    try:
        # Make sure any old modal/drawer is completely closed before selecting next job
        await close_all_modals(page)
        await page.wait_for_timeout(500)

        buttons = await get_learn_more_buttons(page)
        if job_idx >= len(buttons):
            return False

        btn = buttons[job_idx]

        # Extract title / company from card DOM
        job_title, company = "Unknown Role", "Unknown Company"
        try:
            card = await btn.evaluate_handle(
                "(el) => el.closest('[class*=\"component\"], [class*=\"job\"], section') || el.parentElement")
            card_el = card.as_element()
            if card_el:
                t = await card_el.query_selector("h2, h3, [class*='title']")
                if t: job_title = (await t.inner_text()).strip()
                c = await card_el.query_selector("[class*='company'], [class*='startup'], strong")
                if c: company = (await c.inner_text()).strip().split("\n")[0]
        except Exception:
            pass

        log(f"[Job #{job_idx+1}] {job_title} @ {company}")
        status(f"Reading JD: {job_title} @ {company}", job_id)

        await btn.scroll_into_view_if_needed()
        await btn.click()
        await page.wait_for_timeout(2500)

        jd_text = await scrape_jd(page)
        log(f"[Job #{job_idx+1}] JD length: {len(jd_text)} chars")

        if not jd_text:
            emit_result(job_id, "failed", "Could not read JD")
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(1000)
            return False

        status(f"Generating cover letter for {company}...", job_id)
        cover_letter = await generate_cover_letter(llm_cfg, profile, jd_text, job_title, company)
        log(f"[Job #{job_idx+1}] Cover letter generated ({len(cover_letter)} chars, plain text)")

        status(f"Filling application for {company}...", job_id)
        ok = await fill_application_form(page, cover_letter, profile, jd_text, llm_cfg, dry_run)
        outcome = ("applied" if not dry_run else "skipped") if ok else "failed"
        msg = f"{'Applied' if not dry_run else 'Dry run'} — {job_title} @ {company}"
        emit_result(job_id, outcome, msg)

        await close_all_modals(page)
        await page.wait_for_timeout(1000)
        return ok

    except Exception as e:
        log(f"[Job #{job_idx+1}] Error: {e}")
        emit_result(job_id, "failed", str(e))
        try:
            await close_all_modals(page)
        except Exception:
            pass
        return False


# ─────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload", required=True)
    args = parser.parse_args()

    if not os.path.exists(args.payload):
        log(f"[Error] Payload not found: {args.payload}")
        sys.exit(1)

    with open(args.payload) as f:
        payload = json.load(f)

    profile     = payload.get("profile", {})
    filters     = payload.get("filters", {})
    llm_cfg     = payload.get("llm", {})
    dry_run     = payload.get("dryRun", True)
    profile_dir = payload.get("profileDir", "")
    max_jobs    = int(filters.get("maxJobs", 20))

    log(f"[Wellfound Apply] DryRun={dry_run}, MaxJobs={max_jobs}")

    if USING_PATCHRIGHT:
        log("[System] Using Patchright for browser automation")
    else:
        log("[System] Using Playwright for browser automation (Patchright not found)")

    if not profile_dir or not os.path.exists(profile_dir):
        log("[Error] Wellfound browser profile not found. Please log in to Wellfound first.")
        sys.exit(1)

    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            user_data_dir=profile_dir,
            headless=False,
            args=[
                "--no-first-run", "--no-default-browser-check",
                "--disable-session-crashed-bubble",
                "--disable-features=InfiniteSessionRestore",
            ],
            no_viewport=True,
        )
        page = context.pages[0] if context.pages else await context.new_page()

        log("[Wellfound Apply] Checking Wellfound session...")
        await page.goto("https://wellfound.com/jobs", wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2000)
        if "sign_in" in page.url or "login" in page.url:
            log("[Error] Not logged in. Please run Login to Wellfound first.")
            await context.close()
            sys.exit(1)

        log("[Wellfound Apply] Waiting for user's manual filters to load...")
        await page.wait_for_timeout(3000)

        total_processed = 0
        total_applied   = 0
        job_idx         = 0

        while total_processed < max_jobs:
            await close_all_modals(page)
            buttons = await get_learn_more_buttons(page)
            if not buttons or job_idx >= len(buttons):
                log("[Wellfound Apply] No more jobs on this page.")
                break

            ok = await process_job(page, job_idx, profile, llm_cfg, dry_run)
            if ok:
                total_applied += 1
            total_processed += 1
            job_idx += 1
            await page.wait_for_timeout(1500)

        log(f"[Wellfound Apply] Done. Processed={total_processed}, Applied={total_applied}")
        done(total_processed, total_applied)
        await context.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log("[Wellfound Apply] Interrupted.")
        done(0, 0)
