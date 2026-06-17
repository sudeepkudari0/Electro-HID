/**
 * Job Manager — Save, view, and manage jobs
 */

import { useState, useMemo, useEffect } from "react";
import { useJobStore, useCareerProfileStore } from "../../career/state/career-store";
import type { Job, JobStatus } from "../../career/core/types";
import { useNavigationStore } from "@/state/navigation-store";
import { DataTable } from "../../components/ui/DataTable";
import { ColumnDef } from "@tanstack/react-table";
import {
  ExternalLink,
  Sparkles,
  Trash2,
  ChevronDown,
  ChevronUp,
  MapPin,
  Building2,
  Calendar,
  Briefcase,
  Play
} from "lucide-react";

const STATUS_OPTIONS: {
  value: JobStatus | "all";
  label: string;
  color: string;
}[] = [
  { value: "all", label: "All Jobs", color: "#6366f1" },
  { value: "saved", label: "Saved", color: "#3b82f6" },
  { value: "applied", label: "Applied", color: "#f59e0b" },
  { value: "interviewing", label: "Interviewing", color: "#10b981" },
  { value: "offered", label: "Offered", color: "#22c55e" },
  { value: "rejected", label: "Rejected", color: "#ef4444" },
  { value: "archived", label: "Archived", color: "#6b7280" },
];

