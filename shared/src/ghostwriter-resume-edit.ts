import type {
  GhostwriterResumeEdit,
  GhostwriterResumeEditOp,
  GhostwriterResumeEditProposal,
} from "./types/chat";
import { GHOSTWRITER_RESUME_EDIT_OPS } from "./types/chat";

export const GHOSTWRITER_RESUME_EDIT_MAX_EDITS = 40;
export const GHOSTWRITER_RESUME_EDIT_MAX_SUMMARY_CHARS = 600;
export const GHOSTWRITER_RESUME_EDIT_MAX_REASON_CHARS = 400;
export const GHOSTWRITER_RESUME_EDIT_MAX_VALUE_CHARS = 20000;
export const GHOSTWRITER_RESUME_EDIT_MAX_PATH_CHARS = 500;

/**
 * Pointer prefixes Ghostwriter must never touch.
 *
 * `/picture` is owned by the Resume Studio asset pipeline: its `url` is
 * bookkept against rows in `design_resume_assets`, so rewriting it through a
 * chat patch would orphan or dangle the stored file.
 */
const BLOCKED_POINTER_PREFIXES = ["/picture"] as const;

const OP_SET = new Set<string>(GHOSTWRITER_RESUME_EDIT_OPS);

/** Raw, untrusted edit as produced by the model's structured output. */
export type GhostwriterResumeEditDraft = {
  op?: unknown;
  path?: unknown;
  /** JSON-encoded replacement value. Strict JSON schema cannot carry free-form values. */
  valueJson?: unknown;
  reason?: unknown;
};

export type GhostwriterResumeEditProposalDraft = {
  summary?: unknown;
  edits?: unknown;
};

export type NormalizeGhostwriterResumeEditResult =
  | { ok: true; summary: string; edits: GhostwriterResumeEdit[] }
  | { ok: false; reason: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function isBlockedPointer(path: string): boolean {
  return BLOCKED_POINTER_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * Validate one raw edit.
 *
 * Returns the normalized edit, or a human-readable reason the whole proposal
 * must be discarded. A proposal is all-or-nothing on purpose: partially
 * dropping edits would silently change what the user reviews and approves.
 */
function normalizeEdit(
  draft: unknown,
  index: number,
): { ok: true; edit: GhostwriterResumeEdit } | { ok: false; reason: string } {
  const record = asRecord(draft);
  if (!record) {
    return { ok: false, reason: `Edit ${index + 1} is not an object.` };
  }

  const op = toTrimmedString(record.op);
  if (!OP_SET.has(op)) {
    return {
      ok: false,
      reason: `Edit ${index + 1} has an unsupported op "${op || "(empty)"}".`,
    };
  }

  const path = toTrimmedString(record.path);
  if (!path) {
    return { ok: false, reason: `Edit ${index + 1} is missing a path.` };
  }
  if (!path.startsWith("/")) {
    return {
      ok: false,
      reason: `Edit ${index + 1} path must be a JSON Pointer starting with "/".`,
    };
  }
  if (path.length > GHOSTWRITER_RESUME_EDIT_MAX_PATH_CHARS) {
    return { ok: false, reason: `Edit ${index + 1} path is too long.` };
  }
  if (isBlockedPointer(path)) {
    return {
      ok: false,
      reason: `Edit ${index + 1} targets ${path}, which Ghostwriter cannot change.`,
    };
  }

  const reason = toTrimmedString(record.reason);
  if (!reason) {
    return { ok: false, reason: `Edit ${index + 1} is missing a reason.` };
  }

  if (op === "remove") {
    return {
      ok: true,
      edit: {
        op: op as GhostwriterResumeEditOp,
        path,
        reason: truncate(reason, GHOSTWRITER_RESUME_EDIT_MAX_REASON_CHARS),
      },
    };
  }

  const valueJson =
    typeof record.valueJson === "string" ? record.valueJson : "";
  if (!valueJson.trim()) {
    return {
      ok: false,
      reason: `Edit ${index + 1} (${op}) is missing a value.`,
    };
  }
  if (valueJson.length > GHOSTWRITER_RESUME_EDIT_MAX_VALUE_CHARS) {
    return { ok: false, reason: `Edit ${index + 1} value is too large.` };
  }

  let value: unknown;
  try {
    value = JSON.parse(valueJson);
  } catch {
    return {
      ok: false,
      reason: `Edit ${index + 1} value is not valid JSON.`,
    };
  }
  if (value === undefined) {
    return { ok: false, reason: `Edit ${index + 1} value is empty.` };
  }

  return {
    ok: true,
    edit: {
      op: op as GhostwriterResumeEditOp,
      path,
      value,
      reason: truncate(reason, GHOSTWRITER_RESUME_EDIT_MAX_REASON_CHARS),
    },
  };
}

/**
 * Turn a model-produced resume edit draft into a validated change set.
 *
 * `null`/`undefined` means "no resume edit proposed" and is not an error: the
 * common Ghostwriter turn is plain chat.
 */
export function normalizeGhostwriterResumeEditDraft(
  draft: unknown,
): NormalizeGhostwriterResumeEditResult | null {
  if (draft === null || draft === undefined) return null;

  const record = asRecord(draft);
  if (!record) {
    return { ok: false, reason: "Resume edit payload is not an object." };
  }

  const rawEdits = record.edits;
  if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
    // A resumeEdit object with no edits is the model's way of saying
    // "nothing to change"; treat it as plain chat rather than an error.
    return null;
  }

  if (rawEdits.length > GHOSTWRITER_RESUME_EDIT_MAX_EDITS) {
    return {
      ok: false,
      reason: `Resume edit proposes ${rawEdits.length} changes, more than the ${GHOSTWRITER_RESUME_EDIT_MAX_EDITS} allowed.`,
    };
  }

  const edits: GhostwriterResumeEdit[] = [];
  for (const [index, rawEdit] of rawEdits.entries()) {
    const normalized = normalizeEdit(rawEdit, index);
    if (!normalized.ok) return normalized;
    edits.push(normalized.edit);
  }

  const summary = truncate(
    toTrimmedString(record.summary) || "Proposed resume changes",
    GHOSTWRITER_RESUME_EDIT_MAX_SUMMARY_CHARS,
  );

  return { ok: true, summary, edits };
}

export function isGhostwriterResumeEditProposalPending(
  proposal: GhostwriterResumeEditProposal | null | undefined,
): boolean {
  return proposal?.status === "pending";
}

/** JSON-Patch operations for the design-resume PATCH mechanism. */
export function toDesignResumePatchOperations(
  edits: readonly GhostwriterResumeEdit[],
): Array<{ op: GhostwriterResumeEditOp; path: string; value?: unknown }> {
  return edits.map((edit) =>
    edit.op === "remove"
      ? { op: edit.op, path: edit.path }
      : { op: edit.op, path: edit.path, value: edit.value },
  );
}
