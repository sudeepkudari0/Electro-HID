import { app } from "electron";
import path from "path";
import fs from "fs";
import net from "net";
import { spawn, execSync, ChildProcess } from "child_process";
import { getSettings } from "../settings";
import { JSONStore } from "../storage/store";

let activeChromeProc: ChildProcess | null = null;
let activeClaudeProc: ChildProcess | null = null;
let activeProxyProc: ChildProcess | null = null;
let activePort: number = 9222;
let activeWorkerId: number = 0;

/**
 * Locate Chrome/Chromium executable path on Linux, macOS, or Windows.
 */
function getChromePath(): string {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  const platform = process.platform;
  const candidates: string[] = [];

  if (platform === "win32") {
    candidates.push(
      path.join(
        process.env.PROGRAMFILES || "C:\\Program Files",
        "Google\\Chrome\\Application\\chrome.exe",
      ),
      path.join(
        process.env.process_env_PROGRAMFILESX86 || "C:\\Program Files (x86)",
        "Google\\Chrome\\Application\\chrome.exe",
      ),
      path.join(
        process.env.LOCALAPPDATA || "",
        "Google\\Chrome\\Application\\chrome.exe",
      ),
    );
  } else if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
  } else {
    // Linux
    const commands = [
      "google-chrome-stable",
      "google-chrome",
      "chromium-browser",
      "chromium",
      "chrome",
    ];
    for (const cmd of commands) {
      try {
        const found = execSync(`which ${cmd} 2>/dev/null`).toString().trim();
        if (found) {
          candidates.push(found);
        }
      } catch (e) {
        // Ignored
      }
    }
    candidates.push(
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/snap/bin/chromium",
    );
  }

  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      return c;
    }
  }

  throw new Error(
    "Google Chrome or Chromium executable not found on this system.",
  );
}

/**
 * Kill any process occupying a specific port.
 */
function killPort(port: number): void {
  try {
    if (process.platform === "win32") {
      const output = execSync(`netstat -ano -p TCP`).toString();
      const lines = output.split("\n");
      for (const line of lines) {
        if (line.includes(`:${port}`) && line.includes("LISTENING")) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid)) {
            execSync(`taskkill /F /PID ${pid}`);
          }
        }
      }
    } else {
      // Unix
      try {
        const pids = execSync(`lsof -t -i:${port}`)
          .toString()
          .trim()
          .split("\n");
        for (const pid of pids) {
          if (pid && /^\d+$/.test(pid)) {
            execSync(`kill -9 ${pid}`);
          }
        }
      } catch (err) {
        // lsof fails if nothing is listening, ignore
      }
    }
  } catch (e) {
    console.warn(`Failed to kill process on port ${port}:`, e);
  }
}

function getProxyDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "groq-proxy");
  }

  let basePath = app.getAppPath();
  if (basePath.includes("dist-electron")) {
    basePath = path.join(basePath, "..", "..");
  }
  return path.join(basePath, "native", "groq-proxy");
}

function getProxyVenvDir(nativeDir: string): string {
  if (app.isPackaged) {
    return path.join(app.getPath("userData"), "groq-proxy", "venv");
  }
  return path.join(nativeDir, ".venv");
}

function getProxyVenvPython(venvDir: string): string {
  return process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
}

function findSystemPython(): string | null {
  const candidates =
    process.platform === "win32"
      ? ["python", "python3", "py -3"]
      : ["python3", "python"];

  for (const cmd of candidates) {
    try {
      const version = execSync(`${cmd} --version 2>&1`, {
        timeout: 5000,
      })
        .toString()
        .trim();
      if (version.startsWith("Python 3")) {
        return cmd;
      }
    } catch {
      // not found, try next
    }
  }
  return null;
}

function setupProxyVenv(nativeDir: string, venvDir: string, onStatusUpdate: (data: any) => void): void {
  const systemPython = findSystemPython();
  if (!systemPython) {
    throw new Error(
      "Python 3 is not installed on this system. Please install Python 3.9+ and try again.",
    );
  }

  const requirementsPath = path.join(nativeDir, "requirements.txt");
  if (!fs.existsSync(requirementsPath)) {
    throw new Error(
      `Groq proxy requirements.txt not found at ${requirementsPath}`,
    );
  }

  const workingDir = path.dirname(venvDir);
  fs.mkdirSync(workingDir, { recursive: true });

  console.log("[Proxy Setup] Creating venv at:", venvDir, "with:", systemPython);
  onStatusUpdate({
    status: "running",
    action: "Creating Python virtual environment for Groq proxy...",
  });
  execSync(`${systemPython} -m venv "${venvDir}"`, {
    cwd: workingDir,
    timeout: 60_000,
    stdio: "pipe",
  });

  const pip =
    process.platform === "win32"
      ? path.join(venvDir, "Scripts", "pip")
      : path.join(venvDir, "bin", "pip");

  console.log("[Proxy Setup] Installing requirements...");
  onStatusUpdate({
    status: "running",
    action: "Installing Groq proxy requirements (fastapi, litellm, uvicorn)...",
  });
  execSync(`"${pip}" install -r "${requirementsPath}"`, {
    cwd: workingDir,
    timeout: 300_000, // 5 min
    stdio: "pipe",
  });
}