export function JobManager() {
  const {
    jobs,
    searchQuery,
    statusFilter,
    setSearchQuery,
    setStatusFilter,
    addJob,
    updateJob,
    removeJob,
    getFilteredJobs,
    setBulkTailorJobIds,
  } = useJobStore();
  const { profile } = useCareerProfileStore();
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  // Selection states
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Clear selection on filter changes
  useEffect(() => {
    setRowSelection({});
  }, [statusFilter]);

  const filteredJobs = getFilteredJobs();

  const selectedJobIds = useMemo(() => {
    return Object.keys(rowSelection).filter((id) => rowSelection[id]);
  }, [rowSelection]);

  const selectedJobs = useMemo(() => {
    return jobs.filter((j) => selectedJobIds.includes(j.id));
  }, [jobs, selectedJobIds]);

  const handleBulkStatusChange = (newStatus: JobStatus) => {
    if (selectedJobIds.length === 0) return;
    
    selectedJobIds.forEach((id) => {
      updateJob(id, { status: newStatus });
    });
    
    const updatedJobs = jobs.map((j) =>
      selectedJobIds.includes(j.id)
        ? { ...j, status: newStatus, updatedAt: new Date().toISOString() }
        : j
    );
    (window as any).electronAPI?.careerHub?.saveJobs?.(updatedJobs);
    
    setRowSelection({});
  };

  const handleBulkOpenInBrowser = () => {
    const jobsToOpen = selectedJobs.filter(j => j.url).map(job => ({
      id: job.id,
      url: job.url,
      title: job.title,
      company: job.company
    }));

    if (jobsToOpen.length > 0) {
      if ((window as any).electronAPI?.careerHub?.runAutofillSession) {
        (window as any).electronAPI.careerHub.runAutofillSession({
          jobs: jobsToOpen,
          profile: profile
        }, (status: any) => console.log('Autofill status:', status));
      } else {
        jobsToOpen.forEach(j => window.open(j.url, "_blank"));
      }
    }
  };

  const handleBulkTailor = () => {
    if (selectedJobIds.length === 0) return;
    
    setBulkTailorJobIds(selectedJobIds);
    
    const navStore = useNavigationStore.getState();
    navStore.setCareerTab("tailor");
    
    setRowSelection({});
  };

  const handleBulkDelete = () => {
    selectedJobIds.forEach((id) => {
      removeJob(id);
    });
    
    const updatedJobs = jobs.filter((j) => !selectedJobIds.includes(j.id));
    (window as any).electronAPI?.careerHub?.saveJobs?.(updatedJobs);
    
    setRowSelection({});
    setShowDeleteConfirm(false);
  };

  const handleAddJob = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const newJob: Job = {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      url: (fd.get("url") as string) || "",
      title: (fd.get("title") as string) || "",
      company: (fd.get("company") as string) || "",
      location: (fd.get("location") as string) || "",
      description: (fd.get("description") as string) || "",
      isRemote: (fd.get("isRemote") as string) === "on",
      source: (fd.get("source") as string) || "manual",
      dateFound: new Date().toISOString(),
      status: "saved",
      notes: "",
      updatedAt: new Date().toISOString(),
    };

    addJob(newJob);
    // Persist
    (window as any).electronAPI?.careerHub?.saveJobs?.([...jobs, newJob]);
    setShowAddForm(false);
    form.reset();
  };

  const handleStatusChange = (jobId: string, newStatus: JobStatus) => {
    updateJob(jobId, { status: newStatus });
    const updatedJobs = jobs.map((j) =>
      j.id === jobId ? { ...j, status: newStatus } : j
    );
    (window as any).electronAPI?.careerHub?.saveJobs?.(updatedJobs);
  };

  // Define table columns
  const columns = useMemo<ColumnDef<Job>[]>(() => [
    {
      id: "expander",
      header: () => null,
      cell: ({ row }) => {
        const isExpanded = expandedJobId === row.original.id;
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpandedJobId(isExpanded ? null : row.original.id);
            }}
            className="p-1 hover:bg-white/5 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
          >
            {isExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        );
      },
    },
    {
      accessorKey: "title",
      header: "Role / Company",
      cell: ({ row }) => {
        const job = row.original;
        return (
          <div className="flex flex-col">
            <span className="font-semibold text-slate-100">{job.title}</span>
            <span className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
              <Building2 className="w-3.5 h-3.5 text-slate-500" />
              {job.company}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "location",
      header: "Location",
      cell: ({ row }) => {
        const job = row.original;
        return (
          <div className="flex flex-wrap gap-1.5 items-center">
            {job.location && (
              <span className="text-xs text-slate-300 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-slate-500" />
                {job.location}
              </span>
            )}
            {job.isRemote && (
              <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-md">
                Remote
              </span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "fitScore",
      header: "Fit Score",
      cell: ({ row }) => {
        const score = row.original.fitScore;
        if (score === undefined || score === null) {
          return <span className="text-slate-500 text-xs">—</span>;
        }

        let colorClass = "bg-rose-500/10 text-rose-400 border-rose-500/20";
        if (score >= 7) {
          colorClass = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
        } else if (score >= 5) {
          colorClass = "bg-amber-500/10 text-amber-400 border-amber-500/20";
        }

        return (
          <span className={`px-2 py-0.5 text-xs font-semibold border rounded-md ${colorClass}`}>
            {score}/10
          </span>
        );
      },
    },
    {
      accessorKey: "dateFound",
      header: "Date Added",
      cell: ({ row }) => {
        const date = new Date(row.original.dateFound);
        return (
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-slate-500" />
            {date.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const job = row.original;
        const currentStatusOpt =
          STATUS_OPTIONS.find((o) => o.value === job.status) || STATUS_OPTIONS[1];
        return (
          <select
            value={job.status}
            onChange={(e) => handleStatusChange(job.id, e.target.value as JobStatus)}
            onClick={(e) => e.stopPropagation()}
            className="px-2 py-1 text-xs bg-white/5 border border-white/10 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500/50 cursor-pointer transition-colors"
            style={{ color: currentStatusOpt.color }}
          >
            {STATUS_OPTIONS.filter((o) => o.value !== "all").map((opt) => (
              <option
                key={opt.value}
                value={opt.value}
                className="bg-[#0f1117] text-slate-300"
              >
                {opt.label}
              </option>
            ))}
          </select>
        );
      },
    },
    {
      id: "actions",
      header: () => <div className="text-right">Actions</div>,
      cell: ({ row }) => {
        const job = row.original;
        return (
          <div
            className="flex items-center justify-end gap-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            {job.url && (
              <button
                onClick={() => {
                  if ((window as any).electronAPI?.careerHub?.runAutofillSession) {
                    (window as any).electronAPI.careerHub.runAutofillSession({
                      jobs: [{
                        id: job.id,
                        url: job.url,
                        title: job.title,
                        company: job.company
                      }],
                      profile: profile
                    }, (status: any) => console.log('Autofill status:', status));
                  } else if ((window as any).electronAPI?.openExternal) {
                    (window as any).electronAPI.openExternal(job.url);
                  } else {
                    window.open(job.url, "_blank");
                  }
                }}
                className="p-1.5 hover:bg-white/5 text-slate-400 hover:text-slate-200 rounded-lg transition-all"
                title="View Posting"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => {
                const prepJob = {
                  role: job.title || '',
                  company: job.company || '',
                  jobDescription: job.description || ''
                };
                localStorage.setItem('prepJob', JSON.stringify(prepJob));
                useNavigationStore.getState().setActiveModule('interview');
              }}
              className="p-1.5 hover:bg-emerald-500/10 text-emerald-400 hover:text-emerald-300 rounded-lg transition-all"
              title="Prep for this Job"
            >
              <Play className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                const navStore = useNavigationStore.getState();
                const jobStoreState = useJobStore.getState();
                jobStoreState.setSelectedJob(job.id);
                navStore.setCareerTab("tailor");
              }}
              className="p-1.5 hover:bg-indigo-500/10 text-indigo-400 hover:text-indigo-300 rounded-lg transition-all"
              title="Tailor Resume"
            >
              <Sparkles className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                removeJob(job.id);
                const updatedJobs = jobs.filter((j) => j.id !== job.id);
                (window as any).electronAPI?.careerHub?.saveJobs?.(updatedJobs);
              }}
              className="p-1.5 hover:bg-rose-500/10 text-rose-400 hover:text-rose-300 rounded-lg transition-all"
              title="Remove Job"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      },
    },
  ], [jobs, expandedJobId]);

  const renderExpandedRow = (job: Job) => {
    return (
      <div className="space-y-3 text-slate-300 text-xs">
        {job.description && (
          <div>
            <h4 className="font-semibold text-slate-400 mb-1 flex items-center gap-1.5">
              <Briefcase className="w-3.5 h-3.5 text-slate-500" />
              Description
            </h4>
            <p className="whitespace-pre-line leading-relaxed text-slate-400 max-h-48 overflow-y-auto pr-2 bg-white/[0.01] p-3 rounded-lg border border-white/5">
              {job.description}
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-[11px] text-slate-500 border-t border-white/5 pt-2">
          <span>Found: {new Date(job.dateFound).toLocaleString()}</span>
          <span>Source: {job.source || "Manual"}</span>
          {job.updatedAt && (
            <span>Updated: {new Date(job.updatedAt).toLocaleString()}</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="job-manager">
      {/* Search & Filter Bar */}
      <div className="jm-toolbar">
        <div className="jm-search">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search jobs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="jm-filters">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`jm-filter-btn ${statusFilter === opt.value ? "jm-filter-active" : ""}`}
              onClick={() => setStatusFilter(opt.value)}
              style={
                statusFilter === opt.value
                  ? { borderColor: opt.color, color: opt.color }
                  : {}
              }
            >
              {opt.label}
              {opt.value !== "all" && (
                <span className="jm-filter-count">
                  {jobs.filter((j) => j.status === opt.value).length}
                </span>
              )}
            </button>
          ))}
        </div>

        <button
          className="jm-add-btn"
          onClick={() => setShowAddForm(!showAddForm)}
        >
          {showAddForm ? "✕ Cancel" : "+ Add Job"}
        </button>
      </div>

      {/* Add Job Form */}
      {showAddForm && (
        <form className="jm-add-form animate-in fade-in slide-in-from-top-3 duration-200" onSubmit={handleAddJob}>
          <div className="jm-form-grid">
            <input name="title" placeholder="Job Title *" required />
            <input name="company" placeholder="Company *" required />
            <input name="location" placeholder="Location" />
            <input name="url" placeholder="Job URL" type="url" />
            <input name="source" placeholder="Source (e.g. LinkedIn)" />
            <label className="jm-remote-label">
              <input name="isRemote" type="checkbox" />
              Remote
            </label>
          </div>
          <textarea
            name="description"
            placeholder="Job description (paste here)"
            rows={4}
          />
          <button type="submit" className="jm-submit-btn">
            Save Job
          </button>
        </form>
      )}

      {/* Bulk Actions Panel */}
      {selectedJobIds.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-indigo-500/10 border border-indigo-500/25 rounded-2xl mb-4 animate-in fade-in slide-in-from-top-3 duration-200">
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-1 text-xs font-semibold bg-indigo-500 text-white rounded-lg">
              {selectedJobIds.length} Selected
            </span>
            <button
              onClick={() => setRowSelection({})}
              className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              Clear selection
            </button>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            {/* Status Change Dropdown */}
            <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-slate-300">
              <span className="text-slate-400">Status:</span>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    handleBulkStatusChange(e.target.value as JobStatus);
                  }
                }}
                className="bg-transparent border-none p-0 text-indigo-400 focus:outline-none focus:ring-0 cursor-pointer font-medium"
              >
                <option value="" disabled className="bg-[#0f1117] text-slate-500 font-semibold">Change status...</option>
                {STATUS_OPTIONS.filter((o) => o.value !== "all").map((opt) => (
                  <option
                    key={opt.value}
                    value={opt.value}
                    className="bg-[#0f1117] text-slate-300 font-semibold"
                  >
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Open in Browser */}
            <button
              onClick={handleBulkOpenInBrowser}
              disabled={!selectedJobs.some((j) => j.url)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
              title="Open all selected URLs in browser"
            >
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
              <span>Open Links</span>
            </button>

            {/* Tailor Resume */}
            <button
              onClick={handleBulkTailor}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 transition-all cursor-pointer"
              title="Tailor resumes for selected jobs"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Tailor CV</span>
            </button>

            {/* Delete */}
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/25 text-rose-400 transition-all cursor-pointer"
              title="Delete selected jobs"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete</span>
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal Overlay */}
      {showDeleteConfirm && (
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
              ⚠️ Delete Selected Jobs?
            </h3>
            <p
              style={{
                color: "#a6adc8",
                fontSize: "14px",
                lineHeight: "1.5",
                marginBottom: "24px",
              }}
            >
              Are you sure you want to permanently delete the {selectedJobIds.length} selected job(s)? This action cannot be undone.
            </p>
            <div
              style={{ display: "flex", gap: "12px", justifyContent: "center" }}
            >
              <button
                onClick={() => setShowDeleteConfirm(false)}
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
                onClick={handleBulkDelete}
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
                Yes, Delete Jobs
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Job List */}
      <div className="jm-list">
        {filteredJobs.length === 0 ? (
          <div className="jm-empty">
            <div className="jm-empty-icon">📋</div>
            <h3>No jobs yet</h3>
            <p>
              Add jobs manually or use the Job Search tab to discover opportunities.
            </p>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={filteredJobs}
            expandedRowId={expandedJobId}
            renderExpandedRow={renderExpandedRow}
            enableSelection={true}
            rowSelection={rowSelection}
            onRowSelectionChange={setRowSelection}
          />
        )}
      </div>

      {/* Stats */}
      {jobs.length > 0 && (
        <div className="jm-stats">
          <div className="jm-stat">
            <span className="jm-stat-value">{jobs.length}</span>
            <span className="jm-stat-label">Total</span>
          </div>
          <div className="jm-stat">
            <span className="jm-stat-value">
              {jobs.filter((j) => j.status === "applied").length}
            </span>
            <span className="jm-stat-label">Applied</span>
          </div>
          <div className="jm-stat">
            <span className="jm-stat-value">
              {jobs.filter((j) => j.status === "interviewing").length}
            </span>
            <span className="jm-stat-label">Interviewing</span>
          </div>
        </div>
      )}
    </div>
  );
}
