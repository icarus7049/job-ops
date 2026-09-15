import { open } from "node:fs/promises";
import { badRequest, notFound } from "@infra/errors";
import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import {
  buildGhostwriterDocumentContextItems,
  normalizeGhostwriterSelectedDocumentIds,
} from "@shared/ghostwriter-document-context.js";
import {
  buildGhostwriterEmailContextItems,
  normalizeGhostwriterSelectedEmailIds,
} from "@shared/ghostwriter-email-context.js";
import {
  buildGhostwriterNoteContextItems,
  normalizeGhostwriterSelectedNoteIds,
} from "@shared/ghostwriter-note-context.js";
import {
  canUseJobDocumentForTextContext,
  isJobDocumentDocx,
  isJobDocumentPdf,
  isJobDocumentTextLike,
} from "@shared/job-document-classification.js";
import { settingsRegistry } from "@shared/settings-registry";
import type { Job, JobDocument, ResumeProfile } from "@shared/types";
import { stripHtmlTags } from "@shared/utils/string";
import * as jobDocumentsRepo from "../repositories/job-documents";
import * as jobsRepo from "../repositories/jobs";
import * as settingsRepo from "../repositories/settings";
import { extractDocxText, extractPdfText } from "./document-text-extraction";
import {
  getWritingLanguageLabel,
  resolveWritingOutputLanguage,
} from "./output-language";
import { getProfile } from "./profile";
import {
  getEffectivePromptTemplate,
  renderPromptTemplate,
} from "./prompt-templates";
import { filterProfileProjectsForAi } from "./resumeProjects";
import {
  getWritingStyle,
  stripLanguageDirectivesFromConstraints,
  type WritingStyle,
} from "./writing-style";

/**
 * The complete Resume Studio document made available to Ghostwriter, with the
 * revision it was read at. Present only when a resume exists and fits the
 * context budget in full.
 */
export type JobChatResumeContext = {
  documentId: string;
  revision: number;
  updatedAt: string;
  /** The unreduced Resume Studio document, serialized verbatim. */
  resumeJson: string;
};

export type JobChatPromptContext = {
  job: Job;
  style: WritingStyle;
  systemPrompt: string;
  jobSnapshot: string;
  profileSnapshot: string;
  selectedNotesSnapshot: string;
  selectedEmailsSnapshot: string;
  selectedDocumentsSnapshot: string;
  /** Null when no resume is available, or when it is too large to send whole. */
  resume: JobChatResumeContext | null;
};

const MAX_JOB_DESCRIPTION = 6000;
const MAX_JOB_SUITABILITY_REASON = 600;
const MAX_JOB_TAILORED_SUMMARY = 2000;
const MAX_JOB_TAILORED_HEADLINE = 300;
const MAX_JOB_TAILORED_SKILLS = 2000;
const MAX_PROFILE_SUMMARY = 2000;
const MAX_SKILLS = 18;
const MAX_PROJECTS = 6;
const MAX_EXPERIENCE = 5;
const MAX_ITEM_TEXT = 500;
const MAX_DOCUMENT_READ_BYTES = 2 * 1024 * 1024;
/**
 * Hard ceiling on the serialized resume sent to the model.
 *
 * This budget is never used to truncate. A resume edit is expressed as a JSON
 * Pointer, and a pointer written against a partial document can silently
 * target the wrong array index, so an oversized resume is dropped from the
 * context entirely rather than trimmed.
 */
const MAX_RESUME_CONTEXT_CHARS = 120_000;

