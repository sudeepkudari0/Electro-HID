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
            elif cmd.get("action") == "close":
                # Close all pages to trigger the clean close loop
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

async def get_element_label(page, el):
    try:
        el_id = await el.get_attribute("id")
        if el_id:
            label_el = await page.query_selector(f"label[for='{el_id}']")
            if label_el:
                txt = await label_el.inner_text()
                if txt.strip():
                    return txt.strip()
    except Exception:
        pass
    
    try:
        aria_label = await el.get_attribute("aria-label")
        if aria_label and aria_label.strip():
            return aria_label.strip()
    except Exception:
        pass
        
    try:
        aria_labelled_by = await el.get_attribute("aria-labelledby")
        if aria_labelled_by:
            for part in aria_labelled_by.split():
                label_el = await page.query_selector(f"#{part}")
                if label_el:
                    txt = await label_el.inner_text()
                    if txt.strip():
                        return txt.strip()
    except Exception:
        pass
                
    try:
        placeholder = await el.get_attribute("placeholder")
        if placeholder and placeholder.strip():
            return placeholder.strip()
    except Exception:
        pass
        
    try:
        parent_label = await el.evaluate("""(element) => {
            let parent = element.parentElement;
            while (parent) {
                if (parent.tagName.toLowerCase() === 'label') {
                    return parent.innerText;
                }
                parent = parent.parentElement;
            }
            return '';
        }""")
        if parent_label and parent_label.strip():
            return parent_label.strip()
    except Exception:
        pass
        
    try:
        prev_text = await el.evaluate("""(element) => {
            let prev = element.previousSibling;
            while (prev) {
                if (prev.nodeType === 3 && prev.nodeValue.trim()) {
                    return prev.nodeValue.trim();
                }
                if (prev.nodeType === 1) {
                    let text = prev.innerText || prev.textContent;
                    if (text.trim()) return text.trim();
                }
                prev = prev.previousSibling;
            }
            return '';
        }""")
        if prev_text and prev_text.strip():
            return prev_text.strip()
    except Exception:
        pass
        
    return ""

async def get_group_label(page, first_el):
    try:
        legend_txt = await first_el.evaluate("""(element) => {
            let fieldset = element.closest('fieldset');
            if (fieldset) {
                let legend = fieldset.querySelector('legend');
                if (legend) return legend.innerText;
            }
            let container = element.closest('.form-group, .field, [role="group"], .radio-group');
            if (container) {
                let labelEl = container.querySelector('label, .label, .question-text, .legend');
                if (labelEl) return labelEl.innerText;
            }
            return '';
        }""")
        if legend_txt and legend_txt.strip():
            return legend_txt.strip()
    except Exception:
        pass
    return ""

async def get_radio_option_label(page, el):
    try:
        el_id = await el.get_attribute("id")
        if el_id:
            label_el = await page.query_selector(f"label[for='{el_id}']")
            if label_el:
                txt = await label_el.inner_text()
                if txt.strip():
                    return txt.strip()
    except Exception:
        pass
        
    try:
        txt = await el.evaluate("""(element) => {
            let parent = element.parentElement;
            if (parent && parent.tagName.toLowerCase() === 'label') {
                return parent.innerText;
            }
            let next = element.nextSibling;
            if (next && next.nodeType === 3) {
                return next.nodeValue;
            }
            let nextEl = element.nextElementSibling;
            if (nextEl && nextEl.tagName.toLowerCase() === 'span') {
                return nextEl.innerText;
            }
            return '';
        }""")
        return txt.strip()
    except Exception:
        pass
    return ""

async def get_select_options(el):
    options = []
    try:
        option_elements = await el.query_selector_all("option")
        for opt in option_elements:
            val = await opt.get_attribute("value") or ""
            txt = await opt.inner_text()
            options.append(txt.strip() if txt else val.strip())
    except Exception:
        pass
    return options

def match_dropdown_option(options, preferred_synonyms):
    for i, opt in enumerate(options):
        norm = opt.lower().strip()
        if any(s in norm for s in preferred_synonyms):
            return i
    return None

def match_country_option(options, country_name):
    if not country_name:
        return None
    name_norm = country_name.lower().strip()
    for i, opt in enumerate(options):
        opt_norm = opt.lower().strip()
        if name_norm == opt_norm or name_norm in opt_norm or opt_norm in name_norm:
            return i
    if "united states" in name_norm or "usa" in name_norm or "u.s." in name_norm:
        for i, opt in enumerate(options):
            o = opt.lower()
            if "united states" in o or o == "usa" or o == "us":
                return i
    return None

def match_state_option(options, location):
    if not location:
        return None
    loc_norm = location.lower().strip()
    for i, opt in enumerate(options):
        opt_norm = opt.lower().strip()
        if opt_norm in loc_norm or loc_norm in opt_norm:
            return i
    return None

