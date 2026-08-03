import asyncio
import json
import sys

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
            let container = element.closest('.fb-dash-form-element, .jobs-easy-apply-form-section__group, .artdeco-text-input, .form-group, .field, [role="group"]');
            if (container) {
                let labelEl = container.querySelector('label, .fb-form-element-label, .jobs-easy-apply-form-section__group-title, .artdeco-text-input--label, legend, .question-text, span.visually-hidden');
                if (labelEl && labelEl.innerText.trim()) {
                    return labelEl.innerText.trim();
                }
            }
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
                if (legend && legend.innerText.trim()) return legend.innerText.trim();
            }
            let container = element.closest('.jobs-easy-apply-form-section__group, .fb-dash-form-element, .form-group, .field, [role="group"], .radio-group');
            if (container) {
                let labelEl = container.querySelector('.jobs-easy-apply-form-section__group-title, .fb-form-element-label, label, .label, .question-text, .legend');
                if (labelEl && labelEl.innerText.trim()) return labelEl.innerText.trim();
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
        await el.fill(str(val))
        await page.evaluate("([msg]) => window.addAutofillLog(msg)", [f"Typed {label}: {val}"])
        return True
    except Exception:
        return False

async def fill_custom_dropdown(page, trigger, synonyms, label=""):
    try:
        await highlight_element(trigger)
        await trigger.click()
        await page.wait_for_timeout(250)

        search_box = await page.query_selector(
            "[aria-expanded='true'] input[type='text']:visible, [role='combobox'] input:visible"
        )
        if search_box and synonyms:
            await search_box.fill(synonyms[0])
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

async def fill_cover_letter_impl(page, cover_letter_text):
    if not cover_letter_text:
        return False
        
    print(json.dumps({"type": "log", "message": "[Autofill] Attempting to fill cover letter..."}))
    sys.stdout.flush()
    try:
        await page.evaluate("([msg]) => window.addAutofillLog(msg)", ["Locating cover letter field..."])
    except Exception:
        pass
    
    # 0. Try to click "Enter manually" if it is an attachment toggle
    try:
        toggles = await page.query_selector_all("button, span, a, div[role='button']")
        for toggle in toggles:
            text = (await toggle.text_content() or "").strip().lower()
            if "enter manually" in text or "write cover letter" in text or "paste" in text:
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
                    try:
                        await page.evaluate("([msg]) => window.addAutofillLog(msg)", ["Clicking 'Enter manually' to show text area..."])
                    except Exception:
                        pass
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
                try:
                    await page.evaluate("([msg]) => window.addAutofillLog(msg)", ["Typing cover letter..."])
                except Exception:
                    pass
                await el.type(cover_letter_text, delay=5)
                print(json.dumps({"type": "log", "message": "[Autofill] Filled cover letter in plain textarea."}))
                sys.stdout.flush()
                try:
                    await page.evaluate("([msg]) => window.addAutofillLog(msg)", ["Typed cover letter in plain textarea."])
                except Exception:
                    pass
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
                try:
                    await page.evaluate("([msg]) => window.addAutofillLog(msg)", ["Typing cover letter in rich text editor..."])
                except Exception:
                    pass
                await page.keyboard.type(cover_letter_text, delay=5)
                val = await el.inner_text() or ""
                if cover_letter_text[:20] not in val:
                    await page.wait_for_timeout(300)
                    await el.click()
                    await page.keyboard.type(cover_letter_text, delay=5)
                print(json.dumps({"type": "log", "message": "[Autofill] Filled cover letter in rich-text editor."}))
                sys.stdout.flush()
                try:
                    await page.evaluate("([msg]) => window.addAutofillLog(msg)", ["Typed cover letter in rich text editor."])
                except Exception:
                    pass
                return True
    except Exception:
        pass
                
    return False