const STOP_SLOP_GHOSTWRITER_PROMPT = `
Stop Slop revision rules for Ghostwriter prose:
- Cut filler openers and emphasis crutches. Start with the useful sentence.
- Avoid business jargon such as navigate, unpack, landscape, game-changer, deep dive, moving forward, and circle back.
- Remove adverbs, softeners, and intensifiers such as really, just, literally, genuinely, honestly, simply, actually, deeply, truly, fundamentally, importantly, and crucially.
- Avoid formulaic structures: "not X but Y", "X is not the problem, Y is", negative buildup, rhetorical setups, and punchy one-line endings.
- Use active voice. Name the person or team doing the action.
- Do not give inanimate things human agency. Data does not tell us; a person reads data.
- Be specific. Replace vague claims, lazy extremes, and abstract importance with concrete details from the job, profile, or user prompt.
- Put the reader in the room. Use "you" when it fits the requested output.
- Vary rhythm. Mix sentence lengths, prefer one or two items over three, and avoid stacked fragments.
- Do not use em dashes.
- Before answering, revise once for directness, rhythm, trust, authenticity, and density.
`.trim();

// A truncation marker must advertise omitted content. A bare "..." reads as
// the author trailing off, and a mid-clause cut leaves the model holding half
// a sentence it cannot know the end of, which invites it to invent one.
const TRUNCATION_MARKER = " [...]";

// Truncate without ever ending mid-clause. Prefer the last complete sentence
// that fits the budget; fall back to the last whole word when the text has no
// sentence break in the useful part of the window. Both paths keep at least 60%
// of the budget so a single early period cannot collapse the content.
function truncate(value: string | null | undefined, max: number): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;

  const window = trimmed.slice(0, max);
  const minUseful = Math.floor(max * 0.6);

  let cut = -1;
  const sentenceRe = /[.!?]+(?=\s|$)/g;
  let match = sentenceRe.exec(window);
  while (match !== null) {
    const end = match.index + match[0].length;
    if (end > max) break;
    if (end >= minUseful) cut = end;
    match = sentenceRe.exec(window);
  }

  if (cut === -1) {
    const lastSpace = window.lastIndexOf(" ");
    cut = lastSpace >= minUseful ? lastSpace : window.length;
  }

  return `${trimmed.slice(0, cut).trimEnd()}${TRUNCATION_MARKER}`;
}

function compactJoin(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join("\n");
}

export function canUseJobDocumentForGhostwriterContext(
  document: Pick<JobDocument, "fileName" | "mediaType">,
): boolean {
  return canUseJobDocumentForTextContext(document);
}

function buildJobSnapshot(job: Job): string {
  const snapshot = {
    event: "job.completed",
    sentAt: new Date().toISOString(),
    job: {
      id: job.id,
      source: job.source,
      title: job.title,
      employer: job.employer,
      location: job.location,
      salary: job.salary,
      status: job.status,
      jobUrl: job.jobUrl,
      applicationLink: job.applicationLink,
      suitabilityScore: job.suitabilityScore,
      suitabilityReason: truncate(
        job.suitabilityReason,
        MAX_JOB_SUITABILITY_REASON,
      ),
      tailoredSummary: truncate(job.tailoredSummary, MAX_JOB_TAILORED_SUMMARY),
      tailoredHeadline: truncate(
        job.tailoredHeadline,
        MAX_JOB_TAILORED_HEADLINE,
      ),
      tailoredSkills: truncate(job.tailoredSkills, MAX_JOB_TAILORED_SKILLS),
      jobDescription: truncate(
        stripHtmlTags(job.jobDescription ?? ""),
        MAX_JOB_DESCRIPTION,
      ),
    },
  };

  return JSON.stringify(snapshot);
}

