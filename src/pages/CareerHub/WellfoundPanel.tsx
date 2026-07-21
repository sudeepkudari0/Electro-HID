/**
 * WellfoundPanel — Autonomous Wellfound Job Application Dashboard
 * Handles login session, filter configuration, and running the apply bot.
 */

import { useState, useEffect, useRef } from "react";
import {
  ShieldCheck,
  Play,
  StopCircle,
  Terminal,
  Settings2,
  Briefcase,
  MapPin,
  Clock,
  Zap,
  CheckCircle2,
  XCircle,
  Loader2,
  Globe,
  ChevronRight,
  AlertTriangle,
  FileText,
  Upload,
} from "lucide-react";
import { useCareerProfileStore, useTailoringStore } from "../../career/state/career-store";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface StatusLog {
  timestamp: string;
  text: string;
  type?: "info" | "success" | "error" | "step";
}

interface WellfoundFilters {
  role: string;
  location: string;
  jobType: string;
  remote: boolean;
  maxJobs: number;
}

type AgentStatus = "idle" | "running" | "done" | "failed" | "stopped";

const JOB_TYPES = ["Full Time", "Part Time", "Contract", "Internship"];

// ─────────────────────────────────────────────────────────────────
// Wellfound Panel Component
// ─────────────────────────────────────────────────────────────────

