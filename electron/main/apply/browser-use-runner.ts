import { app } from "electron";
import path from "path";
import fs from "fs";
import { spawn, execSync, ChildProcess } from "child_process";
import { getSettings } from "../settings";

let activeApplyProc: ChildProcess | null = null;
let activeLoginProc: ChildProcess | null = null;

function buildLlmConfig(): { model: string; apiKey: string; baseUrl?: string } {
  const settings = getSettings();
  const applyProvider = settings.applyLlmProvider || 'openai';
  
  let llmConfig = {
    model: settings.applyModel || settings.openaiModel || "gpt-4o",
    apiKey: settings.openaiApiKey || "",
    baseUrl: settings.openaiBaseUrl || ""
  };

  if (applyProvider === 'gemini') {
    llmConfig = {
      model: settings.applyModel || settings.geminiModel || "gemini-2.0-flash",
      apiKey: settings.geminiApiKey || "",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai"
    };
  } else if (applyProvider === 'groq') {
    llmConfig = {
      model: settings.applyModel || settings.groqModel || "llama-3.3-70b-versatile",
      apiKey: settings.groqApiKey || "",
      baseUrl: "https://api.groq.com/openai/v1"
    };
  } else if (applyProvider === 'mistral') {
    llmConfig = {
      model: settings.applyModel || settings.mistralModel || "mistral-large-latest",
      apiKey: settings.mistralApiKey || "",
      baseUrl: "https://api.mistral.ai/v1"
    };
  } else if (applyProvider === 'ollama') {
    llmConfig = {
      model: settings.applyModel || settings.ollamaModel || "qwen3-vl:2b",
      apiKey: "ollama",
      baseUrl: settings.ollamaBaseUrl
    };
  }
  return llmConfig;
}


export function getApplyDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "browser-use-apply");
  }

  let basePath = app.getAppPath();
  if (basePath.includes("dist-electron")) {
    basePath = path.join(basePath, "..", "..");
  }
  return path.join(basePath, "native", "browser-use-apply");
}

export function getVenvDir(nativeDir: string): string {
  if (app.isPackaged) {
    return path.join(app.getPath("userData"), "browser-use-apply", "venv");
  }
  return path.join(nativeDir, "venv");
}

