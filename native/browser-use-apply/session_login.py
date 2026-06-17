import asyncio
import sys
import argparse
import json
import re
import os
from playwright.async_api import async_playwright

# Global variables
job_context_by_page = {}
payload_data = None

async def wait_for_linkedin_auth(context, page, timeout=900):
    """
    Periodically checks if the user has authenticated on LinkedIn.
    Checks cookies for 'li_at' and URL patterns.
    """
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        try:
            if page.is_closed():
                break

            current_url = page.url
            if "linkedin.com/feed" in current_url or "linkedin.com/mynetwork" in current_url or "linkedin.com/jobs" in current_url:
                return {
                    "success": True,
                    "reason": "url_pattern",
                    "url": current_url
                }

            cookies = await context.cookies()
            li_at_cookie = [c for c in cookies if c.get("name") == "li_at" and "linkedin.com" in c.get("domain", "")]
            if li_at_cookie:
                return {
                    "success": True,
                    "reason": "li_at_cookie_present",
                    "url": current_url
                }

        except Exception:
            break
        await asyncio.sleep(1)

    try:
        cookies = await context.cookies()
        li_at_cookie = [c for c in cookies if c.get("name") == "li_at" and "linkedin.com" in c.get("domain", "")]
        if li_at_cookie:
            return {
                "success": True,
                "reason": "li_at_cookie_present",
                "url": page.url if not page.is_closed() else ""
            }
    except Exception:
        pass

    return {
        "success": False,
        "reason": "closed_or_timeout",
        "url": ""
    }

async def listen_to_stdin(context):
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
                await perform_autofill_stdin(context, cmd)
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(json.dumps({"type": "log", "message": f"[Autofill Error] {str(e)}"}))
            sys.stdout.flush()

async def fill_field(page, selector, value):
    if not value:
        return False
    try:
        el = await page.query_selector(selector)
        if el and await el.is_visible() and await el.is_editable():
            await el.focus()
            await el.evaluate("(el) => el.value = ''")
            await el.fill(value)
            return True
    except Exception:
        pass
    return False

