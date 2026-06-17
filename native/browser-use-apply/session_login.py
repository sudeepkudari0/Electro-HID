import asyncio
import sys
import argparse
import json
from playwright.async_api import async_playwright

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
                await perform_autofill(context, cmd)
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(json.dumps({"type": "log", "message": f"[Autofill Error] {str(e)}"}))
            sys.stdout.flush()

async def perform_autofill(context, cmd):
    job = cmd.get("job", {})
    profile = cmd.get("profile", {})
    resume_path = cmd.get("resume_path", "")
    cover_letter_text = job.get("coverLetterText", "") or cmd.get("coverLetterText", "")
    llm_config = cmd.get("llm", {})
    
    # 1. Get active page
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

    print(json.dumps({"type": "log", "message": f"[Autofill] Analyzing fields on page: {page.url}..."}))
    sys.stdout.flush()

    try:
        # 2. Tag elements
        elements = await page.query_selector_all("input, textarea, select, [role='textbox']")
        form_fields = []
        for idx, el in enumerate(elements):
            if not await el.is_visible():
                continue
                
            el_type = await el.get_attribute("type") or ""
            if el_type.lower() == "hidden":
                continue
                
            await el.evaluate(f"(element, idx) => element.setAttribute('data-autofill-id', String(idx))", idx)
            
            element_id = await el.get_attribute("id") or ""
            name = await el.get_attribute("name") or ""
            placeholder = await el.get_attribute("placeholder") or ""
            tag = await el.evaluate("(element) => element.tagName.toLowerCase()")
            
            options = []
            if tag == "select":
                opts = await el.query_selector_all("option")
                for opt in opts:
                    val = await opt.get_attribute("value") or ""
                    txt = await opt.inner_text()
                    options.append({"value": val, "text": txt.strip()})
                    
            label_text = ""
            if element_id:
                label = await page.query_selector(f"label[for='{element_id}']")
                if label:
                    label_text = await label.inner_text()
                    
            if not label_text:
                label_text = await el.get_attribute("aria-label") or await el.get_attribute("title") or ""
                
            if not label_text:
                label_text = placeholder
                
            if not label_text:
                label_text = await el.evaluate("""(element) => {
                    let parent = element.parentElement;
                    if (parent && parent.tagName.toLowerCase() === 'label') {
                        return parent.innerText;
                    }
                    let prev = element.previousSibling;
                    if (prev && prev.nodeType === 3) {
                        return prev.nodeValue;
                    }
                    return '';
                }""")
                
            form_fields.append({
                "autofill_id": str(idx),
                "tag": tag,
                "type": el_type,
                "label": label_text.strip() if label_text else "",
                "placeholder": placeholder,
                "options": options
            })
            
        if not form_fields:
            print(json.dumps({"type": "log", "message": "[Autofill] No visible input fields found on page."}))
            sys.stdout.flush()
            return
            
        print(json.dumps({"type": "log", "message": f"[Autofill] Found {len(form_fields)} fields. Consulting LLM..."}))
        sys.stdout.flush()
        
        # 3. Setup LLM
        from langchain_openai import ChatOpenAI
        llm = ChatOpenAI(
            model=llm_config.get("model") or "gpt-4o",
            api_key=llm_config.get("apiKey") or "EMPTY",
            base_url=llm_config.get("baseUrl") or None
        )
        
        prompt = f"""
You are an AI assistant designed to autofill a job application web form for a candidate.
Below is the candidate's profile information, cover letter, resume file path, and a list of form fields identified on the active page.

Candidate Profile:
{json.dumps(profile, indent=2)}

Cover Letter Text:
{cover_letter_text}

Resume File Path:
{resume_path}

Visible Form Fields:
{json.dumps(form_fields, indent=2)}

Match each form field with the correct candidate value.
For select dropdowns (tag="select"), inspect the list of available "options" and match the "value" or "text" of the option.
For file inputs (type="file"), specify the resume file path as the value, and action as "upload".
For checkbox/radio buttons, specify "true", "false", or the option value to select.

Respond in strict JSON format: a list of objects, each containing:
{{
  "autofill_id": "the autofill_id of the matched field",
  "value": "the string value to enter (or resume path)",
  "action": "fill" | "check" | "uncheck" | "select" | "upload"
}}

Do not include markdown code block formatting (such as ```json) in your response. Output raw JSON only.
"""
        response = await llm.ainvoke(prompt)
        content = response.content.strip()
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        fill_actions = json.loads(content.strip())
        
        # 4. Fill form
        filled_count = 0
        for act in fill_actions:
            fid = act.get("autofill_id")
            val = act.get("value")
            action = act.get("action")
            
            if not fid:
                continue
                
            el = await page.query_selector(f"[data-autofill-id='{fid}']")
            if not el:
                continue
                
            try:
                if action == "fill":
                    await el.focus()
                    await el.evaluate("(el) => el.value = ''")
                    await el.fill(val)
                    filled_count += 1
                elif action == "upload":
                    await el.set_input_files(val)
                    filled_count += 1
                elif action == "select":
                    await el.select_option(value=val)
                    filled_count += 1
                elif action == "check":
                    await el.check()
                    filled_count += 1
                elif action == "uncheck":
                    await el.uncheck()
                    filled_count += 1
            except Exception as e:
                print(json.dumps({"type": "log", "message": f"[Autofill] Failed to fill field {fid}: {str(e)}"}))
                sys.stdout.flush()
                
        print(json.dumps({"type": "log", "message": f"[Autofill] Successfully autofilled {filled_count} fields!"}))
        sys.stdout.flush()
        
    except Exception as e:
        print(json.dumps({"type": "log", "message": f"[Autofill Error] {str(e)}"}))
        sys.stdout.flush()

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", choices=["linkedin", "default"], required=True)
    parser.add_argument("--user-data-dir", required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

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

        # Interactive Mode
        stdin_task = asyncio.create_task(listen_to_stdin(context))
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
                # Filter out closed pages
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