export function getVenvPython(venvDir: string): string {
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

export function setupApplyVenv(
  nativeDir: string,
  venvDir: string,
  onStatusUpdate?: (status: any) => void
): void {
  const systemPython = findSystemPython();
  if (!systemPython) {
    throw new Error(
      "Python 3 is not installed on this system. Please install Python 3.9+ and try again."
    );
  }

  const requirementsPath = path.join(nativeDir, "requirements.txt");
  if (!fs.existsSync(requirementsPath)) {
    throw new Error(`browser-use-apply requirements.txt not found at ${requirementsPath}`);
  }

  const workingDir = path.dirname(venvDir);
  fs.mkdirSync(workingDir, { recursive: true });

  console.log("[Apply Setup] Creating venv at:", venvDir, "with:", systemPython);
  onStatusUpdate?.({
    status: "running",
    action: "Creating Python virtual environment for browser-use...",
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

  console.log("[Apply Setup] Installing requirements...");
  onStatusUpdate?.({
    status: "running",
    action: "Installing Python dependencies (browser-use, etc.)...",
  });
  execSync(`"${pip}" install -r "${requirementsPath}"`, {
    cwd: workingDir,
    timeout: 300_000,
    stdio: "pipe",
  });

  const playwrightBin =
    process.platform === "win32"
      ? path.join(venvDir, "Scripts", "playwright")
      : path.join(venvDir, "bin", "playwright");

  console.log("[Apply Setup] Installing Playwright Chromium browser...");
  onStatusUpdate?.({
    status: "running",
    action: "Installing Playwright browser binaries...",
  });
  execSync(`"${playwrightBin}" install chromium`, {
    cwd: workingDir,
    timeout: 300_000,
    stdio: "pipe",
  });

  // Also install patchright's patched Chromium (for undetected automation)
  const patchrightBin =
    process.platform === "win32"
      ? path.join(venvDir, "Scripts", "patchright")
      : path.join(venvDir, "bin", "patchright");

  if (fs.existsSync(patchrightBin)) {
    console.log("[Apply Setup] Installing Patchright Chromium browser...");
    onStatusUpdate?.({
      status: "running",
      action: "Installing Patchright (stealth) browser binaries...",
    });
    try {
      execSync(`"${patchrightBin}" install chromium`, {
        cwd: workingDir,
        timeout: 300_000,
        stdio: "pipe",
      });
    } catch (e) {
      console.warn("[Apply Setup] Patchright install warning (non-fatal):", e);
    }
  }

  console.log("[Apply Setup] Done.");
}

function ensureVenvComplete(onStatusUpdate?: (status: any) => void): string {
  const nativeDir = getApplyDir();
  const venvDir = getVenvDir(nativeDir);
  const venvBin = getVenvPython(venvDir);
  const sentinelPath = path.join(venvDir, "setup_complete.txt");

  if (!fs.existsSync(venvBin) || !fs.existsSync(sentinelPath)) {
    console.log("[Apply Runner] Venv not found or setup incomplete, auto-provisioning...", venvDir);
    if (fs.existsSync(venvDir)) {
      fs.rmSync(venvDir, { recursive: true, force: true });
    }
    setupApplyVenv(nativeDir, venvDir, onStatusUpdate);
    fs.writeFileSync(sentinelPath, `completed at ${new Date().toISOString()}`);
  }

  return venvBin;
}

function writeBase64ToTempFile(base64Str: string, filename: string): string {
  const tempPath = path.join(app.getPath("temp"), filename);
  fs.writeFileSync(tempPath, Buffer.from(base64Str, "base64"));
  return tempPath;
}

export function runApply(
  options: any,
  onStatusUpdate: (data: any) => void
): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const venvBin = ensureVenvComplete(onStatusUpdate);
      const nativeDir = getApplyDir();
      const scriptPath = path.join(nativeDir, "main.py");
      
      // Setup browser profile folders under App UserData
      const userProfileBaseDir = path.join(app.getPath("userData"), "careerHub", "browser-profiles");
      const linkedinProfileDir = path.join(userProfileBaseDir, "linkedin");
      const defaultProfileDir = path.join(userProfileBaseDir, "apply-default");
      
      fs.mkdirSync(linkedinProfileDir, { recursive: true });
      fs.mkdirSync(defaultProfileDir, { recursive: true });

      // Clean/write temp PDF resume files
      let globalResumePath = "";
      if (options.resumePdfBase64) {
        globalResumePath = writeBase64ToTempFile(options.resumePdfBase64, "global-resume.pdf");
      }

      const inputJobs = options.jobs || [options.job];
      const processedJobs = inputJobs.map((job: any) => {
        let jobResumePath = "";
        if (job.resumePdfBase64) {
          jobResumePath = writeBase64ToTempFile(job.resumePdfBase64, `resume-${job.id}.pdf`);
        }
        return {
          id: job.id,
          url: job.url,
          title: job.title,
          company: job.company,
          salary: job.salary,
          coverLetterText: job.coverLetterText || "",
          resumePdfPath: jobResumePath || globalResumePath
        };
      });

      const settings = getSettings();
      const llmConfig = buildLlmConfig();

      const dbPath = path.join(app.getPath("userData"), "careerHub", "career_hub.db");

      // Build payload JSON
      const payload = {
        jobs: processedJobs,
        resumePdfPath: globalResumePath,
        coverLetterText: options.coverLetterText || "",
        dryRun: options.dryRun !== false, // Default to true
        headless: settings.headlessApply === true,
        browserProfileDirs: {
          linkedin: linkedinProfileDir,
          default: defaultProfileDir
        },
        candidateProfile: options.profile || {},
        llm: llmConfig,
        dbPath: dbPath
      };

      const payloadPath = path.join(app.getPath("userData"), "temp-apply-payload.json");
      fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2), "utf-8");

      console.log("[Apply Runner] Spawning main.py with payload:", payloadPath);
      activeApplyProc = spawn(venvBin, [scriptPath, "--payload", payloadPath], {
        cwd: nativeDir,
      });

      activeApplyProc.stdout!.on("data", (data: Buffer) => {
        const text = data.toString();
        const lines = text.split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line.trim());
            onStatusUpdate(parsed);
          } catch (e) {
            // Forward raw log fallback
            onStatusUpdate({
              type: "log",
              message: line.trim()
            });
          }
        }
      });

      activeApplyProc.stderr!.on("data", (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          onStatusUpdate({
            type: "log",
            message: `[stderr] ${text}`
          });
        }
      });

      activeApplyProc.on("close", (code) => {
        activeApplyProc = null;
        try {
          if (fs.existsSync(payloadPath)) {
            fs.unlinkSync(payloadPath);
          }
        } catch (err) {
          // ignore
        }
        
        console.log(`[Apply Runner] Child process exited with code ${code}`);
        resolve({ success: code === 0, code });
      });

      activeApplyProc.on("error", (err) => {
        activeApplyProc = null;
        reject(err);
      });

    } catch (err) {
      reject(err);
    }
  });
}