export function WellfoundPanel() {
  const { profile } = useCareerProfileStore();
  const { masterResumeYaml, setMasterResumeYaml, setMasterResume } = useTailoringStore();

  const handleYamlUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result as string;
      setMasterResumeYaml(text);
      try {
        const { load } = await import("js-yaml");
        const { normalizeResume } = await import("../../career/core/resumeParser");
        const parsed = load(text) as any;
        setMasterResume(normalizeResume(parsed));

        const profileData = {
          fullName: parsed.name || parsed.personal?.name || parsed.person?.name || parsed.personal_info?.name || "",
          email: parsed.email || parsed.personal?.email || parsed.person?.email || parsed.personal_info?.email || "",
          phone: parsed.phone || parsed.personal?.phone || parsed.person?.phone || parsed.personal_info?.phone || "",
          location: parsed.location || parsed.personal?.location || parsed.person?.location || parsed.personal_info?.location || "",
          linkedinUrl: parsed.linkedin || parsed.personal?.linkedin || parsed.person?.linkedin || parsed.links?.linkedin || parsed.linkedinUrl || "",
          githubUrl: parsed.github || parsed.personal?.github || parsed.person?.github || parsed.links?.github || parsed.githubUrl || "",
          portfolioUrl: parsed.portfolio || parsed.personal?.portfolio || parsed.person?.portfolio || parsed.links?.portfolio || parsed.portfolioUrl || "",
          masterResumeYaml: text,
          masterResumeText: text,
          updatedAt: new Date().toISOString()
        };

        await (window as any).electronAPI?.careerHub?.saveProfile?.(profileData);
        appendLog(`[SYSTEM] Master Resume loaded successfully (${text.length} characters).`, "success");
      } catch (err: any) {
        appendLog(`[ERROR] Invalid YAML file: ${err.message}`, "error");
      }
    };
    reader.readAsText(file);
  };

  // Login state
  const [loginStatus, setLoginStatus] = useState<{
    checked: boolean;
    loggedIn: boolean;
    checking: boolean;
  }>({ checked: false, loggedIn: false, checking: false });

  // Agent state
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("idle");
  const [currentStep, setCurrentStep] = useState("");
  const [logs, setLogs] = useState<StatusLog[]>([]);
  const [dryRun, setDryRun] = useState(true);
  const [stats, setStats] = useState({ processed: 0, applied: 0 });

  // Filter config
  const [filters, setFilters] = useState<WellfoundFilters>({
    role: "",
    location: "",
    jobType: "Full Time",
    remote: false,
    maxJobs: 10,
  });

  const [activeTab, setActiveTab] = useState<"config" | "logs">("config");
  const consoleEndRef = useRef<HTMLDivElement>(null);

  // ── Effects ──────────────────────────────────────────────────────
  useEffect(() => {
    checkWellfoundLogin();
  }, []);

  useEffect(() => {
    if (!(window as any).electronAPI?.careerHub?.onApplyStatus) return;
    const unsub = (window as any).electronAPI.careerHub.onApplyStatus(
      (data: any) => handleStatusUpdate(data)
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // ── Helpers ───────────────────────────────────────────────────────
  const appendLog = (text: string, type: StatusLog["type"] = "info") => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { timestamp, text, type }]);
  };

  const handleStatusUpdate = (data: any) => {
    if (data.type === "status") {
      if (data.action) {
        setCurrentStep(data.action);
        appendLog(`${data.action}`, "step");
      }
      if (data.status) setAgentStatus(data.status as AgentStatus);
    } else if (data.type === "log") {
      const msg: string = data.message || "";
      const logType: StatusLog["type"] = msg.includes("[Error]") || msg.includes("error")
        ? "error"
        : msg.includes("[SUCCESS]") || msg.includes("Applied")
        ? "success"
        : "info";
      appendLog(msg, logType);
    } else if (data.type === "result") {
      const { status: s, message: m } = data;
      if (s === "applied") {
        appendLog(`✓ Applied: ${m}`, "success");
        setStats((p) => ({ ...p, applied: p.applied + 1, processed: p.processed + 1 }));
      } else if (s === "failed") {
        appendLog(`✗ Failed: ${m}`, "error");
        setStats((p) => ({ ...p, processed: p.processed + 1 }));
      } else {
        appendLog(`↩ Skipped: ${m}`, "info");
        setStats((p) => ({ ...p, processed: p.processed + 1 }));
      }
    } else if (data.type === "done") {
      setAgentStatus("done");
      setCurrentStep(`Completed — ${data.applied} applied of ${data.total} processed`);
      appendLog(`✓ Finished: ${data.applied} applied out of ${data.total} processed`, "success");
    }
  };

  // ── Login ─────────────────────────────────────────────────────────
  const checkWellfoundLogin = async () => {
    if (!(window as any).electronAPI?.careerHub?.checkLogin) return;
    setLoginStatus((p) => ({ ...p, checking: true }));
    try {
      const res = await (window as any).electronAPI.careerHub.checkLogin("wellfound");
      setLoginStatus({
        checked: true,
        loggedIn: !!res?.loggedIn,
        checking: false,
      });
    } catch {
      setLoginStatus({ checked: true, loggedIn: false, checking: false });
    }
  };

  const handleOpenBrowser = async () => {
    setLogs([]);
    setCurrentStep("Opening Wellfound login browser...");
    setAgentStatus("running");
    appendLog("[SYSTEM] Opening browser for Wellfound login...", "info");
    appendLog("[SYSTEM] Log in manually, then close the browser when done.", "info");
    try {
      await (window as any).electronAPI.careerHub.runLogin("wellfound");
      appendLog("[SYSTEM] Browser session closed.", "info");
    } catch (e: any) {
      appendLog(`[ERROR] ${e.message}`, "error");
    } finally {
      setAgentStatus("idle");
      setCurrentStep("");
      checkWellfoundLogin();
    }
  };

  const handleStop = async () => {
    appendLog("[SYSTEM] Stopping...", "info");
    try {
      await (window as any).electronAPI.careerHub.stopWellfoundApply?.();
      await (window as any).electronAPI.careerHub.stopLogin?.();
      setAgentStatus("stopped");
      setCurrentStep("Stopped by user");
    } catch (e: any) {
      appendLog(`[ERROR] ${e.message}`, "error");
    }
  };

  const handleStart = async () => {
    if (!loginStatus.loggedIn) {
      appendLog("[ERROR] Please log in to Wellfound first.", "error");
      return;
    }
    if (!filters.role && !filters.location) {
      appendLog("[ERROR] Please set at least a role or location filter.", "error");
      return;
    }

    setLogs([]);
    setStats({ processed: 0, applied: 0 });
    setAgentStatus("running");
    setCurrentStep("Starting Wellfound apply bot...");
    setActiveTab("logs");

    appendLog(`[SYSTEM] Starting Wellfound apply — DryRun: ${dryRun}, MaxJobs: ${filters.maxJobs}`, "info");
    appendLog(`[SYSTEM] Filters: role="${filters.role}" location="${filters.location}" type="${filters.jobType}"`, "info");

    try {
      const profileRes = await (window as any).electronAPI.careerHub.loadProfile();
      const baseProfile = profileRes?.success ? profileRes.profile : profile || {};
      const { masterResumeText, masterResumeYaml, masterResume } = useTailoringStore.getState();
      let resumeStr = masterResumeText || masterResumeYaml || "";
      if (!resumeStr && masterResume) {
        try { resumeStr = JSON.stringify(masterResume); } catch {}
      }

      const candidateProfile = {
        ...baseProfile,
        resumeText: typeof resumeStr === "string" ? resumeStr : String(resumeStr || ""),
      };

      const res = await (window as any).electronAPI.careerHub.runWellfoundApply({
        profile: candidateProfile,
        filters: {
          role: filters.role,
          location: filters.location,
          jobType: filters.jobType,
          remote: filters.remote,
          maxJobs: filters.maxJobs,
        },
        dryRun,
      });

      if (!res?.success) {
        setAgentStatus("failed");
        appendLog(`[ERROR] ${res?.error || "Unknown error"}`, "error");
      }
    } catch (err: any) {
      setAgentStatus("failed");
      setCurrentStep(err.message || "Failed to start");
      appendLog(`[ERROR] ${err.message}`, "error");
    }
  };

  // ── UI Helpers ────────────────────────────────────────────────────
  const isRunning = agentStatus === "running";

  const statusColor = {
    idle: "#64748b",
    running: "#6366f1",
    done: "#10b981",
    failed: "#ef4444",
    stopped: "#f59e0b",
  }[agentStatus];

  const statusLabel = {
    idle: "Idle",
    running: "Running",
    done: "Done",
    failed: "Failed",
    stopped: "Stopped",
  }[agentStatus];

  const logColor = (type: StatusLog["type"]) => {
    if (type === "success") return "#34d399";
    if (type === "error") return "#f87171";
    if (type === "step") return "#818cf8";
    return "#94a3b8";
  };

  // ─────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────
  return (
    <div className="apply-panel space-y-5" style={{ fontFamily: "inherit" }}>

      {/* ── Header Banner ──────────────────────────────────────────── */}
      <div style={{
        background: "linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(99,102,241,0.08) 100%)",
        border: "1px solid rgba(245,158,11,0.2)",
        borderRadius: "14px",
        padding: "18px 20px",
        display: "flex",
        alignItems: "center",
        gap: "16px",
      }}>
        <div style={{
          width: "44px", height: "44px", borderRadius: "12px",
          background: "linear-gradient(135deg, #f59e0b, #6366f1)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "22px", flexShrink: 0, boxShadow: "0 4px 14px rgba(245,158,11,0.3)",
        }}>
          🚀
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "15px", fontWeight: 700, color: "#f1f5f9", letterSpacing: "0.3px" }}>
            Wellfound Auto Apply
          </div>
          <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}>
            Autonomous job applications on Wellfound — login once, apply to hundreds
          </div>
        </div>
        {/* Status badge */}
        <div style={{
          display: "flex", alignItems: "center", gap: "6px",
          background: `${statusColor}15`,
          border: `1px solid ${statusColor}40`,
          borderRadius: "8px", padding: "5px 10px",
        }}>
          {isRunning
            ? <Loader2 size={12} style={{ color: statusColor, animation: "spin 1s linear infinite" }} />
            : <div style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor }} />
          }
          <span style={{ fontSize: "12px", fontWeight: 600, color: statusColor }}>{statusLabel}</span>
        </div>
      </div>

      {/* ── Login Status Card ─────────────────────────────────────── */}
      <div style={{
        background: "#12121e",
        border: loginStatus.loggedIn
          ? "1px solid rgba(16,185,129,0.25)"
          : "1px solid rgba(255,255,255,0.06)",
        borderRadius: "12px", padding: "16px 18px",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{
            width: "36px", height: "36px", borderRadius: "10px",
            background: loginStatus.loggedIn ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.1)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {loginStatus.loggedIn
              ? <CheckCircle2 size={18} style={{ color: "#10b981" }} />
              : <Globe size={18} style={{ color: "#f59e0b" }} />
            }
          </div>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#e2e8f0" }}>
              Wellfound Session
            </div>
            <div style={{ fontSize: "11px", marginTop: "2px" }}>
              {loginStatus.checking ? (
                <span style={{ color: "#94a3b8" }}>Checking...</span>
              ) : loginStatus.loggedIn ? (
                <span style={{ color: "#10b981" }}>✓ Logged in — session saved</span>
              ) : (
                <span style={{ color: "#f59e0b" }}>Not logged in — click to authenticate</span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={checkWellfoundLogin}
            disabled={loginStatus.checking || isRunning}
            style={{
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
              color: "#94a3b8", padding: "6px 12px", borderRadius: "7px",
              fontSize: "12px", cursor: "pointer",
            }}
          >
            {loginStatus.checking ? "Checking..." : "Check"}
          </button>
          <button
            onClick={handleOpenBrowser}
            disabled={isRunning}
            style={{
              background: "linear-gradient(135deg, rgba(245,158,11,0.15), rgba(99,102,241,0.15))",
              border: "1px solid rgba(245,158,11,0.3)",
              color: "#fbbf24", padding: "6px 14px", borderRadius: "7px",
              fontSize: "12px", fontWeight: 600, cursor: "pointer", display: "flex",
              alignItems: "center", gap: "5px",
            }}
          >
            <Globe size={12} />
            {loginStatus.loggedIn ? "Re-login" : "Login to Wellfound"}
          </button>
        </div>
      </div>

      {/* ── Tab Bar ───────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: "4px" }}>
        {[
          { id: "config", label: "Configuration", icon: <Settings2 size={13} /> },
          { id: "logs", label: "Live Logs", icon: <Terminal size={13} /> },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as any)}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "7px 14px", borderRadius: "8px",
              background: activeTab === t.id ? "rgba(99,102,241,0.15)" : "transparent",
              border: activeTab === t.id ? "1px solid rgba(99,102,241,0.3)" : "1px solid transparent",
              color: activeTab === t.id ? "#818cf8" : "#64748b",
              fontSize: "12px", fontWeight: 600, cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Config Tab ────────────────────────────────────────────── */}
      {activeTab === "config" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

          {/* Master Resume Status Card */}
          <div style={{
            background: "#12121e",
            border: masterResumeYaml || profile?.fullName
              ? "1px solid rgba(16,185,129,0.25)"
              : "1px solid rgba(245,158,11,0.3)",
            borderRadius: "12px", padding: "16px 18px",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{
                width: "36px", height: "36px", borderRadius: "10px",
                background: masterResumeYaml || profile?.fullName ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)",
                border: masterResumeYaml || profile?.fullName ? "1px solid rgba(16,185,129,0.3)" : "1px solid rgba(245,158,11,0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: masterResumeYaml || profile?.fullName ? "#34d399" : "#fbbf24", flexShrink: 0,
              }}>
                <FileText size={18} />
              </div>
              <div>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#f1f5f9" }}>
                  {masterResumeYaml || profile?.fullName
                    ? `Master Resume Loaded (${masterResumeYaml ? `${masterResumeYaml.length} chars` : profile?.fullName || "Active"})`
                    : "No Master Resume Loaded"}
                </div>
                <div style={{ fontSize: "11px", color: masterResumeYaml || profile?.fullName ? "#34d399" : "#f59e0b", marginTop: "2px" }}>
                  {masterResumeYaml || profile?.fullName
                    ? "✓ Full work experience & details will be used for cover letters (no placeholders)."
                    : "⚠ Please upload master_resume.yaml to prevent placeholder generation."}
                </div>
              </div>
            </div>

            <label style={{
              background: "linear-gradient(135deg, rgba(99,102,241,0.15), rgba(168,85,247,0.15))",
              border: "1px solid rgba(99,102,241,0.3)",
              color: "#a78bfa", padding: "6px 14px", borderRadius: "7px",
              fontSize: "12px", fontWeight: 600, cursor: "pointer", display: "flex",
              alignItems: "center", gap: "6px", flexShrink: 0,
            }}>
              <Upload size={12} />
              {masterResumeYaml ? "Update YAML" : "Upload master_resume.yaml"}
              <input
                type="file"
                accept=".yaml,.yml,.json,.txt"
                onChange={handleYamlUpload}
                style={{ display: "none" }}
              />
            </label>
          </div>

          {/* Filters */}
          <div style={{
            background: "#12121e", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "12px", padding: "18px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
              <Settings2 size={15} style={{ color: "#818cf8" }} />
              <span style={{ fontSize: "13px", fontWeight: 700, color: "#e2e8f0" }}>Job Filters</span>
              <span style={{ fontSize: "11px", color: "#475569", marginLeft: "4px" }}>
                — these will be applied on wellfound.com/jobs
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>

              {/* Role */}
              <div>
                <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, display: "block", marginBottom: "6px" }}>
                  <Briefcase size={10} style={{ display: "inline", marginRight: "4px" }} />
                  ROLE / TITLE
                </label>
                <input
                  type="text"
                  value={filters.role}
                  onChange={(e) => setFilters((f) => ({ ...f, role: e.target.value }))}
                  placeholder="e.g. Full-Stack Engineer"
                  style={{
                    width: "100%", padding: "9px 12px", borderRadius: "8px",
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                    color: "#e2e8f0", fontSize: "13px", outline: "none", boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Location */}
              <div>
                <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, display: "block", marginBottom: "6px" }}>
                  <MapPin size={10} style={{ display: "inline", marginRight: "4px" }} />
                  LOCATION
                </label>
                <input
                  type="text"
                  value={filters.location}
                  onChange={(e) => setFilters((f) => ({ ...f, location: e.target.value }))}
                  placeholder="e.g. Bengaluru, Remote"
                  style={{
                    width: "100%", padding: "9px 12px", borderRadius: "8px",
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                    color: "#e2e8f0", fontSize: "13px", outline: "none", boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Job Type */}
              <div>
                <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, display: "block", marginBottom: "6px" }}>
                  <Clock size={10} style={{ display: "inline", marginRight: "4px" }} />
                  JOB TYPE
                </label>
                <select
                  value={filters.jobType}
                  onChange={(e) => setFilters((f) => ({ ...f, jobType: e.target.value }))}
                  style={{
                    width: "100%", padding: "9px 12px", borderRadius: "8px",
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                    color: "#e2e8f0", fontSize: "13px", outline: "none", cursor: "pointer",
                  }}
                >
                  {JOB_TYPES.map((t) => <option key={t} value={t} style={{ background: "#1e1e2e" }}>{t}</option>)}
                </select>
              </div>

              {/* Max Jobs */}
              <div>
                <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, display: "block", marginBottom: "6px" }}>
                  <Zap size={10} style={{ display: "inline", marginRight: "4px" }} />
                  MAX JOBS
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={filters.maxJobs}
                  onChange={(e) => setFilters((f) => ({ ...f, maxJobs: parseInt(e.target.value) || 10 }))}
                  style={{
                    width: "100%", padding: "9px 12px", borderRadius: "8px",
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                    color: "#e2e8f0", fontSize: "13px", outline: "none", boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            {/* Remote toggle */}
            <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "10px" }}>
              <div
                onClick={() => setFilters((f) => ({ ...f, remote: !f.remote }))}
                style={{
                  width: "36px", height: "20px", borderRadius: "10px", cursor: "pointer",
                  background: filters.remote ? "#6366f1" : "rgba(255,255,255,0.1)",
                  position: "relative", transition: "background 0.2s", flexShrink: 0,
                }}
              >
                <div style={{
                  width: "16px", height: "16px", borderRadius: "50%", background: "#fff",
                  position: "absolute", top: "2px",
                  left: filters.remote ? "18px" : "2px",
                  transition: "left 0.2s",
                }} />
              </div>
              <span style={{ fontSize: "12px", color: "#94a3b8" }}>Remote jobs only</span>
            </div>
          </div>

          {/* Run settings */}
          <div style={{
            background: "#12121e", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "12px", padding: "18px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
              <ShieldCheck size={15} style={{ color: "#818cf8" }} />
              <span style={{ fontSize: "13px", fontWeight: 700, color: "#e2e8f0" }}>Run Settings</span>
            </div>

            {/* Dry run toggle */}
            <div style={{
              display: "flex", alignItems: "flex-start", gap: "12px",
              padding: "12px 14px", borderRadius: "10px",
              background: dryRun ? "rgba(245,158,11,0.06)" : "rgba(239,68,68,0.06)",
              border: dryRun ? "1px solid rgba(245,158,11,0.2)" : "1px solid rgba(239,68,68,0.2)",
            }}>
              <div
                onClick={() => setDryRun((d) => !d)}
                style={{
                  width: "36px", height: "20px", borderRadius: "10px", cursor: "pointer",
                  background: !dryRun ? "#ef4444" : "rgba(255,255,255,0.1)",
                  position: "relative", transition: "background 0.2s", flexShrink: 0, marginTop: "2px",
                }}
              >
                <div style={{
                  width: "16px", height: "16px", borderRadius: "50%", background: "#fff",
                  position: "absolute", top: "2px",
                  left: !dryRun ? "18px" : "2px",
                  transition: "left 0.2s",
                }} />
              </div>
              <div>
                <div style={{ fontSize: "13px", fontWeight: 600, color: dryRun ? "#fbbf24" : "#f87171" }}>
                  {dryRun ? "🧪 Dry Run Mode" : "🚀 Live Mode — will submit applications"}
                </div>
                <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                  {dryRun
                    ? "Forms are filled but NOT submitted. Safe to test."
                    : "Applications will be submitted. Make sure your profile and filters are correct!"}
                </div>
              </div>
            </div>
          </div>

          {/* Profile preview */}
          {profile?.fullName && (
            <div style={{
              background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.12)",
              borderRadius: "10px", padding: "12px 14px",
              display: "flex", alignItems: "center", gap: "10px",
            }}>
              <CheckCircle2 size={14} style={{ color: "#818cf8", flexShrink: 0 }} />
              <span style={{ fontSize: "12px", color: "#94a3b8" }}>
                Will apply as <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{profile.fullName}</span>
                {profile.currentRole ? ` · ${profile.currentRole}` : ""}
              </span>
            </div>
          )}

          {/* Profile missing warning */}
          {!profile?.fullName && (
            <div style={{
              background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)",
              borderRadius: "10px", padding: "12px 14px",
              display: "flex", alignItems: "center", gap: "10px",
            }}>
              <AlertTriangle size={14} style={{ color: "#f59e0b", flexShrink: 0 }} />
              <span style={{ fontSize: "12px", color: "#94a3b8" }}>
                Career profile not loaded — add your info in the Tailor CV tab first.
              </span>
            </div>
          )}

          {/* Start / Stop button */}
          <div style={{ display: "flex", gap: "10px" }}>
            {isRunning ? (
              <button
                onClick={handleStop}
                style={{
                  flex: 1, padding: "11px", borderRadius: "10px",
                  background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                  color: "#f87171", fontSize: "13px", fontWeight: 700, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                }}
              >
                <StopCircle size={15} />
                Stop Apply Bot
              </button>
            ) : (
              <button
                onClick={handleStart}
                disabled={!loginStatus.loggedIn}
                style={{
                  flex: 1, padding: "11px", borderRadius: "10px",
                  background: loginStatus.loggedIn
                    ? "linear-gradient(135deg, #f59e0b, #6366f1)"
                    : "rgba(255,255,255,0.04)",
                  border: loginStatus.loggedIn ? "none" : "1px solid rgba(255,255,255,0.06)",
                  color: loginStatus.loggedIn ? "#fff" : "#475569",
                  fontSize: "13px", fontWeight: 700, cursor: loginStatus.loggedIn ? "pointer" : "not-allowed",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                  boxShadow: loginStatus.loggedIn ? "0 4px 16px rgba(245,158,11,0.25)" : "none",
                }}
              >
                <Play size={15} />
                {dryRun ? "Start Dry Run" : "Start Applying"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Logs Tab ──────────────────────────────────────────────── */}
      {activeTab === "logs" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>

          {/* Stats bar */}
          {(stats.processed > 0 || agentStatus !== "idle") && (
            <div style={{
              display: "flex", gap: "10px",
            }}>
              {[
                { label: "Processed", value: stats.processed, color: "#818cf8" },
                { label: "Applied", value: stats.applied, color: "#10b981" },
                { label: "Skipped", value: stats.processed - stats.applied, color: "#64748b" },
              ].map((s) => (
                <div key={s.label} style={{
                  flex: 1, padding: "10px 12px", borderRadius: "10px",
                  background: `${s.color}0a`, border: `1px solid ${s.color}25`,
                  textAlign: "center",
                }}>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Current step */}
          {currentStep && (
            <div style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "10px 14px", borderRadius: "8px",
              background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)",
            }}>
              {isRunning && <Loader2 size={12} style={{ color: "#818cf8", animation: "spin 1s linear infinite", flexShrink: 0 }} />}
              {agentStatus === "done" && <CheckCircle2 size={12} style={{ color: "#10b981", flexShrink: 0 }} />}
              {agentStatus === "failed" && <XCircle size={12} style={{ color: "#ef4444", flexShrink: 0 }} />}
              <span style={{ fontSize: "12px", color: "#94a3b8" }}>{currentStep}</span>
            </div>
          )}

          {/* Log console */}
          <div style={{
            background: "#0a0a12", border: "1px solid rgba(255,255,255,0.05)",
            borderRadius: "10px", padding: "14px",
            minHeight: "280px", maxHeight: "380px",
            overflowY: "auto", fontFamily: "ui-monospace, SFMono-Regular, monospace",
            fontSize: "11px",
          }}>
            {logs.length === 0 ? (
              <div style={{ color: "#334155", textAlign: "center", marginTop: "80px" }}>
                No logs yet — start the apply bot to see activity
              </div>
            ) : (
              logs.map((log, i) => (
                <div key={i} style={{
                  display: "flex", gap: "8px", marginBottom: "4px", lineHeight: "1.5",
                }}>
                  <span style={{ color: "#334155", flexShrink: 0 }}>{log.timestamp}</span>
                  <span style={{ color: logColor(log.type) }}>{log.text}</span>
                </div>
              ))
            )}
            <div ref={consoleEndRef} />
          </div>

          {/* Control buttons in logs tab */}
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => setActiveTab("config")}
              style={{
                flex: 1, padding: "9px", borderRadius: "8px",
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
                color: "#64748b", fontSize: "12px", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
              }}
            >
              <Settings2 size={12} />
              Configure
            </button>
            {isRunning ? (
              <button
                onClick={handleStop}
                style={{
                  flex: 2, padding: "9px", borderRadius: "8px",
                  background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
                  color: "#f87171", fontSize: "12px", fontWeight: 600, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                }}
              >
                <StopCircle size={12} />
                Stop
              </button>
            ) : (
              <button
                onClick={() => { setLogs([]); setStats({ processed: 0, applied: 0 }); setCurrentStep(""); setAgentStatus("idle"); }}
                style={{
                  flex: 2, padding: "9px", borderRadius: "8px",
                  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
                  color: "#64748b", fontSize: "12px", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                }}
              >
                <ChevronRight size={12} />
                Clear Logs
              </button>
            )}
          </div>
        </div>
      )}

      {/* CSS animation for spinner */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