async def fill_cover_letter_impl(page, cover_letter_text):
    if not cover_letter_text:
        return False
        
    print(json.dumps({"type": "log", "message": "[Autofill] Attempting to fill cover letter..."}))
    sys.stdout.flush()
    await page.evaluate("([msg]) => window.addAutofillLog(msg)", ["Locating cover letter field..."])
    
    # 0. Try to click "Enter manually" if it is an attachment toggle
    try:
        toggles = await page.query_selector_all("button, span, a, div[role='button']")
        for toggle in toggles:
            text = (await toggle.text_content() or "").strip().lower()
            if "enter manually" in text or "write cover letter" in text or "paste" in text:
                # Check if it's within a cover letter section
                parent_text = await toggle.evaluate("""(el) => {
                    let parent = el.closest('.form-group, .field, td, div');
                    while (parent) {
                        let text = parent.innerText || "";
                        if (/cover letter/i.test(text)) return text;
                        parent = parent.parentElement;
                    }
                    return '';
                }""")
                if parent_text:
                    await page.evaluate("([msg]) => window.addAutofillLog(msg)", ["Clicking 'Enter manually' to show text area..."])
                    await toggle.click()
                    await asyncio.sleep(0.5)
                    break
    except Exception as e:
        print(json.dumps({"type": "log", "message": f"[Autofill Log] Failed to toggle cover letter input: {str(e)}"}))
        sys.stdout.flush()
        
    # 1. Plain textareas first
    try:
        textareas = await page.query_selector_all("textarea")
        for el in textareas:
            label = (await get_element_label(page, el)).lower()
            if any(x in label for x in ["cover letter", "letter", "comments", "msg_to_employer", "message to"]):
                await highlight_element(el)
                await el.focus()
                await el.evaluate("(el) => el.value = ''")
                await page.evaluate("([msg]) => window.addAutofillLog(msg)", ["Typing cover letter..."])
                await el.type(cover_letter_text, delay=5)
                print(json.dumps({"type": "log", "message": "[Autofill] Filled cover letter in plain textarea."}))
                sys.stdout.flush()
                await page.evaluate("([msg]) => window.addAutofillLog(msg)", ["Typed cover letter in plain textarea."])
                return True
    except Exception:
        pass
                
    # 2. Contenteditable rich text editor (Workday, custom, etc.)
    try:
        editors = await page.query_selector_all("[contenteditable='true']")
        for el in editors:
            label = await el.evaluate("""(element) => {
                let container = element.closest('.form-group, .field, [role="group"]');
                if (container) {
                    let labelEl = container.querySelector('label, legend');
                    if (labelEl) return labelEl.innerText;
                }
                let sibling = element.previousElementSibling;
                while (sibling) {
                    if (sibling.tagName.match(/H[1-6]/i) || sibling.tagName === 'LABEL') {
                        return sibling.innerText;
                    }
                    sibling = sibling.previousElementSibling;
                }
                return '';
            }""")
            label = label.lower()
            if any(x in label for x in ["cover letter", "letter", "comments", "msg_to_employer", "message to"]):
                await highlight_element(el)
                await el.click()
                await page.evaluate("([msg]) => window.addAutofillLog(msg)", ["Typing cover letter in rich text editor..."])
                await page.keyboard.type(cover_letter_text, delay=5)
                # verify it landed
                val = await el.inner_text() or ""
                if cover_letter_text[:20] not in val:
                    await page.wait_for_timeout(300)
                    await el.click()
                    await page.keyboard.type(cover_letter_text, delay=5)
                print(json.dumps({"type": "log", "message": "[Autofill] Filled cover letter in rich-text editor."}))
                sys.stdout.flush()
                await page.evaluate("([msg]) => window.addAutofillLog(msg)", ["Typed cover letter in rich text editor."])
                return True
    except Exception:
        pass
                
    return False

# Common EEO and deterministic synonyms
EEOC_SYNONYMS = {
    "gender": {
        "male": ["male", "man"],
        "female": ["female", "woman"],
        "decline": ["decline", "prefer not to", "identify", "not specified", "do not wish", "choose not"]
    },
    "race": {
        "white": ["white", "caucasian", "european"],
        "black": ["black", "african american", "african"],
        "asian": ["asian", "indian", "chinese", "japanese", "korean", "vietnamese", "filipino", "pacific islander"],
        "hispanic": ["hispanic", "latino", "latina", "chicano"],
        "decline": ["decline", "prefer not to", "identify", "not specified", "do not wish", "choose not"]
    },
    "veteran": {
        "yes": ["yes", "i am a protected veteran", "i identify as a veteran"],
        "no": ["no", "not a veteran", "not a protected veteran", "not protected"],
        "decline": ["decline", "prefer not to", "not specified", "do not wish", "choose not"]
    },
    "disability": {
        "yes": ["yes", "i have a disability", "disability", "individual with a disability"],
        "no": ["no", "do not have a disability", "no disability", "i do not"],
        "decline": ["decline", "prefer not to", "not specified", "do not wish", "choose not"]
    },
    "sponsorship": {
        "auth_yes": ["yes", "authorized to work", "legally authorized", "have legal authorization"],
        "auth_no": ["no", "not authorized"],
        "sponsor_yes": ["yes", "will require sponsorship", "require sponsorship", "will you now or in the future require"],
        "sponsor_no": ["no", "will not require", "do not require sponsorship", "do not require visa"]
    }
}

async def check_deterministic_eeo(label, options, candidate_summary):
    label_lower = label.lower()
    
    # 1. Gender
    if any(x in label_lower for x in ["gender", "sex"]) and not "spouse" in label_lower:
        val = (candidate_summary.get("gender") or "decline").lower()
        preferred = EEOC_SYNONYMS["gender"].get(val) or EEOC_SYNONYMS["gender"]["decline"]
        return match_dropdown_option(options, preferred)
        
    # 2. Race
    if any(x in label_lower for x in ["race", "ethnicity", "hispanic"]):
        val = (candidate_summary.get("race") or "decline").lower()
        preferred = EEOC_SYNONYMS["race"].get(val) or EEOC_SYNONYMS["race"]["decline"]
        return match_dropdown_option(options, preferred)
        
    # 3. Veteran
    if "veteran" in label_lower:
        val = (candidate_summary.get("veteranStatus") or "decline").lower()
        preferred = EEOC_SYNONYMS["veteran"].get(val) or EEOC_SYNONYMS["veteran"]["decline"]
        return match_dropdown_option(options, preferred)
        
    # 4. Disability
    if any(x in label_lower for x in ["disabilit", "handicap"]):
        val = (candidate_summary.get("disabilityStatus") or "decline").lower()
        preferred = EEOC_SYNONYMS["disability"].get(val) or EEOC_SYNONYMS["disability"]["decline"]
        return match_dropdown_option(options, preferred)
        
    # 5. Sponsorship / Work Authorization
    # Check sponsorship first because it might contain the phrase "work in"
    if any(x in label_lower for x in ["sponsor", "visa"]):
        val = (candidate_summary.get("sponsorshipRequired") or "no").lower()
        key = "sponsor_yes" if "yes" in val or val == "true" else "sponsor_no"
        preferred = EEOC_SYNONYMS["sponsorship"][key]
        return match_dropdown_option(options, preferred)
        
    if any(x in label_lower for x in ["authorized", "authorization", "legally", "work in"]):
        val = (candidate_summary.get("authorizedToWork") or "yes").lower()
        key = "auth_yes" if "yes" in val or val == "true" else "auth_no"
        preferred = EEOC_SYNONYMS["sponsorship"][key]
        return match_dropdown_option(options, preferred)
        
    return None