export function stopApply(): Promise<any> {
  return new Promise((resolve) => {
    if (activeApplyProc) {
      console.log("[Apply Runner] Terminating active apply process...");
      activeApplyProc.kill("SIGINT");
      activeApplyProc = null;
    }
    resolve({ success: true });
  });
}

export function approveApply(): Promise<any> {
  return new Promise((resolve) => {
    if (activeApplyProc && activeApplyProc.stdin) {
      console.log("[Apply Runner] Sending approval to active process stdin...");
      activeApplyProc.stdin.write("approve\n");
    }
    resolve({ success: true });
  });
}

export function runLogin(
  site: "linkedin" | "default" | "wellfound",
  onStatusUpdate: (data: any) => void
): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const venvBin = ensureVenvComplete(onStatusUpdate);
      const nativeDir = getApplyDir();
      const scriptPath = path.join(nativeDir, "session_login.py");

      const userProfileBaseDir = path.join(app.getPath("userData"), "careerHub", "browser-profiles");
      const profileDirName = site === "linkedin" ? "linkedin"
        : site === "wellfound" ? "wellfound"
        : "apply-default";
      const profileDir = path.join(userProfileBaseDir, profileDirName);
      fs.mkdirSync(profileDir, { recursive: true });

      // Load career profile and LLM config for the manual session
      const { JSONStore } = require("../storage/store");
      const store = new JSONStore("career-hub");
      const profile = store.read("career-profile.json") || {};
      const llmConfig = buildLlmConfig();

      // Write temp payload file
      const payloadPath = path.join(app.getPath("userData"), "temp-manual-autofill-payload.json");
      fs.writeFileSync(payloadPath, JSON.stringify({
        jobs: [],
        profile: profile,
        llm: llmConfig
      }, null, 2));

      console.log(`[Apply Runner] Launching manual login for ${site} in:`, profileDir);
      activeLoginProc = spawn(venvBin, [
        scriptPath, 
        "--site", site, 
        "--user-data-dir", profileDir,
        "--jobs-file", payloadPath
      ], {
        cwd: nativeDir,
      });

      activeLoginProc.stdout!.on("data", (data: Buffer) => {
        const text = data.toString();
        console.log(`[Python Login Stdout] ${text.trim()}`);
        const lines = text.split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line.trim());
            onStatusUpdate(parsed);
          } catch (e) {
            onStatusUpdate({
              type: "log",
              message: line.trim()
            });
          }
        }
      });

      activeLoginProc.stderr!.on("data", (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          console.error(`[Python Login Stderr] ${text}`);
          onStatusUpdate({
            type: "log",
            message: `[stderr] ${text}`
          });
        }
      });

      activeLoginProc.on("close", (code) => {
        activeLoginProc = null;
        try {
          if (fs.existsSync(payloadPath)) {
            fs.unlinkSync(payloadPath);
          }
        } catch (e) {
          // ignore
        }
        console.log(`[Apply Runner] Login process exited with code ${code}`);
        resolve({ success: code === 0, code });
      });

      activeLoginProc.on("error", (err) => {
        activeLoginProc = null;
        try {
          if (fs.existsSync(payloadPath)) {
            fs.unlinkSync(payloadPath);
          }
        } catch (e) {
          // ignore
        }
        reject(err);
      });

    } catch (err) {
      reject(err);
    }
  });
}