function checkPortOpen(port: number, host: string = "127.0.0.1", timeoutMs: number = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tryConnect = () => {
      const socket = new net.Socket();
      socket.setTimeout(250);
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("timeout", () => {
        socket.destroy();
        next();
      });
      socket.on("error", () => {
        socket.destroy();
        next();
      });
      socket.connect(port, host);
    };
    const next = () => {
      if (Date.now() - start > timeoutMs) {
        resolve(false);
      } else {
        setTimeout(tryConnect, 100);
      }
    };
    tryConnect();
  });
}

/**
 * Clean Chrome Preferences to avoid "Restore pages?" bubble.
 */
function suppressRestoreNag(profileDir: string): void {
  const prefsPath = path.join(profileDir, "Default", "Preferences");
  if (!fs.existsSync(prefsPath)) return;
  try {
    const content = fs.readFileSync(prefsPath, "utf-8");
    const prefs = JSON.parse(content);

    if (!prefs.profile) prefs.profile = {};
    prefs.profile.exit_type = "Normal";

    if (!prefs.session) prefs.session = {};
    prefs.session.restore_on_startup = 4; // Open blank
    delete prefs.session.startup_urls;

    prefs.credentials_enable_service = false;
    if (!prefs.password_manager) prefs.password_manager = {};
    prefs.password_manager.saving_enabled = false;

    if (!prefs.autofill) prefs.autofill = {};
    prefs.autofill.profile_enabled = false;

    fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2), "utf-8");
  } catch (e) {
    console.warn("[Auto-Apply] Failed to patch Chrome preferences:", e);
  }
}

/**
 * Clean up active subprocesses.
 */
export async function stopApply(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    let killed = false;
    if (activeClaudeProc) {
      activeClaudeProc.kill("SIGKILL");
      activeClaudeProc = null;
      killed = true;
    }
    if (activeProxyProc) {
      if (process.platform === "win32") {
        try { execSync(`taskkill /F /T /PID ${activeProxyProc.pid}`); } catch {}
      } else {
        try {
          process.kill(-activeProxyProc.pid!, "SIGKILL");
        } catch {
          try { activeProxyProc.kill("SIGKILL"); } catch {}
        }
      }
      activeProxyProc = null;
      killed = true;
    }
    if (activeChromeProc) {
      if (process.platform === "win32") {
        execSync(`taskkill /F /T /PID ${activeChromeProc.pid}`);
      } else {
        process.kill(-activeChromeProc.pid!, "SIGKILL");
      }
      activeChromeProc = null;
      killed = true;
    }
    if (killed) {
      killPort(activePort);
    }
    return { success: true };
  } catch (e: any) {
    console.error("[Auto-Apply] Stop failed:", e);
    return { success: false, error: e.message };
  }
}

/**
 * Generate full prompt for the Claude Code agent, matching ApplyPilot's template.
 */
