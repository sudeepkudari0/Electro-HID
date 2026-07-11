/**
 * Tailor Panel — Resume tailoring + cover letter generation
 * Uses ported cv-tailor core logic via the Electron LLM adapter.
 */

import { useState, useEffect, useMemo } from "react";
import { useJobStore } from "../../career/state/career-store";
import { useTailoringStore } from "../../career/state/career-store";
import { ElectronLLMProvider } from "../../career/core/llm-adapter";
import { ResumeEditor } from "../../career/core/resumeEditor";
import { CoverLetterGenerator } from "../../career/core/coverLetter";
import {
  generateResumePDF,
  generateResumePDFBlob,
  buildFilename,
} from "../../career/core/pdfGenerator";
import type { Job } from "../../career/core/types";
import { DataTable } from "../../components/ui/DataTable";
import { ColumnDef } from "@tanstack/react-table";
import {
  ChevronDown,
  ChevronUp,
  Building2,
  MapPin,
  Sparkles,
  RefreshCw,
  Download,
  Copy,
  Check,
  Loader2,
  Briefcase,
  Globe,
} from "lucide-react";

export function TailorPanel() {
  const { jobs, updateJob, bulkTailorJobIds, setBulkTailorJobIds } = useJobStore();
  
  const displayJobs = useMemo(() => {
    if (bulkTailorJobIds && bulkTailorJobIds.length > 0) {
      return jobs.filter((j) => bulkTailorJobIds.includes(j.id));
    }
    return jobs.filter((j) => j.status === "saved");
  }, [jobs, bulkTailorJobIds]);

  const savedJobs = displayJobs;

  const {
    masterResume,
    isGenerating,
    generatingStatus,
    error,
    setMasterResume,
    setMasterResumeYaml,
    setIsGenerating,
    setGeneratingStatus,
    setError,
    reset,
  } = useTailoringStore();

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [copySuccessId, setCopySuccessId] = useState<string | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});

  const selectedJobIds = useMemo(() => {
    return Object.keys(rowSelection).filter((id) => rowSelection[id]);
  }, [rowSelection]);

  const selectedJobs = useMemo(() => {
    return jobs.filter((j) => selectedJobIds.includes(j.id));
  }, [jobs, selectedJobIds]);

  useEffect(() => {
    setRowSelection({});
  }, [bulkTailorJobIds]);

  // Auto-trigger tailoring if bulk selected jobs are set and master resume is available
  useEffect(() => {
    if (bulkTailorJobIds && bulkTailorJobIds.length > 0 && masterResume && !isGenerating) {
      const timer = setTimeout(() => {
        handleTailorAll();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [bulkTailorJobIds, masterResume]);

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

        // Extract and structure profile info from the resume YAML for the auto-apply runner
        const profileData = {
          fullName: parsed.name || parsed.personal?.name || parsed.person?.name || parsed.personal_info?.name || "",
          email: parsed.email || parsed.personal?.email || parsed.person?.email || parsed.personal_info?.email || "",
          phone: parsed.phone || parsed.personal?.phone || parsed.person?.phone || parsed.personal_info?.phone || "",
          location: parsed.location || parsed.personal?.location || parsed.person?.location || parsed.personal_info?.location || "",
          linkedinUrl: parsed.linkedin || parsed.personal?.linkedin || parsed.person?.linkedin || parsed.links?.linkedin || parsed.linkedinUrl || parsed.personal?.linkedinUrl || parsed.person?.linkedinUrl || "",
          githubUrl: parsed.github || parsed.personal?.github || parsed.person?.github || parsed.links?.github || parsed.githubUrl || parsed.personal?.githubUrl || parsed.person?.githubUrl || "",
          portfolioUrl: parsed.portfolio || parsed.personal?.portfolio || parsed.person?.portfolio || parsed.links?.portfolio || parsed.portfolioUrl || parsed.personal?.portfolioUrl || parsed.person?.portfolioUrl || "",
          masterResumeYaml: text,
          masterResumeText: parsed.summary || parsed.personal?.summary || parsed.person?.summary || parsed.personal_info?.summary || "",
          updatedAt: new Date().toISOString()
        };

        await (window as any).electronAPI?.careerHub?.saveProfile?.(profileData);
        setError(null);
      } catch (err: any) {
        setError("Invalid YAML file: " + err.message);
      }
    };
    reader.readAsText(file);
  };

  const processJob = async (job: Job) => {
    if (!masterResume) throw new Error("Master resume is missing");

    const provider = new ElectronLLMProvider();
    const resumeEditor = new ResumeEditor(provider);
    const coverLetterGen = new CoverLetterGenerator(provider);

    let jd = job.description || job.fullDescription || "";

    // Fetch JD if too short
    if (jd.length < 200 && job.url) {
      if (!(window as any).electronAPI?.careerHub?.fetchUrl) {
        throw new Error(
          "Backend update required: Please completely restart the Synapse AI app.",
        );
      }
      setGeneratingStatus("Fetching job page...");
      const fetchRes = await (window as any).electronAPI.careerHub.fetchUrl(
        job.url,
      );
      if (fetchRes?.success && fetchRes.html) {
        setGeneratingStatus("Extracting job description...");
        const html = fetchRes.html
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ");

        const extractPrompt = `You are a job description extractor. Extract ONLY the job description (responsibilities, requirements, qualifications, etc.) from the following text. Do not include headers, footers, or navigation links.\n\nTEXT:\n${html.substring(0, 30000)}`;
        const jdExtractedResponse = await provider.generate(extractPrompt, {
          systemPrompt: "You are an expert recruiter.",
          temperature: 0.1,
        });
        const jdExtracted = jdExtractedResponse.content;

        if (jdExtracted && jdExtracted.length > 50) {
          jd = jdExtracted;
          updateJob(job.id, { description: jdExtracted });
          const updatedJobs = useJobStore.getState().jobs;
          await (window as any).electronAPI?.careerHub?.saveJobs?.(updatedJobs);
        }
      }
    }

    if (!jd.trim()) {
      throw new Error("Could not find or extract Job Description.");
    }

    setGeneratingStatus("Analyzing job description...");
    const { resume } = await resumeEditor.optimize(
      masterResume,
      jd,
      job.title,
      job.company,
    );

    setGeneratingStatus("Generating cover letter...");
    const letter = await coverLetterGen.generate(
      job.company,
      job.title,
      jd,
      resume,
    );

    // Save outputs directly to the job object for persistence
    updateJob(job.id, {
      tailoredResumeText: resume,
      coverLetterText: letter,
    });
    const updatedJobs = useJobStore.getState().jobs;
    await (window as any).electronAPI?.careerHub?.saveJobs?.(updatedJobs);
  };

  const handleTailorJob = async (job: Job) => {
    if (!masterResume) {
      setError("Please upload your master resume YAML first");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setActiveJobId(job.id);
    reset();
    setIsGenerating(true);
    setError(null);

    try {
      await processJob(job);
      setGeneratingStatus("");
    } catch (err: any) {
      setError(err.message || "Generation failed");
      setGeneratingStatus("");
    } finally {
      setIsGenerating(false);
      setActiveJobId(null);
    }
  };

  const handleTailorAll = async () => {
    if (!masterResume) {
      setError("Please upload your master resume YAML first");
      return;
    }

    // If bulk selection is active, process all of them. Otherwise process pending saved jobs.
    const jobsToProcess = bulkTailorJobIds && bulkTailorJobIds.length > 0
      ? savedJobs
      : savedJobs.filter((j) => !j.tailoredResumeText || !j.coverLetterText);

    if (jobsToProcess.length === 0) {
      alert("No jobs to process!");
      return;
    }

    reset();
    setIsGenerating(true);
    setError(null);

    try {
      for (const job of jobsToProcess) {
        setActiveJobId(job.id);
        await processJob(job);
      }
      setGeneratingStatus("");
    } catch (err: any) {
      setError(err.message || "Generation failed");
    } finally {
      setIsGenerating(false);
      setActiveJobId(null);
      setBulkTailorJobIds([]);
    }
  };

  const handleCopy = (jobId: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopySuccessId(jobId);
    setTimeout(() => setCopySuccessId(null), 2000);
  };

  const handleDownloadPDF = async (resumeText: string) => {
    if (!resumeText || !masterResume) return;
    try {
      const filename = buildFilename(masterResume.name);
      await generateResumePDF(resumeText, filename, masterResume);
    } catch (err: any) {
      setError("PDF generation failed: " + err.message);
    }
  };

  const handleOpenSelectedInBrowser = async () => {
    if (!masterResume) {
      setError("Please upload your master resume first.");
      return;
    }

    const jobsToOpen = selectedJobs.filter(j => j.url);
    if (jobsToOpen.length === 0) {
      alert("None of the selected jobs have a valid application URL.");
      return;
    }

    setIsGenerating(true);
    setGeneratingStatus("Compiling PDFs for browser session...");
    setError(null);

    try {
      const jobsPayload = await Promise.all(
        jobsToOpen.map(async (job) => {
          let base64 = "";
          const textToUse = job.tailoredResumeText || "";
          if (textToUse) {
            const blob = await generateResumePDFBlob(
              textToUse,
              masterResume
            );
            base64 = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.readAsDataURL(blob);
              reader.onloadend = () => {
                resolve((reader.result as string).split(",")[1]);
              };
            });
          }
          
          return {
            id: job.id,
            title: job.title,
            company: job.company,
            url: job.url,
            coverLetterText: job.coverLetterText || "",
            resumePdfBase64: base64
          };
        })
      );

      const profileRes = await (window as any).electronAPI.careerHub.loadProfile();
      const candidateProfile = profileRes?.success ? profileRes.profile : {};

      setGeneratingStatus("Launching browser context...");
      const res = await (window as any).electronAPI.careerHub.runAutofillSession({
        jobs: jobsPayload,
        profile: candidateProfile
      });

      if (res?.success) {
        setError(null);
      } else if (res?.error) {
        setError(res.error);
      }
    } catch (err: any) {
      console.error(err);
      setError("Error launching browser: " + err.message);
    } finally {
      setIsGenerating(false);
      setGeneratingStatus("");
      setRowSelection({});
    }
  };

  // Define columns for DataTable
  const columns = useMemo<ColumnDef<Job>[]>(
    () => [
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
        accessorKey: "source",
        header: "Source",
        cell: ({ row }) => {
          return (
            <span className="px-2 py-0.5 text-xs bg-white/5 border border-white/10 rounded-md text-slate-300">
              {row.original.source || "Saved"}
            </span>
          );
        },
      },
      {
        id: "status",
        header: "Tailoring Status",
        cell: ({ row }) => {
          const job = row.original;
          const isTailored = !!job.tailoredResumeText || !!job.coverLetterText;
          return isTailored ? (
            <span className="px-2 py-0.5 text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-md">
              Optimized
            </span>
          ) : (
            <span className="px-2 py-0.5 text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-md">
              Pending
            </span>
          );
        },
      },
      {
        id: "actions",
        header: () => <div className="text-right">Actions</div>,
        cell: ({ row }) => {
          const job = row.original;
          const isProcessing = isGenerating && activeJobId === job.id;
          const isTailored = !!job.tailoredResumeText || !!job.coverLetterText;

          return (
            <div
              className="flex items-center justify-end gap-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Tailor Button */}
              <button
                onClick={() => handleTailorJob(job)}
                disabled={isGenerating}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                  isProcessing
                    ? "bg-indigo-500/20 border-indigo-500/30 text-indigo-400 cursor-not-allowed"
                    : isTailored
                      ? "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
                      : "bg-indigo-500 border-indigo-600 text-white hover:bg-indigo-600"
                }`}
                title={
                  isProcessing
                    ? generatingStatus || "Tailoring..."
                    : isTailored
                      ? "Re-Tailor Resume"
                      : "Tailor Resume"
                }
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{generatingStatus || "Working..."}</span>
                  </>
                ) : isTailored ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" />
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                  </>
                )}
              </button>

              {/* Download PDF Button */}
              {job.tailoredResumeText && (
                <button
                  onClick={() => handleDownloadPDF(job.tailoredResumeText!)}
                  className="p-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 hover:text-blue-300 border border-blue-500/20 rounded-lg transition-all"
                  title="Download Tailored Resume PDF"
                >
                  <Download className="w-4 h-4" />
                </button>
              )}

              {/* Copy Cover Letter Button */}
              {job.coverLetterText && (
                <button
                  onClick={() => handleCopy(job.id, job.coverLetterText!)}
                  className={`p-1.5 border rounded-lg transition-all ${
                    copySuccessId === job.id
                      ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                      : "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 border-emerald-500/20"
                  }`}
                  title="Copy Cover Letter"
                >
                  {copySuccessId === job.id ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              )}
            </div>
          );
        },
      },
    ],
    [isGenerating, activeJobId, generatingStatus, copySuccessId, expandedJobId],
  );

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
        </div>
      </div>
    );
  };

  return (
    <div className="tailor-panel js-dashboard">
      {/* Header section */}
      <div
        className="js-header"
        style={{
          marginBottom: "24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <h2 className="js-header-title">✨ Tailor CV & Apply</h2>
          <p className="js-header-subtitle">
            Extract JDs, automatically tailor your Master Resume, and generate
            Cover Letters instantly.
          </p>
        </div>

        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          {selectedJobIds.length > 0 && (
            <button
              onClick={handleOpenSelectedInBrowser}
              disabled={isGenerating}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition shadow-lg shadow-indigo-600/15 disabled:opacity-50"
            >
              <Globe className="w-4 h-4" />
              <span>Open Selected ({selectedJobIds.length})</span>
            </button>
          )}

          <label
            className="js-btn-view"
            style={{ cursor: "pointer", background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", gap: "6px" }}
          >
            📄 {masterResume ? "Update Master Resume" : "Upload Master Resume"}
            <input
              type="file"
              accept=".yaml,.yml"
              onChange={handleYamlUpload}
              hidden
            />
          </label>

          <button
            className={`js-btn-primary ${isGenerating ? "tailor-generating" : ""}`}
            onClick={handleTailorAll}
            disabled={isGenerating || savedJobs.length === 0 || !masterResume}
          >
            {bulkTailorJobIds && bulkTailorJobIds.length > 0 ? "Tailor Selected" : "Tailor All"}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="js-error-card" style={{ marginBottom: "24px" }}>
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* Bulk selection banner */}
      {bulkTailorJobIds && bulkTailorJobIds.length > 0 && (
        <div className="flex items-center justify-between p-3.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-slate-200 text-xs mb-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <span className="flex items-center gap-2 font-medium">
            <Sparkles className="w-4.5 h-4.5 text-indigo-400 animate-pulse" />
            Showing {bulkTailorJobIds.length} job(s) selected for bulk tailoring.
          </span>
          <button
            onClick={() => setBulkTailorJobIds([])}
            className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-slate-300 transition-colors text-xs font-semibold cursor-pointer"
          >
            Show All Saved Jobs
          </button>
        </div>
      )}

      {/* Saved Jobs Grid */}
      <div className="space-y-4" style={{ marginBottom: "24px" }}>
        {savedJobs.length === 0 ? (
          <div
            className="js-glass-panel"
            style={{
              padding: "32px",
              textAlign: "center",
              color: "rgba(255, 255, 255, 0.5)",
            }}
          >
            <p>
              {bulkTailorJobIds && bulkTailorJobIds.length > 0
                ? "No matching selected jobs found."
                : "No saved jobs found. Search for jobs and save them to see them here."}
            </p>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={savedJobs}
            expandedRowId={expandedJobId}
            renderExpandedRow={renderExpandedRow}
            enableSelection={true}
            rowSelection={rowSelection}
            onRowSelectionChange={setRowSelection}
          />
        )}
      </div>
    </div>
  );
}