export function stopLogin(): Promise<any> {
  return new Promise((resolve) => {
    if (activeLoginProc) {
      console.log("[Apply Runner] Gracefully stopping login process via stdin...");
      if (activeLoginProc.stdin && activeLoginProc.stdin.writable) {
        try {
          activeLoginProc.stdin.write(JSON.stringify({ action: "close" }) + "\n");
        } catch (e) {
          console.error("[Apply Runner] Failed to write close command to stdin:", e);
        }
      }
      
      const proc = activeLoginProc;
      activeLoginProc = null;
      
      // Give it 1.5 seconds to exit gracefully, otherwise kill it
      setTimeout(() => {
        try {
          if (proc && proc.exitCode === null) {
            console.log("[Apply Runner] Graceful shutdown timed out. Force killing process...");
            proc.kill("SIGKILL");
          }
        } catch (e) {
          // ignore
        }
      }, 1500);
    }
    resolve({ success: true });
  });
}

export function autofillCurrentPage(options: any): Promise<any> {
  return new Promise((resolve) => {
    if (activeLoginProc && activeLoginProc.stdin) {
      console.log("[Apply Runner] Preparing autofill resume...");
      const candidateName = options.profile?.fullName || "Candidate";
      const cleanResumeName = `${candidateName.replace(/\s+/g, "")}_Resume.pdf`;
      const singleTempDir = path.join(app.getPath("temp"), "career-hub", "single-autofill");
      fs.mkdirSync(singleTempDir, { recursive: true });
      const resumePath = path.join(singleTempDir, cleanResumeName);
      if (options.resumePdfBase64) {
        fs.writeFileSync(resumePath, Buffer.from(options.resumePdfBase64, 'base64'));
      }

      const llmConfig = buildLlmConfig();
      
      const payload = {
        action: "autofill",
        job: options.job,
        profile: options.profile,
        resume_path: resumePath,
        llm: llmConfig
      };
      
      console.log("[Apply Runner] Sending autofill command to active login process stdin...");
      activeLoginProc.stdin.write(JSON.stringify(payload) + "\n");
      resolve({ success: true });
    } else {
      resolve({ success: false, error: "No active browser session open. Click 'Open Browser' or 'Login' to start a session first." });
    }
  });
}

