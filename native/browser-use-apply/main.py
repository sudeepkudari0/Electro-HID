import asyncio
import sys
import os
import json
import argparse
import sqlite3
import datetime
from pathlib import Path
from urllib.parse import urlparse
from browser_use import Agent, BrowserSession, ChatOpenAI, Controller, ActionResult

# Import custom callback signatures
from browser_use.agent.views import AgentOutput
from browser_use.browser.views import BrowserStateSummary

# Initialize Controller for dynamic tools
controller = Controller()
current_profile = {}

@controller.action('Get candidate profile fields: "currentRole", "currentCompany", "totalYearsExperience", "noticePeriod", "salaryExpectation", "remotePreference", "topSkills", "githubUrl", "portfolioUrl", "linkedinUrl"')
def get_candidate_profile_field(field_name: str) -> ActionResult:
    global current_profile
    value = current_profile.get(field_name)
    if value is None:
        return ActionResult(error=f"Field {field_name} not found in profile", include_in_memory=False)
    if isinstance(value, list):
        value = ", ".join(value)
    return ActionResult(extracted_content=str(value), include_in_memory=False)

@controller.action('Get the answer to a screening question or EEO question based on candidate preferences and history')
def get_screening_answer(question_text: str) -> ActionResult:
    global current_profile
    custom_answers = current_profile.get("customScreeningAnswers", {})
    
    # Fuzzy match question
    from difflib import SequenceMatcher
    best_match = None
    best_ratio = 0.0
    for q_key, val in custom_answers.items():
        ratio = SequenceMatcher(None, question_text.lower(), q_key.lower()).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_match = val
            
    if best_ratio > 0.7:
        return ActionResult(extracted_content=str(best_match), include_in_memory=False)
        
    q_lower = question_text.lower()
    if "sponsorship" in q_lower or "visa" in q_lower or "authorized" in q_lower:
        sponsorship = current_profile.get("sponsorshipNeeded", "No")
        return ActionResult(extracted_content="Yes" if sponsorship == "Yes" or sponsorship is True else "No", include_in_memory=False)
    if "salary" in q_lower or "compensation" in q_lower or "expect" in q_lower:
        salary = current_profile.get("salaryExpectation", "Market rate")
        return ActionResult(extracted_content=str(salary), include_in_memory=False)
    if "notice" in q_lower or "start" in q_lower:
        notice = current_profile.get("noticePeriod", "Immediate")
        return ActionResult(extracted_content=str(notice), include_in_memory=False)
    if "remote" in q_lower or "hybrid" in q_lower:
        pref = current_profile.get("remotePreference", "Remote/Hybrid")
        return ActionResult(extracted_content=str(pref), include_in_memory=False)
        
    return ActionResult(extracted_content="UNKNOWN - Flag for review", error="no_matching_answer", include_in_memory=False)

@controller.action('Request human approval before submitting the application. Use this ONLY when you are ready to submit.')
def request_human_submit_approval() -> ActionResult:
    print(json.dumps({
        "type": "status",
        "status": "awaiting_approval",
        "action": "Awaiting human review/approval before final submission..."
    }))
    sys.stdout.flush()
    
    try:
        # Blocks and reads input from Electron process
        line = sys.stdin.readline().strip()
        if "approve" in line.lower():
            return ActionResult(extracted_content="Approval received. Application submitted.", include_in_memory=False)
        else:
            return ActionResult(error="Submission approval rejected by user.", include_in_memory=False)
    except Exception as e:
        return ActionResult(error=f"stdin read failure during approval: {str(e)}", include_in_memory=False)

# Database Helpers
def init_db(db_path):
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS applications (
        id TEXT PRIMARY KEY,
        company TEXT,
        title TEXT,
        url TEXT,
        final_status TEXT,
        total_steps INTEGER,
        started_at TEXT,
        ended_at TEXT
    )
    """)
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id TEXT,
        step_index INTEGER,
        action_type TEXT,
        success INTEGER,
        error_text TEXT,
        timestamp TEXT
    )
    """)
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS site_tips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT,
        tip_text TEXT,
        validated_count INTEGER DEFAULT 1,
        last_seen_at TEXT
    )
    """)
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS screening_answers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT,
        question_text TEXT,
        answer_text TEXT,
        source TEXT,
        confidence REAL,
        times_reused INTEGER DEFAULT 0
    )
    """)
    
    conn.commit()
    conn.close()

def get_site_tips(db_path, domain):
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute("SELECT tip_text FROM site_tips WHERE domain = ?", (domain,))
        tips = [row[0] for row in c.fetchall()]
        conn.close()
        return tips
    except Exception:
        return []