function buildPrompt(options: {
  job: any;
  resumeText: string;
  coverLetterText: string;
  pdfPath: string;
  clPdfPath: string;
  profile: any;
  settings: any;
  dryRun?: boolean;
}): string {
  const {
    job,
    resumeText,
    coverLetterText,
    pdfPath,
    clPdfPath,
    profile,
    settings,
    dryRun,
  } = options;

  // Personal
  const fullName = profile.fullName || "Applicant";
  const email = profile.email || "";
  const phone = profile.phone || "";
  const location = profile.location || "";

  const linkedin = profile.linkedinUrl || "";
  const github = profile.githubUrl || "";
  const portfolio = profile.portfolioUrl || "";

  // Work Auth defaults
  const workAuth = profile.workAuthorization || {
    legally_authorized_to_work: "Yes",
    require_sponsorship: "No",
    work_permit_type: "",
  };

  // Salary expectations
  const salaryExpectation =
    options.job.salary || profile.salaryExpectation || "100000";
  const salaryCurrency = profile.salaryCurrency || "USD";
  const salaryMin = profile.salaryRangeMin || salaryExpectation;
  const salaryMax =
    profile.salaryRangeMax || String(parseInt(salaryExpectation) + 20000);

  // EEO default Decline
  const gender = profile.eeoGender || "Decline to self-identify";
  const race = profile.eeoRace || "Decline to self-identify";
  const veteran = profile.eeoVeteran || "I am not a protected veteran";
  const disability = profile.eeoDisability || "I do not wish to answer";

  // Available Date
  const startDate = profile.earliestStartDate || "Immediately";
  const yearsExp = profile.totalYearsExperience || "5";
  const currentRole = profile.currentRole || "Software Engineer";

  // Format profiles section
  const profileSummary = [
    `Name: ${fullName}`,
    `Email: ${email}`,
    `Phone: ${phone}`,
    `Address: ${location}`,
    linkedin ? `LinkedIn: ${linkedin}` : "",
    github ? `GitHub: ${github}` : "",
    portfolio ? `Portfolio: ${portfolio}` : "",
    `Work Auth: ${workAuth.legally_authorized_to_work}`,
    `Sponsorship Needed: ${workAuth.require_sponsorship}`,
    workAuth.work_permit_type
      ? `Work Permit: ${workAuth.work_permit_type}`
      : "",
    `Salary Expectation: $${salaryExpectation} ${salaryCurrency}`,
    `Years Experience: ${yearsExp}`,
    `Education: Bachelor's Degree`,
    `Available: ${startDate}`,
    `Age 18+: Yes`,
    `Background Check: Yes`,
    `Felony: No`,
    `Previously Worked Here: No`,
    `How Heard: Online Job Board`,
    `Gender: ${gender}`,
    `Race: ${race}`,
    `Veteran: ${veteran}`,
    `Disability: ${disability}`,
  ]
    .filter(Boolean)
    .join("\n");

  // Hard rules
  const workAuthRule = workAuth.work_permit_type
    ? `Work auth: ${workAuth.work_permit_type}. Sponsorship needed: ${workAuth.require_sponsorship}.`
    : `Work auth: Answer truthfully from profile.`;

  const preferredName = fullName.split(" ")[0];
  const nameRule = `Name: Legal name = ${fullName}. Preferred name = ${preferredName}. Use "${fullName}" unless a field specifically says "legal name".`;

  const hardRules = [
    `== HARD RULES (never break these) ==`,
    `1. Never lie about: citizenship, work authorization, criminal history, education credentials, security clearance, licenses.`,
    `2. ${workAuthRule}`,
    `3. ${nameRule}`,
  ].join("\n");

  // Location check
  const acceptPatterns = profile.preferredLocations || [location.split(",")[0]];
  const cityList = acceptPatterns.join(", ");
  const locationCheck = [
    `== LOCATION CHECK (do this FIRST before any form) ==`,
    `Read the job page. Determine the work arrangement. Then decide:`,
    `- "Remote" or "work from anywhere" -> ELIGIBLE. Apply.`,
    `- "Hybrid" or "onsite" in ${cityList} -> ELIGIBLE. Apply.`,
    `- "Hybrid" or "onsite" in another city BUT the posting also says "remote OK" or "remote option available" -> ELIGIBLE. Apply.`,
    `- "Onsite only" or "hybrid only" in any city outside the list above with NO remote option -> NOT ELIGIBLE. Stop immediately. Output RESULT:FAILED:not_eligible_location`,
    `- City is overseas (India, Philippines, Europe, etc.) with no remote option -> NOT ELIGIBLE. Output RESULT:FAILED:not_eligible_location`,
    `- Cannot determine location -> Continue applying. If a screening question reveals it's non-local onsite, answer honestly and let the system reject if needed.`,
    `Do NOT fill out forms for jobs that are clearly onsite in a non-acceptable location. Check EARLY, save time.`,
  ].join("\n");

  // Salary Negotiation
  const salarySection = [
    `== SALARY (think, don't just copy) ==`,
    `$${salaryExpectation} ${salaryCurrency} is the FLOOR. Never go below it. But don't always use it either.`,
    ``,
    `Decision tree:`,
    `1. Job posting shows a range (e.g. "$120K-$160K")? -> Answer with the MIDPOINT ($140K).`,
    `2. Title says Senior, Staff, Lead, Principal, Architect, or level II/III/IV? -> Minimum $110K ${salaryCurrency}. Use midpoint of posted range if higher.`,
    `3. Posting is in a different currency? -> Target midpoint of their range. Convert if needed.`,
    `4. No salary info anywhere? -> Use $${salaryExpectation} ${salaryCurrency}.`,
    `5. Asked for a range? -> Give "${salaryMin}-${salaryMax} ${salaryCurrency}".`,
    `6. Hourly rate? -> Divide your annual answer by 2080. (e.g., $100K = $48/hr)`,
  ].join("\n");

  // Screening questions
  const screeningSection = [
    `== SCREENING QUESTIONS (be strategic) ==`,
    `Hard facts -> answer truthfully from the profile. No guessing. This includes:`,
    `  - Location/relocation: lives in ${location}, cannot relocate`,
    `  - Work authorization: ${workAuth.legally_authorized_to_work}`,
    `  - Citizenship, clearance, licenses, certifications: answer from profile only`,
    `  - Criminal/background: answer from profile only`,
    ``,
    `Skills and tools -> be confident. This candidate is a ${currentRole} with ${yearsExp} years experience. If the question asks "Do you have experience with [tool]?" and it's in the same domain (DevOps, backend, ML, cloud, automation), answer YES. Software engineers learn tools fast. Don't sell short.`,
    ``,
    `Open-ended questions ("Why do you want this role?", "Tell us about yourself", "What interests you?") -> Write 2-3 sentences. Be specific to THIS job. Reference something from the job description. Connect it to a real achievement from the resume. No generic fluff. No "I am passionate about..." -- sound like a real person.`,
    ``,
    `EEO/demographics -> "Decline to self-identify" or "Prefer not to say" for everything.`,
  ].join("\n");

  // CapSolver config
  const capsolverKey =
    settings.capsolverApiKey || process.env.CAPSOLVER_API_KEY || "";
  const captchaSection = [
    `== CAPTCHA ==`,
    `You solve CAPTCHAs via the CapSolver REST API. No browser extension. You control the entire flow.`,
    `API key: ${capsolverKey || "Not provided (go straight to MANUAL FALLBACK for all CAPTCHAs)"}`,
    `API base: https://api.capsolver.com`,
    ``,
    `CRITICAL RULE: When ANY CAPTCHA appears (hCaptcha, reCAPTCHA, Turnstile -- regardless of what it looks like visually), you MUST:`,
    `1. Run CAPTCHA DETECT to get the type and sitekey`,
    `2. Run CAPTCHA SOLVE (createTask -> poll -> inject) with the CapSolver API`,
    `3. ONLY go to MANUAL FALLBACK if CapSolver returns errorId > 0`,
    `Do NOT skip the API call based on what the CAPTCHA looks like. CapSolver solves CAPTCHAs server-side -- it does NOT need to see or interact with images, puzzles, or games. Even "drag the pipe" or "click all traffic lights" hCaptchas are solved via API token, not visually. ALWAYS try the API first.`,
    ``,
    `--- CAPTCHA DETECT ---`,
    `Run this browser_evaluate after every navigation, Apply/Submit/Login click, or when a page feels stuck.`,
    `IMPORTANT: Detection order matters. hCaptcha elements also have data-sitekey, so check hCaptcha BEFORE reCAPTCHA.`,
    `browser_evaluate function: () => {`,
    `  const r = {};`,
    `  const url = window.location.href;`,
    `  const hc = document.querySelector('.h-captcha, [data-hcaptcha-sitekey]');`,
    `  if (hc) { r.type = 'hcaptcha'; r.sitekey = hc.dataset.sitekey || hc.dataset.hcaptchaSitekey; }`,
    `  if (!r.type && document.querySelector('script[src*="hcaptcha.com"], iframe[src*="hcaptcha.com"]')) {`,
    `    const el = document.querySelector('[data-sitekey]');`,
    `    if (el) { r.type = 'hcaptcha'; r.sitekey = el.dataset.sitekey; }`,
    `  }`,
    `  if (!r.type) {`,
    `    const cf = document.querySelector('.cf-turnstile, [data-turnstile-sitekey]');`,
    `    if (cf) {`,
    `      r.type = 'turnstile'; r.sitekey = cf.dataset.sitekey || cf.dataset.turnstileSitekey;`,
    `      if (cf.dataset.action) r.action = cf.dataset.action;`,
    `      if (cf.dataset.cdata) r.cdata = cf.dataset.cdata;`,
    `    }`,
    `  }`,
    `  if (!r.type && document.querySelector('script[src*="challenges.cloudflare.com"]')) {`,
    `    r.type = 'turnstile_script_only'; r.note = 'Wait 3s and re-detect.';`,
    `  }`,
    `  if (!r.type) {`,
    `    const s = document.querySelector('script[src*="recaptcha"][src*="render="]');`,
    `    if (s) {`,
    `      const m = s.src.match(/render=([^&]+)/);`,
    `      if (m && m[1] !== 'explicit') { r.type = 'recaptchav3'; r.sitekey = m[1]; }`,
    `    }`,
    `  }`,
    `  if (!r.type) {`,
    `    const rc = document.querySelector('.g-recaptcha');`,
    `    if (rc) { r.type = 'recaptchav2'; r.sitekey = rc.dataset.sitekey; }`,
    `  }`,
    `  if (!r.type && document.querySelector('script[src*="recaptcha"]')) {`,
    `    const el = document.querySelector('[data-sitekey]');`,
    `    if (el) { r.type = 'recaptchav2'; r.sitekey = el.dataset.sitekey; }`,
    `  }`,
    `  if (!r.type) {`,
    `    const fc = document.querySelector('#FunCaptcha, [data-pkey], .funcaptcha');`,
    `    if (fc) { r.type = 'funcaptcha'; r.sitekey = fc.dataset.pkey; }`,
    `  }`,
    `  if (!r.type && document.querySelector('script[src*="arkoselabs"], script[src*="funcaptcha"]')) {`,
    `    const el = document.querySelector('[data-pkey]');`,
    `    if (el) { r.type = 'funcaptcha'; r.sitekey = el.dataset.pkey; }`,
    `  }`,
    `  if (r.type) { r.url = url; return r; }`,
    `  return null;`,
    `}`,
    ``,
    `--- CAPTCHA SOLVE ---`,
    `STEP 1 -- CREATE TASK (copy this exactly, fill in the 3 placeholders):`,
    `browser_evaluate function: async () => {`,
    `  const r = await fetch('https://api.capsolver.com/createTask', {`,
    `    method: 'POST',
    headers: {'Content-Type': 'application/json'},`,
    `    body: JSON.stringify({`,
    `      clientKey: '${capsolverKey}',`,
    `      task: {`,
    `        type: 'TASK_TYPE',`,
    `        websiteURL: 'PAGE_URL',`,
    `        websiteKey: 'SITE_KEY'`,
    `      }`,
    `    })`,
    `  });`,
    `  return await r.json();`,
    `}`,
    ``,
    `TASK_TYPE values (use EXACTLY these strings):`,
    `  hcaptcha     -> HCaptchaTaskProxyLess`,
    `  recaptchav2  -> ReCaptchaV2TaskProxyLess`,
    `  recaptchav3  -> ReCaptchaV3TaskProxyLess`,
    `  turnstile    -> AntiTurnstileTaskProxyLess`,
    `  funcaptcha   -> FunCaptchaTaskProxyLess`,
    ``,
    `PAGE_URL = the url from detect result. SITE_KEY = the sitekey from detect result.`,
    `For recaptchav3: add "pageAction": "submit" to the task object.`,
    `For turnstile: add "metadata": {"action": "...", "cdata": "..."} if those were in detect result.`,
    ``,
    `Response: {"errorId": 0, "taskId": "abc123"} on success.`,
    `If errorId > 0 -> CAPTCHA SOLVE failed. Go to MANUAL FALLBACK.`,
    ``,
    `STEP 2 -- POLL (replace TASK_ID with the taskId from step 1):`,
    `Loop: browser_wait_for time: 3, then run:`,
    `browser_evaluate function: async () => {`,
    `  const r = await fetch('https://api.capsolver.com/getTaskResult', {`,
    `    method: 'POST',`,
    `    headers: {'Content-Type': 'application/json'},`,
    `    body: JSON.stringify({`,
    `      clientKey: '${capsolverKey}',`,
    `      taskId: 'TASK_ID'`,
    `    })`,
    `  });`,
    `  return await r.json();`,
    `}`,
    `- status "processing" -> wait 3s, poll again. Max 10 polls.`,
    `- status "ready" -> extract token.`,
    `- errorId > 0 or 30s timeout -> MANUAL FALLBACK.`,
    ``,
    `STEP 3 -- INJECT TOKEN (replace THE_TOKEN with actual token string):`,
    `For reCAPTCHA v2/v3:`,
    `browser_evaluate function: () => {`,
    `  const token = 'THE_TOKEN';`,
    `  document.querySelectorAll('[name="g-recaptcha-response"]').forEach(el => { el.style.display = 'block'; el.value = token; });`,
    `  return 'injected';`,
    `}`,
    `For hCaptcha:`,
    `browser_evaluate function: () => {`,
    `  const token = 'THE_TOKEN';`,
    `  const ta = document.querySelector('[name="h-captcha-response"], textarea[name*="hcaptcha"]');`,
    `  if (ta) ta.value = token;`,
    `  return 'injected';`,
    `}`,
    `For Turnstile:`,
    `browser_evaluate function: () => {`,
    `  const token = 'THE_TOKEN';`,
    `  const inp = document.querySelector('[name="cf-turnstile-response"], input[name*="turnstile"]');`,
    `  if (inp) inp.value = token;`,
    `  return 'injected';`,
    `}`,
    `For FunCaptcha:`,
    `browser_evaluate function: () => {`,
    `  const token = 'THE_TOKEN';`,
    `  const inp = document.querySelector('#FunCaptcha-Token, input[name="fc-token"]');`,
    `  if (inp) inp.value = token;`,
    `  return 'injected';`,
    `}`,
    ``,
    `--- MANUAL FALLBACK ---`,
    `If CapSolver genuinely failed:`,
    `1. Audio challenge: Look for "audio" or "accessibility" button -> click it.`,
    `2. Text/logic puzzles: Solve them yourself.`,
    `3. Simple text captchas -> solve them.`,
    `4. All else fails -> Output RESULT:CAPTCHA.`,
  ].join("\n");

  // Submit Instruction
  const submitInstruction = dryRun
    ? "IMPORTANT: Do NOT click the final Submit/Apply button. Review the form, verify all fields, then output RESULT:APPLIED with a note that this was a dry run."
    : "BEFORE clicking Submit/Apply, take a snapshot and review EVERY field on the page. Verify all data matches the APPLICANT PROFILE and TAILORED RESUME. Only click Submit after confirming everything is correct.";

  // Assemble full prompt
  return `You are an autonomous job application agent. Your ONE mission: get this candidate an interview. You have all the information and tools. Think strategically. Act decisively. Submit the application.

== JOB ==
URL: ${job.url}
Title: ${job.title}
Company: ${job.company}

== FILES ==
Resume PDF (upload this): ${pdfPath}
Cover Letter PDF (upload if asked): ${clPdfPath || "N/A"}

== RESUME TEXT (use when filling text fields) ==
${resumeText}

== COVER LETTER TEXT (paste if text field, upload PDF if file field) ==
${coverLetterText || "None. Skip if optional. Otherwise pitch 2 factual sentences."}

== APPLICANT PROFILE ==
${profileSummary}

== YOUR MISSION ==
Submit a complete, accurate application. Use the profile and resume as source data -- adapt to fit each form's format.

If something unexpected happens and these instructions don't cover it, figure it out yourself. You are autonomous. Navigate pages, read content, try buttons, explore the site. The goal is always the same: submit the application. Do whatever it takes to reach that goal.

${hardRules}

== NEVER DO THESE (immediate RESULT:FAILED if encountered) ==
- NEVER grant camera, microphone, screen sharing, or location permissions. If a site requests them -> RESULT:FAILED:unsafe_permissions
- NEVER do video/audio verification, selfie capture, ID photo upload, or biometric anything -> RESULT:FAILED:unsafe_verification
- NEVER set up a freelancing profile (Mercor, Toptal, Upwork, Fiverr, Turing, etc.). These are contractor marketplaces, not job applications -> RESULT:FAILED:not_a_job_application
- NEVER agree to hourly/contract rates, availability calendars, or "set your rate" flows. You are applying for FULL-TIME salaried positions only.
- NEVER install browser extensions, download executables, or run assessment software.
- NEVER enter payment info, bank details, or SSN/SIN.
- NEVER click "Allow" on any browser permission popup. Always deny/block.
- If the site is NOT a job application form (it's a profile builder, skills marketplace, talent network signup, coding assessment platform) -> RESULT:FAILED:not_a_job_application

${locationCheck}

${salarySection}

${screeningSection}

== STEP-BY-STEP ==
1. browser_navigate to the job URL.
2. browser_snapshot to read the page. Then run CAPTCHA DETECT (see CAPTCHA section). If a CAPTCHA is found, solve it before continuing.
3. LOCATION CHECK. Read the page for location info. If not eligible, output RESULT and stop.
4. Find and click the Apply button. If email-only (page says "email resume to X"):
   - send_email with subject "Application for ${job.title} -- ${fullName}", body = 2-3 sentence pitch + contact info, attach resume PDF: ["${pdfPath}"]
   - Output RESULT:APPLIED. Done.
   After clicking Apply: browser_snapshot. Run CAPTCHA DETECT -- many sites trigger CAPTCHAs right after the Apply click. If found, solve before continuing.
5. Login wall?
   5a. FIRST: check the URL. If you landed on any SSO/OAuth page -> STOP. Output RESULT:FAILED:sso_required. Do NOT try to sign in to Google/Microsoft/SSO.
   5b. Check for popups. Run browser_tabs action "list". If a new tab/window appeared (login popup), switch to it. If SSO -> RESULT:FAILED:sso_required.
   5c. Regular login form? Try sign in: ${email}
   5d. After clicking Login/Sign-in: run CAPTCHA DETECT. If found, solve it then retry login.
   5e. Sign in failed? Try sign up with same email and password.
   5f. Need email verification? Use search_emails + read_email to get the code.
   5g. After login, run browser_tabs action "list". Switch back to the application tab if needed.
   5h. All failed? Output RESULT:FAILED:login_issue. Do not loop.
6. Upload resume. ALWAYS upload fresh -- delete any existing resume first, then browser_file_upload with the PDF path above.
7. Upload cover letter if there's a field for it. Text field -> paste the cover letter text. File upload -> use the cover letter PDF path.
8. Check ALL pre-filled fields. ATS systems parse your resume and auto-fill -- it's often WRONG. Fix mismatches. Fill empty fields.
9. Answer screening questions using the rules above.
10. ${submitInstruction}
11. After submit: browser_snapshot. Run CAPTCHA DETECT. Solve if found. Then check for new tabs. Confirm submission. Look for "thank you" or "application received".
12. Output your result.

== RESULT CODES (output EXACTLY one) ==
RESULT:APPLIED -- submitted successfully
RESULT:EXPIRED -- job closed or no longer accepting applications
RESULT:CAPTCHA -- blocked by unsolvable captcha
RESULT:LOGIN_ISSUE -- could not sign in or create account
RESULT:FAILED:not_eligible_location -- onsite outside acceptable area, no remote option
RESULT:FAILED:not_eligible_work_auth -- requires unauthorized work location
RESULT:FAILED:reason -- any other failure (brief reason)

== BROWSER EFFICIENCY ==
- browser_snapshot ONCE per page to understand it. Then use browser_take_screenshot to check results.
- Only snapshot again when you need element refs to click/fill.
- Multi-page forms (Workday, Taleo, iCIMS): snapshot each new page, fill all fields, click Next/Continue. Repeat until final review page.
- Fill ALL fields in ONE browser_fill_form call. Not one at a time.
- Keep your thinking SHORT. Don't repeat page structure back.
- CAPTCHA AWARENESS: After any navigation, Apply/Submit/Login click, or when a page feels stuck -- run CAPTCHA DETECT.

== FORM TRICKS ==
- date fields format: MM/DD/YYYY (${new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })})
- Dropdown won't fill? browser_click to open it, then browser_click the option.
- Checkbox won't check via fill_form? Use browser_click on it instead.
- Phone field with country prefix: just type digits ${phone.replace(/\D/g, "")}

== WHEN TO GIVE UP ==
- Same page after 3 attempts with no progress -> RESULT:FAILED:stuck
- Job is closed/expired -> RESULT:EXPIRED
- Page is broken/500 error/blank -> RESULT:FAILED:page_error
Stop immediately. Output your RESULT code. Do not loop.

${captchaSection}`;
}