export function runAutofillSession(
  options: { jobs: any[]; profile: any },
  onStatusUpdate: (data: any) => void
): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const venvBin = ensureVenvComplete(onStatusUpdate);
      const nativeDir = getApplyDir();
      const scriptPath = path.join(nativeDir, "session_login.py");

      const userProfileBaseDir = path.join(app.getPath("userData"), "careerHub", "browser-profiles");
      
      // Process jobs and write temporary resumes
      const processedJobs: any[] = [];
      const candidateName = options.profile?.fullName || "Candidate";
      const cleanResumeName = `${candidateName.replace(/\s+/g, "")}_Resume.pdf`;

      for (const job of options.jobs) {
        // Create a separate temp directory for each job to avoid file locks and namespace collisions
        const jobTempDir = path.join(app.getPath("temp"), "career-hub", job.id);
        fs.mkdirSync(jobTempDir, { recursive: true });
        
        const resumePath = path.join(jobTempDir, cleanResumeName);
        if (job.resumePdfBase64) {
          fs.writeFileSync(resumePath, Buffer.from(job.resumePdfBase64, 'base64'));
        }
        processedJobs.push({
          id: job.id,
          url: job.url,
          title: job.title,
          company: job.company,
          coverLetterText: job.coverLetterText,
          resumePath: resumePath
        });
      }

      const hasLinkedInJob = processedJobs.some(j => j.url && j.url.includes("linkedin.com"));
      const profileDirName = hasLinkedInJob ? "linkedin" : "apply-default";
      const profileDir = path.join(userProfileBaseDir, profileDirName);
      fs.mkdirSync(profileDir, { recursive: true });

      const llmConfig = buildLlmConfig();

      // Write temp payload file
      const payloadPath = path.join(app.getPath("userData"), "temp-autofill-payload.json");
      fs.writeFileSync(payloadPath, JSON.stringify({
        jobs: processedJobs,
        profile: options.profile,
        llm: llmConfig
      }, null, 2));

      console.log(`[Apply Runner] Launching autofill browser session for ${processedJobs.length} jobs with profile: ${profileDirName}`);
      activeLoginProc = spawn(venvBin, [
        scriptPath,
        "--site", hasLinkedInJob ? "linkedin" : "default",
        "--user-data-dir", profileDir,
        "--jobs-file", payloadPath
      ], {
        cwd: nativeDir,
      });

      activeLoginProc.stdout!.on("data", (data: Buffer) => {
        const text = data.toString();
        console.log(`[Python Autofill Session Stdout] ${text.trim()}`);
        const lines = text.split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line.trim());
            onStatusUpdate(parsed);
          } catch (e) {
            onStatusUpdate({
              type: "log",
              message: line.trim()
            });
          }
        }
      });

      activeLoginProc.stderr!.on("data", (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          console.error(`[Python Autofill Session Stderr] ${text}`);
          onStatusUpdate({
            type: "log",
            message: `[stderr] ${text}`
          });
        }
      });

      activeLoginProc.on("close", (code) => {
        activeLoginProc = null;
        try {
          if (fs.existsSync(payloadPath)) {
            fs.unlinkSync(payloadPath);
          }
          // Clean up job temp directories
          for (const job of processedJobs) {
            const jobTempDir = path.dirname(job.resumePath);
            if (fs.existsSync(jobTempDir)) {
              fs.rmSync(jobTempDir, { recursive: true, force: true });
            }
          }
          // Clean up single autofill temp dir
          const singleTempDir = path.join(app.getPath("temp"), "career-hub", "single-autofill");
          if (fs.existsSync(singleTempDir)) {
            fs.rmSync(singleTempDir, { recursive: true, force: true });
          }
        } catch (err) {
          // ignore
        }
        console.log(`[Apply Runner] Autofill browser process exited with code ${code}`);
        resolve({ success: code === 0, code });
      });

      activeLoginProc.on("error", (err) => {
        activeLoginProc = null;
        reject(err);
      });

    } catch (err) {
      reject(err);
    }
  });
}