async def run_autofill_impl(page, job_ctx, profile):
    url = page.url
    print(json.dumps({"type": "log", "message": f"[Autofill] Starting autofill for: {job_ctx.get('title')} at {job_ctx.get('company')}..."}))
    sys.stdout.flush()
    
    # Determine platform
    is_greenhouse = "greenhouse.io" in url
    is_lever = "lever.co" in url
    is_workday = "myworkday.com" in url or "workday" in url
    
    resume_path = job_ctx.get("resumePath", "")
    cover_letter = job_ctx.get("coverLetterText", "")
    
    # Common profile fields
    first_name = profile.get("fullName", "").split(" ")[0] if profile.get("fullName") else ""
    last_name = " ".join(profile.get("fullName", "").split(" ")[1:]) if profile.get("fullName") else ""
    full_name = profile.get("fullName", "")
    email = profile.get("email", "")
    phone = profile.get("phone", "")
    linkedin = profile.get("linkedinUrl", "")
    github = profile.get("githubUrl", "")
    portfolio = profile.get("portfolioUrl", "")
    
    filled_count = 0

    try:
        if is_greenhouse:
            print(json.dumps({"type": "log", "message": "[Autofill] Detected Greenhouse portal. Applying Greenhouse selectors..."}))
            sys.stdout.flush()
            
            # Greenhouse standard selectors
            if await fill_field(page, "input#first_name, input[name='job_application[first_name]']", first_name): filled_count += 1
            if await fill_field(page, "input#last_name, input[name='job_application[last_name]']", last_name): filled_count += 1
            if await fill_field(page, "input#email, input[name='job_application[email]']", email): filled_count += 1
            if await fill_field(page, "input#phone, input[name='job_application[phone]']", phone): filled_count += 1
            
            # Custom questions matching via labels
            labels = await page.query_selector_all("label")
            for label in labels:
                txt = (await label.inner_text()).lower()
                target_id = await label.get_attribute("for")
                if not target_id:
                    continue
                
                input_el = await page.query_selector(f"#{target_id}")
                if not input_el or not await input_el.is_editable():
                    continue
                    
                if "linkedin" in txt:
                    if await fill_field(page, f"#{target_id}", linkedin): filled_count += 1
                elif "github" in txt:
                    if await fill_field(page, f"#{target_id}", github): filled_count += 1
                elif "portfolio" in txt or "website" in txt:
                    if await fill_field(page, f"#{target_id}", portfolio): filled_count += 1
                    
            # File inputs
            if resume_path and os.path.exists(resume_path):
                resume_input = await page.query_selector("input[type='file'][accept*='pdf'], input[type='file'][id*='resume'], input[type='file'][name*='resume']")
                if resume_input:
                    await resume_input.set_input_files(resume_path)
                    filled_count += 1
                    print(json.dumps({"type": "log", "message": "[Autofill] Uploaded resume PDF."}))
                    sys.stdout.flush()
                    
            if cover_letter:
                cl_textarea = await page.query_selector("textarea#cover_letter, textarea[name*='cover_letter']")
                if cl_textarea:
                    await cl_textarea.fill(cover_letter)
                    filled_count += 1
                    
        elif is_lever:
            print(json.dumps({"type": "log", "message": "[Autofill] Detected Lever portal. Applying Lever selectors..."}))
            sys.stdout.flush()
            
            if await fill_field(page, "input[name='name']", full_name): filled_count += 1
            if await fill_field(page, "input[name='email']", email): filled_count += 1
            if await fill_field(page, "input[name='phone']", phone): filled_count += 1
            if await fill_field(page, "input[name='org']", profile.get("currentCompany", "")): filled_count += 1
            
            if await fill_field(page, "input[name='urls[LinkedIn]']", linkedin): filled_count += 1
            if await fill_field(page, "input[name='urls[GitHub]']", github): filled_count += 1
            if await fill_field(page, "input[name='urls[Portfolio]']", portfolio): filled_count += 1
            
            if resume_path and os.path.exists(resume_path):
                resume_input = await page.query_selector("input[type='file'][name='resume']")
                if resume_input:
                    await resume_input.set_input_files(resume_path)
                    filled_count += 1
                    print(json.dumps({"type": "log", "message": "[Autofill] Uploaded resume PDF."}))
                    sys.stdout.flush()
                    
            if cover_letter:
                cl_textarea = await page.query_selector("textarea[name='comments']")
                if cl_textarea:
                    await cl_textarea.fill(cover_letter)
                    filled_count += 1
                    
        elif is_workday:
            print(json.dumps({"type": "log", "message": "[Autofill] Detected Workday portal. Applying Workday selectors..."}))
            sys.stdout.flush()
            
            if await fill_field(page, "input[data-automation-id='legalNameSection_firstName']", first_name): filled_count += 1
            if await fill_field(page, "input[data-automation-id='legalNameSection_lastName']", last_name): filled_count += 1
            if await fill_field(page, "input[data-automation-id='email']", email): filled_count += 1
            if await fill_field(page, "input[data-automation-id='phone-number']", phone): filled_count += 1
            
            if await fill_field(page, "input[data-automation-id='linkedin']", linkedin): filled_count += 1
            if await fill_field(page, "input[data-automation-id='github']", github): filled_count += 1
            
            if resume_path and os.path.exists(resume_path):
                resume_input = await page.query_selector("input[type='file'][data-automation-id='file-upload-input-drop-zone']")
                if not resume_input:
                    resume_input = await page.query_selector("input[type='file']")
                if resume_input:
                    await resume_input.set_input_files(resume_path)
                    filled_count += 1
                    print(json.dumps({"type": "log", "message": "[Autofill] Uploaded resume PDF."}))
                    sys.stdout.flush()
                    
        else:
            # Generic Fallback Heuristic
            print(json.dumps({"type": "log", "message": "[Autofill] Unknown ATS. Running heuristic regex matcher..."}))
            sys.stdout.flush()
            
            inputs = await page.query_selector_all("input, textarea, select")
            for el in inputs:
                if not await el.is_visible() or not await el.is_editable():
                    continue
                    
                el_type = await el.get_attribute("type") or ""
                if el_type.lower() == "hidden":
                    continue
                    
                name = (await el.get_attribute("name") or "").lower()
                element_id = (await el.get_attribute("id") or "").lower()
                placeholder = (await el.get_attribute("placeholder") or "").lower()
                aria_label = (await el.get_attribute("aria-label") or "").lower()
                
                label_txt = ""
                if element_id:
                    label = await page.query_selector(f"label[for='{element_id}']")
                    if label:
                        label_txt = (await label.inner_text()).lower()
                        
                combined_text = f"{name} {element_id} {placeholder} {aria_label} {label_txt}"
                
                if "email" in name or "email" in element_id or "email" in label_txt:
                    if await el.fill(email): filled_count += 1
                elif any(x in combined_text for x in ["first name", "fname", "given name"]):
                    if await el.fill(first_name): filled_count += 1
                elif any(x in combined_text for x in ["last name", "lname", "family name", "surname"]):
                    if await el.fill(last_name): filled_count += 1
                elif "fullname" in name or "full name" in combined_text or (("name" in name or "name" in element_id) and not ("first" in name or "last" in name)):
                    if await el.fill(full_name): filled_count += 1
                elif any(x in combined_text for x in ["phone", "tel", "mobile", "cell"]):
                    if await el.fill(phone): filled_count += 1
                elif "linkedin" in combined_text:
                    if await el.fill(linkedin): filled_count += 1
                elif "github" in combined_text:
                    if await el.fill(github): filled_count += 1
                elif any(x in combined_text for x in ["portfolio", "website", "personal page"]):
                    if await el.fill(portfolio): filled_count += 1
                elif "cover" in combined_text and await el.evaluate("(el) => el.tagName.toLowerCase() === 'textarea'"):
                    if await el.fill(cover_letter): filled_count += 1
                    
            if resume_path and os.path.exists(resume_path):
                file_inputs = await page.query_selector_all("input[type='file']")
                for fi in file_inputs:
                    element_id = (await fi.get_attribute("id") or "").lower()
                    name = (await fi.get_attribute("name") or "").lower()
                    
                    label_txt = ""
                    if element_id:
                        label = await page.query_selector(f"label[for='{element_id}']")
                        if label:
                            label_txt = (await label.inner_text()).lower()
                            
                    combined = f"{element_id} {name} {label_txt}"
                    if "resume" in combined or "cv" in combined or "curriculum" in combined:
                        await fi.set_input_files(resume_path)
                        filled_count += 1
                        print(json.dumps({"type": "log", "message": "[Autofill] Uploaded resume file via heuristic."}))
                        sys.stdout.flush()
                        break
                        
        print(json.dumps({"type": "log", "message": f"[Autofill] Autofilled {filled_count} fields!"}))
        sys.stdout.flush()
        
    except Exception as e:
        print(json.dumps({"type": "log", "message": f"[Autofill Error] {str(e)}"}))
        sys.stdout.flush()