async def check_deterministic_location(label, options, candidate_summary):
    label_lower = label.lower()
    if any(x in label_lower for x in ["country", "nation", "citizenship"]) and not "sponsor" in label_lower:
        return match_country_option(options, candidate_summary.get("location"))
    if any(x in label_lower for x in ["state", "province", "region"]):
        return match_state_option(options, candidate_summary.get("location"))
    return None

async def highlight_element(el):
    try:
        await el.scroll_into_view_if_needed()
        await el.evaluate("""(element) => {
            const origBorder = element.style.border;
            const origBg = element.style.backgroundColor;
            const origOutline = element.style.outline;
            element.style.outline = '3px solid #6366f1';
            element.style.backgroundColor = 'rgba(99, 102, 241, 0.15)';
            setTimeout(() => {
                element.style.outline = origOutline;
                element.style.backgroundColor = origBg;
            }, 800);
        }""")
        await asyncio.sleep(0.4)
    except Exception:
        pass

async def fill_text_field(page, el, val, label="Field"):
    try:
        await highlight_element(el)
        await el.focus()
        await el.evaluate("(el) => el.value = ''")
        await el.type(str(val), delay=15)
        await page.evaluate("([msg]) => window.addAutofillLog(msg)", [f"Typed {label}: {val}"])
        return True
    except Exception:
        return False

async def fill_custom_dropdown(page, trigger, synonyms, label=""):
    try:
        await highlight_element(trigger)
        await trigger.click()
        await page.wait_for_timeout(250)

        # Big lists (country, state) are often type-ahead rather than
        # pre-rendered — type into whatever search input just appeared.
        search_box = await page.query_selector(
            "[aria-expanded='true'] input[type='text']:visible, [role='combobox'] input:visible"
        )
        if search_box and synonyms:
            await search_box.type(synonyms[0], delay=20)
            await page.wait_for_timeout(400)

        options = await page.query_selector_all("[role='option']:visible, li[role='option']:visible")
        for opt in options:
            text = (await opt.inner_text() or "").lower().strip()
            if any(s in text for s in synonyms):
                await opt.click()
                await page.evaluate("([msg]) => window.addAutofillLog(msg)", [f"Selected {label} -> {text}"])
                return True

        await page.keyboard.press("Escape")
    except Exception:
        pass
    return False

async def run_autofill_impl(page, job_ctx, profile):
    if not job_ctx:
        job_ctx = {}
    if not profile:
        profile = {}
    try:
        await _run_autofill_impl_inner(page, job_ctx, profile)
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(json.dumps({"type": "log", "message": f"[Autofill Error] Critical failure in run_autofill_impl: {str(e)}\n{tb}"}))
        sys.stdout.flush()
        try:
            await page.evaluate("([status, layer]) => window.updateAutofillStatus(status, layer)", [f"Error: {str(e)}", "Failed"])
            await page.evaluate("([msg, type]) => window.addAutofillLog(msg, type)", [f"Critical error: {str(e)}", "error"])
        except Exception:
            pass