function buildProfileSnapshot(profile: ResumeProfile): string {
  const summary =
    truncate(profile?.sections?.summary?.content, MAX_PROFILE_SUMMARY) ||
    truncate(profile?.basics?.summary, MAX_PROFILE_SUMMARY);

  const skills = (profile?.sections?.skills?.items ?? [])
    .slice(0, MAX_SKILLS)
    .map((item) => {
      const keywords = (item.keywords ?? []).slice(0, 8).join(", ");
      return `${item.name}${keywords ? `: ${keywords}` : ""}`;
    });

  const projects = (profile?.sections?.projects?.items ?? [])
    .filter((item) => item.visible !== false)
    .slice(0, MAX_PROJECTS)
    .map(
      (item) =>
        `${item.name} (${item.date || "n/a"}): ${truncate(item.summary, MAX_ITEM_TEXT)}`,
    );

  const experience = (profile?.sections?.experience?.items ?? [])
    .filter((item) => item.visible !== false)
    .slice(0, MAX_EXPERIENCE)
    .map(
      (item) =>
        `${item.position} @ ${item.company} (${item.date || "n/a"}): ${truncate(item.summary, MAX_ITEM_TEXT)}`,
    );

  return compactJoin([
    `Name: ${profile?.basics?.name || "Unknown"}`,
    `Headline: ${truncate(profile?.basics?.headline || profile?.basics?.label, 200) || ""}`,
    summary ? `Summary:\n${summary}` : null,
    skills.length > 0 ? `Skills:\n- ${skills.join("\n- ")}` : null,
    projects.length > 0 ? `Projects:\n- ${projects.join("\n- ")}` : null,
    experience.length > 0 ? `Experience:\n- ${experience.join("\n- ")}` : null,
  ]);
}

async function listSelectedContextItems<TItem>(input: {
  selectedIds: readonly string[];
  normalize: (selectedIds: readonly string[]) => string[];
  listItems: (normalizedIds: string[]) => Promise<TItem[]>;
  getId: (item: TItem) => string;
}): Promise<TItem[]> {
  const normalizedIds = input.normalize(input.selectedIds);
  if (normalizedIds.length === 0) return [];

  const items = await input.listItems(normalizedIds);
  const itemsById = new Map(items.map((item) => [input.getId(item), item]));
  return normalizedIds
    .map((selectedId) => itemsById.get(selectedId))
    .filter((item): item is TItem => Boolean(item));
}

async function buildSelectedNotesSnapshot(
  jobId: string,
  selectedNoteIds: readonly string[],
): Promise<string> {
  const selectedNotes = await listSelectedContextItems({
    selectedIds: selectedNoteIds,
    normalize: normalizeGhostwriterSelectedNoteIds,
    listItems: (normalizedNoteIds) =>
      jobsRepo.listJobNotesByIds(jobId, normalizedNoteIds),
    getId: (note) => note.id,
  });

  if (selectedNotes.length === 0) return "";

  const context = buildGhostwriterNoteContextItems(selectedNotes);
  return compactJoin([
    "Selected Job Notes:",
    ...context.items.map((note, index) =>
      compactJoin([
        `Note ${index + 1}: ${note.title}`,
        `Updated: ${note.updatedAt}`,
        note.wasTrimmed ? "Context note: trimmed for AI context limits." : null,
        note.content ? `Content:\n${note.content}` : "Content: [empty]",
      ]),
    ),
  ]);
}

async function buildSelectedEmailsSnapshot(
  jobId: string,
  selectedEmailIds: readonly string[],
): Promise<string> {
  const { listJobPostApplicationEmailsByIds } = await import(
    "./post-application/job-emails"
  );
  const selectedEmails = await listSelectedContextItems({
    selectedIds: selectedEmailIds,
    normalize: normalizeGhostwriterSelectedEmailIds,
    listItems: (normalizedEmailIds) =>
      listJobPostApplicationEmailsByIds(jobId, normalizedEmailIds),
    getId: (email) => email.message.id,
  });

  if (selectedEmails.length === 0) return "";

  const context = buildGhostwriterEmailContextItems(selectedEmails);
  return compactJoin([
    "Selected Job Emails:",
    ...context.items.map((email, index) =>
      compactJoin([
        `Email ${index + 1}: ${email.subject}`,
        `Sender: ${email.sender}`,
        email.receivedAt
          ? `Received: ${new Date(email.receivedAt).toISOString()}`
          : null,
        `Type: ${email.messageType}`,
        `Status: ${email.processingStatus}`,
        email.matchConfidence !== null
          ? `Match confidence: ${email.matchConfidence}%`
          : null,
        email.wasTrimmed
          ? "Context note: snippet trimmed for AI context limits."
          : null,
        email.snippet ? `Snippet:\n${email.snippet}` : "Snippet: [empty]",
      ]),
    ),
  ]);
}