async def perform_autofill_stdin(context, cmd):
    """
    Fallback support for legacy command pipe from ApplyPanel if triggered there.
    """
    job = cmd.get("job", {})
    profile = cmd.get("profile", {})
    resume_path = cmd.get("resume_path", "")
    
    # Find active page
    page = None
    valid_pages = [p for p in context.pages if not p.is_closed() and p.url != "about:blank"]
    if valid_pages:
        page = valid_pages[-1]
    else:
        page = context.pages[-1] if context.pages else None
        
    if not page:
        print(json.dumps({"type": "log", "message": "[Autofill] No active page found."}))
        sys.stdout.flush()
        return

    job_ctx = {
        "title": job.get("title", ""),
        "company": job.get("company", ""),
        "coverLetterText": job.get("coverLetterText", ""),
        "resumePath": resume_path
    }
    await run_autofill_impl(page, job_ctx, profile)

async def main():
    global payload_data
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", choices=["linkedin", "default"], required=True)
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
            headless=args.check,
            args=chrome_args,
            viewport={"width": 1280, "height": 800}
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
            else:
                print(json.dumps({"success": True, "loggedIn": True}))
                sys.stdout.flush()
                await context.close()
                return

        # Context-level trigger injection script (Shadow DOM + Hotkey listener)
        trigger_script = """
        (() => {
          if (document.getElementById('synapse-autofill-host')) return;
          
          const host = document.createElement('div');
          host.id = 'synapse-autofill-host';
          host.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;display:block;';
          
          const shadow = host.attachShadow({ mode: 'open' });
          shadow.innerHTML = `
            <style>
              button {
                padding: 10px 18px;
                border-radius: 9999px;
                background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
                color: #ffffff;
                border: 1px solid rgba(255, 255, 255, 0.1);
                font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                font-weight: 700;
                font-size: 13px;
                cursor: pointer;
                box-shadow: 0 10px 25px rgba(99, 102, 241, 0.35);
                display: flex;
                align-items: center;
                gap: 6px;
                transition: transform 0.2s, box-shadow 0.2s;
              }
              button:hover {
                transform: translateY(-2px);
                box-shadow: 0 12px 30px rgba(99, 102, 241, 0.45);
              }
              button:active {
                transform: translateY(0);
              }
            </style>
            <button id="btn">⚡ Autofill Form</button>
          `;
          
          shadow.getElementById('btn').onclick = (e) => {
            e.stopPropagation();
            window.triggerAutofill();
          };
          
          document.body.appendChild(host);

          document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === 'A') {
              e.preventDefault();
              window.triggerAutofill();
            }
          });
        })();
        """
        await context.add_init_script(trigger_script)

        # Context-level exposed binding
        async def on_autofill_trigger(source):
            page = source["page"]
            ctx = job_context_by_page.get(page)
            if not ctx:
                # Fallback: check if the page's current URL matches any job URL
                current_url = page.url
                for p, c in job_context_by_page.items():
                    if c.get("url") and c["url"] in current_url:
                        ctx = c
                        break
            if not ctx:
                # Fallback to first context if none matched
                if job_context_by_page:
                    ctx = list(job_context_by_page.values())[0]
            
            if ctx:
                profile = payload_data.get("profile", {}) if payload_data else {}
                await run_autofill_impl(page, ctx, profile)
            else:
                print(json.dumps({"type": "log", "message": "[Autofill] No job context matched for this tab."}))
                sys.stdout.flush()

        await context.expose_binding("triggerAutofill", lambda source: asyncio.create_task(on_autofill_trigger(source)))

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
                    page.on("close", on_page_close)
                    
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
