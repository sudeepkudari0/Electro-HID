import { app } from "electron";
import path from "path";
import { exec, execSync } from "child_process";
import fs from "fs";

export interface JobspyOptions {
  query: string;
  location: string;
  sites?: string; // comma separated
  results?: number;
  hours?: number;
  remote?: boolean;
  jobType?: string; // fulltime, parttime, internship, contract
  easyApply?: boolean;
  distance?: number; // miles
  country?: string; // e.g. usa, india, uk
  linkedinFetchDescription?: boolean;
  excludeUrls?: string[];
}

/**
 * Resolve the jobspy native directory.
 * - In development: <project>/native/jobspy
 * - In production:  <resources>/jobspy  (via extraResources)
 */
function getJobspyDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "jobspy");
  }

  let basePath = app.getAppPath();
  if (basePath.includes("dist-electron")) {
    basePath = path.join(basePath, "..", "..");
  }
  return path.join(basePath, "native", "jobspy");
}

/**
 * Resolve the writable directory where virtual environment should be created.
 * - In development: inside <project>/native/jobspy (to keep dev self-contained)
 * - In production:  inside Electron's userData/jobspy (to bypass read-only filesystem restrictions in packages like AppImage)
 */
function getVenvDir(nativeDir: string): string {
  if (app.isPackaged) {
    return path.join(app.getPath("userData"), "jobspy", "venv");
  }
  return path.join(nativeDir, "venv");
}

/**
 * Get the path to the Python binary inside the venv.
 */
function getVenvPython(venvDir: string): string {
  return process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
}

/**
 * Find a working system Python (3.x) on the user's machine.
 */
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

/**
 * Auto-provision the venv and install requirements.
 * Runs synchronously so the caller can await it once and retry.
 */
function setupVenv(nativeDir: string, venvDir: string, onStatusUpdate?: (status: string) => void): void {
  const systemPython = findSystemPython();
  if (!systemPython) {
    throw new Error(
      "Python 3 is not installed on this system. Please install Python 3.9+ and try again.",
    );
  }

  const requirementsPath = path.join(nativeDir, "requirements.txt");
  if (!fs.existsSync(requirementsPath)) {
    throw new Error(
      `JobSpy requirements.txt not found at ${requirementsPath}`,
    );
  }

  const workingDir = path.dirname(venvDir);
  fs.mkdirSync(workingDir, { recursive: true });

  console.log("[JobSpy Setup] Creating venv at:", venvDir, "with:", systemPython);
  onStatusUpdate?.("creating_venv");
  execSync(`${systemPython} -m venv "${venvDir}"`, {
    cwd: workingDir,
    timeout: 60_000,
    stdio: "pipe",
  });

  const pip =
    process.platform === "win32"
      ? path.join(venvDir, "Scripts", "pip")
      : path.join(venvDir, "bin", "pip");

  console.log("[JobSpy Setup] Installing requirements…");
  onStatusUpdate?.("installing_requirements");
  execSync(`"${pip}" install -r "${requirementsPath}"`, {
    cwd: workingDir,
    timeout: 300_000, // 5 min – first install can be slow
    stdio: "pipe",
  });

  console.log("[JobSpy Setup] Done.");
}

export function runJobspySearch(options: JobspyOptions, onStatusUpdate?: (status: string) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    const nativeDir = getJobspyDir();
    const venvDir = getVenvDir(nativeDir);
    const venvBin = getVenvPython(venvDir);
    const scriptPath = path.join(nativeDir, "scraper.py");
    const workingDir = path.dirname(venvDir);
    const sentinelPath = path.join(venvDir, "setup_complete.txt");

    // Auto-setup the venv if it doesn't exist yet or is incomplete
    if (!fs.existsSync(venvBin) || !fs.existsSync(sentinelPath)) {
      console.log(
        "[JobSpy Runner] Venv not found or setup incomplete, auto-provisioning…",
        venvDir,
      );
      try {
        if (fs.existsSync(venvDir)) {
          fs.rmSync(venvDir, { recursive: true, force: true });
        }
        setupVenv(nativeDir, venvDir, onStatusUpdate);
        fs.writeFileSync(sentinelPath, `completed at ${new Date().toISOString()}`);
      } catch (err: any) {
        return reject(
          new Error(
            `Failed to auto-setup JobSpy environment: ${err.message}`,
          ),
        );
      }
    }

    // Final check after potential auto-setup
    if (!fs.existsSync(venvBin)) {
      return reject(
        new Error(
          "JobSpy Python environment not found. Please run the setup script.",
        ),
      );
    }

    onStatusUpdate?.("searching");

    let command = `"${venvBin}" "${scriptPath}" --query "${options.query}" --location "${options.location}"`;
    if (options.sites) command += ` --sites "${options.sites}"`;
    if (options.results) command += ` --results ${options.results}`;
    if (options.hours) command += ` --hours ${options.hours}`;
    if (options.remote) command += ` --remote`;
    if (options.jobType) command += ` --job-type ${options.jobType}`;
    if (options.easyApply) command += ` --easy-apply`;
    if (options.distance) command += ` --distance ${options.distance}`;
    if (options.country) command += ` --country "${options.country}"`;
    if (options.linkedinFetchDescription) command += ` --linkedin-fetch-description`;
    if (options.excludeUrls && options.excludeUrls.length > 0) {
      // join with comma and pass
      command += ` --exclude-urls "${options.excludeUrls.join(',')}"`;
    }

    console.log("[JobSpy Runner] Executing:", command);

    // Increase maxBuffer to 50MB because JSON output can be large
    exec(
      command,
      { maxBuffer: 1024 * 1024 * 50, cwd: workingDir },
      (error, stdout, stderr) => {
        if (error) {
          console.error("[JobSpy Runner] Error:", stderr || error.message);
          return reject(new Error(stderr || error.message));
        }
        try {
          const result = JSON.parse(stdout);
          if (!result.success) {
            return reject(new Error(result.error));
          }
          resolve(result.data);
        } catch (e) {
          console.error("[JobSpy Runner] Failed to parse JSON:", stdout);
          reject(new Error("Invalid output from JobSpy script"));
        }
      },
    );
  });
}

export function checkJobspySetup(): { pythonAvailable: boolean; venvReady: boolean } {
  const nativeDir = getJobspyDir();
  const venvDir = getVenvDir(nativeDir);
  const venvBin = getVenvPython(venvDir);
  const sentinelPath = path.join(venvDir, "setup_complete.txt");

  const pythonAvailable = findSystemPython() !== null;
  const venvReady = fs.existsSync(venvBin) && fs.existsSync(sentinelPath);

  return { pythonAvailable, venvReady };
}
