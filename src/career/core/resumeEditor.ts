/**
 * Resume Editor — Two-pass ATS-aware resume rewriting
 * Ported from cv-tailor/src/core/resumeEditor.ts
 * Uses synapse-ai's LLM adapter instead of Chrome extension providers.
 */

import type { LLMProvider, MasterResume, JDAnalysis } from './types';
import { PROMPTS } from './prompts';
import { normalizeResume } from './resumeParser';

export class ResumeEditor {
  constructor(private llm: LLMProvider) {}

  /**
   * Convert master resume to plain text for LLM
   */
  masterResumeToText(rawResume: MasterResume): string {
    const resume = normalizeResume(rawResume);
    const lines: string[] = [
      `# ${resume.name}`,
      `Email: ${resume.email}`,
    ];

    if (resume.phone) lines.push(`Phone: ${resume.phone}`);
    if (resume.location) lines.push(`Location: ${resume.location}`);
    if (resume.linkedin) lines.push(`LinkedIn: ${resume.linkedin}`);
    if (resume.github) lines.push(`GitHub: ${resume.github}`);
    if (resume.portfolio) lines.push(`Portfolio: ${resume.portfolio}`);

    if (resume.summary) {
      lines.push("", "## Summary", resume.summary);
    }

    if (resume.experience?.length) {
      lines.push("", "## Experience");
      for (const exp of resume.experience) {
        lines.push(`\n### ${exp.title} at ${exp.company}`);
        lines.push(`${exp.dates}${exp.location ? ` | ${exp.location}` : ""}`);
        for (const bullet of exp.bullets) {
          lines.push(`- ${bullet}`);
        }
      }
    }

    if (resume.education?.length) {
      lines.push("", "## Education");
      for (const edu of resume.education) {
        lines.push(`- ${edu.degree} - ${edu.school} (${edu.year})`);
      }
    }

    if (resume.categorized_skills?.length) {
      lines.push("", "## Skills");
      for (const cat of resume.categorized_skills) {
        lines.push(`- ${cat.label}: ${cat.items}`);
      }
    } else if (resume.skills?.length) {
      lines.push("", "## Skills");
      lines.push(resume.skills.join(", "));
    }

    if (resume.certifications?.length) {
      lines.push("", "## Certifications");
      for (const cert of resume.certifications) {
        lines.push(`- ${cert}`);
      }
    }

    if (resume.projects?.length) {
      lines.push("", "## Projects");
      for (const proj of resume.projects) {
        lines.push(`\n### ${proj.name}`);
        if (proj.bullets?.length) {
          for (const bullet of proj.bullets) {
            lines.push(`- ${bullet}`);
          }
        } else if (proj.description) {
          lines.push(proj.description);
        }
        if (proj.url) lines.push(`Link: ${proj.url}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Pass 1: Analyze job description for keywords
   */
  async analyzeJD(jobDescription: string): Promise<JDAnalysis> {
    console.log('[ResumeEditor] Pass 1: Analyzing JD with LLM...');
    const response = await this.llm.generate(
      PROMPTS.ats_analysis.user(jobDescription),
      {
        systemPrompt: PROMPTS.ats_analysis.system,
        temperature: 0.1,
        forceJson: true,
      }
    );

    const analysis = this.parseJsonResponse(response.content);
    console.log('[ResumeEditor] JD Analysis result:', {
      hardSkills: analysis.hard_skills?.length ?? 0,
      tools: analysis.tools_technologies?.length ?? 0,
      mustHave: analysis.keyword_priorities?.must_have?.length ?? 0,
    });

    return analysis;
  }

  /**
   * Pass 2: Rewrite resume using JD analysis
   */
  async rewriteResume(
    masterResume: MasterResume,
    jdAnalysis: JDAnalysis,
    jobTitle: string,
    company: string,
    rawResumeText?: string
  ): Promise<string> {
    const masterText = rawResumeText || this.masterResumeToText(masterResume);
    const jdAnalysisStr = JSON.stringify(jdAnalysis, null, 2);

    console.log('[ResumeEditor] Pass 2: Rewriting resume for', jobTitle, 'at', company);

    const response = await this.llm.generate(
      PROMPTS.resume_rewrite.user(masterText, jdAnalysisStr, jobTitle, company),
      {
        systemPrompt: PROMPTS.resume_rewrite.system,
        temperature: 0.2,
      }
    );

    const rewritten = response.content.trim();
    console.log('[ResumeEditor] Pass 2 complete. Length:', rewritten.length, 'chars');

    return rewritten;
  }

  /**
   * Full optimization pipeline
   */
  async optimize(
    masterResume: MasterResume,
    jobDescription: string,
    jobTitle: string,
    company: string,
    rawResumeText?: string
  ): Promise<{ resume: string; jdAnalysis: JDAnalysis }> {
    console.log('[ResumeEditor] Starting 2-pass optimization pipeline for:', jobTitle, 'at', company);

    const jdAnalysis = await this.analyzeJD(jobDescription);
    const resume = await this.rewriteResume(masterResume, jdAnalysis, jobTitle, company, rawResumeText);

    console.log('[ResumeEditor] ✅ Optimization pipeline complete');
    return { resume, jdAnalysis };
  }

  private parseJsonResponse(content: string): JDAnalysis {
    try {
      return JSON.parse(content);
    } catch {
      const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) return JSON.parse(match[1]);
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
      throw new Error("Failed to parse JD analysis JSON");
    }
  }
}
