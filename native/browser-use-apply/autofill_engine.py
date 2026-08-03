import os
import json
import sys
import re
import asyncio
from utils import (
    fill_field,
    get_element_label,
    get_group_label,
    get_radio_option_label,
    get_select_options,
    match_dropdown_option,
    match_country_option,
    match_state_option,
    fill_cover_letter_impl,
    highlight_element,
    fill_text_field,
    fill_custom_dropdown
)
from rules import check_deterministic_eeo, check_deterministic_location

async def run_autofill_impl(page, job_ctx, profile, payload_data):
    if not job_ctx:
        job_ctx = {}
    if not profile:
        profile = {}
    try:
        await _run_autofill_impl_inner(page, job_ctx, profile, payload_data)
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

async def _run_autofill_impl_inner(page, job_ctx, profile, payload_data):
    url = page.url
    print(json.dumps({"type": "log", "message": f"[Autofill] Starting autofill for: {job_ctx.get('title')} at {job_ctx.get('company')}..."}))
    sys.stdout.flush()
    
    resume_path = job_ctx.get("resumePath", "")
    cover_letter = job_ctx.get("coverLetterText", "")
    
    # Simple YAML key extractor / Parser
    yaml_text = profile.get("masterResumeYaml") or profile.get("masterResumeText", "")
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
    
    first_name = candidate_summary["fullName"].split(" ")[0] if candidate_summary["fullName"] else ""
    last_name = " ".join(candidate_summary["fullName"].split(" ")[1:]) if candidate_summary["fullName"] else ""
    
    filled_count = 0
    processed_elements = set()
    
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
            except Exception:
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
            except Exception:
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
- If type is "text" or "textarea", write a complete, ready-to-submit answer based on the candidate's profile. Follow these rules without exception:

  1. NO PLACEHOLDERS, EVER. Never write things like "[Insert Company Name]", "[to fill]", "[X years]", or any bracketed placeholder. If a specific detail (like the company name or role) isn't in the candidate profile or field context, infer the most reasonable value from what IS available (e.g. use the job title given in the field context, or write around it naturally without needing the missing detail) and write a complete answer. The output must be something a person could submit right now with zero edits.

  2. STRICT PLAIN TEXT. No markdown, ever. That means: no **bold**, no *italics*, no bullet points, no numbered lists, no headers, no backticks. Do not use em-dashes (—) either — use commas or periods instead. Write in plain paragraphs or plain line breaks only, exactly as someone would type directly into a browser textarea.

  3. SOUND LIKE A HUMAN, NOT AN AI. This is the most important rule. The candidate is a real developer typing this into a form, not a copywriter. Follow these guidelines:
     - Avoid AI-tell words and phrases: delve, testament, tapestry, leverage, robust, seamless, furthermore, moreover, in today's world, passionate about, thrilled, elevate, unlock, navigate, foster, dive into, game-changer, cutting-edge, at the end of the day.
     - Keep sentences short and a little uneven in length. Real people don't write in perfectly balanced paragraphs.
     - It's fine, even encouraged, to start an occasional sentence with "And" or "So" or "Honestly".
     - Use contractions (I'm, don't, it's) instead of formal full forms.
     - Avoid summarizing or restating the question back before answering. Just answer it directly, the way a person would in a chat.
     - Skip the "hook" opening and the neat concluding sentence that ties everything together with a bow. AI text tries to open strong and close strong; humans just answer and stop.
     - Tone should be casual-professional: like a competent engineer answering a recruiter's screening question on a Tuesday afternoon, not like a cover letter written by a career coach.
     - Do not use exclamation points more than once per answer, if at all.
     - Very occasionally (not every answer) it is okay to have a tiny natural imperfection, like a missing comma before "but" or "and", or a slightly informal phrasing choice. Do not overdo this or make the text look sloppy or unprofessional. It should read like a careful person typing quickly, not like a typo-filled mess.
     - Vary answer length based on question complexity. A technical question like "difference between SSR and CSR" can be 3-5 sentences of real substance. A simple field like "why this role" can be shorter and more direct.


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
    
    await page.evaluate("([status, layer]) => window.updateAutofillStatus(status, layer)", ["Autofill Completed!", "Finished"])
    await page.evaluate("([msg, type]) => window.addAutofillLog(msg, type)", [f"Successfully filled {filled_count} fields!", "success"])

async def perform_autofill_stdin(context, cmd, payload_data):
    """
    Fallback support for legacy command pipe from ApplyPanel if triggered there.
    """
    job = cmd.get("job", {})
    profile = cmd.get("profile", {})
    resume_path = cmd.get("resume_path", "")
    llm_conf = cmd.get("llm", {})
    
    if profile:
        payload_data["profile"] = profile
    if llm_conf:
        payload_data["llm"] = llm_conf
        
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
    await run_autofill_impl(page, job_ctx, profile, payload_data)
