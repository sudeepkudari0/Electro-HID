/**
 * Resume Parser
 * Ported from cv-tailor/src/core/resumeParser.ts
 * Parses LLM-rewritten plain-text resume back into a MasterResume structure.
 */

import type { MasterResume } from './types';

interface ParsedSections {
  summary?: string;
  experiences: ParsedExperience[];
  projects: ParsedProject[];
  skills: string[];
  categorized_skills: { label: string; items: string }[];
}

interface ParsedExperience {
  title: string;
  company: string;
  bullets: string[];
  internBullets: string[];
}

interface ParsedProject {
  name: string;
  bullets: string[];
}

export function parseRewrittenResume(text: string): ParsedSections {
  const lines = text.split('\n').map((l) => l.trim());
  const result: ParsedSections = {
    experiences: [],
    projects: [],
    skills: [],
    categorized_skills: [],
  };

  let currentSection: 'none' | 'summary' | 'experience' | 'projects' | 'skills' | 'education' = 'none';
  let currentExp: ParsedExperience | null = null;
  let currentProject: ParsedProject | null = null;
  let inInternSection = false;
  let summaryLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const sectionHeader = detectSectionHeader(line);
    if (sectionHeader) {
      if (currentExp) { result.experiences.push(currentExp); currentExp = null; }
      if (currentProject) { result.projects.push(currentProject); currentProject = null; }
      currentSection = sectionHeader;
      inInternSection = false;
      continue;
    }

    switch (currentSection) {
      case 'summary':
        if (!isBullet(line) && !isSubheading(line)) summaryLines.push(line);
        break;

      case 'experience': {
        if (line.toLowerCase().includes('full-time') || line.toLowerCase().includes('full time')) {
          inInternSection = false; continue;
        }
        if (line.toLowerCase().includes('intern') && !isBullet(line)) {
          inInternSection = true; continue;
        }

        const expMatch = line.match(/^#{2,3}\s+(.+?)\s+(?:at|[-–—])\s+(.+)/i) ||
          line.match(/^(?:\*\*)?(.+?)(?:\*\*)?,\s*(?:\*\*)?(.+?)(?:\*\*)?$/);

        if (expMatch && !isBullet(line) && !isDateLine(line) && !isTechLine(line)) {
          if (currentExp) result.experiences.push(currentExp);
          currentExp = {
            title: expMatch[1].replace(/[*#]/g, '').trim(),
            company: expMatch[2].replace(/[*#]/g, '').trim(),
            bullets: [],
            internBullets: [],
          };
          inInternSection = false;
          continue;
        }

        if (isDateLine(line) || isTechLine(line) || isLocationLine(line)) continue;

        if (isBullet(line) && currentExp) {
          const bulletText = extractBulletText(line);
          if (bulletText) {
            if (inInternSection) currentExp.internBullets.push(bulletText);
            else currentExp.bullets.push(bulletText);
          }
        }
        break;
      }

      case 'projects': {
        const projMatch = line.match(/^#{2,3}\s+(.+)/) ||
          line.match(/^(?:\*\*)?([^-•*\n].{3,})(?:\*\*)?$/);

        if (projMatch && !isBullet(line) && !isLinkLine(line)) {
          if (currentProject) result.projects.push(currentProject);
          currentProject = {
            name: projMatch[1].replace(/[*#]/g, '').replace(/\|.*$/, '').trim(),
            bullets: [],
          };
          continue;
        }

        if (isLinkLine(line)) continue;

        if (isBullet(line) && currentProject) {
          const bulletText = extractBulletText(line);
          if (bulletText) currentProject.bullets.push(bulletText);
        }
        break;
      }

      case 'skills': {
        const skillLine = line.replace(/^[-•*]\s+/, '').replace(/\*\*/g, '').trim();
        if (skillLine) {
          const colonIdx = skillLine.indexOf(':');
          if (colonIdx !== -1 && colonIdx < 40) {
            const label = skillLine.substring(0, colonIdx).trim();
            const items = skillLine.substring(colonIdx + 1).replace(/\.$/, '').trim();
            result.categorized_skills.push({ label, items });
          } else {
            const skills = skillLine.split(/[,;]/).map((s) => s.replace(/\.$/, '').trim()).filter((s) => s.length > 0);
            result.skills.push(...skills);
          }
        }
        break;
      }

      case 'none': {
        if (i > 5 && !isContactLine(line)) summaryLines.push(line);
        break;
      }
    }
  }

  if (currentExp) result.experiences.push(currentExp);
  if (currentProject) result.projects.push(currentProject);
  if (summaryLines.length > 0) result.summary = summaryLines.join(' ').trim();

  return result;
}

function detectSectionHeader(line: string): 'summary' | 'experience' | 'projects' | 'skills' | 'education' | null {
  const lower = line.toLowerCase().replace(/[#*_\-=]/g, '').trim();
  if (/^summary|^bio|^profile|^about|^objective/i.test(lower)) return 'summary';
  if (/^experience|^employment|^work\s*history|^professional\s*experience/i.test(lower)) return 'experience';
  if (/^project/i.test(lower)) return 'projects';
  if (/^skill|^technical\s*skill|^core\s*competenc/i.test(lower)) return 'skills';
  if (/^education|^academic/i.test(lower)) return 'education';
  return null;
}

function isBullet(line: string): boolean { return /^[-•*–]\s+/.test(line) || /^\d+\.\s+/.test(line); }
function isSubheading(line: string): boolean { return /^#{2,}/.test(line) || /^\*\*.+\*\*$/.test(line); }
function isDateLine(line: string): boolean { return /\b\d{4}\b/.test(line) && /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|present|current)/i.test(line); }
function isTechLine(line: string): boolean { return /^tech(nolog)?/i.test(line) || /^\[?tech\s*stack/i.test(line); }
function isLocationLine(line: string): boolean { return /^location|^remote|^hybrid|^on-?site/i.test(line); }
function isLinkLine(line: string): boolean { return /^link:|^url:|^https?:\/\//i.test(line); }
function isContactLine(line: string): boolean { return /^(email|phone|linkedin|github|portfolio|location):/i.test(line) || /^#\s+/.test(line); }
function extractBulletText(line: string): string { return line.replace(/^[-•*–]\s+/, '').replace(/^\d+\.\s+/, '').trim(); }

/**
 * Merge parsed rewritten content into original MasterResume structure
 */
export function normalizeResume(raw: any): MasterResume {
  if (!raw) {
    return {
      name: '',
      email: '',
      experience: [],
      education: [],
      skills: [],
    };
  }

  // 1. Header fields
  const name = raw.name || raw.personal?.name || raw.person?.name || raw.personal_info?.name || '';
  const email = raw.email || raw.personal?.email || raw.person?.email || raw.personal_info?.email || '';
  const phone = raw.phone || raw.personal?.phone || raw.person?.phone || raw.personal_info?.phone || '';
  const location = raw.location || raw.personal?.location || raw.person?.location || raw.personal_info?.location || '';
  const linkedin = raw.linkedin || raw.personal?.linkedin || raw.person?.linkedin || raw.links?.linkedin || '';
  const github = raw.github || raw.personal?.github || raw.person?.github || raw.links?.github || '';
  const portfolio = raw.portfolio || raw.personal?.portfolio || raw.person?.portfolio || raw.links?.portfolio || '';
  
  let summary = '';
  if (raw.summary) {
    if (typeof raw.summary === 'object') {
      summary = raw.summary.short || raw.summary.summary || '';
    } else {
      summary = String(raw.summary);
    }
  }

  // 2. Experience
  const rawExperience = Array.isArray(raw.experience) ? raw.experience : (raw.experiences && Array.isArray(raw.experiences) ? raw.experiences : []);
  const experience = rawExperience.map((exp: any) => {
    const title = exp.title || exp.role || '';
    const company = exp.company || '';
    const dates = exp.dates || (exp.start && exp.end ? `${exp.start} - ${exp.end}` : exp.start || '');
    const location = exp.location || '';
    const technologies = Array.isArray(exp.technologies) ? exp.technologies : (exp.technologies ? [exp.technologies] : []);
    
    // achievements -> bullets mapping
    const rawBullets = exp.bullets || exp.achievements || exp.highlights || exp.responsibilities || exp.details || [];
    const bullets = Array.isArray(rawBullets) ? rawBullets : [rawBullets];
    
    const rawInternBullets = exp.intern_bullets || exp.internBullets || [];
    const intern_bullets = Array.isArray(rawInternBullets) ? rawInternBullets : [rawInternBullets];

    return {
      title,
      company,
      dates,
      location,
      technologies,
      bullets,
      intern_bullets,
    };
  });

  // 3. Education
  const rawEdu = raw.education || [];
  let education: any[] = [];
  if (rawEdu && !Array.isArray(rawEdu)) {
    education = [{
      degree: rawEdu.degree || rawEdu.branch || rawEdu.major || '',
      school: rawEdu.college || rawEdu.school || rawEdu.university || '',
      year: String(rawEdu.year || (rawEdu.start && rawEdu.end ? `${rawEdu.start}-${rawEdu.end}` : rawEdu.end || '')),
      gpa: String(rawEdu.cgpa || rawEdu.gpa || ''),
    }];
  } else if (Array.isArray(rawEdu)) {
    education = rawEdu.map((edu: any) => ({
      degree: edu.degree || edu.branch || edu.major || '',
      school: edu.school || edu.college || edu.university || '',
      year: String(edu.year || (edu.start && edu.end ? `${edu.start}-${edu.end}` : edu.end || '')),
      gpa: String(edu.gpa || edu.cgpa || ''),
    }));
  }

  // 4. Skills & Categorized Skills
  let skills: string[] = [];
  let categorized_skills: { label: string; items: string }[] = [];

  if (raw.categorized_skills && Array.isArray(raw.categorized_skills)) {
    categorized_skills = raw.categorized_skills;
  }

  if (raw.skills) {
    if (Array.isArray(raw.skills)) {
      skills = raw.skills;
    } else if (typeof raw.skills === 'object') {
      const cats: { label: string; items: string }[] = [];
      const allItems: string[] = [];
      for (const [key, value] of Object.entries(raw.skills)) {
        const label = key.charAt(0).toUpperCase() + key.slice(1);
        const itemsArr = Array.isArray(value) ? value : [String(value)];
        allItems.push(...itemsArr);
        cats.push({
          label,
          items: itemsArr.join(', '),
        });
      }
      skills = allItems;
      if (categorized_skills.length === 0) {
        categorized_skills = cats;
      }
    } else if (typeof raw.skills === 'string') {
      skills = [raw.skills];
    }
  }

  // 5. Projects
  const rawProjects = Array.isArray(raw.projects) ? raw.projects : [];
  const projects = rawProjects.map((proj: any) => {
    const name = proj.name || '';
    const url = proj.url || '';
    const description = proj.description || '';
    const rawBullets = proj.bullets || proj.highlights || proj.achievements || [];
    const bullets = Array.isArray(rawBullets) ? rawBullets : [rawBullets];

    return {
      name,
      url,
      description,
      bullets,
    };
  });

  // 6. Certifications
  const certifications = Array.isArray(raw.certifications) ? raw.certifications : (raw.certifications ? [raw.certifications] : []);

  return {
    name,
    email,
    phone,
    location,
    linkedin,
    github,
    portfolio,
    summary,
    experience,
    education,
    skills,
    categorized_skills,
    projects,
    certifications,
  };
}

export function mergeRewrittenIntoOriginal(
  rawOriginal: MasterResume,
  parsed: ParsedSections
): MasterResume {
  const original = normalizeResume(rawOriginal);
  const merged: MasterResume = JSON.parse(JSON.stringify(original));

  if (parsed.summary) merged.summary = parsed.summary;

  for (let i = 0; i < merged.experience.length; i++) {
    if (i < parsed.experiences.length) {
      const parsedExp = parsed.experiences[i];
      if (parsedExp.bullets.length > 0) merged.experience[i].bullets = parsedExp.bullets;
      if (parsedExp.internBullets.length > 0 && merged.experience[i].intern_bullets) {
        merged.experience[i].intern_bullets = parsedExp.internBullets;
      }
    }
  }

  if (merged.projects) {
    for (let i = 0; i < merged.projects.length; i++) {
      if (i < parsed.projects.length) {
        const parsedProj = parsed.projects[i];
        if (parsedProj.bullets.length > 0) merged.projects[i].bullets = parsedProj.bullets;
      }
    }
  }

  if (parsed.categorized_skills && parsed.categorized_skills.length > 0) {
    merged.categorized_skills = parsed.categorized_skills;
  } else if (parsed.skills.length > 0) {
    merged.skills = parsed.skills;
    merged.categorized_skills = [];
  }

  return merged;
}
