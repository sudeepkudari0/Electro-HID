import os
import json
import sys
import re
from utils import (
    get_element_label,
    get_group_label,
    get_radio_option_label,
    get_select_options,
    highlight_element,
    fill_text_field,
    fill_custom_dropdown
)

async def run_modal_autofill_impl(page, job_ctx, profile, payload_data):
    """
    Autofills ONLY the currently visible LinkedIn Easy Apply modal step using ChatOpenAI.
    Does NOT click Next, Review, or Submit.
    """
    if not job_ctx:
        job_ctx = {}
    if not profile:
        profile = {}

    raw_modals = await page.query_selector_all("div[role='dialog']:visible, [data-sdui-screen*='EasyApply']:visible, [data-testid='dialog-content']:visible, #dialog-header:visible, .jobs-easy-apply-modal:visible, .artdeco-modal:visible")
    modal_el = None
    for m in raw_modals:
        try:
            # Get the containing dialog if possible
            dialog_handle = await m.evaluate_handle("(el) => el.closest('div[role=\"dialog\"], dialog') || el")
            dialog_el = dialog_handle.as_element() or m
            box = await dialog_el.bounding_box()
            aria_hidden = await dialog_el.get_attribute("aria-hidden")
            if box and box["width"] > 200 and box["height"] > 200 and aria_hidden != "true":
                modal_el = dialog_el
                break
        except Exception:
            pass

    if not modal_el:
        print(json.dumps({"type": "log", "message": "[Modal Autofill] No visible Easy Apply modal found on page."}))
        sys.stdout.flush()
        try:
            await page.evaluate("([msg]) => window.resetModalAutofillBtn(msg)", ["No modal visible!"])
        except Exception:
            pass
        return

    print(json.dumps({"type": "log", "message": "[Modal Autofill] Starting AI autofill for current modal step..."}))
    sys.stdout.flush()

    # Scrape background JD
    jd_text = ""
    try:
        jd_text = await page.evaluate("""() => {
            const selectors = [
                '#job-details',
                '.jobs-description-content__text',
                '.jobs-description__content',
                '.jobs-box__html-content',
                'article.jobs-description-content__text',
                '[data-job-id] .description',
                '.jobs-search__job-details--container'
            ];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el && el.innerText && el.innerText.trim().length > 50) {
                    return el.innerText.trim();
                }
            }
            return '';
        }""")
    except Exception:
        pass

    if not jd_text and job_ctx.get("description"):
        jd_text = job_ctx.get("description")

    job_title = job_ctx.get("title", "")
    job_company = job_ctx.get("company", "")
    resume_path = job_ctx.get("resumePath") or (payload_data.get("resume_path") if payload_data else "")
    master_resume_yaml = profile.get("masterResumeYaml", "")

    filled_count = 0

    # 1. Handle file inputs (resume upload on step 1/2)
    if resume_path and os.path.exists(resume_path):
        try:
            file_inputs = await modal_el.query_selector_all("input[type='file']")
            for fi in file_inputs:
                await fi.set_input_files(resume_path)
                filled_count += 1
                print(json.dumps({"type": "log", "message": f"[Modal Autofill] Uploaded resume: {os.path.basename(resume_path)}"}))
                sys.stdout.flush()
                try:
                    await page.evaluate("([msg]) => window.addAutofillLog(msg, 'success')", [f"Uploaded resume: {os.path.basename(resume_path)}"])
                except Exception:
                    pass
        except Exception as e:
            print(json.dumps({"type": "log", "message": f"[Modal Autofill] Resume upload notice: {str(e)}"}))
            sys.stdout.flush()

    # 2. Query visible interactive elements inside current modal step
    CUSTOM_DROPDOWN_SELECTOR = (
        "[role='combobox'], [aria-haspopup='listbox'], button[aria-haspopup='listbox'], "
        "div[data-automation-id*='picklist'], div[data-automation-id*='dropdown'], "
        "div[data-automation-id*='selectInput'], div[data-automation-id*='multiSelect']"
    )
    all_elements = await modal_el.query_selector_all(f"input, textarea, select, {CUSTOM_DROPDOWN_SELECTOR}")

    step_fields = []
    radio_groups = {}
    processed_elements = set()

    for el in all_elements:
        if el in processed_elements:
            continue
        
        el_id = (await el.get_attribute("id") or "").lower()
        if "synapse" in el_id:
            continue
            
        tag = await el.evaluate("(el) => el.tagName.toLowerCase()")
        role = (await el.get_attribute("role") or "").lower()
        aria_haspopup = (await el.get_attribute("aria-haspopup") or "").lower()
        auto_id = (await el.get_attribute("data-automation-id") or "").lower()
        el_type = (await el.get_attribute("type") or "").lower()
        
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
            
        if el_type == "hidden" and tag != "select":
            continue
        if el_type in ["file", "submit", "button", "image", "reset"] and not is_custom_dropdown:
            continue
            
        if el_type == "radio":
            name = await el.get_attribute("name")
            if not name:
                name = await el.evaluate("(el) => { let fs = el.closest('fieldset, .jobs-easy-apply-form-section__group, .fb-dash-form-element'); return fs ? (fs.id || fs.className) : 'radio_grp'; }")
            if name not in radio_groups:
                radio_groups[name] = []
            radio_groups[name].append(el)
            continue
            
        step_fields.append({
            "element": el,
            "tag": tag,
            "type": el_type
        })

    # Build serialized fields for LLM
    residue_fields = []
    field_id_counter = 0

    for f in step_fields:
        el = f["element"]
        tag = f["tag"]
        type_attr = f["type"]
        label = await get_element_label(page, el)
        if not label:
            continue
            
        fid = f"modal_f_{field_id_counter}"
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
        grp_label = await get_group_label(page, group_els[0])
        if not grp_label:
            continue
            
        fid = f"modal_f_{field_id_counter}"
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

    if residue_fields:
        serialized_fields = []
        for rf in residue_fields:
            s_field = {
                "id": rf["id"],
                "type": rf["type"],
                "label": rf["label"]
            }
            if "options" in rf and rf["options"]:
                s_field["options"] = rf["options"]
            serialized_fields.append(s_field)

        print(json.dumps({"type": "log", "message": f"[Modal Autofill] Found {len(residue_fields)} questions on this step. Invoking ChatOpenAI..."}))
        sys.stdout.flush()

        prompt = f"""
You are an expert AI recruiter assistant helping a job candidate autofill a step in a LinkedIn Easy Apply job application modal.
Your goal is to answer every screening question or form field on this step with 100% precision, accuracy, and professionalism, using ONLY the candidate's master resume and the job description provided below.

=== JOB CONTEXT ===
Job Title: {job_title}
Company: {job_company}
Job Description:
{jd_text[:3500]}

=== CANDIDATE PROFILE & MASTER RESUME ===
Profile Data: {json.dumps(profile, indent=2)}
Master Resume YAML:
{master_resume_yaml[:4000]}

=== FORM FIELDS TO FILL ON THIS MODAL STEP ===
{json.dumps(serialized_fields, indent=2)}

=== INSTRUCTIONS FOR ANSWERING ===
1. **Dropdowns ("select") and Radio Buttons ("radio"):**
   - You MUST return the 0-indexed integer corresponding to the exact best option in the "options" list.
   - For experience ranges (e.g. "1-3 years", "3-5 years", "5+ years"), check the candidate's total years of experience or skill experience from the resume and choose the exact matching option index.
   - For work authorization/citizenship/sponsorship questions (e.g. "Are you legally authorized...", "Will you now or in the future require sponsorship..."), answer accurately based on the candidate's country, work authorization, and sponsorship requirement (`authorizedToWork`, `sponsorshipRequired`). If not explicitly stated, assume standard positive work authorization for the candidate's location and no sponsorship required unless specified otherwise.
   
2. **Open-Ended Text Fields ("text", "textarea"):**
   - Write a complete, ready-to-submit answer based on the candidate's profile. Follow these rules without exception:
     - NO PLACEHOLDERS, EVER. Never write things like "[Insert Company Name]", "[to fill]", "[X years]", or any bracketed placeholder. If a specific detail (like the company name or role) isn't in the candidate profile or field context, infer the most reasonable value from what IS available (e.g. use the job title given in the field context, or write around it naturally without needing the missing detail) and write a complete answer. The output must be something a person could submit right now with zero edits.
     - STRICT PLAIN TEXT. No markdown, ever. That means: no **bold**, no *italics*, no bullet points, no numbered lists, no headers, no backticks. Do not use em-dashes (—) either — use commas or periods instead. Write in plain paragraphs or plain line breaks only, exactly as someone would type directly into a browser textarea.
     - SOUND LIKE A HUMAN, NOT AN AI. This is the most important rule. The candidate is a real developer typing this into a form, not a copywriter. Follow these guidelines:
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
   - **Compensation / CTC / RSU / Salary Questions** (e.g., "Please indicate your last CTC", "Please indicate your last RSU", "Expected Salary"):
     - Look up the salary/compensation expectations or current CTC in the candidate's profile/resume. If a specific currency or number is available or requested, provide a realistic, professional figure based on `salaryExpectation` or state "Confidential" / "Negotiable" / "Market rate" or "0" (for RSU if not applicable).
   - **Nationality / Citizenship Questions** (e.g., "Please indicate your nationality*", "Please indicate your citizenship*"):
     - State the candidate's country/nationality clearly (e.g., from `country` or `location` in resume, such as "Indian", "United States", etc.).
   - **Skill Years of Experience Questions** (e.g., "How many years of work experience do you have with [Skill]?"):
     - Calculate or estimate the years of experience with that exact skill based on the candidate's work history dates and skills in the resume. Return just the numeric value (e.g., "4").
   - **Notice Period Questions**:
     - Return the candidate's notice period (`noticePeriod`, e.g., "Immediate", "2 weeks", "30 days").

3. **Checkboxes ("checkbox"):**
   - Return boolean `true` or `false` (`true` for agreeing to terms, privacy policies, or required attestations).

4. **Output Format:**
   - Return a strict, raw JSON object mapping each `"id"` (`modal_f_0`, `modal_f_1`, etc.) to its calculated value (integer index for select/radio, boolean for checkbox, string for text/textarea).
   - DO NOT wrap in markdown code blocks (` ```json `). Output RAW JSON ONLY.
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
                            await page.evaluate("([msg]) => window.addAutofillLog(msg, 'success')", [f"AI Selected {rf_label} -> {chosen_opt}"])
                            filled_count += 1
                    elif rf_type == "radio":
                        idx = int(val)
                        if 0 <= idx < len(rf["options"]):
                            await highlight_element(rf["elements"][idx])
                            await rf["elements"][idx].click()
                            chosen_opt = rf["options"][idx]
                            await page.evaluate("([msg]) => window.addAutofillLog(msg, 'success')", [f"AI Clicked {rf_label} -> {chosen_opt}"])
                            filled_count += 1
                    elif rf_type == "checkbox":
                        is_checked = bool(val)
                        await highlight_element(rf["element"])
                        await rf["element"].set_checked(is_checked)
                        action = "Checked" if is_checked else "Unchecked"
                        await page.evaluate("([msg]) => window.addAutofillLog(msg, 'success')", [f"AI {action} {rf_label}"])
                        filled_count += 1
                    else:
                        await fill_text_field(page, rf["element"], str(val), rf_label)
                        await page.evaluate("([msg]) => window.addAutofillLog(msg, 'success')", [f"AI Filled {rf_label}: {str(val)[:30]}"])
                        filled_count += 1
                except Exception as e:
                    print(json.dumps({"type": "log", "message": f"[Modal Autofill Error] Field {rf_label}: {str(e)}"}))
                    sys.stdout.flush()
        except Exception as e:
            print(json.dumps({"type": "log", "message": f"[Modal Autofill Error] LLM answering failed: {str(e)}"}))
            sys.stdout.flush()

    print(json.dumps({"type": "log", "message": f"[Modal Autofill] Completed current modal step! Total fields filled: {filled_count}"}))
    sys.stdout.flush()
    try:
        await page.evaluate("([msg]) => window.resetModalAutofillBtn(msg)", [f"✨ Step Filled! ({filled_count} fields)"])
    except Exception:
        pass