async function readFilePrefix(path: string, maxBytes: number): Promise<Buffer> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await file.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

async function extractDocumentText(
  document: jobDocumentsRepo.JobDocumentWithStorage,
): Promise<string> {
  const buffer = await readFilePrefix(
    document.storagePath,
    MAX_DOCUMENT_READ_BYTES,
  );

  if (isJobDocumentPdf(document)) {
    try {
      return await extractPdfText(buffer);
    } catch (error) {
      logger.warn("Failed to extract Ghostwriter document PDF text", {
        jobId: document.jobId,
        documentId: document.id,
        error: sanitizeUnknown(error),
      });
      return "";
    }
  }

  if (isJobDocumentDocx(document)) {
    try {
      return await extractDocxText(buffer);
    } catch (error) {
      logger.warn("Failed to extract Ghostwriter document DOCX text", {
        jobId: document.jobId,
        documentId: document.id,
        error: sanitizeUnknown(error),
      });
      return "";
    }
  }

  if (isJobDocumentTextLike(document)) {
    return buffer.toString("utf8").trim();
  }

  return "";
}

async function buildSelectedDocumentsSnapshot(
  jobId: string,
  selectedDocumentIds: readonly string[],
): Promise<string> {
  const selectedDocuments = await listSelectedContextItems({
    selectedIds: selectedDocumentIds,
    normalize: normalizeGhostwriterSelectedDocumentIds,
    listItems: (normalizedDocumentIds) =>
      jobDocumentsRepo.listJobDocumentsByIds(jobId, normalizedDocumentIds),
    getId: (document) => document.id,
  });

  if (selectedDocuments.length === 0) return "";

  const documentsWithContent = await Promise.all(
    selectedDocuments
      .filter(canUseJobDocumentForGhostwriterContext)
      .map(async (document) => ({
        ...document,
        content: await extractDocumentText(document),
      })),
  );
  const context = buildGhostwriterDocumentContextItems(documentsWithContent);
  if (context.items.length === 0) return "";

  return compactJoin([
    "Selected Job Documents:",
    ...context.items.map((document, index) =>
      compactJoin([
        `Document ${index + 1}: ${document.fileName}`,
        document.mediaType ? `Type: ${document.mediaType}` : null,
        `Uploaded: ${document.createdAt}`,
        document.wasTrimmed
          ? "Context note: document text trimmed for AI context limits."
          : null,
        document.content ? `Content:\n${document.content}` : "Content: [empty]",
      ]),
    ),
  ]);
}

async function buildSystemPrompt(
  style: WritingStyle,
  profile: ResumeProfile,
  jobDescription?: string | null,
): Promise<string> {
  const resolvedLanguage = resolveWritingOutputLanguage({
    style,
    profile,
    jobDescription,
  });
  const outputLanguage = getWritingLanguageLabel(resolvedLanguage.language);
  const effectiveConstraints = stripLanguageDirectivesFromConstraints(
    style.constraints,
  );
  const template = await getEffectivePromptTemplate(
    "ghostwriterSystemPromptTemplate",
  );

  return renderPromptTemplate(template, {
    outputLanguage,
    tone: style.tone,
    formality: style.formality,
    constraintsSentence: effectiveConstraints
      ? `Writing constraints: ${effectiveConstraints}`
      : "",
    avoidTermsSentence: style.doNotUse
      ? `Avoid these terms: ${style.doNotUse}`
      : "",
  });
}