def save_application_run(db_path, job_id, company, title, url, final_status, steps_count):
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        now_str = datetime.datetime.now().isoformat()
        c.execute("""
        INSERT OR REPLACE INTO applications (id, company, title, url, final_status, total_steps, ended_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (job_id, company, title, url, final_status, steps_count, now_str))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error saving app run: {e}", file=sys.stderr)

async def run_reflection_critic(db_path, job, steps_log, final_status, error_message, llm):
    url = job.get("url", "")
    domain = urlparse(url).netloc or url
    
    prompt = f"""
You are an AI critique system. You are reviewing the execution trace of an autonomous job application agent.
Job: {job.get('title')} at {job.get('company')}
URL: {job.get('url')}
Final Status: {final_status}
Error/Message: {error_message}

Trace of steps executed:
{json.dumps(steps_log, indent=2)}

Please diagnose the run. Respond in strict JSON format matching the following keys:
{{
    "root_cause": "Short diagnosis of the outcome",
    "site_tips": ["Single sentence instruction for future runs on this site, e.g., 'Workday forms load slowly: add wait after clicking next.'"],
    "screening_qas": [
        {{"question": "exact question text from page", "answer": "correct answer from candidate profile used"}}
    ]
}}
"""
    try:
        response = await llm.ainvoke(prompt)
        content = response.content.strip()
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        data = json.loads(content.strip())
        
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        now_str = datetime.datetime.now().isoformat()
        
        for tip in data.get("site_tips", []):
            c.execute("SELECT id, validated_count FROM site_tips WHERE domain = ? AND tip_text = ?", (domain, tip))
            row = c.fetchone()
            if row:
                c.execute("UPDATE site_tips SET validated_count = validated_count + 1, last_seen_at = ? WHERE id = ?", (now_str, row[0]))
            else:
                c.execute("INSERT INTO site_tips (domain, tip_text, last_seen_at) VALUES (?, ?, ?)", (domain, tip, now_str))
                
        for qa in data.get("screening_qas", []):
            q_text = qa.get("question")
            a_text = qa.get("answer")
            if q_text and a_text:
                c.execute("""
                INSERT INTO screening_answers (domain, question_text, answer_text, source, confidence)
                VALUES (?, ?, ?, 'critic_inferred', 0.8)
                """, (domain, q_text, a_text))
                
        conn.commit()
        conn.close()
        
        print(json.dumps({
            "type": "log",
            "message": f"[CRITIC] Reflection complete. Saved {len(data.get('site_tips', []))} tips and {len(data.get('screening_qas', []))} Q&A mappings."
        }))
        sys.stdout.flush()
        
    except Exception as e:
        print(json.dumps({
            "type": "log",
            "message": f"[CRITIC] Reflection failed: {str(e)}"
        }))
        sys.stdout.flush()

def build_apply_prompt(job, resume_path, cover_letter_text, dry_run):
    submit_instructions = (
        "DO NOT click the final submit button. Fill out all pages, stop at the review/submit step, and call request_human_submit_approval to await final approval. DO NOT submit without approval."
        if dry_run else
        "Fill all fields, call request_human_submit_approval when on the review/submit step, and only submit if the human approves."
    )
    
    prompt = f"""
You are an autonomous job application assistant. Your task is to apply for the following job:
Job Title: {job.get('title')}
Company: {job.get('company')}
Job URL: {job.get('url')}

Instructions:
1. Navigate to the job URL: {job.get('url')}
2. If this is a LinkedIn Easy Apply job, complete the application steps within the modal.
3. If it is an external board (like Greenhouse or Lever) or a company site, navigate to the application form.
4. Fill all required fields truthfully. Use your available custom actions to retrieve candidate details, screening answers, and EEO/demographic information.
5. If you need sensitive candidate details (like full name, email, phone, or location), use the provided sensitive data placeholders (e.g., wrap them in <secret> tags as instructed).
6. Handle resume selection:
   - For LinkedIn Easy Apply: If one or more resumes are already uploaded and listed on the page, use the already selected/listed resume. DO NOT upload a new resume. Only upload the resume from {resume_path} if no resume is currently uploaded or selected.
   - For other job boards/sites: Upload the resume at the file input. The resume path is: {resume_path}
7. {submit_instructions}
8. Once finished, write a short summary stating: "RESULT:APPLIED" or "RESULT:FAILED" or "RESULT:LOGIN_ISSUE".
"""
    return prompt

async def run_job(job, payload, llm):
    global current_profile
    job_id = job.get("id")
    url = job.get("url", "")
    dry_run = payload.get("dryRun", True)
    db_path = payload.get("dbPath")
    
    # Check if LinkedIn vs default browser profile
    is_linkedin = "linkedin.com" in url
    profile_dir = payload.get("browserProfileDirs", {}).get(
        "linkedin" if is_linkedin else "default"
    )
    
    print(json.dumps({
        "type": "status",
        "status": "running",
        "action": f"Launching browser for {job.get('company')}...",
        "jobId": job_id
    }))
    sys.stdout.flush()

    # Generate custom prompt
    resume_path = payload.get("resumePdfPath", "")
    cover_letter_text = job.get("coverLetterText") or payload.get("coverLetterText", "")
    
    prompt = build_apply_prompt(job, resume_path, cover_letter_text, dry_run)
    
    # Fetch site tips
    domain = urlparse(url).netloc or url
    tips = get_site_tips(db_path, domain) if db_path else []
    extend_system_message = None
    if tips:
        extend_system_message = "Site Tips for this domain:\n" + "\n".join(f"- {t}" for t in tips)
        print(json.dumps({
            "type": "log",
            "message": f"Loaded {len(tips)} site-specific tips for domain: {domain}"
        }))
        sys.stdout.flush()

    # Prep sensitive data masking
    profile = payload.get("candidateProfile", {})
    current_profile = profile
    sensitive_data = {
        "fullName": profile.get("fullName", ""),
        "email": profile.get("email", ""),
        "phone": profile.get("phone", ""),
        "location": profile.get("location", ""),
    }
    
    browser_session = None
    steps_log = []
    final_message = ""
    final_status = "failed"
    
    try:
        browser_session = BrowserSession(
            headless=payload.get("headless", False),
            user_data_dir=profile_dir,
            keep_alive=False,
            wait_between_actions=1.2,
            minimum_wait_page_load_time=1.0,
            wait_for_network_idle_page_load_time=1.5,
        )
        
        def step_callback(state: BrowserStateSummary, agent_output: AgentOutput, step_number: int):
            try:
                message = ""
                action_type = "unknown"
                if agent_output.action:
                    message = str(agent_output.action)
                    action_type = getattr(agent_output.action, "__class__", {}).__name__ if hasattr(agent_output.action, "__class__") else "action"
                
                steps_log.append({
                    "step_number": step_number,
                    "action": message,
                    "action_type": action_type
                })
                
                print(json.dumps({
                    "type": "log",
                    "message": f"Step {step_number}: {message[:250]}"
                }))
                sys.stdout.flush()
            except Exception:
                pass

        agent = Agent(
            task=prompt,
            llm=llm,
            browser_session=browser_session,
            controller=controller,
            sensitive_data=sensitive_data,
            extend_system_message=extend_system_message,
            use_thinking=False,
            use_judge=False,
            enable_planning=False,
            register_new_step_callback=step_callback
        )
        
        history = await agent.run()
        
        # Read history to find final output
        if history and history.history:
            last_item = history.history[-1]
            if hasattr(last_item, 'result') and last_item.result:
                final_message = str(last_item.result)
        
        # Classify status based on final message
        final_status = "applied"
        if "RESULT:FAILED" in final_message.upper():
            final_status = "failed"
        elif "RESULT:LOGIN_ISSUE" in final_message.upper():
            final_status = "login_issue"
        elif "RESULT:EXPIRED" in final_message.upper():
            final_status = "expired"
        elif "RESULT:CAPTCHA" in final_message.upper():
            final_status = "captcha"
            
        print(json.dumps({
            "type": "result",
            "jobId": job_id,
            "status": final_status,
            "message": final_message or f"Finished applying to {job.get('company')}"
        }))
        sys.stdout.flush()
        
    except Exception as e:
        final_message = f"Agent crashed: {str(e)}"
        print(json.dumps({
            "type": "result",
            "jobId": job_id,
            "status": "failed",
            "message": final_message
        }))
        sys.stdout.flush()
    finally:
        if browser_session:
            try:
                await browser_session.close()
            except Exception:
                pass
                
        # Persist traces and run critique loop
        if db_path:
            save_application_run(db_path, job_id, job.get('company'), job.get('title'), url, final_status, len(steps_log))
            
            # Save steps trace in SQLite steps table
            try:
                conn = sqlite3.connect(db_path)
                c = conn.cursor()
                now_str = datetime.datetime.now().isoformat()
                for step in steps_log:
                    c.execute("""
                    INSERT INTO steps (application_id, step_index, action_type, success, error_text, timestamp)
                    VALUES (?, ?, ?, 1, '', ?)
                    """, (job_id, step["step_number"], step["action_type"], now_str))
                conn.commit()
                conn.close()
            except Exception as e:
                print(f"Error saving steps trace: {e}", file=sys.stderr)
                
            # Run LLM-based reflection critique loop
            await run_reflection_critic(db_path, job, steps_log, final_status, final_message, llm)

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload", required=True, help="Path to JSON payload file")
    args = parser.parse_args()
    
    with open(args.payload, 'r') as f:
        payload = json.load(f)
        
    db_path = payload.get("dbPath")
    if db_path:
        init_db(db_path)
        
    llm_config = payload.get("llm", {})
    llm = ChatOpenAI(
        model=llm_config.get("model") or "gpt-4o",
        api_key=llm_config.get("apiKey") or "EMPTY",
        base_url=llm_config.get("baseUrl") or None
    )
    
    jobs = payload.get("jobs", [])
    print(json.dumps({"type": "status", "status": "running", "action": f"Starting queue of {len(jobs)} jobs..."}))
    sys.stdout.flush()
    
    for job in jobs:
        await run_job(job, payload, llm)
        
    print(json.dumps({"type": "status", "status": "done", "action": "All queue jobs completed"}))
    sys.stdout.flush()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print(json.dumps({"type": "status", "status": "stopped", "action": "Interrupted by user"}))
        sys.stdout.flush()
