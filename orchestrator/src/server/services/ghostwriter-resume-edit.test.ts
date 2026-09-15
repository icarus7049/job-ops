import type {
  GhostwriterResumeEditProposal,
  JobChatMessage,
} from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GhostwriterResumeEditProposalRecord } from "../repositories/ghostwriter";

const mocks = vi.hoisted(() => ({
  repo: {
    getMessageById: vi.fn(),
    getResumeEditProposalRecord: vi.fn(),
    saveResumeEditProposalRecord: vi.fn(),
  },
  designResume: {
    requireCurrentDesignResume: vi.fn(),
    updateCurrentDesignResume: vi.fn(),
  },
  clearProfileCache: vi.fn(),
}));

vi.mock("@infra/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../repositories/ghostwriter", () => ({
  getMessageById: mocks.repo.getMessageById,
  getResumeEditProposalRecord: mocks.repo.getResumeEditProposalRecord,
  saveResumeEditProposalRecord: mocks.repo.saveResumeEditProposalRecord,
}));

vi.mock("./design-resume", () => ({
  requireCurrentDesignResume: mocks.designResume.requireCurrentDesignResume,
  updateCurrentDesignResume: mocks.designResume.updateCurrentDesignResume,
}));

vi.mock("./profile", () => ({
  clearProfileCache: mocks.clearProfileCache,
}));

import {
  applyResumeEditProposal,
  getResumeEditProposal,
  rejectResumeEditProposal,
  revertResumeEditProposal,
} from "./ghostwriter-resume-edit";

const previousResumeJson = {
  basics: { name: "Ada Lovelace" },
  summary: { content: "<p>Original summary</p>" },
} as unknown as GhostwriterResumeEditProposalRecord["previousResumeJson"];

function buildRecord(
  overrides: Partial<GhostwriterResumeEditProposalRecord> = {},
): GhostwriterResumeEditProposalRecord {
  return {
    id: "proposal-1",
    baseRevision: 4,
    summary: "Sharpen the summary",
    edits: [
      {
        op: "replace",
        path: "/summary/content",
        value: "<p>Platform engineer</p>",
        reason: "Mirrors the platform focus in the job description.",
      },
    ],
    status: "pending",
    createdAt: "2026-09-14T10:00:00.000Z",
    resolvedAt: null,
    appliedRevision: null,
    previousResumeJson: null,
    ...overrides,
  };
}

function buildMessage(
  proposal: GhostwriterResumeEditProposal | null,
): JobChatMessage {
  return {
    id: "assistant-1",
    threadId: "thread-1",
    jobId: "job-1",
    role: "assistant",
    content: "I drafted a sharper summary.",
    status: "complete",
    tokensIn: 10,
    tokensOut: 20,
    version: 1,
    replacesMessageId: null,
    parentMessageId: "user-1",
    activeChildId: null,
    attachments: [],
    resumeEditProposal: proposal,
    createdAt: "2026-09-14T10:00:00.000Z",
    updatedAt: "2026-09-14T10:00:00.000Z",
  };
}

function publicProposal(
  overrides: Partial<GhostwriterResumeEditProposal> = {},
): GhostwriterResumeEditProposal {
  const record = buildRecord();
  return {
    id: record.id,
    baseRevision: record.baseRevision,
    summary: record.summary,
    edits: record.edits,
    status: record.status,
    createdAt: record.createdAt,
    resolvedAt: record.resolvedAt,
    appliedRevision: record.appliedRevision,
    canRevert: false,
    ...overrides,
  };
}

const input = { jobId: "job-1", messageId: "assistant-1" };

