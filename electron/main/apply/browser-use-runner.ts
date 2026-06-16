import { app } from "electron";
import path from "path";
import fs from "fs";
import { spawn, execSync, ChildProcess } from "child_process";
import { getSettings } from "../settings";

let activeApplyProc: ChildProcess | null = null;
let activeLoginProc: ChildProcess | null = null;

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

      // Build payload JSON
      const settings = getSettings();
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
        llm: {
          model: settings.openaiModel || "gpt-4o",
          apiKey: settings.openaiApiKey || "",
          baseUrl: settings.openaiBaseUrl || ""
        }
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

export function runLogin(
  site: "linkedin" | "default",
  onStatusUpdate: (data: any) => void
): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const venvBin = ensureVenvComplete(onStatusUpdate);
      const nativeDir = getApplyDir();
      const scriptPath = path.join(nativeDir, "session_login.py");

      const userProfileBaseDir = path.join(app.getPath("userData"), "careerHub", "browser-profiles");
      const profileDir = path.join(userProfileBaseDir, site === "linkedin" ? "linkedin" : "apply-default");
      fs.mkdirSync(profileDir, { recursive: true });

      console.log(`[Apply Runner] Launching manual login for ${site} in:`, profileDir);
      activeLoginProc = spawn(venvBin, [scriptPath, "--site", site, "--user-data-dir", profileDir], {
        cwd: nativeDir,
      });

      activeLoginProc.stdout!.on("data", (data: Buffer) => {
        const text = data.toString();
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
          onStatusUpdate({
            type: "log",
            message: `[stderr] ${text}`
          });
        }
      });

      activeLoginProc.on("close", (code) => {
        activeLoginProc = null;
        console.log(`[Apply Runner] Login process exited with code ${code}`);
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

export function stopLogin(): Promise<any> {
  return new Promise((resolve) => {
    if (activeLoginProc) {
      console.log("[Apply Runner] Terminating login process...");
      activeLoginProc.kill("SIGINT");
      activeLoginProc = null;
    }
    resolve({ success: true });
  });
}
