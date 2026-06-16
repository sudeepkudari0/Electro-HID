/**
 * Apply Panel — Auto-Apply Dashboard
 * Orchestrates autonomous applications via browser-use.
 */

import { useState, useEffect, useRef } from "react";
import { useJobStore, useTailoringStore } from "../../career/state/career-store";
import { generateResumePDFBlob } from "../../career/core/pdfGenerator";
import {
  Building2,
  MapPin,
  Sparkles,
  Play,
  Terminal,
  StopCircle,
  KeyRound,
  FileText,
  ShieldCheck,
  CheckSquare,
  Square,
  Settings,
  ExternalLink,
  Linkedin,
  CheckCircle2,
  Loader2
} from "lucide-react";

interface StatusLog {
  timestamp: string;
  text: string;
}

export function ApplyPanel() {
  const { jobs, updateJob } = useJobStore();
  const { masterResume } = useTailoringStore();

  const [settings, setSettings] = useState<any>(null);
  const [capsolverKey, setCapsolverKey] = useState("");
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [headless, setHeadless] = useState(false);
  const [dryRunGlobal, setDryRunGlobal] = useState(true);

  // Filter for jobs that have tailoredResumeText and are in saved state
  const readyJobs = jobs.filter(
    (j) => j.status === "saved" && j.tailoredResumeText
  );

  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<
    "idle" | "running" | "applied" | "expired" | "captcha" | "login_issue" | "failed" | "stopped" | "done"
  >("idle");
  const [currentStep, setCurrentStep] = useState("");
  const [logs, setLogs] = useState<StatusLog[]>([]);
  const [rawLogs, setRawLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"monitor" | "raw">("monitor");
  const [copiedLogs, setCopiedLogs] = useState(false);

  const consoleEndRef = useRef<HTMLDivElement>(null);

  // Auto select all ready jobs by default on mount or when queue changes
  useEffect(() => {
    if (readyJobs.length > 0 && selectedJobIds.length === 0) {
      setSelectedJobIds(readyJobs.map((j) => j.id));
    }
  }, [jobs]);

  // Load app settings
  useEffect(() => {
    (async () => {
      try {
        const res = await (window as any).electronAPI?.getSettings?.();
        if (res?.success && res.settings) {
          setSettings(res.settings);
          setCapsolverKey(res.settings.capsolverApiKey || "");
          setHeadless(res.settings.headlessApply || false);
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
    })();
  }, []);

  // Set up status event listener for auto-apply streams
  useEffect(() => {
    if (!(window as any).electronAPI?.careerHub?.onApplyStatus) return;

    const unsubscribe = (window as any).electronAPI.careerHub.onApplyStatus(
      (eventData: any) => {
        // Handle structured JSON status output
        if (eventData.type === "status") {
          if (eventData.status) {
            setAgentStatus(eventData.status);
          }
          if (eventData.jobId) {
            setActiveJobId(eventData.jobId);
          }
          if (eventData.action) {
            setCurrentStep(eventData.action);
            appendLog(`[STEP] ${eventData.action}`);
          }
        } else if (eventData.type === "log") {
          appendLog(eventData.message);
        } else if (eventData.type === "result") {
          const { jobId, status, message } = eventData;
          // Map to correct display status
          if (status === "applied") {
            updateJob(jobId, {
              status: "applied",
              appliedAt: new Date().toISOString(),
            });
            appendLog(`[SUCCESS] Job ID ${jobId} applied successfully!`);
          } else if (status === "failed") {
            updateJob(jobId, { status: "saved" }); // revert status so user can retry
            appendLog(`[FAILED] Job ID ${jobId} failed: ${message}`);
          } else {
            appendLog(`[SYSTEM] Job ID ${jobId} finished with: ${status.toUpperCase()} - ${message}`);
          }
        } else if (eventData.type === "login_status") {
          appendLog(`[LOGIN] ${eventData.message}`);
        } else {
          // Fallback to legacy format
          if (eventData.status) {
            setAgentStatus(eventData.status as any);
          }
          if (eventData.action) {
            setCurrentStep(eventData.action);
            appendLog(`[STEP] ${eventData.action}`);
          }
          if (eventData.log) {
            appendLog(eventData.log);
          }
          if (eventData.rawLog) {
            setRawLogs((prev) => [...prev, eventData.rawLog!]);
          }
        }
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  // Scroll to bottom of logs on update
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, rawLogs, activeTab]);

  const appendLog = (text: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { timestamp, text }]);
  };

  const handleSaveKey = async () => {
    if (!settings) return;
    setIsSavingKey(true);
    try {
      const updated = await (window as any).electronAPI?.updateSettings?.({
        ...settings,
        capsolverApiKey: capsolverKey,
      });
      if (updated?.success) {
        setSettings(updated.settings);
        appendLog(`[SYSTEM] CapSolver API key updated.`);
      }
    } catch (e) {
      console.error(e);
      appendLog(`[SYSTEM] Error updating CapSolver key.`);
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleToggleHeadless = async (checked: boolean) => {
    setHeadless(checked);
    if (!settings) return;
    try {
      const updated = await (window as any).electronAPI?.updateSettings?.({
        ...settings,
        headlessApply: checked,
      });
      if (updated?.success) {
        setSettings(updated.settings);
        appendLog(`[SYSTEM] Headless mode set to: ${checked}`);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const toggleSelectJob = (id: string) => {
    setSelectedJobIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedJobIds.length === readyJobs.length) {
      setSelectedJobIds([]);
    } else {
      setSelectedJobIds(readyJobs.map((j) => j.id));
    }
  };

  const handleCopyLogs = () => {
    const textToCopy = activeTab === "monitor"
      ? logs.map(l => `[${l.timestamp}] ${l.text}`).join("\n")
      : rawLogs.join("\n");
    navigator.clipboard.writeText(textToCopy);
    setCopiedLogs(true);
    setTimeout(() => setCopiedLogs(false), 2000);
  };

  const startQueue = async (dryRun = true) => {
    if (!masterResume) {
      alert("Please upload your master resume in the Tailor CV tab first.");
      return;
    }

    const jobsToRun = readyJobs.filter((j) => selectedJobIds.includes(j.id));
    if (jobsToRun.length === 0) {
      alert("No jobs selected in the queue to run.");
      return;
    }

    setActiveJobId("queue");
    setAgentStatus("running");
    setCurrentStep("Compiling resume PDFs for the queue...");
    setLogs([]);
    setRawLogs([]);

    appendLog(`[SYSTEM] Compiling resume PDFs for ${jobsToRun.length} selected jobs...`);

    try {
      const compiledJobs = [];
      for (const job of jobsToRun) {
        appendLog(`[SYSTEM] Compiling resume PDF for ${job.company}...`);
        const blob = await generateResumePDFBlob(
          job.tailoredResumeText || "",
          masterResume
        );
        
        const base64data = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.readAsDataURL(blob);
          reader.onloadend = () => {
            const base64 = (reader.result as string).split(",")[1];
            resolve(base64);
          };
        });

        compiledJobs.push({
          id: job.id,
          url: job.url,
          title: job.title,
          company: job.company,
          salary: job.salary,
          coverLetterText: job.coverLetterText || "",
          resumePdfBase64: base64data
        });
      }

      appendLog(`[SYSTEM] All resumes compiled. Starting queue execution...`);
      setCurrentStep("Executing queue runner...");

      // Fetch profile state to supply candidate details to the agent
      const profileRes = await (window as any).electronAPI.profile.load();
      const candidateProfile = profileRes?.success ? profileRes.profile : {};

      const res = await (window as any).electronAPI.careerHub.runApply({
        jobs: compiledJobs,
        profile: candidateProfile,
        dryRun,
      });

      if (res?.success) {
        appendLog(`[SYSTEM] Queue runner completed.`);
        setAgentStatus("idle");
        setCurrentStep("Queue completed successfully");
      } else {
        setAgentStatus("failed");
        setCurrentStep(res?.error || "Queue execution failed");
        appendLog(`[SYSTEM] Queue execution error: ${res?.error || "Execution failed"}`);
      }
    } catch (err: any) {
      console.error(err);
      setAgentStatus("failed");
      setCurrentStep(err.message || "Failed starting queue runner");
      appendLog(`[SYSTEM] Error: ${err.message || "Failed starting queue runner"}`);
    } finally {
      setActiveJobId(null);
    }
  };

  const handleRunLogin = async (site: "linkedin" | "default") => {
    setLogs([]);
    setRawLogs([]);
    appendLog(`[SYSTEM] Starting manual login session for ${site.toUpperCase()}...`);
    appendLog(`[SYSTEM] A browser window will open. Complete login manually and then close or exit the session.`);
    setCurrentStep(`Authenticating ${site.toUpperCase()}...`);
    setAgentStatus("running");
    
    try {
      const res = await (window as any).electronAPI.careerHub.runLogin(site);
      if (res?.success) {
        appendLog(`[SYSTEM] Manual login process finished.`);
        setCurrentStep("Login session finished");
      } else {
        appendLog(`[SYSTEM] Manual login closed or failed.`);
        setCurrentStep("Login closed");
      }
    } catch (err: any) {
      appendLog(`[SYSTEM] Error during login: ${err.message}`);
    } finally {
      setAgentStatus("idle");
    }
  };

  const handleStopAgent = async () => {
    appendLog("[SYSTEM] Stopping active process...");
    try {
      await (window as any).electronAPI.careerHub.stopApply();
      await (window as any).electronAPI.careerHub.stopLogin();
      setAgentStatus("stopped");
      setCurrentStep("Stopped by user");
      appendLog("[SYSTEM] Process terminated successfully.");
    } catch (e) {
      console.error(e);
      appendLog("[SYSTEM] Failed to stop process cleanly.");
    }
  };

  return (
    <div className="apply-panel space-y-6">
      {/* Persistent Session Authentication Section */}
      <div className="bg-[#12121e]/80 border border-white/5 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
            <ShieldCheck className="w-5.5 h-5.5" />
          </div>
          <div>
            <h3 className="font-semibold text-white text-base">Persistent Browser Profiles</h3>
            <p className="text-xs text-slate-400">
              Pre-authenticate to ensure smooth background runs on LinkedIn and company sites.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          {/* LinkedIn Login Card */}
          <div className="bg-slate-900/50 border border-white/5 rounded-xl p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
                <Linkedin className="w-5 h-5" />
              </div>
              <div>
                <p className="font-semibold text-sm text-slate-200">LinkedIn Session</p>
                <p className="text-[11px] text-slate-400">Holds LinkedIn credentials & cookies</p>
              </div>
            </div>
            <button
              onClick={() => handleRunLogin("linkedin")}
              disabled={agentStatus === "running"}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Login
            </button>
          </div>

          {/* Default Browser Login Card */}
          <div className="bg-slate-900/50 border border-white/5 rounded-xl p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
                <Settings className="w-5 h-5" />
              </div>
              <div>
                <p className="font-semibold text-sm text-slate-200">Default Apply Profile</p>
                <p className="text-[11px] text-slate-400">Holds forms, resumes & Greenhouse cache</p>
              </div>
            </div>
            <button
              onClick={() => handleRunLogin("default")}
              disabled={agentStatus === "running"}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-white/10 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open Browser
            </button>
          </div>
        </div>
      </div>

      {/* Settings / CapSolver API Section */}
      <div className="bg-[#12121e]/80 border border-white/5 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-white">CapSolver Configuration</h3>
            <p className="text-xs text-slate-400">Used for autonomous CAPTCHA solving</p>
          </div>
        </div>
        <div className="flex items-center gap-2 max-w-md w-full">
          <input
            type="password"
            placeholder="Capsolver API Key..."
            className="bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-sm w-full text-slate-200 focus:outline-none focus:border-indigo-500"
            value={capsolverKey}
            onChange={(e) => setCapsolverKey(e.target.value)}
          />
          <button
            onClick={handleSaveKey}
            disabled={isSavingKey}
            className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-1.5 text-sm font-semibold transition disabled:opacity-50"
          >
            {isSavingKey ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Split layout: Queue and Console */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Job Queue */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>Ready Queue</span>
              <span className="bg-indigo-500/10 text-indigo-400 text-xs px-2 py-0.5 rounded-full font-normal">
                {readyJobs.length} jobs
              </span>
            </h2>
            {readyJobs.length > 0 && (
              <button
                onClick={toggleSelectAll}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
              >
                {selectedJobIds.length === readyJobs.length ? "Deselect All" : "Select All"}
              </button>
            )}
          </div>

          {/* Queue Settings & Main Run Controls */}
          {readyJobs.length > 0 && (
            <div className="bg-[#12121e]/80 border border-white/5 rounded-xl p-4 space-y-4">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-300">
                <label className="flex items-center gap-2 cursor-pointer hover:text-white transition">
                  <input
                    type="checkbox"
                    checked={dryRunGlobal}
                    onChange={(e) => setDryRunGlobal(e.target.checked)}
                    className="rounded border-white/10 bg-slate-900 text-indigo-600 focus:ring-0 focus:ring-offset-0"
                  />
                  <span>Dry Run Mode (Review but don't submit)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer hover:text-white transition">
                  <input
                    type="checkbox"
                    checked={headless}
                    onChange={(e) => handleToggleHeadless(e.target.checked)}
                    className="rounded border-white/10 bg-slate-900 text-indigo-600 focus:ring-0 focus:ring-offset-0"
                  />
                  <span>Run Headless</span>
                </label>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => startQueue(dryRunGlobal)}
                  disabled={agentStatus === "running" || selectedJobIds.length === 0}
                  className="flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition disabled:opacity-50"
                >
                  <Play className="w-4 h-4" />
                  Run Selected ({selectedJobIds.length})
                </button>
                {agentStatus === "running" && (
                  <button
                    onClick={handleStopAgent}
                    className="flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-semibold bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-500/30 transition"
                  >
                    <StopCircle className="w-4 h-4" />
                    Stop
                  </button>
                )}
              </div>
            </div>
          )}

          {readyJobs.length === 0 ? (
            <div className="border border-dashed border-white/10 rounded-xl p-8 text-center text-slate-400 space-y-3">
              <FileText className="w-8 h-8 mx-auto text-slate-500" />
              <p className="text-sm">No tailored CVs ready for application.</p>
              <p className="text-xs text-slate-500">
                Go to <strong>Tailor CV</strong> and generate a tailored resume for your saved jobs.
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
              {readyJobs.map((job) => {
                const isSelected = selectedJobIds.includes(job.id);
                return (
                  <div
                    key={job.id}
                    onClick={() => toggleSelectJob(job.id)}
                    className={`p-4 bg-[#12121e]/80 border rounded-xl transition cursor-pointer flex gap-3 ${
                      activeJobId === job.id
                        ? "border-indigo-500 bg-indigo-500/[0.04]"
                        : isSelected
                        ? "border-indigo-500/40 bg-indigo-500/[0.02] shadow-lg shadow-indigo-500/5"
                        : "border-white/5 hover:border-white/10"
                    }`}
                  >
                    {/* Checkbox Icon */}
                    <div className="pt-0.5 text-slate-500 shrink-0">
                      {isSelected ? (
                        <CheckSquare className="w-4.5 h-4.5 text-indigo-400" />
                      ) : (
                        <Square className="w-4.5 h-4.5" />
                      )}
                    </div>

                    <div className="flex-1 space-y-2">
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <h4 className="font-semibold text-white text-sm line-clamp-1">{job.title}</h4>
                          <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                            <Building2 className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                            <span>{job.company}</span>
                            <span className="text-slate-600">•</span>
                            <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                            <span>{job.location}</span>
                          </p>
                        </div>

                        {job.fitScore !== undefined && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-bold flex items-center gap-1 ${
                              job.fitScore >= 8
                                ? "bg-green-500/10 text-green-400"
                                : job.fitScore >= 6
                                ? "bg-yellow-500/10 text-yellow-400"
                                : "bg-slate-500/10 text-slate-400"
                            }`}
                          >
                            <Sparkles className="w-3 h-3" />
                            {job.fitScore}/10
                          </span>
                        )}
                      </div>

                      {/* Display Status */}
                      <div className="flex items-center justify-between text-[11px] text-slate-400 border-t border-white/5 pt-2">
                        <span className="capitalize px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-slate-300">
                          {job.status === "saved" ? "ready" : job.status}
                        </span>
                        {job.status === "applied" && (
                          <span className="text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Applied
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Console/Status Panel */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-[#12121e]/80 border border-white/5 rounded-xl p-5 space-y-4">
            <h3 className="font-bold text-white text-sm flex items-center gap-2">
              <Terminal className="w-4 h-4 text-indigo-400" />
              <span>Execution Console</span>
            </h3>

            {/* Current Step Tracker */}
            {agentStatus === "running" && (
              <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4 flex gap-3 text-slate-200 animate-pulse">
                <Loader2 className="w-5 h-5 animate-spin text-indigo-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-indigo-300">Current Action</p>
                  <p className="text-sm font-medium text-slate-100">{currentStep || "Initializing..."}</p>
                </div>
              </div>
            )}

            {/* Terminal Outputs */}
            <div className="space-y-2">
              <div className="flex justify-between items-center bg-slate-900 border border-white/5 rounded-t-lg px-4 py-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => setActiveTab("monitor")}
                    className={`text-xs font-semibold px-2.5 py-1 rounded transition ${
                      activeTab === "monitor"
                        ? "bg-indigo-600 text-white"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Structured Logs
                  </button>
                  <button
                    onClick={() => setActiveTab("raw")}
                    className={`text-xs font-semibold px-2.5 py-1 rounded transition ${
                      activeTab === "raw"
                        ? "bg-indigo-600 text-white"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Raw Stream ({rawLogs.length})
                  </button>
                </div>
                <div className="flex gap-3 items-center">
                  <button
                    onClick={handleCopyLogs}
                    disabled={logs.length === 0 && rawLogs.length === 0}
                    className="text-[10px] text-slate-400 hover:text-slate-200 font-semibold disabled:opacity-50"
                  >
                    {copiedLogs ? "Copied!" : "Copy Logs"}
                  </button>
                  <button
                    onClick={() => {
                      setLogs([]);
                      setRawLogs([]);
                    }}
                    className="text-[10px] text-slate-500 hover:text-slate-300 font-semibold"
                  >
                    Clear Console
                  </button>
                </div>
              </div>

              <div className="bg-slate-950 font-mono text-xs text-slate-300 p-4 rounded-b-lg h-[400px] overflow-y-auto border border-t-0 border-white/5 space-y-1 select-text">
                {activeTab === "monitor" ? (
                  logs.length === 0 ? (
                    <div className="text-slate-600 italic">No activity logs yet. Ready for run.</div>
                  ) : (
                    logs.map((log, i) => (
                      <div key={i} className="flex gap-3 leading-relaxed">
                        <span className="text-slate-600 shrink-0 select-none">{log.timestamp}</span>
                        <span className="text-slate-300 break-all">{log.text}</span>
                      </div>
                    ))
                  )
                ) : rawLogs.length === 0 ? (
                  <div className="text-slate-600 italic">No raw terminal data.</div>
                ) : (
                  rawLogs.map((log, i) => (
                    <div key={i} className="whitespace-pre-wrap break-all text-slate-400">
                      {log}
                    </div>
                  ))
                )}
                <div ref={consoleEndRef} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
