import asyncio
import sys
import argparse
import json
import os
# Playwright/Patchright imported dynamically in main() based on site

from client_scripts import get_trigger_script
from auth import wait_for_linkedin_auth, wait_for_wellfound_auth
from autofill_engine import run_autofill_impl, perform_autofill_stdin
from modal_autofill import run_modal_autofill_impl

# Global variables
job_context_by_page = {}
payload_data = {}

async def listen_to_stdin(context):
    global payload_data
    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)
    
    while True:
        try:
            line = await reader.readline()
            if not line:
                break
            cmd = json.loads(line.decode().strip())
            if cmd.get("action") == "autofill":
                await perform_autofill_stdin(context, cmd, payload_data)
            elif cmd.get("action") == "close":
                for page in list(context.pages):
                    try:
                        await page.close()
                    except Exception:
                        pass
                break
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(json.dumps({"type": "log", "message": f"[Autofill Error] {str(e)}"}))
            sys.stdout.flush()

async def main():
    global payload_data
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", choices=["linkedin", "default", "wellfound"], required=True)
    parser.add_argument("--user-data-dir", required=True)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--jobs-file", help="Path to temp JSON payload containing selected jobs and profile")
    args = parser.parse_args()

    # Load jobs payload if provided
    if args.jobs_file and os.path.exists(args.jobs_file):
        try:
            with open(args.jobs_file, "r") as f:
                payload_data = json.load(f)
        except Exception as e:
            print(json.dumps({"type": "log", "message": f"[Payload Error] Failed to load jobs payload: {str(e)}"}))
            sys.stdout.flush()

    if args.site == "wellfound":
        try:
            from patchright.async_api import async_playwright
            print(json.dumps({"type": "log", "message": "[System] Using Patchright for browser automation"}))
            sys.stdout.flush()
        except ImportError:
            from playwright.async_api import async_playwright
            print(json.dumps({"type": "log", "message": "[System] Using Playwright for browser automation (Patchright not found)"}))
            sys.stdout.flush()
    else:
        from playwright.async_api import async_playwright
        print(json.dumps({"type": "log", "message": "[System] Using Playwright for browser automation"}))
        sys.stdout.flush()

    async with async_playwright() as p:
        chrome_args = [
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-session-crashed-bubble",
            "--disable-features=InfiniteSessionRestore,PasswordManagerOnboarding",
            "--hide-crash-restore-bubble",
            "--noerrdialogs",
            "--password-store=basic",
            "--disable-save-password-bubble",
            "--disable-popup-blocking",
        ]

        context = await p.chromium.launch_persistent_context(
            user_data_dir=args.user_data_dir,
            channel="chrome",
            headless=args.check,
            args=chrome_args,
            no_viewport=True,
        )

        if args.check:
            if args.site == "linkedin":
                cookies = await context.cookies()
                li_at_cookie = [c for c in cookies if c.get("name") == "li_at" and "linkedin.com" in c.get("domain", "")]
                if not li_at_cookie:
                    print(json.dumps({"success": True, "loggedIn": False}))
                    sys.stdout.flush()
                    await context.close()
                    return

                try:
                    page = context.pages[0] if context.pages else await context.new_page()
                    await page.goto("https://www.linkedin.com/feed", timeout=15000)
                    
                    current_url = page.url
                    if "login" in current_url or "signup" in current_url or "checkpoint" in current_url:
                        print(json.dumps({"success": True, "loggedIn": False}))
                        sys.stdout.flush()
                        await context.close()
                        return

                    name = None
                    try:
                        await page.wait_for_selector(".feed-identity-module__name, .global-nav__me-photo, .feed-identity-module__actor-meta", timeout=5000)
                        name_elem = await page.query_selector(".feed-identity-module__name")
                        if name_elem:
                            name = (await name_elem.inner_text()).strip()
                        if not name:
                            name_elem = await page.query_selector(".feed-identity-module__actor-meta a")
                            if name_elem:
                                name = (await name_elem.inner_text()).strip()
                        if not name:
                            photo_elem = await page.query_selector(".global-nav__me-photo")
                            if photo_elem:
                                alt = await photo_elem.get_attribute("alt")
                                if alt and "Photo of" in alt:
                                    name = alt.split("Photo of")[-1].strip()
                    except Exception:
                        pass

                    print(json.dumps({"success": True, "loggedIn": True, "name": name}))
                except Exception as e:
                    print(json.dumps({"success": False, "error": str(e)}))
                sys.stdout.flush()
                await context.close()
                return
            elif args.site == "wellfound":
                try:
                    page = context.pages[0] if context.pages else await context.new_page()
                    await page.goto("https://wellfound.com/jobs", timeout=20000, wait_until="domcontentloaded")
                    await page.wait_for_timeout(2000)
                    current_url = page.url
                    login_pages = ("/users/sign_in", "/login", "/sign_in")
                    if any(lp in current_url for lp in login_pages):
                        print(json.dumps({"success": True, "loggedIn": False}))
                    else:
                        print(json.dumps({"success": True, "loggedIn": True}))
                except Exception as e:
                    print(json.dumps({"success": False, "error": str(e)}))
                sys.stdout.flush()
                await context.close()
                return
            else:
                print(json.dumps({"success": True, "loggedIn": True}))
                sys.stdout.flush()
                await context.close()
                return

        # Context-level trigger injection script (Shadow DOM + Hotkey listener)
        await context.add_init_script(get_trigger_script())

        # Context-level exposed bindings
        async def on_autofill_trigger(source):
            try:
                page = source["page"]
                print(json.dumps({"type": "log", "message": f"[Autofill] triggerAutofill called from page: {page.url}"}))
                sys.stdout.flush()
                
                ctx = job_context_by_page.get(page)
                if not ctx:
                    current_url = page.url
                    for p, c in job_context_by_page.items():
                        if c.get("url") and c["url"] in current_url:
                            ctx = c
                            break
                if not ctx and job_context_by_page:
                    ctx = list(job_context_by_page.values())[0]
                if not ctx:
                    ctx = {
                        "title": "",
                        "company": "",
                        "coverLetterText": "",
                        "resumePath": ""
                    }
                
                profile = payload_data.get("profile", {}) if payload_data else {}
                await run_autofill_impl(page, ctx, profile, payload_data)
            except Exception as e:
                import traceback
                tb = traceback.format_exc()
                print(json.dumps({"type": "log", "message": f"[Autofill Error in trigger] {str(e)}\n{tb}"}))
                sys.stdout.flush()

        async def on_check_resume(source):
            try:
                page = source["page"]
                ctx = job_context_by_page.get(page)
                if not ctx:
                    current_url = page.url
                    for p, c in job_context_by_page.items():
                        if c.get("url") and c["url"] in current_url:
                            ctx = c
                            break
                if not ctx and job_context_by_page:
                    ctx = list(job_context_by_page.values())[0]
                
                resume_path = ctx.get("resumePath") if ctx else None
                if not resume_path and payload_data:
                    resume_path = payload_data.get("resume_path") or payload_data.get("resumePdfPath")
                
                return bool(resume_path and os.path.exists(resume_path))
            except Exception:
                return False

        async def on_view_resume(source):
            try:
                page = source["page"]
                ctx = job_context_by_page.get(page)
                if not ctx:
                    current_url = page.url
                    for p, c in job_context_by_page.items():
                        if c.get("url") and c["url"] in current_url:
                            ctx = c
                            break
                if not ctx and job_context_by_page:
                    ctx = list(job_context_by_page.values())[0]
                
                resume_path = ctx.get("resumePath") if ctx else None
                if not resume_path and payload_data:
                    resume_path = payload_data.get("resume_path") or payload_data.get("resumePdfPath")
                
                if resume_path and os.path.exists(resume_path):
                    import urllib.parse
                    file_url = "file://" + urllib.parse.quote(os.path.abspath(resume_path))
                    print(json.dumps({"type": "log", "message": f"[Autofill] Opening resume in new tab: {file_url}"}))
                    sys.stdout.flush()
                    new_page = await context.new_page()
                    await new_page.goto(file_url)
                else:
                    print(json.dumps({"type": "log", "message": "[Autofill] No local resume path found to display."}))
                    sys.stdout.flush()
            except Exception as e:
                print(json.dumps({"type": "log", "message": f"[Autofill Error viewing resume] {str(e)}"}))
                sys.stdout.flush()

        async def on_modal_autofill_trigger(source):
            try:
                page = source["page"]
                print(json.dumps({"type": "log", "message": f"[Modal Autofill] triggerModalAutofill called from page: {page.url}"}))
                sys.stdout.flush()
                
                ctx = job_context_by_page.get(page)
                if not ctx:
                    current_url = page.url
                    for p, c in job_context_by_page.items():
                        if c.get("url") and c["url"] in current_url:
                            ctx = c
                            break
                if not ctx and job_context_by_page:
                    ctx = list(job_context_by_page.values())[0]
                if not ctx:
                    ctx = {
                        "title": "",
                        "company": "",
                        "coverLetterText": "",
                        "resumePath": ""
                    }
                
                profile = payload_data.get("profile", {}) if payload_data else {}
                await run_modal_autofill_impl(page, ctx, profile, payload_data)
            except Exception as e:
                import traceback
                tb = traceback.format_exc()
                print(json.dumps({"type": "log", "message": f"[Modal Autofill Error] {str(e)}\n{tb}"}))
                sys.stdout.flush()
                try:
                    await page.evaluate("([msg]) => window.resetModalAutofillBtn(msg)", [f"Error: {str(e)}"])
                except Exception:
                    pass

        # Fallback to console listener for stealth browsers that strip Playwright bindings
        def setup_console_listener(page):
            async def handle_console(msg):
                try:
                    text = msg.text
                    if text == "__SYNAPSE_AUTOFILL_TRIGGER__":
                        asyncio.create_task(on_autofill_trigger({"page": page}))
                    elif text == "__SYNAPSE_MODAL_AUTOFILL_TRIGGER__":
                        asyncio.create_task(on_modal_autofill_trigger({"page": page}))
                    elif text == "__SYNAPSE_VIEW_RESUME_TRIGGER__":
                        asyncio.create_task(on_view_resume({"page": page}))
                except Exception:
                    pass
            page.on("console", handle_console)
            
        context.on("page", setup_console_listener)
        for p in context.pages:
            setup_console_listener(p)
            
        resume_exists = False
        if payload_data:
            rp = payload_data.get("resume_path") or payload_data.get("resumePdfPath")
            if rp and os.path.exists(rp):
                resume_exists = True
        await context.add_init_script(f"window.__SYNAPSE_RESUME_EXISTS = {'true' if resume_exists else 'false'};")

        try:
            await context.expose_binding("triggerAutofill", lambda source: asyncio.create_task(on_autofill_trigger(source)))
            await context.expose_binding("triggerModalAutofill", lambda source: asyncio.create_task(on_modal_autofill_trigger(source)))
            await context.expose_binding("checkResume", lambda source: on_check_resume(source))
            await context.expose_binding("viewResume", lambda source: asyncio.create_task(on_view_resume(source)))
        except Exception as e:
            print(json.dumps({"type": "log", "message": f"[Setup] Could not expose bindings: {e}"}))
            sys.stdout.flush()

        # Popup and Tab lifecycle mapping handlers
        def on_popup(new_page, parent_ctx):
            job_context_by_page[new_page] = parent_ctx
            new_page.on("popup", lambda np: on_popup(np, parent_ctx))
            new_page.on("close", lambda p=new_page: on_page_close(p))

        def on_page_close(closed_page):
            if closed_page in job_context_by_page:
                del job_context_by_page[closed_page]

        # Interactive Mode
        stdin_task = asyncio.create_task(listen_to_stdin(context))

        if payload_data and payload_data.get("jobs"):
            first = True
            for job in payload_data.get("jobs", []):
                if not job.get("url"):
                    continue
                try:
                    if first:
                        page = context.pages[0] if context.pages else await context.new_page()
                        first = False
                    else:
                        page = await context.new_page()
                    
                    job_context_by_page[page] = job
                    page.on("popup", lambda np, j=job: on_popup(np, j))
                    page.on("close", lambda p=page: on_page_close(p))
                    
                    await page.goto(job["url"])
                    print(json.dumps({"type": "log", "message": f"Opened job page: {job.get('title')} at {job.get('company')}"}))
                    sys.stdout.flush()
                except Exception as e:
                    print(json.dumps({"type": "log", "message": f"Error opening job tab: {str(e)}"}))
                    sys.stdout.flush()
        else:
            page = context.pages[0] if context.pages else await context.new_page()
            if args.site == "linkedin":
                await page.goto("https://www.linkedin.com/login")
                print(json.dumps({"type": "status", "message": "Please log in to LinkedIn in the browser window..."}))
                sys.stdout.flush()
                
                result = await wait_for_linkedin_auth(context, page)
                if result["success"]:
                    print(json.dumps({
                        "type": "login_status",
                        "success": True,
                        "message": "LinkedIn authentication detected!",
                        "details": result
                    }))
                else:
                    print(json.dumps({
                        "type": "login_status",
                        "success": False,
                        "message": "LinkedIn login not completed or browser closed.",
                        "details": result
                    }))
                sys.stdout.flush()
            elif args.site == "wellfound":
                await page.goto("https://wellfound.com/login")
                print(json.dumps({"type": "status", "message": "Please log in to Wellfound in the browser window..."}))
                sys.stdout.flush()

                result = await wait_for_wellfound_auth(context, page)
                if result["success"]:
                    print(json.dumps({
                        "type": "login_status",
                        "success": True,
                        "message": "Wellfound authentication detected!",
                        "details": result
                    }))
                else:
                    print(json.dumps({
                        "type": "login_status",
                        "success": False,
                        "message": "Wellfound login not completed or browser closed.",
                        "details": result
                    }))
                sys.stdout.flush()
            else:
                await page.goto("https://www.google.com")
                print(json.dumps({"type": "status", "message": "Default browser session opened. Navigate to any site and log in. Close browser when done."}))
                sys.stdout.flush()

        # Keep browser open for either site as long as pages are active
        while len(context.pages) > 0:
            try:
                active_pages = [p for p in context.pages if not p.is_closed()]
                if not active_pages:
                    break
                await asyncio.sleep(1)
            except Exception:
                break

        stdin_task.cancel()
        print(json.dumps({
            "type": "login_status",
            "success": True,
            "message": f"{args.site.capitalize()} browser session closed."
        }))
        sys.stdout.flush()
        await context.close()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print(json.dumps({"type": "login_status", "success": False, "message": "Interrupted by user"}))
        sys.stdout.flush()
