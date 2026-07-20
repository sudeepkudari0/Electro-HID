import path from 'path';
import fs from 'fs';
import http from 'http';
import { app } from 'electron';
import { spawn, execSync, ChildProcess } from 'child_process';

const NLP_HOST = '127.0.0.1';
const NLP_PORT = 8179;
const SERVER_STARTUP_TIMEOUT_MS = 10_000; // 10s max startup for lightweight spaCy
const HEALTH_POLL_INTERVAL_MS = 250;

function serverLog(...args: any[]) {
    console.log('[spaCy Server Manager]', ...args);
}

export function getNlpDir(): string {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'nlp');
    }
    let basePath = app.getAppPath();
    if (basePath.includes('dist-electron')) {
        basePath = path.join(basePath, '..', '..');
    }
    return path.join(basePath, 'native', 'nlp');
}

export function getNlpVenvDir(): string {
    if (app.isPackaged) {
        return path.join(app.getPath('userData'), 'nlp', 'venv');
    }
    return path.join(getNlpDir(), '.venv');
}

export function getNlpVenvPython(): string {
    const venvDir = getNlpVenvDir();
    return process.platform === 'win32'
        ? path.join(venvDir, 'Scripts', 'python.exe')
        : path.join(venvDir, 'bin', 'python');
}

export function resolveNlpScriptPath(): string {
    return path.join(getNlpDir(), 'server.py');
}

export function findPythonExecutable(): string | null {
    const candidates = process.platform === 'win32'
        ? ['python', 'py', 'python3']
        : ['python3', 'python'];

    for (const cmd of candidates) {
        try {
            const version = execSync(`${cmd} --version 2>&1`, { timeout: 3000 })
                .toString()
                .trim();
            if (version.startsWith('Python 3')) {
                return cmd;
            }
        } catch {
            // continue
        }
    }
    return null;
}

class NlpServerManager {
    private serverProcess: ChildProcess | null = null;
    private isReady = false;
    private isStarting = false;

    public async ensureStarted(): Promise<boolean> {
        if (this.isReady && this.serverProcess) return true;
        if (this.isStarting) return false;

        const scriptPath = resolveNlpScriptPath();
        if (!fs.existsSync(scriptPath)) {
            serverLog(`⚠ spaCy script not found at ${scriptPath}`);
            return false;
        }

        const venvPy = getNlpVenvPython();
        const pythonCmd = fs.existsSync(venvPy) ? venvPy : findPythonExecutable();
        if (!pythonCmd) {
            serverLog('⚠ Python 3 not found on system path or venv');
            return false;
        }

        this.isStarting = true;
        try {
            await this.startServer(pythonCmd, scriptPath);
            this.isReady = true;
            serverLog(`spaCy NLP server ready on http://${NLP_HOST}:${NLP_PORT}`);
            return true;
        } catch (err: any) {
            serverLog(`Failed to start spaCy NLP server: ${err.message}`);
            this.isReady = false;
            return false;
        } finally {
            this.isStarting = false;
        }
    }

    private startServer(pythonCmd: string, scriptPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            serverLog(`Launching: ${pythonCmd} "${scriptPath}" --port ${NLP_PORT}`);
            
            const parts = pythonCmd.split(' ');
            const mainBin = parts[0];
            const binArgs = [...parts.slice(1), scriptPath, '--port', NLP_PORT.toString()];

            const proc = spawn(mainBin, binArgs, {
                cwd: path.dirname(scriptPath),
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: true
            });

            this.serverProcess = proc;

            proc.stderr?.on('data', (chunk: Buffer) => {
                const msg = chunk.toString().trim();
                if (msg) serverLog(`[stderr] ${msg}`);
            });

            proc.stdout?.on('data', (chunk: Buffer) => {
                const msg = chunk.toString().trim();
                if (msg) serverLog(`[stdout] ${msg}`);
            });

            proc.on('error', (err) => {
                serverLog(`Process error: ${err.message}`);
                this.serverProcess = null;
                reject(err);
            });

            proc.on('exit', (code, signal) => {
                serverLog(`Exited (code=${code}, signal=${signal})`);
                if (this.serverProcess === proc) {
                    this.serverProcess = null;
                    this.isReady = false;
                }
            });

            const startTime = Date.now();
            const pollHealth = () => {
                if (Date.now() - startTime > SERVER_STARTUP_TIMEOUT_MS) {
                    this.stopServer();
                    reject(new Error(`Timeout waiting for spaCy NLP server on port ${NLP_PORT}`));
                    return;
                }

                const req = http.get(`http://${NLP_HOST}:${NLP_PORT}/`, { timeout: 800 }, (res) => {
                    res.resume();
                    serverLog(`Server responded to health check in ${Date.now() - startTime}ms`);
                    resolve();
                });

                req.on('error', () => setTimeout(pollHealth, HEALTH_POLL_INTERVAL_MS));
                req.on('timeout', () => {
                    req.destroy();
                    setTimeout(pollHealth, HEALTH_POLL_INTERVAL_MS);
                });
            };

            setTimeout(pollHealth, 300);
        });
    }

    public stopServer(): void {
        if (this.serverProcess) {
            try {
                this.serverProcess.kill('SIGTERM');
                setTimeout(() => {
                    if (this.serverProcess && !this.serverProcess.killed) {
                        this.serverProcess.kill('SIGKILL');
                    }
                }, 1500);
            } catch {
                // ignore
            }
            this.serverProcess = null;
            this.isReady = false;
        }
    }
}

export const nlpServerManager = new NlpServerManager();
