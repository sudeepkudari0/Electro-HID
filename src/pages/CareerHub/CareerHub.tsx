/**
 * Career Hub — Main Container
 * Houses all career management features: Job Search, Tracking, Resume Tailoring, Cover Letters.
 */

import { useState, useEffect } from "react";
import {
  useNavigationStore,
  type CareerTab,
} from "../../state/navigation-store";
import {
  useJobStore,
  useTailoringStore,
  useCareerProfileStore,
} from "../../career/state/career-store";
import { JobManager } from "./JobManager";
import { JobBoard } from "./JobBoard";
import { TailorPanel } from "./TailorPanel";
import { JobSearch } from "./JobSearch";
import { ApplyPanel } from "./ApplyPanel";
import type { MasterResume } from "../../career/core/types";

const TABS: { id: CareerTab; label: string; icon: string }[] = [
  { id: "jobs", label: "My Jobs", icon: "📋" },
  { id: "tracking", label: "Tracking", icon: "📊" },
  { id: "tailor", label: "Tailor CV", icon: "✨" },
  { id: "search", label: "Job Search", icon: "🔍" },
  { id: "apply", label: "Auto Apply", icon: "🤖" },
];

export function CareerHub() {
  const { careerTab, setCareerTab } = useNavigationStore();
  const [showConfirmReset, setShowConfirmReset] = useState(false);

  const { setMasterResume, setMasterResumeYaml, setMasterResumeText } = useTailoringStore();
  const { setProfile } = useCareerProfileStore();

  // Load career profile / master resume from electron store on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await (
          window as any
        ).electronAPI?.careerHub?.loadProfile?.();
        if (res?.success && res?.profile?.masterResumeYaml) {
          setMasterResumeYaml(res.profile.masterResumeYaml);
          setMasterResumeText(res.profile.masterResumeText || "");
          const { load } = await import("js-yaml");
          const parsed = load(res.profile.masterResumeYaml) as MasterResume;
          setMasterResume(parsed);
          setProfile(res.profile);
        }
      } catch (err) {
        console.error("Failed to load career profile on mount:", err);
      }
    })();
  }, [setMasterResume, setMasterResumeYaml, setMasterResumeText, setProfile]);

  const handleResetAll = async () => {
    try {
      // 1. Clear backend storage
      if ((window as any).electronAPI?.careerHub) {
        await (window as any).electronAPI.careerHub.saveJobs([]);
        await (window as any).electronAPI.careerHub.saveProfile({});
      }

      // 2. Clear frontend state
      useJobStore.getState().setJobs([]);
      useJobStore.getState().setSelectedJob(null);

      const tailoringStore = useTailoringStore.getState();
      tailoringStore.setMasterResume(null);
      tailoringStore.setMasterResumeYaml("");
      tailoringStore.setMasterResumeText("");
      tailoringStore.reset();

      useCareerProfileStore.getState().setProfile({
        fullName: "",
        email: "",
        phone: "",
        location: "",
        linkedinUrl: "",
        githubUrl: "",
        portfolioUrl: "",
        totalYearsExperience: 0,
        currentRole: "",
        currentCompany: "",
        topSkills: [],
        preferredJobTitles: [],
        preferredLocations: [],
        masterResumeYaml: "",
        masterResumeText: "",
        updatedAt: new Date().toISOString(),
      });

      // 3. Close modal
      setShowConfirmReset(false);

      // 4. Force go to 'jobs' tab
      setCareerTab("jobs");
    } catch (err) {
      console.error("Failed to reset Career Hub data:", err);
    }
  };

  return (
    <div className="career-hub" style={{ position: "relative" }}>
      {/* Top Title/Window Bar */}
      <div
        className="career-topbar"
        style={{
          display: "flex",
          alignItems: "center",
          height: "44px",
          padding: "0 20px",
          background: "#09090b",
          borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
          WebkitAppRegion: "no-drag",
        } as any}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flex: 1,
            height: "100%",
            WebkitAppRegion: "drag",
          } as any}
        >
          <span style={{ fontSize: "14px" }}>💼</span>
          <span
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "#e2e8f0",
              letterSpacing: "0.5px",
            }}
          >
            Career Hub
          </span>
        </div>
        {/* Reserve space for window controls and allow click events to pass through */}
        <div style={{ width: "110px", height: "100%", WebkitAppRegion: "no-drag" } as any} />
      </div>

      {/* Tab Navigation */}
      <div
        className="career-tabs"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 20px",
          background: "rgba(255, 255, 255, 0.02)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
        }}
      >
        <div style={{ display: "flex", gap: "8px" }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`career-tab ${careerTab === tab.id ? "career-tab-active" : ""}`}
              onClick={() => setCareerTab(tab.id)}
            >
              <span className="career-tab-icon">{tab.icon}</span>
              <span className="career-tab-label">{tab.label}</span>
            </button>
          ))}
        </div>

        <button
          className="career-reset-btn"
          onClick={() => setShowConfirmReset(true)}
          style={{
            background: "rgba(239, 68, 68, 0.08)",
            border: "1px solid rgba(239, 68, 68, 0.2)",
            color: "#f87171",
            padding: "6px 14px",
            borderRadius: "6px",
            fontSize: "13px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            transition: "all 0.2s ease",
            marginRight: "8px",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)";
            e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.4)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(239, 68, 68, 0.08)";
            e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.2)";
          }}
        >
          <span>🗑️</span>
          <span>Reset All</span>
        </button>
      </div>

      {/* Content */}
      <div className="career-content">
        {careerTab === "jobs" && <JobManager />}
        {careerTab === "tracking" && <JobBoard />}
        {careerTab === "tailor" && <TailorPanel />}
        {careerTab === "search" && <JobSearch />}
        {careerTab === "apply" && <ApplyPanel />}
      </div>

      {/* Premium Confirmation Modal Overlay */}
      {showConfirmReset && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            backdropFilter: "blur(4px)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: "#1e1e2e",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "12px",
              padding: "24px",
              maxWidth: "400px",
              width: "100%",
              boxShadow: "0 10px 25px rgba(0, 0, 0, 0.5)",
              textAlign: "center",
            }}
          >
            <h3
              style={{
                color: "#f87171",
                marginTop: 0,
                marginBottom: "12px",
                fontSize: "18px",
              }}
            >
              ⚠️ Reset Career Hub?
            </h3>
            <p
              style={{
                color: "#a6adc8",
                fontSize: "14px",
                lineHeight: "1.5",
                marginBottom: "24px",
              }}
            >
              This will permanently delete all saved jobs, tailored resumes,
              cover letters, and master resume settings. This action cannot be
              undone.
            </p>
            <div
              style={{ display: "flex", gap: "12px", justifyContent: "center" }}
            >
              <button
                onClick={() => setShowConfirmReset(false)}
                style={{
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  color: "#cdd6f4",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontSize: "14px",
                  cursor: "pointer",
                  transition: "background 0.2s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background =
                    "rgba(255, 255, 255, 0.05)")
                }
              >
                Cancel
              </button>
              <button
                onClick={handleResetAll}
                style={{
                  background: "#ef4444",
                  border: "none",
                  color: "#ffffff",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontSize: "14px",
                  fontWeight: "500",
                  cursor: "pointer",
                  transition: "background 0.2s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#dc2626")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "#ef4444")
                }
              >
                Yes, Reset Everything
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
