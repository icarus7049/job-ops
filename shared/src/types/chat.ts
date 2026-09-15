export const JOB_CHAT_MESSAGE_ROLES = [
  "system",
  "user",
  "assistant",
  "tool",
] as const;
export type JobChatMessageRole = (typeof JOB_CHAT_MESSAGE_ROLES)[number];

export const JOB_CHAT_MESSAGE_STATUSES = [
  "complete",
  "partial",
  "cancelled",
  "failed",
] as const;
export type JobChatMessageStatus = (typeof JOB_CHAT_MESSAGE_STATUSES)[number];

export const JOB_CHAT_RUN_STATUSES = [
  "running",
  "completed",
  "cancelled",
  "failed",
] as const;
export type JobChatRunStatus = (typeof JOB_CHAT_RUN_STATUSES)[number];

export interface JobChatThread {
  id: string;
  jobId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  activeRootMessageId: string | null;
  selectedNoteIds: string[];
  selectedEmailIds: string[];
  selectedDocumentIds: string[];
}

export const GHOSTWRITER_RESUME_EDIT_OPS = [
  "add",
  "replace",
  "remove",
] as const;
export type GhostwriterResumeEditOp =
  (typeof GHOSTWRITER_RESUME_EDIT_OPS)[number];

export const GHOSTWRITER_RESUME_EDIT_PROPOSAL_STATUSES = [
  "pending",
  "applied",
  "rejected",
  "reverted",
] as const;
export type GhostwriterResumeEditProposalStatus =
  (typeof GHOSTWRITER_RESUME_EDIT_PROPOSAL_STATUSES)[number];

/** A single staged change to the Resume Studio document. */
export interface GhostwriterResumeEdit {
  op: GhostwriterResumeEditOp;
  /** JSON Pointer into the Resume Studio document. Never the root pointer. */
  path: string;
  /** Replacement value for `add`/`replace`. Always absent for `remove`. */
  value?: unknown;
  /** Why this specific edit is proposed. Shown next to the edit in the UI. */
  reason: string;
}

/**
 * A Ghostwriter-drafted resume change set. Proposals are always staged: they
 * are never applied to the Resume Studio document until the user approves them.
 */
export interface GhostwriterResumeEditProposal {
  id: string;
  /** Resume Studio revision the edits were drafted against. */
  baseRevision: number;
  summary: string;
  edits: GhostwriterResumeEdit[];
  status: GhostwriterResumeEditProposalStatus;
  createdAt: string;
  resolvedAt: string | null;
  /** Revision produced by applying this proposal. */
  appliedRevision: number | null;
  /** True while a stored pre-apply snapshot can still restore the document. */
  canRevert: boolean;
}

export interface JobChatMessage {
  id: string;
  threadId: string;
  jobId: string;
  role: JobChatMessageRole;
  content: string;
  status: JobChatMessageStatus;
  tokensIn: number | null;
  tokensOut: number | null;
  version: number;
  replacesMessageId: string | null;
  parentMessageId: string | null;
  activeChildId: string | null;
  attachments: JobChatImageAttachment[];
  /** Staged resume change set awaiting explicit user approval, if any. */
  resumeEditProposal: GhostwriterResumeEditProposal | null;
  createdAt: string;
  updatedAt: string;
}

export interface BranchInfo {
  /** The message ID this branch info belongs to (the currently active sibling). */
  messageId: string;
  /** Ordered sibling IDs at this branch point (by createdAt). */
  siblingIds: string[];
  /** 0-based index of the active sibling within siblingIds. */
  activeIndex: number;
}

export interface JobChatRun {
  id: string;
  threadId: string;
  jobId: string;
  status: JobChatRunStatus;
  model: string | null;
  provider: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: number;
  completedAt: number | null;
  requestId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobChatImageAttachment {
  id?: string;
  name: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  dataUrl: string;
}

export type JobChatStreamEvent =
  | {
      type: "ready";
      runId: string;
      threadId: string;
      messageId: string;
      requestId: string;
    }
  | {
      type: "delta";
      runId: string;
      messageId: string;
      delta: string;
    }
  | {
      type: "completed";
      runId: string;
      message: JobChatMessage;
    }
  | {
      type: "cancelled";
      runId: string;
      message: JobChatMessage;
    }
  | {
      type: "error";
      runId: string;
      code: string;
      message: string;
      requestId: string;
    };