describe("ghostwriter resume edit proposals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.repo.getMessageById.mockResolvedValue(buildMessage(publicProposal()));
    mocks.repo.getResumeEditProposalRecord.mockResolvedValue(buildRecord());
    mocks.repo.saveResumeEditProposalRecord.mockImplementation(
      async (_messageId: string, record: GhostwriterResumeEditProposalRecord) =>
        buildMessage(
          publicProposal({
            status: record.status,
            resolvedAt: record.resolvedAt,
            appliedRevision: record.appliedRevision,
            canRevert:
              record.status === "applied" && Boolean(record.previousResumeJson),
          }),
        ),
    );
    mocks.designResume.requireCurrentDesignResume.mockResolvedValue({
      id: "design-resume-1",
      revision: 4,
      resumeJson: previousResumeJson,
    });
    mocks.designResume.updateCurrentDesignResume.mockResolvedValue({
      id: "design-resume-1",
      revision: 5,
      resumeJson: { summary: { content: "<p>Platform engineer</p>" } },
    });
  });

  describe("getResumeEditProposal", () => {
    it("returns the staged proposal without touching the resume", async () => {
      const result = await getResumeEditProposal(input);

      expect(result.proposal.status).toBe("pending");
      expect(result.document).toBeNull();
      expect(
        mocks.designResume.updateCurrentDesignResume,
      ).not.toHaveBeenCalled();
    });

    it("404s when the message belongs to another job", async () => {
      mocks.repo.getMessageById.mockResolvedValue({
        ...buildMessage(publicProposal()),
        jobId: "other-job",
      });

      await expect(getResumeEditProposal(input)).rejects.toMatchObject({
        status: 404,
      });
      expect(mocks.repo.getResumeEditProposalRecord).not.toHaveBeenCalled();
    });

    it("404s when the message carries no proposal", async () => {
      mocks.repo.getResumeEditProposalRecord.mockResolvedValue(null);

      await expect(getResumeEditProposal(input)).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe("applyResumeEditProposal", () => {
    it("applies the edits through the design-resume patch mechanism", async () => {
      const result = await applyResumeEditProposal(input);

      expect(mocks.designResume.updateCurrentDesignResume).toHaveBeenCalledWith(
        {
          baseRevision: 4,
          operations: [
            {
              op: "replace",
              path: "/summary/content",
              value: "<p>Platform engineer</p>",
            },
          ],
        },
      );
      expect(result.document?.revision).toBe(5);
      expect(result.proposal.status).toBe("applied");
    });

    it("records the applied revision and keeps a revert snapshot", async () => {
      await applyResumeEditProposal(input);

      const [, record] = mocks.repo.saveResumeEditProposalRecord.mock.calls[0];
      expect(record).toMatchObject({
        status: "applied",
        appliedRevision: 5,
        previousResumeJson,
      });
      expect(record.resolvedAt).not.toBeNull();
    });

    it("clears the profile cache so downstream tailoring sees the new resume", async () => {
      await applyResumeEditProposal(input);
      expect(mocks.clearProfileCache).toHaveBeenCalledTimes(1);
    });

    it("strips the reason from the emitted patch operations", async () => {
      await applyResumeEditProposal(input);

      const [[patch]] = mocks.designResume.updateCurrentDesignResume.mock.calls;
      expect(patch.operations[0]).not.toHaveProperty("reason");
    });

    it("omits value for remove operations", async () => {
      mocks.repo.getResumeEditProposalRecord.mockResolvedValue(
        buildRecord({
          edits: [
            {
              op: "remove",
              path: "/sections/projects/items/2",
              reason: "Stale project.",
            },
          ],
        }),
      );

      await applyResumeEditProposal(input);

      const [[patch]] = mocks.designResume.updateCurrentDesignResume.mock.calls;
      expect(patch.operations).toEqual([
        { op: "remove", path: "/sections/projects/items/2" },
      ]);
    });

    describe("revision conflict protection", () => {
      it("409s and writes nothing when the resume moved ahead", async () => {
        mocks.designResume.requireCurrentDesignResume.mockResolvedValue({
          id: "design-resume-1",
          revision: 6,
          resumeJson: previousResumeJson,
        });

        await expect(applyResumeEditProposal(input)).rejects.toMatchObject({
          status: 409,
          code: "CONFLICT",
        });

        expect(
          mocks.designResume.updateCurrentDesignResume,
        ).not.toHaveBeenCalled();
        expect(mocks.repo.saveResumeEditProposalRecord).not.toHaveBeenCalled();
        expect(mocks.clearProfileCache).not.toHaveBeenCalled();
      });

      it("leaves the proposal pending after a conflict so it can be redrafted", async () => {
        mocks.designResume.requireCurrentDesignResume.mockResolvedValue({
          id: "design-resume-1",
          revision: 9,
          resumeJson: previousResumeJson,
        });

        await expect(applyResumeEditProposal(input)).rejects.toMatchObject({
          status: 409,
        });

        const proposal = await getResumeEditProposal(input);
        expect(proposal.proposal.status).toBe("pending");
      });

      it("surfaces a conflict raised inside the design-resume patch itself", async () => {
        mocks.designResume.updateCurrentDesignResume.mockRejectedValue(
          Object.assign(new Error("Resume Studio has changed."), {
            status: 409,
          }),
        );

        await expect(applyResumeEditProposal(input)).rejects.toMatchObject({
          status: 409,
        });
        expect(mocks.repo.saveResumeEditProposalRecord).not.toHaveBeenCalled();
      });
    });

    it.each([
      "applied",
      "rejected",
      "reverted",
    ] as const)("409s when the proposal is already %s", async (status) => {
      mocks.repo.getResumeEditProposalRecord.mockResolvedValue(
        buildRecord({ status }),
      );

      await expect(applyResumeEditProposal(input)).rejects.toMatchObject({
        status: 409,
      });
      expect(
        mocks.designResume.updateCurrentDesignResume,
      ).not.toHaveBeenCalled();
    });

    it("400s when the proposal has no edits", async () => {
      mocks.repo.getResumeEditProposalRecord.mockResolvedValue(
        buildRecord({ edits: [] }),
      );

      await expect(applyResumeEditProposal(input)).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe("rejectResumeEditProposal", () => {
    it("marks the proposal rejected without touching the resume", async () => {
      const result = await rejectResumeEditProposal(input);

      expect(result.proposal.status).toBe("rejected");
      expect(result.document).toBeNull();
      expect(
        mocks.designResume.updateCurrentDesignResume,
      ).not.toHaveBeenCalled();
      expect(mocks.clearProfileCache).not.toHaveBeenCalled();
    });

    it("409s when the proposal is no longer pending", async () => {
      mocks.repo.getResumeEditProposalRecord.mockResolvedValue(
        buildRecord({ status: "applied" }),
      );

      await expect(rejectResumeEditProposal(input)).rejects.toMatchObject({
        status: 409,
      });
    });
  });

  describe("revertResumeEditProposal", () => {
    const appliedRecord = buildRecord({
      status: "applied",
      appliedRevision: 5,
      resolvedAt: "2026-09-14T11:00:00.000Z",
      previousResumeJson,
    });

    it("restores the pre-apply snapshot through a document PATCH", async () => {
      mocks.repo.getResumeEditProposalRecord.mockResolvedValue(appliedRecord);
      mocks.designResume.requireCurrentDesignResume.mockResolvedValue({
        id: "design-resume-1",
        revision: 5,
        resumeJson: { summary: { content: "<p>Platform engineer</p>" } },
      });
      mocks.designResume.updateCurrentDesignResume.mockResolvedValue({
        id: "design-resume-1",
        revision: 6,
        resumeJson: previousResumeJson,
      });

      const result = await revertResumeEditProposal(input);

      expect(mocks.designResume.updateCurrentDesignResume).toHaveBeenCalledWith(
        {
          baseRevision: 5,
          document: previousResumeJson,
        },
      );
      expect(result.proposal.status).toBe("reverted");
      expect(mocks.clearProfileCache).toHaveBeenCalledTimes(1);
    });

    it("409s when the resume moved on after the apply", async () => {
      mocks.repo.getResumeEditProposalRecord.mockResolvedValue(appliedRecord);
      mocks.designResume.requireCurrentDesignResume.mockResolvedValue({
        id: "design-resume-1",
        revision: 8,
        resumeJson: previousResumeJson,
      });

      await expect(revertResumeEditProposal(input)).rejects.toMatchObject({
        status: 409,
      });
      expect(
        mocks.designResume.updateCurrentDesignResume,
      ).not.toHaveBeenCalled();
    });

    it("409s when the proposal was never applied", async () => {
      await expect(revertResumeEditProposal(input)).rejects.toMatchObject({
        status: 409,
      });
    });

    it("409s when no snapshot is stored", async () => {
      mocks.repo.getResumeEditProposalRecord.mockResolvedValue(
        buildRecord({
          status: "applied",
          appliedRevision: 5,
          previousResumeJson: null,
        }),
      );

      await expect(revertResumeEditProposal(input)).rejects.toMatchObject({
        status: 409,
      });
    });
  });
});