async def _run_autofill_impl_inner(page, job_ctx, profile):
    url = page.url
    print(json.dumps({"type": "log", "message": f"[Autofill] Starting autofill for: {job_ctx.get('title')} at {job_ctx.get('company')}..."}))
    sys.stdout.flush()
    
    resume_path = job_ctx.get("resumePath", "")
    cover_letter = job_ctx.get("coverLetterText", "")
    
    # Simple YAML key extractor / Parser
    yaml_text = profile.get("masterResumeYaml", "")
    parsed_yaml = None
    if yaml_text:
        try:
            import yaml
            parsed_yaml = yaml.safe_load(yaml_text)
        except Exception:
            pass

    def find_in_dict(d, keys, default=None):
        if not isinstance(d, dict):
            return default
        for k, v in d.items():
            if k.lower() in keys:
                if isinstance(v, (str, int, float)):
                    return str(v).strip()
            elif isinstance(v, dict):
                res = find_in_dict(v, keys)
                if res is not None:
                    return res
        return default

    def extract_from_yaml(key):
        if not yaml_text:
            return None
        pattern = rf"(?:^|\n)\s*{key}\s*:\s*([^\n]+)"
        match = re.search(pattern, yaml_text, re.IGNORECASE)
        if match:
            return match.group(1).strip().strip('"').strip("'")
        return None

    # Try to extract keys using YAML dict or fallback regex
    fullName = profile.get("fullName")
    email = profile.get("email")
    phone = profile.get("phone")
    location = profile.get("location")
    linkedin = profile.get("linkedinUrl")
    github = profile.get("githubUrl")
    portfolio = profile.get("portfolioUrl")

    if parsed_yaml:
        fullName = fullName or find_in_dict(parsed_yaml, ["name", "fullname", "full_name"])
        email = email or find_in_dict(parsed_yaml, ["email", "e-mail"])
        phone = phone or find_in_dict(parsed_yaml, ["phone", "mobile", "cell", "telephone", "phone_number"])
        location = location or find_in_dict(parsed_yaml, ["location", "address"])
        linkedin = linkedin or find_in_dict(parsed_yaml, ["linkedin", "linkedinurl", "linkedin_url"])
        github = github or find_in_dict(parsed_yaml, ["github", "githuburl", "github_url"])
        portfolio = portfolio or find_in_dict(parsed_yaml, ["portfolio", "portfoliourl", "portfolio_url", "website", "personal_website"])

    # Fallbacks via regex
    fullName = fullName or extract_from_yaml("name") or extract_from_yaml("fullName") or ""
    email = email or extract_from_yaml("email") or ""
    phone = phone or extract_from_yaml("phone") or extract_from_yaml("mobile") or extract_from_yaml("cell") or ""
    location = location or extract_from_yaml("location") or extract_from_yaml("address") or ""
    linkedin = linkedin or extract_from_yaml("linkedin") or ""
    github = github or extract_from_yaml("github") or ""
    portfolio = portfolio or extract_from_yaml("portfolio") or extract_from_yaml("website") or ""

    gender = extract_from_yaml("gender") or extract_from_yaml("sex") or ""
    race = extract_from_yaml("race") or extract_from_yaml("ethnicity") or ""
    veteran = extract_from_yaml("veteran") or extract_from_yaml("veteranStatus") or ""
    disability = extract_from_yaml("disability") or ""
    authorized = extract_from_yaml("authorizedToWork") or extract_from_yaml("workAuthorization") or ""
    sponsorship = extract_from_yaml("sponsorshipNeeded") or extract_from_yaml("requireSponsorship") or ""
    
    candidate_summary = {
        "fullName": fullName,
        "email": email,
        "phone": phone,
        "location": location,
        "street_address": extract_from_yaml("address") or extract_from_yaml("street") or "",
        "city": extract_from_yaml("city") or "",
        "state": extract_from_yaml("state") or extract_from_yaml("province") or "",
        "postal_code": extract_from_yaml("zip") or extract_from_yaml("postalCode") or "",
        "country": extract_from_yaml("country") or "",
        "linkedinUrl": linkedin,
        "githubUrl": github,
        "portfolioUrl": portfolio,
        "currentRole": extract_from_yaml("targetRole") or extract_from_yaml("currentRole") or "",
        "currentCompany": extract_from_yaml("currentCompany") or extract_from_yaml("targetCompany") or "",
        "totalYearsExperience": extract_from_yaml("totalYearsExperience") or extract_from_yaml("experienceYears") or "",
        "noticePeriod": extract_from_yaml("noticePeriod") or "Immediate",
        "salaryExpectation": extract_from_yaml("salaryExpectation") or "Market rate",
        "remotePreference": extract_from_yaml("remotePreference") or "Remote/Hybrid",
        "skills": profile.get("skills", []),
        "education": extract_from_yaml("education") or "",
        "gender": gender,
        "race": race,
        "veteranStatus": veteran,
        "disabilityStatus": disability,
        "authorizedToWork": authorized,
        "sponsorshipRequired": sponsorship
    }
    
    # Split names
    first_name = candidate_summary["fullName"].split(" ")[0] if candidate_summary["fullName"] else ""
    last_name = " ".join(candidate_summary["fullName"].split(" ")[1:]) if candidate_summary["fullName"] else ""
    
    filled_count = 0
    processed_elements = set()
    
    # Init interactive status widget
    await page.evaluate("([status, layer]) => window.updateAutofillStatus(status, layer)", ["Autofill starting...", "Initializing"])
    
    # 1. Fill Resume (file inputs)
    if resume_path and os.path.exists(resume_path):
        try:
            file_inputs = await page.query_selector_all("input[type='file']")
            for fi in file_inputs:
                label = (await get_element_label(page, fi)).lower()
                name_attr = (await fi.get_attribute("name") or "").lower()
                id_attr = (await fi.get_attribute("id") or "").lower()
                combined = f"{label} {name_attr} {id_attr}"
                if any(x in combined for x in ["resume", "cv", "curriculum", "file"]):
                    await fi.set_input_files(resume_path)
                    processed_elements.add(fi)
                    filled_count += 1
                    print(json.dumps({"type": "log", "message": "[Autofill] Uploaded tailored resume."}))
                    sys.stdout.flush()
                    await page.evaluate("([msg]) => window.addAutofillLog(msg)", [f"Uploaded resume: {os.path.basename(resume_path)}"])
                    break
        except Exception as e:
            print(json.dumps({"type": "log", "message": f"[Autofill Error] Resume upload failed: {str(e)}"}))
            sys.stdout.flush()

    # 2. Fill Cover Letter
    if cover_letter:
        cl_filled = await fill_cover_letter_impl(page, cover_letter)
        if cl_filled:
            filled_count += 1
            try:
                all_inputs = await page.query_selector_all("textarea, [contenteditable='true']")
                for el in all_inputs:
                    label = (await get_element_label(page, el)).lower()
                    if any(x in label for x in ["cover letter", "letter", "comments", "msg_to_employer", "message to"]):
                        processed_elements.add(el)
            except Exception:
                pass

    # 3. Scan DOM & Group Radio Buttons
    await page.evaluate("([status, layer]) => window.updateAutofillStatus(status, layer)", ["Filling basic information...", "Layer 1: Deterministic Basics"])
    radio_groups = {}
    standard_fields = []
    
    try:
        CUSTOM_DROPDOWN_SELECTOR = (
            "[role='combobox'], [aria-haspopup='listbox'], button[aria-haspopup='listbox'], "
            "div[data-automation-id*='picklist'], div[data-automation-id*='dropdown'], "
            "div[data-automation-id*='selectInput'], div[data-automation-id*='multiSelect']"
        )
        all_elements = await page.query_selector_all(f"input, textarea, select, [contenteditable='true'], {CUSTOM_DROPDOWN_SELECTOR}")
        for el in all_elements:
            if el in processed_elements:
                continue
                
            tag = await el.evaluate("(el) => el.tagName.toLowerCase()")
            role = (await el.get_attribute("role") or "").lower()
            aria_haspopup = (await el.get_attribute("aria-haspopup") or "").lower()
            auto_id = (await el.get_attribute("data-automation-id") or "").lower()
            
            is_custom_dropdown = (
                role == "combobox" or 
                aria_haspopup == "listbox" or 
                "picklist" in auto_id or 
                "dropdown" in auto_id or 
                "selectinput" in auto_id or 
                "multiselect" in auto_id
            )
            
            if is_custom_dropdown:
                tag = "custom_select"

            if tag == "select" and not await el.is_visible():
                pass
            elif not await el.is_visible() and not is_custom_dropdown:
                continue
            
            el_type = (await el.get_attribute("type") or "").lower()
            if el_type == "hidden" and tag != "select":
                continue
                
            if el_type == "radio":
                name = await el.get_attribute("name")
                if name:
                    if name not in radio_groups:
                        radio_groups[name] = []
                    radio_groups[name].append(el)
                    continue
            
            if el_type in ["file", "submit", "button", "image"] and not is_custom_dropdown:
                continue
                
            standard_fields.append({
                "element": el,
                "tag": tag,
                "type": el_type
            })
    except Exception as e:
        print(json.dumps({"type": "log", "message": f"[Autofill Error] DOM scan failed: {str(e)}"}))
        sys.stdout.flush()

    # 4. Resolve Deterministic Standard Fields
    for f in list(standard_fields):
        el = f["element"]
        tag = f["tag"]
        label = await get_element_label(page, el)
        if not label:
            continue
        label_lower = label.lower()
        
        is_filled = False
        
        if tag == "select":
            # Select dropdowns are in Layer 2
            continue
        else:
            val = None
            if any(x in label_lower for x in ["first name", "fname", "given name"]):
                val = first_name
            elif any(x in label_lower for x in ["last name", "lname", "family name", "surname"]):
                val = last_name
            elif any(x in label_lower for x in ["full name", "fullname"]):
                val = candidate_summary["fullName"]
            elif any(x in label_lower for x in ["email", "e-mail"]):
                val = candidate_summary["email"]
            elif any(x in label_lower for x in ["phone", "tel", "mobile", "cell", "telephone"]):
                val = candidate_summary["phone"]
            elif "linkedin" in label_lower:
                val = candidate_summary["linkedinUrl"]
            elif "github" in label_lower:
                val = candidate_summary["githubUrl"]
            elif any(x in label_lower for x in ["portfolio", "website", "personal page", "homepage"]):
                val = candidate_summary["portfolioUrl"]
            elif any(x in label_lower for x in ["street address", "address line", "address 1"]):
                val = candidate_summary["street_address"]
            elif label_lower.strip() == "city" or "city" in label_lower:
                val = candidate_summary["city"]
            elif any(x in label_lower for x in ["zip", "postal"]):
                val = candidate_summary["postal_code"]
            elif any(x in label_lower for x in ["state", "province", "region"]):
                val = candidate_summary["state"]
            elif any(x in label_lower for x in ["country", "nation", "citizenship"]) and "sponsor" not in label_lower:
                val = candidate_summary["country"]
                
            if val:
                is_filled = await fill_text_field(page, el, val, label)
                
        if is_filled:
            processed_elements.add(el)
            standard_fields.remove(f)
            filled_count += 1

    # Transition to Layer 2
    await page.evaluate("([status, layer]) => window.updateAutofillStatus(status, layer)", ["Matching location & diversity options...", "Layer 2: EEOC & Location"])

    # Resolve Select Dropdowns in Layer 2
    for f in list(standard_fields):
        el = f["element"]
        tag = f["tag"]
        if tag not in ["select", "custom_select"]:
            continue
        label = await get_element_label(page, el)
        if not label:
            continue
            
        options = []
        if tag == "select":
            options = await get_select_options(el)
        else:
            try:
                await highlight_element(el)
                await el.click()
                await page.wait_for_timeout(250)
                options_els = await page.query_selector_all("[role='option']:visible, li[role='option']:visible")
                for o in options_els:
                    options.append((await o.inner_text() or "").strip())
                await page.keyboard.press("Escape")
            except:
                pass

        eeo_idx = await check_deterministic_eeo(label, options, candidate_summary)
        is_filled = False
        
        if eeo_idx is not None:
            if tag == "select":
                await highlight_element(el)
                await el.select_option(index=eeo_idx)
                chosen_opt = options[eeo_idx] if 0 <= eeo_idx < len(options) else str(eeo_idx)
                await page.evaluate("([msg]) => window.addAutofillLog(msg)", [f"Selected {label} -> {chosen_opt}"])
            else:
                chosen_opt = options[eeo_idx] if 0 <= eeo_idx < len(options) else str(eeo_idx)
                await fill_custom_dropdown(page, el, [chosen_opt.lower()], label)
            is_filled = True
        else:
            loc_idx = await check_deterministic_location(label, options, candidate_summary)
            if loc_idx is not None:
                if tag == "select":
                    await highlight_element(el)
                    await el.select_option(index=loc_idx)
                    chosen_opt = options[loc_idx] if 0 <= loc_idx < len(options) else str(loc_idx)
                    await page.evaluate("([msg]) => window.addAutofillLog(msg)", [f"Selected {label} -> {chosen_opt}"])
                else:
                    chosen_opt = options[loc_idx] if 0 <= loc_idx < len(options) else str(loc_idx)
                    await fill_custom_dropdown(page, el, [chosen_opt.lower()], label)
                is_filled = True
                
        if is_filled:
            processed_elements.add(el)
            standard_fields.remove(f)
            filled_count += 1

    # 5. Resolve Deterministic Radio Groups (Layer 2)
    for name in list(radio_groups.keys()):
        group_els = radio_groups[name]
        if any(rel in processed_elements for rel in group_els):
            continue
            
        grp_label = await get_group_label(page, group_els[0])
        options = []
        for rel in group_els:
            options.append(await get_radio_option_label(page, rel))
            
        eeo_idx = await check_deterministic_eeo(grp_label, options, candidate_summary)
        if eeo_idx is not None:
            await highlight_element(group_els[eeo_idx])
            await group_els[eeo_idx].click()
            chosen_opt = options[eeo_idx] if 0 <= eeo_idx < len(options) else str(eeo_idx)
            await page.evaluate("([msg]) => window.addAutofillLog(msg)", [f"Clicked {grp_label} option: {chosen_opt}"])
            for rel in group_els:
                processed_elements.add(rel)
            del radio_groups[name]
            filled_count += 1

    # 6. Extract Residual Fields and Tag Them
    residue_fields = []
    field_id_counter = 0
    
    for f in standard_fields:
        el = f["element"]
        tag = f["tag"]
        type_attr = f["type"]
        label = await get_element_label(page, el)
        if not label:
            continue
            
        fid = f"f{field_id_counter}"
        field_id_counter += 1
        
        await el.evaluate("(el, id) => el.setAttribute('data-af-id', id)", fid)
        
        field_info = {
            "id": fid,
            "label": label,
            "type": "checkbox" if type_attr == "checkbox" else ("select" if tag in ["select", "custom_select"] else ("textarea" if tag == "textarea" else "text")),
            "element": el,
            "tag": tag
        }
        if tag == "select":
            field_info["options"] = await get_select_options(el)
        elif tag == "custom_select":
            options = []
            try:
                await highlight_element(el)
                await el.click()
                await page.wait_for_timeout(250)
                options_els = await page.query_selector_all("[role='option']:visible, li[role='option']:visible")
                for o in options_els:
                    options.append((await o.inner_text() or "").strip())
                await page.keyboard.press("Escape")
            except:
                pass
            field_info["options"] = options
            
        residue_fields.append(field_info)
        
    for name, group_els in list(radio_groups.items()):
        if any(rel in processed_elements for rel in group_els):
            continue
            
        grp_label = await get_group_label(page, group_els[0])
        if not grp_label:
            continue
            
        fid = f"f{field_id_counter}"
        field_id_counter += 1
        
        options = []
        for rel in group_els:
            await rel.evaluate("(el, id) => el.setAttribute('data-af-id', id)", fid)
            options.append(await get_radio_option_label(page, rel))
            
        residue_fields.append({
            "id": fid,
            "label": grp_label,
            "type": "radio",
            "options": options,
            "elements": group_els
        })

    # 7. LLM Call for Residue Fields
    if residue_fields:
        serialized_fields = []
        for rf in residue_fields:
            s_field = {
                "id": rf["id"],
                "type": rf["type"],
                "label": rf["label"]
            }
            if "options" in rf:
                s_field["options"] = rf["options"]
            serialized_fields.append(s_field)
            
        llm_fields_str = ", ".join([rf["label"] for rf in residue_fields])
        print(json.dumps({"type": "log", "message": f"[Autofill] Found {len(residue_fields)} residue fields. Requesting LLM mapping..."}))
        sys.stdout.flush()
        
        await page.evaluate("([status, layer, details]) => window.updateAutofillStatus(status, layer, details)", 
                            ["Analyzing custom fields with LLM...", "Layer 3: LLM Fallback", llm_fields_str])
        
        prompt = f"""
You are an expert recruiter assistant that helps candidates autofill job application forms.
Below is the candidate's profile information and a list of form fields that couldn't be resolved automatically.

Candidate Profile:
{json.dumps(candidate_summary, indent=2)}

Form Fields to Fill:
{json.dumps(serialized_fields, indent=2)}

For each field:
- If type is "select" or "radio", choose the best index from the "options" list (0-indexed integer).
- If type is "checkbox", choose true or false.
- If type is "text" or "textarea", write the correct response (e.g. cover letter, custom screening question answers, salary expectations, notice period, etc.) based on the candidate's profile details. Keep answers professional and concise.

Return a strict JSON map from field id to value:
{{
  "field_id": value
}}

Do not include markdown code blocks (such as ```json) or any explanation. Output raw JSON only.
"""
        try:
            from langchain_openai import ChatOpenAI
            llm_config = payload_data.get("llm", {}) if payload_data else {}
            llm = ChatOpenAI(
                model=llm_config.get("model") or "gpt-4o-mini",
                api_key=llm_config.get("apiKey") or "EMPTY",
                base_url=llm_config.get("baseUrl") or None,
                temperature=0.1
            )
            
            response = await llm.ainvoke(prompt)
            content = response.content.strip()
            
            if content.startswith("```"):
                content = re.sub(r"^```[a-zA-Z]*\n", "", content)
                content = re.sub(r"\n```$", "", content)
                
            parsed_actions = json.loads(content.strip())
            
            for rf in residue_fields:
                fid = rf["id"]
                if fid not in parsed_actions:
                    continue
                    
                val = parsed_actions[fid]
                rf_type = rf["type"]
                rf_label = rf["label"]
                
                try:
                    if rf_type == "select":
                        idx = int(val)
                        if 0 <= idx < len(rf["options"]):
                            chosen_opt = rf["options"][idx]
                            if rf.get("tag") == "custom_select":
                                await fill_custom_dropdown(page, rf["element"], [chosen_opt.lower()], rf_label)
                            else:
                                await highlight_element(rf["element"])
                                await rf["element"].select_option(index=idx)
                                await page.evaluate("([msg]) => window.addAutofillLog(msg)", [f"LLM Selected {rf_label} -> {chosen_opt}"])
                            filled_count += 1
                    elif rf_type == "radio":
                        idx = int(val)
                        if 0 <= idx < len(rf["options"]):
                            await highlight_element(rf["elements"][idx])
                            await rf["elements"][idx].click()
                            chosen_opt = rf["options"][idx]
                            await page.evaluate("([msg]) => window.addAutofillLog(msg)", [f"LLM Clicked {rf_label} option: {chosen_opt}"])
                            filled_count += 1
                    elif rf_type == "checkbox":
                        is_checked = bool(val)
                        await highlight_element(rf["element"])
                        await rf["element"].set_checked(is_checked)
                        action = "Checked" if is_checked else "Unchecked"
                        await page.evaluate("([msg]) => window.addAutofillLog(msg)", [f"LLM {action} {rf_label}"])
                        filled_count += 1
                    else:
                        await fill_text_field(page, rf["element"], val, rf_label)
                        filled_count += 1
                except Exception as e:
                    print(json.dumps({"type": "log", "message": f"[Autofill Error] Failed to fill field {fid}: {str(e)}"}))
                    sys.stdout.flush()
                    
        except Exception as e:
            print(json.dumps({"type": "log", "message": f"[Autofill Error] LLM fallback failed: {str(e)}"}))
            sys.stdout.flush()

    print(json.dumps({"type": "log", "message": f"[Autofill] Form autofilled successfully! Total fields filled: {filled_count}"}))
    sys.stdout.flush()
    
    # Completed!
    await page.evaluate("([status, layer]) => window.updateAutofillStatus(status, layer)", ["Autofill Completed!", "Finished"])
    await page.evaluate("([msg, type]) => window.addAutofillLog(msg, type)", [f"Successfully filled {filled_count} fields!", "success"])

