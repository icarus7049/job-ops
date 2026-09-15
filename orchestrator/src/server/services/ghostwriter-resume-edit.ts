import { badRequest, conflict, notFound } from "@infra/errors";
import { logger } from "@infra/logger";
import { toDesignResumePatchOperations } from "@shared/ghostwriter-resume-edit.js";
import type {
  DesignResumeDocument,
  GhostwriterResumeEditProposal,
  JobChatMessage,
} from "@shared/types";
import type { GhostwriterResumeEditProposalRecord } from "../repositories/ghostwriter";
import * as jobChatRepo from "../repositories/ghostwriter";
import {
  requireCurrentDesignResume,
  updateCurrentDesignResume,
} from "./design-resume";
import { clearProfileCache } from "./profile";

export type ResumeEditProposalResult = {
  message: JobChatMessage;
  proposal: GhostwriterResumeEditProposal;
  /** The resulting Resume Studio document, when the action changed it. */
  document: DesignResumeDocument | null;
};

type LoadedProposal = {
  message: JobChatMessage;
  record: GhostwriterResumeEditProposalRecord;
};

async function loadProposal(input: {
  jobId: string;
  messageId: string;
}): Promise<LoadedProposal> {
  const message = await jobChatRepo.getMessageById(input.messageId);
  if (!message || message.jobId !== input.jobId) {
    throw notFound("Message not found for this job");
  }

  const record = await jobChatRepo.getResumeEditProposalRecord(input.messageId);
  if (!record) {
    throw notFound("This message has no staged resume edit");
  }

  return { message, record };
}

async function persist(
  messageId: string,
  record: GhostwriterResumeEditProposalRecord,
  document: DesignResumeDocument | null,
): Promise<ResumeEditProposalResult> {
  const message = await jobChatRepo.saveResumeEditProposalRecord(
    messageId,
    record,
  );
  if (!message?.resumeEditProposal) {
    throw notFound("Message not found for this job");
  }
  return { message, proposal: message.resumeEditProposal, document };
}

export async function getResumeEditProposal(input: {
  jobId: string;
  messageId: string;
}): Promise<ResumeEditProposalResult> {
  const { message } = await loadProposal(input);
  if (!message.resumeEditProposal) {
    throw notFound("This message has no staged resume edit");
  }
  return { message, proposal: message.resumeEditProposal, document: null };
}

/**
 * Apply a staged proposal to the Resume Studio document.
 *
 * This is the only path that writes resume data, and it runs solely on an
 * explicit user request. The patch itself is delegated to
 * `updateCurrentDesignResume`, which re-checks the revision and re-validates
 * the whole patched document against the Reactive Resume v5 schema before
 * persisting, so a proposal can never write a structurally invalid resume.
 */
export async function applyResumeEditProposal(input: {
  jobId: string;
  messageId: string;
}): Promise<ResumeEditProposalResult> {
  const { record } = await loadProposal(input);

  if (record.status !== "pending") {
    throw conflict(
      `This resume edit was already ${record.status} and cannot be applied again.`,
    );
  }
  if (record.edits.length === 0) {
    throw badRequest("This resume edit has no changes to apply.");
  }

  const current = await requireCurrentDesignResume();
  if (current.revision !== record.baseRevision) {
    logger.warn("Ghostwriter resume edit rejected on revision conflict", {
      jobId: input.jobId,
      messageId: input.messageId,
      proposalId: record.id,
      baseRevision: record.baseRevision,
      currentRevision: current.revision,
    });
    throw conflict(
      "Your resume changed after Ghostwriter drafted this edit. Ask Ghostwriter to redraft it against the current resume.",
    );
  }

  const updated = await updateCurrentDesignResume({
    baseRevision: record.baseRevision,
    operations: toDesignResumePatchOperations(record.edits),
  });

  const applied: GhostwriterResumeEditProposalRecord = {
    ...record,
    status: "applied",
    resolvedAt: new Date().toISOString(),
    appliedRevision: updated.revision,
    // Snapshot taken before the patch so the change stays reversible through
    // the ordinary design-resume document PATCH.
    previousResumeJson: current.resumeJson,
  };

  clearProfileCache();

  logger.info("Applied Ghostwriter resume edit proposal", {
    jobId: input.jobId,
    messageId: input.messageId,
    proposalId: record.id,
    baseRevision: record.baseRevision,
    appliedRevision: updated.revision,
    editCount: record.edits.length,
  });

  return persist(input.messageId, applied, updated);
}

export async function rejectResumeEditProposal(input: {
  jobId: string;
  messageId: string;
}): Promise<ResumeEditProposalResult> {
  const { record } = await loadProposal(input);

  if (record.status !== "pending") {
    throw conflict(
      `This resume edit was already ${record.status} and cannot be rejected.`,
    );
  }

  logger.info("Rejected Ghostwriter resume edit proposal", {
    jobId: input.jobId,
    messageId: input.messageId,
    proposalId: record.id,
  });

  return persist(
    input.messageId,
    {
      ...record,
      status: "rejected",
      resolvedAt: new Date().toISOString(),
    },
    null,
  );
}

/**
 * Restore the pre-apply resume snapshot.
 *
 * Refuses when the resume moved on after the apply, because replacing the
 * document wholesale would then silently discard those later edits.
 */
export async function revertResumeEditProposal(input: {
  jobId: string;
  messageId: string;
}): Promise<ResumeEditProposalResult> {
  const { record } = await loadProposal(input);

  if (record.status !== "applied") {
    throw conflict(
      `This resume edit is ${record.status} and cannot be reverted.`,
    );
  }
  if (!record.previousResumeJson) {
    throw conflict(
      "No pre-apply snapshot is stored for this resume edit. Restore it from Resume Studio instead.",
    );
  }

  const current = await requireCurrentDesignResume();
  if (current.revision !== record.appliedRevision) {
    logger.warn("Ghostwriter resume revert rejected on revision conflict", {
      jobId: input.jobId,
      messageId: input.messageId,
      proposalId: record.id,
      appliedRevision: record.appliedRevision,
      currentRevision: current.revision,
    });
    throw conflict(
      "Your resume changed after this edit was applied. Reverting now would discard those later changes.",
    );
  }

  const reverted = await updateCurrentDesignResume({
    baseRevision: current.revision,
    document: record.previousResumeJson,
  });

  clearProfileCache();

  logger.info("Reverted Ghostwriter resume edit proposal", {
    jobId: input.jobId,
    messageId: input.messageId,
    proposalId: record.id,
    revertedToRevision: reverted.revision,
  });

  return persist(
    input.messageId,
    {
      ...record,
      status: "reverted",
      resolvedAt: new Date().toISOString(),
      previousResumeJson: null,
    },
    reverted,
  );
}