export function checkLoginStatus(
  site: "linkedin" | "default" | "wellfound"
): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const nativeDir = getApplyDir();
      const venvDir = getVenvDir(nativeDir);
      const venvBin = getVenvPython(venvDir);
      
      // If venv doesn't exist, we aren't configured yet
      if (!fs.existsSync(venvBin)) {
        return resolve({ success: true, loggedIn: false });
      }

      const scriptPath = path.join(nativeDir, "session_login.py");

      const userProfileBaseDir = path.join(app.getPath("userData"), "careerHub", "browser-profiles");
      const profileDirName = site === "linkedin" ? "linkedin"
        : site === "wellfound" ? "wellfound"
        : "apply-default";
      const profileDir = path.join(userProfileBaseDir, profileDirName);
      
      if (!fs.existsSync(profileDir)) {
        return resolve({ success: true, loggedIn: false });
      }

      console.log(`[Apply Runner] Checking login status for ${site} in:`, profileDir);
      const proc = spawn(venvBin, [scriptPath, "--site", site, "--user-data-dir", profileDir, "--check"], {
        cwd: nativeDir,
      });

      let stdoutData = "";
      proc.stdout!.on("data", (data: Buffer) => {
        stdoutData += data.toString();
      });

      proc.on("close", (code) => {
        try {
          const lines = stdoutData.split("\n");
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line.trim());
              if (parsed && typeof parsed.loggedIn !== "undefined") {
                return resolve(parsed);
              }
            } catch (e) {
              // Not a JSON line, ignore
            }
          }
          resolve({ success: false, error: "No structured login status output" });
        } catch (e) {
          resolve({ success: false, error: String(e) });
        }
      });

      proc.on("error", (err) => {
        reject(err);
      });

    } catch (err) {
      reject(err);
    }
  });
}

let activeWellfoundProc: import("child_process").ChildProcess | null = null;

export function runWellfoundApply(
  options: {
    profile: any;
    filters: {
      role?: string;
      location?: string;
      jobType?: string;
      remote?: boolean;
      maxJobs?: number;
    };
    dryRun?: boolean;
    onStatusUpdate: (data: any) => void;
  },
  onStatusUpdate: (data: any) => void
): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const venvBin = ensureVenvComplete(onStatusUpdate);
      const nativeDir = getApplyDir();
      const scriptPath = path.join(nativeDir, "wellfound_apply.py");

      if (!fs.existsSync(scriptPath)) {
        return reject(new Error(`wellfound_apply.py not found at: ${scriptPath}`));
      }

      const userProfileBaseDir = path.join(app.getPath("userData"), "careerHub", "browser-profiles");
      const profileDir = path.join(userProfileBaseDir, "wellfound");
      fs.mkdirSync(profileDir, { recursive: true });

      const llmConfig = buildLlmConfig();

      const payload = {
        profile: options.profile || {},
        filters: options.filters || {},
        llm: llmConfig,
        dryRun: options.dryRun !== false,
        profileDir,
      };

      const payloadPath = path.join(app.getPath("userData"), "temp-wellfound-payload.json");
      fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2), "utf-8");

      console.log("[Wellfound Runner] Spawning wellfound_apply.py");
      activeWellfoundProc = spawn(venvBin, [scriptPath, "--payload", payloadPath], {
        cwd: nativeDir,
      });

      activeWellfoundProc.stdout!.on("data", (data: Buffer) => {
        const text = data.toString();
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          try {
            onStatusUpdate(JSON.parse(line.trim()));
          } catch {
            onStatusUpdate({ type: "log", message: line.trim() });
          }
        }
      });

      activeWellfoundProc.stderr!.on("data", (data: Buffer) => {
        const text = data.toString().trim();
        if (text) onStatusUpdate({ type: "log", message: `[stderr] ${text}` });
      });

      activeWellfoundProc.on("close", (code) => {
        activeWellfoundProc = null;
        try { if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath); } catch {}
        resolve({ success: code === 0, code });
      });

      activeWellfoundProc.on("error", (err) => {
        activeWellfoundProc = null;
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

export function stopWellfoundApply(): Promise<any> {
  return new Promise((resolve) => {
    if (activeWellfoundProc) {
      activeWellfoundProc.kill("SIGINT");
      activeWellfoundProc = null;
    }
    resolve({ success: true });
  });
}