async def perform_autofill_stdin(context, cmd):
    """
    Fallback support for legacy command pipe from ApplyPanel if triggered there.
    """
    global payload_data
    job = cmd.get("job", {})
    profile = cmd.get("profile", {})
    resume_path = cmd.get("resume_path", "")
    llm_conf = cmd.get("llm", {})
    
    # Keep global payload_data in sync
    if not payload_data:
        payload_data = {}
    if profile:
        payload_data["profile"] = profile
    if llm_conf:
        payload_data["llm"] = llm_conf
        
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
          function inject() {
            if (document.getElementById('synapse-autofill-host')) return;
            if (!document.body) {
              setTimeout(inject, 50);
              return;
            }
            
            const host = document.createElement('div');
            host.id = 'synapse-autofill-host';
            host.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;display:block;';
            
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = `
              <style>
                :host {
                  position: fixed !important;
                  bottom: 24px !important;
                  right: 24px !important;
                  z-index: 2147483647 !important;
                  display: block !important;
                  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
                }
                .widget-container, .widget-container * {
                  box-sizing: border-box !important;
                  line-height: 1.4 !important;
                }
                button {
                  padding: 10px 18px !important;
                  border-radius: 9999px !important;
                  background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%) !important;
                  color: #ffffff !important;
                  border: 1px solid rgba(255, 255, 255, 0.1) !important;
                  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
                  font-weight: 700 !important;
                  font-size: 13px !important;
                  cursor: pointer !important;
                  box-shadow: 0 10px 25px rgba(99, 102, 241, 0.35) !important;
                  display: flex !important;
                  align-items: center !important;
                  gap: 6px !important;
                  transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s !important;
                  margin: 0 !important;
                  position: static !important;
                }
                button:hover {
                  transform: translateY(-2px) !important;
                  box-shadow: 0 12px 30px rgba(99, 102, 241, 0.45) !important;
                }
                button:active {
                  transform: translateY(0) !important;
                }
                button.hidden {
                  display: none !important;
                }

                .details-card {
                  width: 320px !important;
                  background: rgba(15, 23, 42, 0.95) !important;
                  backdrop-filter: blur(12px) !important;
                  border: 1px solid rgba(255, 255, 255, 0.15) !important;
                  border-radius: 16px !important;
                  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4) !important;
                  color: #f1f5f9 !important;
                  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
                  padding: 16px !important;
                  display: flex !important;
                  flex-direction: column !important;
                  gap: 12px !important;
                  animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
                  position: relative !important;
                  z-index: 2147483647 !important;
                  margin: 0 !important;
                }
                .details-card.hidden {
                  display: none !important;
                }

                @keyframes slideIn {
                  from {
                    transform: translateY(20px) !important;
                    opacity: 0 !important;
                  }
                  to {
                    transform: translateY(0) !important;
                    opacity: 1 !important;
                  }
                }

                .card-header {
                  display: flex !important;
                  justify-content: space-between !important;
                  align-items: center !important;
                  border-bottom: 1px solid rgba(255, 255, 255, 0.1) !important;
                  padding-bottom: 8px !important;
                  width: 100% !important;
                  height: auto !important;
                  position: static !important;
                  margin: 0 !important;
                }
                .logo {
                  font-weight: 700 !important;
                  font-size: 14px !important;
                  background: linear-gradient(135deg, #a5b4fc 0%, #818cf8 100%) !important;
                  -webkit-background-clip: text !important;
                  -webkit-text-fill-color: transparent !important;
                  display: inline-block !important;
                  position: static !important;
                  margin: 0 !important;
                  padding: 0 !important;
                }
                .close-btn {
                  cursor: pointer !important;
                  font-size: 18px !important;
                  color: #94a3b8 !important;
                  transition: color 0.2s !important;
                  display: inline-block !important;
                  position: static !important;
                  margin: 0 !important;
                  padding: 0 !important;
                }
                .close-btn:hover {
                  color: #f1f5f9 !important;
                }

                .card-body {
                  display: flex !important;
                  flex-direction: column !important;
                  gap: 8px !important;
                  width: 100% !important;
                  height: auto !important;
                  position: static !important;
                  margin: 0 !important;
                  padding: 0 !important;
                }
                .status-row {
                  display: flex !important;
                  flex-direction: row !important;
                  justify-content: space-between !important;
                  align-items: center !important;
                  width: 100% !important;
                  height: auto !important;
                  font-size: 13px !important;
                  position: static !important;
                  margin: 0 !important;
                  padding: 0 !important;
                }
                .status-row.hidden {
                  display: none !important;
                }
                .label {
                  color: #94a3b8 !important;
                  font-size: 13px !important;
                  font-weight: 500 !important;
                  display: inline-block !important;
                  position: static !important;
                  margin: 0 !important;
                  padding: 0 !important;
                }
                .status-value {
                  font-weight: 600 !important;
                  font-size: 13px !important;
                  display: inline-block !important;
                  position: static !important;
                  margin: 0 !important;
                  padding: 0 !important;
                }
                .status-value.highlight {
                  color: #818cf8 !important;
                }

                .logs-container {
                  max-height: 120px !important;
                  height: 120px !important;
                  overflow-y: auto !important;
                  background: rgba(0, 0, 0, 0.3) !important;
                  border-radius: 8px !important;
                  padding: 8px !important;
                  font-size: 11px !important;
                  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
                  display: flex !important;
                  flex-direction: column !important;
                  gap: 4px !important;
                  border: 1px solid rgba(255, 255, 255, 0.05) !important;
                  width: 100% !important;
                  position: static !important;
                  margin: 4px 0 !important;
                }
                .log-item {
                  color: #cbd5e1 !important;
                  line-height: 1.4 !important;
                  word-break: break-all !important;
                  display: block !important;
                  position: static !important;
                  margin: 0 !important;
                  padding: 0 !important;
                }
                .log-item.success {
                  color: #34d399 !important;
                }
                .log-item.error {
                  color: #f87171 !important;
                }

                .llm-details {
                  border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
                  padding-top: 8px !important;
                  display: flex !important;
                  flex-direction: column !important;
                  gap: 4px !important;
                  width: 100% !important;
                  height: auto !important;
                  position: static !important;
                  margin: 0 !important;
                }
                .llm-details.hidden {
                  display: none !important;
                }
                .llm-header {
                  font-size: 12px !important;
                  font-weight: 700 !important;
                  color: #818cf8 !important;
                  display: block !important;
                  position: static !important;
                  margin: 0 !important;
                  padding: 0 !important;
                }
                .llm-fields {
                  font-size: 11px !important;
                  color: #94a3b8 !important;
                  white-space: pre-wrap !important;
                  word-break: break-all !important;
                  display: block !important;
                  position: static !important;
                  margin: 0 !important;
                  padding: 0 !important;
                }
              </style>
              <div class="widget-container">
                <button id="btn">⚡ Autofill Form</button>
                <div id="details-card" class="details-card hidden">
                  <div class="card-header">
                    <span class="logo">⚡ Synapse Autofill</span>
                    <span id="close-btn" class="close-btn">×</span>
                  </div>
                  <div class="card-body">
                    <div class="status-row">
                      <span class="label">Status:</span>
                      <span id="status-text" class="status-value">Ready</span>
                    </div>
                    <div id="layer-row" class="status-row hidden">
                      <span class="label">Layer:</span>
                      <span id="layer-text" class="status-value highlight">None</span>
                    </div>
                    <div id="resume-row" class="status-row hidden">
                      <span class="label">Resume:</span>
                      <span class="status-value"><a id="view-resume-btn" href="#" style="color:#818cf8; text-decoration:underline; font-weight:600; cursor:pointer;">View PDF ↗</a></span>
                    </div>
                    <div id="logs-container" class="logs-container"></div>
                    <div id="llm-details" class="llm-details hidden">
                      <div class="llm-header">LLM Fields Invoked:</div>
                      <div id="llm-fields" class="llm-fields"></div>
                    </div>
                  </div>
                </div>
              </div>
            `;
            
            shadow.getElementById('btn').onclick = (e) => {
              e.stopPropagation();
              window.triggerAutofill();
            };

            shadow.getElementById('close-btn').onclick = (e) => {
              e.stopPropagation();
              window.resetAutofillWidget();
            };
            
            const viewResumeBtn = shadow.getElementById('view-resume-btn');
            if (viewResumeBtn) {
              viewResumeBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (window.viewResume) {
                  window.viewResume();
                }
              };
            }

            if (window.checkResume) {
              window.checkResume().then(hasResume => {
                const resumeRow = shadow.getElementById('resume-row');
                if (resumeRow) {
                  if (hasResume) {
                    resumeRow.classList.remove('hidden');
                  } else {
                    resumeRow.classList.add('hidden');
                  }
                }
              }).catch(() => {});
            }
            
            document.body.appendChild(host);
          }
          
          window.updateAutofillStatus = (statusText, layerText, llmDetails) => {
            const root = document.getElementById('synapse-autofill-host');
            if (!root) return;
            const shadow = root.shadowRoot;
            if (!shadow) return;
            
            const btn = shadow.getElementById('btn');
            const card = shadow.getElementById('details-card');
            
            if (statusText !== 'Ready') {
              btn.classList.add('hidden');
              card.classList.remove('hidden');
            }
            
            if (statusText) {
              shadow.getElementById('status-text').innerText = statusText;
            }
            
            if (layerText) {
              const layerRow = shadow.getElementById('layer-row');
              layerRow.classList.remove('hidden');
              shadow.getElementById('layer-text').innerText = layerText;
            }
            
            if (llmDetails) {
              const llmDiv = shadow.getElementById('llm-details');
              llmDiv.classList.remove('hidden');
              shadow.getElementById('llm-fields').innerText = llmDetails;
            }

            if (window.checkResume) {
              window.checkResume().then(hasResume => {
                const resumeRow = shadow.getElementById('resume-row');
                if (resumeRow) {
                  if (hasResume) {
                    resumeRow.classList.remove('hidden');
                  } else {
                    resumeRow.classList.add('hidden');
                  }
                }
              }).catch(() => {});
            }
          };

          window.addAutofillLog = (message, type) => {
            const root = document.getElementById('synapse-autofill-host');
            if (!root) return;
            const shadow = root.shadowRoot;
            if (!shadow) return;
            
            const container = shadow.getElementById('logs-container');
            const item = document.createElement('div');
            item.className = 'log-item' + (type ? ' ' + type : '');
            item.innerText = message;
            container.appendChild(item);
            container.scrollTop = container.scrollHeight;
          };

          window.resetAutofillWidget = () => {
            const root = document.getElementById('synapse-autofill-host');
            if (!root) return;
            const shadow = root.shadowRoot;
            if (!shadow) return;
            
            const btn = shadow.getElementById('btn');
            const card = shadow.getElementById('details-card');
            
            btn.classList.remove('hidden');
            card.classList.add('hidden');
            
            shadow.getElementById('status-text').innerText = 'Ready';
            shadow.getElementById('layer-row').classList.add('hidden');
            shadow.getElementById('resume-row').classList.add('hidden');
            shadow.getElementById('logs-container').innerHTML = '';
            shadow.getElementById('llm-details').classList.add('hidden');
            shadow.getElementById('llm-fields').innerText = '';
          };
          
          function startObserver() {
            if (!document.body) {
              setTimeout(startObserver, 50);
              return;
            }
            const observer = new MutationObserver(() => {
              if (!document.getElementById('synapse-autofill-host')) {
                inject();
              }
            });
            observer.observe(document.body, { childList: true });
          }

          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
              inject();
              startObserver();
            });
          } else {
            inject();
            startObserver();
          }
          
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
            try:
                page = source["page"]
                print(json.dumps({"type": "log", "message": f"[Autofill] triggerAutofill called from page: {page.url}"}))
                sys.stdout.flush()
                
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
                
                # If still no context (e.g. manual browser run), use empty fallback context
                if not ctx:
                    ctx = {
                        "title": "",
                        "company": "",
                        "coverLetterText": "",
                        "resumePath": ""
                    }
                
                profile = payload_data.get("profile", {}) if payload_data else {}
                await run_autofill_impl(page, ctx, profile)
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

        await context.expose_binding("triggerAutofill", lambda source: asyncio.create_task(on_autofill_trigger(source)))
        await context.expose_binding("checkResume", lambda source: asyncio.create_task(on_check_resume(source)))
        await context.expose_binding("viewResume", lambda source: asyncio.create_task(on_view_resume(source)))

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
