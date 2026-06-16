import asyncio
import sys
import os
import json
import argparse
from pathlib import Path
from browser_use import Agent, BrowserSession, ChatOpenAI

# Import custom callback signatures
from browser_use.agent.views import AgentOutput
from browser_use.browser.views import BrowserStateSummary

def build_apply_prompt(job, profile, resume_path, cover_letter_text, dry_run):
    submit_instructions = (
        "DO NOT click the final submit button. Fill out all pages, stop at the review/submit step, and declare that the application is filled and ready."
        if dry_run else
        "Proceed all the way to submit the application once all fields are filled."
    )
    
    prompt = f"""
You are an autonomous job application assistant. Your task is to apply for the following job:
Job Title: {job.get('title')}
Company: {job.get('company')}
Job URL: {job.get('url')}

Candidate Information:
Name: {profile.get('fullName', '')}
Email: {profile.get('email', '')}
Phone: {profile.get('phone', '')}
Current Location: {profile.get('location', '')}
LinkedIn: {profile.get('linkedinUrl', '')}
GitHub: {profile.get('githubUrl', '')}
Portfolio: {profile.get('portfolioUrl', '')}

Additional details (use these for form fields/questions):
- Total years of experience: {profile.get('totalYearsExperience', '')}
- Current/Most recent role: {profile.get('currentRole', '')}
- Current/Most recent company: {profile.get('currentCompany', '')}
- Top Skills: {', '.join(profile.get('topSkills', []))}
- Sponsorship required: {profile.get('sponsorshipNeeded', 'No')}
- Notice period: {profile.get('noticePeriod', 'Immediate')}
- Salary expectation: {profile.get('salaryExpectation', 'Market rate')}
- Remote preference: {profile.get('remotePreference', 'Remote/Hybrid')}

Custom/Screening Answers:
{json.dumps(profile.get('customScreeningAnswers', {}), indent=2)}

Resume file path to upload:
{resume_path}

Cover Letter text:
{cover_letter_text}

Instructions:
1. Navigate to the job URL: {job.get('url')}
2. If this is a LinkedIn Easy Apply job, complete the application steps within the modal.
3. If it is an external board (like Greenhouse or Lever) or a company site, navigate to the application form.
4. Fill all required fields truthfully from the candidate profile. If a question is not covered in the profile, use your best judgement or common answers.
5. Upload the resume at the file input.
6. {submit_instructions}
7. Once finished, write a short summary stating: "RESULT:APPLIED" or "RESULT:FAILED" or "RESULT:LOGIN_ISSUE".
"""
    return prompt

async def run_job(job, payload, llm):
    job_id = job.get("id")
    url = job.get("url", "")
    dry_run = payload.get("dryRun", True)
    
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
    
    prompt = build_apply_prompt(job, payload.get("candidateProfile", {}), resume_path, cover_letter_text, dry_run)
    
    browser_session = None
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
                # Extract action description or logs
                message = ""
                if agent_output.action:
                    # agent_output.action is a list or object, try to format
                    message = str(agent_output.action)
                
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
            use_thinking=False,
            use_judge=False,
            enable_planning=False,
            register_new_step_callback=step_callback
        )
        
        history = await agent.run()
        
        # Read history to find final output
        final_message = ""
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
        print(json.dumps({
            "type": "result",
            "jobId": job_id,
            "status": "failed",
            "message": f"Agent crashed: {str(e)}"
        }))
        sys.stdout.flush()
    finally:
        if browser_session:
            try:
                await browser_session.close()
            except Exception:
                pass

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload", required=True, help="Path to JSON payload file")
    args = parser.parse_args()
    
    with open(args.payload, 'r') as f:
        payload = json.load(f)
        
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