/**
 * Execute the auto-apply agent process.
 */
export async function runApply(
  options: {
    job: any;
    resumePdfBase64: string;
    resumeText: string;
    coverLetterText: string;
    dryRun?: boolean;
  },
  onStatusUpdate: (eventData: {
    status:
      | "running"
      | "applied"
      | "expired"
      | "captcha"
      | "login_issue"
      | "failed"
      | "stopped";
    action?: string;
    log?: string;
    rawLog?: string;
    cost?: number;
    error?: string;
  }) => void,
): Promise<any> {
  const workerId = activeWorkerId;
  const port = activePort;

  // Make sure we stop any active runs first
  await stopApply();

  // Load backend profile & settings
  const store = new JSONStore("career-hub");
  const profileRes = store.read<any>("career-profile.json") || {};
  const settings = getSettings();

  // Setup worker isolation folders
  const workerDir = path.join(
    app.getPath("userData"),
    "careerHub",
    "apply-workers",
    `worker-${workerId}`,
  );
  const profileDir = path.join(
    app.getPath("userData"),
    "careerHub",
    "chrome-workers",
    `worker-${workerId}`,
  );

  fs.mkdirSync(workerDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });

  // Suppress Chrome crashed bubbles
  suppressRestoreNag(profileDir);

  // Write temporary resume and cover letter files
  const pdfPath = path.join(workerDir, "Tailored_Resume.pdf");
  const clPdfPath = path.join(workerDir, "Tailored_CoverLetter.pdf");

  fs.writeFileSync(pdfPath, Buffer.from(options.resumePdfBase64, "base64"));
  fs.writeFileSync(path.join(workerDir, "resume.txt"), options.resumeText);
  if (options.coverLetterText) {
    fs.writeFileSync(
      path.join(workerDir, "cover_letter.txt"),
      options.coverLetterText,
    );
    // Write cover letter PDF (duplicate of resume or blank dummy PDF for upload if required)
    fs.writeFileSync(clPdfPath, Buffer.from(options.resumePdfBase64, "base64")); // Fallback to same pdf
  }

  // Generate MCP Config File
  const mcpConfigPath = path.join(workerDir, "mcp-config.json");
  const mcpConfig = {
    mcpServers: {
      playwright: {
        command: "npx",
        args: [
          "-y",
          "@playwright/mcp@latest",
          `--cdp-endpoint=http://localhost:${port}`,
          "--viewport-size=1280,800",
        ],
      },
    },
  };
  fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

  // Build prompt
  const agentPrompt = buildPrompt({
    job: options.job,
    resumeText: options.resumeText,
    coverLetterText: options.coverLetterText,
    pdfPath,
    clPdfPath: options.coverLetterText ? clPdfPath : "",
    profile: profileRes,
    settings,
    dryRun: options.dryRun,
  });

  // Log command args for debugging
  console.log("[Auto-Apply] Spawning Chrome on port:", port);
  onStatusUpdate({
    status: "running",
    action: "Launching isolated browser...",
  });

  // Kill port check first
  killPort(port);

  // Spawning Chrome
  const chromePath = getChromePath();
  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    `--profile-directory=Default`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1024,768",
    "--disable-session-crashed-bubble",
    "--disable-features=InfiniteSessionRestore,PasswordManagerOnboarding",
    "--hide-crash-restore-bubble",
    "--noerrdialogs",
    "--password-store=basic",
    "--disable-save-password-bubble",
    "--disable-popup-blocking",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--deny-permission-prompts",
    "--disable-notifications",
  ];

  activeChromeProc = spawn(chromePath, chromeArgs, {
    detached: true,
    stdio: "ignore",
  });
  activeChromeProc.unref();

  // Give Chrome 2.5 seconds to establish listeners
  await new Promise((r) => setTimeout(r, 2500));

  // 1. Manage proxy sidecar setup and execution if enabled
  if (settings.useOllamaOnly) {
    const proxyDir = getProxyDir();
    const venvDir = getProxyVenvDir(proxyDir);
    const pythonExe = getProxyVenvPython(venvDir);

    // If virtual environment is missing, provision it
    if (!fs.existsSync(pythonExe)) {
      console.log("[Auto-Apply] Proxy server .venv not found. Auto-provisioning...");
      setupProxyVenv(proxyDir, venvDir, onStatusUpdate);
    }

    // Write .env file dynamically
    const envPath = path.join(proxyDir, ".env");
    const bigModel = `ollama/${settings.ollamaModel || 'qwen2.5-coder:7b'}`;
    const smallModel = `ollama/${settings.ollamaModel || 'qwen2.5-coder:7b'}`;

    const envContent = [
      `GROQ_API_KEY=""`,
      `BIG_MODEL="${bigModel}"`,
      `SMALL_MODEL="${smallModel}"`,
      `PORT="8082"`,
      `LOG_LEVEL="WARNING"`,
      `OLLAMA_BASE_URL="${settings.ollamaBaseUrl || 'http://localhost:11434'}"`
    ].join("\n");
    fs.writeFileSync(envPath, envContent, "utf-8");

    // Spawn proxy server
    console.log("[Auto-Apply] Spawning Local Ollama proxy server...");
    onStatusUpdate({
      status: "running",
      action: "Launching Local Ollama proxy server...",
    });

    const scriptPath = path.join(proxyDir, "server.py");
    activeProxyProc = spawn(pythonExe, [scriptPath], {
      cwd: proxyDir,
    });

    activeProxyProc.stdout!.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        onStatusUpdate({
          status: "running",
          log: `[Proxy stdout] ${text}`,
        });
      }
    });

    activeProxyProc.stderr!.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        onStatusUpdate({
          status: "running",
          log: `[Proxy stderr] ${text}`,
        });
      }
    });

    // Wait for the proxy server port (8082) to become active
    const isOpen = await checkPortOpen(8082, "127.0.0.1", 10000); // Wait up to 10 seconds
    if (!isOpen) {
      console.error("[Auto-Apply] Local Ollama proxy server failed to start on port 8082");
      throw new Error("Failed to start Local Ollama proxy server on port 8082 within 10 seconds.");
    }
    console.log("[Auto-Apply] Local Ollama proxy server is active on port 8082");
  }

  console.log("[Auto-Apply] Spawning Claude Code agent subprocess...");
  onStatusUpdate({
    status: "running",
    action: "Connecting Claude Code agent...",
  });

  const capsolverApiKey =
    settings.capsolverApiKey || process.env.CAPSOLVER_API_KEY || "";

  const useProxy = settings.useOllamaOnly;
  const launchCmd = "claude";
  const launchArgs = ["--model", "sonnet"];

  launchArgs.push(
    "-p",
    "--mcp-config",
    mcpConfigPath,
    "--permission-mode",
    "bypassPermissions",
    "--no-session-persistence",
    "--output-format",
    "stream-json",
    "--verbose",
    "-",
  );

  const modelDesc = settings.useOllamaOnly 
    ? `Local Ollama Proxy (${settings.ollamaModel || "qwen2.5-coder:7b"})`
    : "sonnet";

  console.log(`[Auto-Apply] Spawning browser agent using ${launchCmd} with model ${modelDesc}`);

  // Spawn process
  const claudeEnv: any = {
    ...process.env,
    CAPSOLVER_API_KEY: capsolverApiKey,
  };
  if (useProxy) {
    claudeEnv.ANTHROPIC_BASE_URL = "http://localhost:8082";
    claudeEnv.ANTHROPIC_API_KEY = "dummy-key-to-bypass-claude-login";
  }

  activeClaudeProc = spawn(
    launchCmd,
    launchArgs,
    {
      cwd: workerDir,
      env: claudeEnv,
    },
  );

  // Write prompt to stdin and close stdin so claude executes
  activeClaudeProc.stdin!.write(agentPrompt, "utf-8");
  activeClaudeProc.stdin!.end();

  let textAccumulator = "";
  let finalResultStatus:
    | "applied"
    | "expired"
    | "captcha"
    | "login_issue"
    | "failed"
    | "stopped" = "failed";
  let costUSD = 0;

  activeClaudeProc.stdout!.on("data", (data: Buffer) => {
    const rawChunk = data.toString();
    onStatusUpdate({
      status: "running",
      rawLog: rawChunk,
    });

    const lines = rawChunk.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line.trim());
        const msgType = msg.type;

        if (msgType === "assistant") {
          const contentBlocks = msg.message?.content || [];
          for (const block of contentBlocks) {
            if (block.type === "text") {
              textAccumulator += block.text;
              onStatusUpdate({
                status: "running",
                log: block.text,
              });
            } else if (block.type === "tool_use") {
              let name = (block.name || "")
                .replace("mcp__playwright__", "")
                .replace("mcp__gmail__", "gmail:");
              const input = block.input || {};
              let desc = name;
              if (input.url) {
                desc = `${name} to ${input.url.substring(0, 60)}`;
              } else if (input.selector) {
                desc = `${name} [${input.selector.substring(0, 40)}]`;
              } else if (input.fields) {
                desc = `${name} (${Object.keys(input.fields).length} fields)`;
              } else if (input.path || input.paths) {
                desc = `${name} upload`;
              }
              onStatusUpdate({
                status: "running",
                action: desc,
                log: `[Tool Call] Spawning ${name} with inputs: ${JSON.stringify(input)}`,
              });
            }
          }
        } else if (msgType === "result") {
          costUSD += msg.total_cost_usd || msg.usage?.cost_usd || 0;
          if (msg.result) {
            textAccumulator += "\n" + msg.result;
            onStatusUpdate({
              status: "running",
              log: msg.result,
            });
          }
          onStatusUpdate({
            status: "running",
            cost: costUSD,
          });
        } else if (msgType === "progress") {
          if (msg.text) {
            onStatusUpdate({
              status: "running",
              log: `[Claude Progress] ${msg.text}`,
            });
          }
        } else if (msgType === "error") {
          onStatusUpdate({
            status: "running",
            log: `[Claude Error] ${msg.message || msg.text || JSON.stringify(msg)}`,
          });
        } else {
          onStatusUpdate({
            status: "running",
            log: `[Claude Event: ${msgType}] ${JSON.stringify(msg)}`,
          });
        }
      } catch (e) {
        // Fallback if not JSON
        textAccumulator += "\n" + line;
        onStatusUpdate({
          status: "running",
          log: `[Claude stdout] ${line}`,
        });
      }
    }
  });

  activeClaudeProc.stderr!.on("data", (data: Buffer) => {
    const rawChunk = data.toString();
    onStatusUpdate({
      status: "running",
      rawLog: rawChunk,
    });

    const text = rawChunk.trim();
    if (text) {
      onStatusUpdate({
        status: "running",
        log: `[Claude stderr] ${text}`,
      });
    }
  });

  return new Promise((resolve) => {
    activeClaudeProc!.on("close", async (code) => {
      console.log(`[Auto-Apply] Claude process closed with code ${code}`);

      // Stop processes
      await stopApply();

      // Parse final output to classify result
      const output = textAccumulator.toUpperCase();
      let resultMessage = "Unknown execution failure";

      if (output.includes("RESULT:APPLIED")) {
        finalResultStatus = "applied";
        resultMessage = "Applied successfully!";
      } else if (output.includes("RESULT:EXPIRED")) {
        finalResultStatus = "expired";
        resultMessage = "Job post has expired or is closed";
      } else if (output.includes("RESULT:CAPTCHA")) {
        finalResultStatus = "captcha";
        resultMessage = "Blocked by unsolvable CAPTCHA";
      } else if (output.includes("RESULT:LOGIN_ISSUE")) {
        finalResultStatus = "login_issue";
        resultMessage = "Authentication or login wall failure";
      } else if (output.includes("RESULT:FAILED")) {
        finalResultStatus = "failed";
        // Extract reason
        const idx = output.indexOf("RESULT:FAILED:");
        if (idx !== -1) {
          const reasonLine = textAccumulator.substring(idx + 14).split("\n")[0];
          resultMessage = `Failed: ${reasonLine.trim()}`;
        } else {
          resultMessage = "Failed during application form filling";
        }
      } else {
        if (code === 0) {
          finalResultStatus = "applied";
          resultMessage = "Finished execution";
        } else {
          finalResultStatus = "failed";
          resultMessage = `Agent crashed or exited with code ${code}`;
        }
      }

      onStatusUpdate({
        status: finalResultStatus,
        action: resultMessage,
        cost: costUSD,
      });

      resolve({
        success: finalResultStatus === "applied",
        status: finalResultStatus,
        message: resultMessage,
        cost: costUSD,
      });
    });
  });
}