async function buildResumeContext(
  jobId: string,
): Promise<JobChatResumeContext | null> {
  const { getCurrentDesignResumeOrNullOnLegacy } = await import(
    "./design-resume"
  );

  let document: Awaited<
    ReturnType<typeof getCurrentDesignResumeOrNullOnLegacy>
  >;
  try {
    document = await getCurrentDesignResumeOrNullOnLegacy();
  } catch (error) {
    logger.warn("Failed to load Resume Studio for job chat context", {
      jobId,
      error: sanitizeUnknown(error),
    });
    return null;
  }

  if (!document) return null;

  const resumeJson = JSON.stringify(document.resumeJson);
  if (resumeJson.length > MAX_RESUME_CONTEXT_CHARS) {
    logger.warn("Resume too large for Ghostwriter resume context", {
      jobId,
      documentId: document.id,
      resumeChars: resumeJson.length,
      maxResumeChars: MAX_RESUME_CONTEXT_CHARS,
    });
    return null;
  }

  return {
    documentId: document.id,
    revision: document.revision,
    updatedAt: document.updatedAt,
    resumeJson,
  };
}

async function isStopSlopEnabled(): Promise<boolean> {
  const raw = await settingsRepo.getSetting("ghostwriterStopSlopEnabled");
  return (
    settingsRegistry.ghostwriterStopSlopEnabled.parse(raw ?? undefined) ??
    settingsRegistry.ghostwriterStopSlopEnabled.default()
  );
}

export async function buildJobChatPromptContext(
  jobId: string,
  selectedNoteIds: readonly string[] = [],
  selectedEmailIds: readonly string[] = [],
  selectedDocumentIds: readonly string[] = [],
): Promise<JobChatPromptContext> {
  const job = await jobsRepo.getJobById(jobId);
  if (!job) {
    throw notFound("Job not found");
  }

  const style = await getWritingStyle();

  let profile: ResumeProfile = {};
  try {
    profile = await filterProfileProjectsForAi(await getProfile());
  } catch (error) {
    logger.warn("Failed to load profile for job chat context", {
      jobId,
      error: sanitizeUnknown(error),
    });
  }

  const profileSnapshot = buildProfileSnapshot(profile);
  const [
    baseSystemPrompt,
    stopSlopEnabled,
    selectedNotesSnapshot,
    selectedEmailsSnapshot,
    selectedDocumentsSnapshot,
    resume,
  ] = await Promise.all([
    buildSystemPrompt(style, profile, job.jobDescription),
    isStopSlopEnabled(),
    buildSelectedNotesSnapshot(jobId, selectedNoteIds),
    buildSelectedEmailsSnapshot(jobId, selectedEmailIds),
    buildSelectedDocumentsSnapshot(jobId, selectedDocumentIds),
    buildResumeContext(jobId),
  ]);
  const systemPrompt = stopSlopEnabled
    ? `${baseSystemPrompt}\n\n${STOP_SLOP_GHOSTWRITER_PROMPT}`
    : baseSystemPrompt;
  const jobSnapshot = buildJobSnapshot(job);

  if (!jobSnapshot.trim()) {
    throw badRequest("Unable to build job context");
  }

  logger.info("Built job chat context", {
    jobId,
    includesProfile: Boolean(profileSnapshot),
    contextStats: sanitizeUnknown({
      systemChars: systemPrompt.length,
      jobChars: jobSnapshot.length,
      profileChars: profileSnapshot.length,
      selectedNotesChars: selectedNotesSnapshot.length,
      selectedEmailsChars: selectedEmailsSnapshot.length,
      selectedDocumentsChars: selectedDocumentsSnapshot.length,
      selectedNoteCount:
        normalizeGhostwriterSelectedNoteIds(selectedNoteIds).length,
      selectedEmailCount:
        normalizeGhostwriterSelectedEmailIds(selectedEmailIds).length,
      selectedDocumentCount:
        normalizeGhostwriterSelectedDocumentIds(selectedDocumentIds).length,
      resumeChars: resume?.resumeJson.length ?? 0,
      resumeRevision: resume?.revision ?? null,
    }),
  });

  return {
    job,
    style,
    systemPrompt,
    jobSnapshot,
    profileSnapshot,
    selectedNotesSnapshot,
    selectedEmailsSnapshot,
    selectedDocumentsSnapshot,
    resume,
  };
}
