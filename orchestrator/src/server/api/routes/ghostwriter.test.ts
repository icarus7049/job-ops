import type { Server } from "node:http";
import { updateContextForJob } from "@server/services/ghostwriter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

const baseMsgFields = {
  threadId: "thread-1",
  jobId: "job-1",
  tokensIn: 1,
  tokensOut: null,
  version: 1,
  replacesMessageId: null,
  parentMessageId: null,
  activeChildId: null,
  attachments: [],
  resumeEditProposal: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const stagedProposal = {
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
  createdAt: new Date().toISOString(),
  resolvedAt: null,
  appliedRevision: null,
  canRevert: false,
};

const resumeEditMocks = vi.hoisted(() => ({
  getResumeEditProposal: vi.fn(),
  applyResumeEditProposal: vi.fn(),
  rejectResumeEditProposal: vi.fn(),
  revertResumeEditProposal: vi.fn(),
}));

vi.mock("@server/services/ghostwriter-resume-edit", () => resumeEditMocks);

vi.mock("@server/services/auto-pdf-regeneration", () => ({
  enqueueAutoPdfRegenerationForReadyJobs: vi.fn(async () => undefined),
}));

vi.mock("@server/services/ghostwriter", () => ({
  listThreads: vi.fn(async () => [
    {
      id: "thread-1",
      jobId: "job-1",
      title: "Thread",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
      activeRootMessageId: null,
      selectedNoteIds: ["note-1"],
      selectedEmailIds: ["email-1"],
      selectedDocumentIds: ["doc-1"],
    },
  ]),
  createThread: vi.fn(
    async (input: { jobId: string; title?: string | null }) => ({
      id: "thread-created",
      jobId: input.jobId,
      title: input.title ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastMessageAt: null,
      activeRootMessageId: null,
      selectedNoteIds: [],
      selectedEmailIds: [],
      selectedDocumentIds: [],
    }),
  ),
  updateContextForJob: vi.fn(
    async (input: {
      jobId: string;
      selectedNoteIds?: string[];
      selectedEmailIds?: string[];
      selectedDocumentIds?: string[];
    }) => ({
      selectedNoteIds: input.selectedNoteIds ?? [],
      selectedEmailIds: input.selectedEmailIds ?? [],
      selectedDocumentIds: input.selectedDocumentIds ?? [],
    }),
  ),
  listMessages: vi.fn(async () => ({
    messages: [
      {
        id: "message-1",
        ...baseMsgFields,
        role: "user",
        content: "hello",
        status: "complete",
      },
    ],
    branches: [],
    selectedNoteIds: ["note-1"],
    selectedEmailIds: ["email-1"],
    selectedDocumentIds: ["doc-1"],
  })),
  listMessagesForJob: vi.fn(async () => ({
    messages: [
      {
        id: "message-1",
        ...baseMsgFields,
        role: "user",
        content: "hello",
        status: "complete",
      },
    ],
    branches: [],
    selectedNoteIds: ["note-1"],
    selectedEmailIds: ["email-1"],
    selectedDocumentIds: ["doc-1"],
  })),
  sendMessage: vi.fn(async () => ({
    userMessage: {
      id: "user-1",
      ...baseMsgFields,
      role: "user",
      content: "hello",
      status: "complete",
    },
    assistantMessage: {
      id: "assistant-1",
      ...baseMsgFields,
      role: "assistant",
      content: "hi",
      status: "complete",
      tokensOut: 1,
    },
    runId: "run-1",
  })),
  sendMessageForJob: vi.fn(async () => ({
    userMessage: {
      id: "user-1",
      ...baseMsgFields,
      role: "user",
      content: "hello",
      status: "complete",
    },
    assistantMessage: {
      id: "assistant-1",
      ...baseMsgFields,
      role: "assistant",
      content: "hi",
      status: "complete",
      tokensOut: 1,
    },
    runId: "run-1",
  })),
  cancelRun: vi.fn(async () => ({ cancelled: true, alreadyFinished: false })),
  regenerateMessage: vi.fn(async () => ({
    runId: "run-2",
    assistantMessage: {
      id: "assistant-2",
      ...baseMsgFields,
      role: "assistant",
      content: "updated",
      status: "complete",
      tokensOut: 1,
      version: 2,
      replacesMessageId: "assistant-1",
      parentMessageId: "user-1",
    },
  })),
  editMessageForJob: vi.fn(async () => ({
    userMessage: {
      id: "user-2",
      ...baseMsgFields,
      role: "user",
      content: "edited",
      status: "complete",
    },
    assistantMessage: {
      id: "assistant-3",
      ...baseMsgFields,
      role: "assistant",
      content: "reply to edit",
      status: "complete",
      tokensOut: 3,
      parentMessageId: "user-2",
    },
    runId: "run-3",
  })),
  switchBranchForJob: vi.fn(async () => ({
    messages: [
      {
        id: "message-1",
        ...baseMsgFields,
        role: "user",
        content: "hello",
        status: "complete",
      },
    ],
    branches: [],
  })),
}));

describe.sequential("Ghostwriter API", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("lists messages with request id metadata and branch info", async () => {
    const res = await fetch(`${baseUrl}/api/jobs/job-1/chat/messages`, {
      headers: {
        "x-request-id": "chat-req-1",
      },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("chat-req-1");
    expect(body.ok).toBe(true);
    expect(body.data.messages.length).toBe(1);
    expect(body.data.branches).toEqual([]);
    expect(body.meta.requestId).toBe("chat-req-1");
  });

  it("sends a message in the per-job conversation", async () => {
    const messageRes = await fetch(`${baseUrl}/api/jobs/job-1/chat/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: "hello" }),
    });
    const messageBody = await messageRes.json();

    expect(messageRes.status).toBe(200);
    expect(messageBody.ok).toBe(true);
    expect(messageBody.data.runId).toBe("run-1");
    expect(messageBody.data.assistantMessage.role).toBe("assistant");
    expect(typeof messageBody.meta.requestId).toBe("string");
  });

  it("updates selected Ghostwriter notes", async () => {
    const res = await fetch(`${baseUrl}/api/jobs/job-1/chat/context`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedNoteIds: ["note-1"] }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.selectedNoteIds).toEqual(["note-1"]);
  });

  it("updates selected Ghostwriter emails", async () => {
    const res = await fetch(`${baseUrl}/api/jobs/job-1/chat/context`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedEmailIds: ["email-1"] }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.selectedEmailIds).toEqual(["email-1"]);
  });

  it("updates selected Ghostwriter documents", async () => {
    const res = await fetch(`${baseUrl}/api/jobs/job-1/chat/context`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedDocumentIds: ["doc-1"] }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.selectedDocumentIds).toEqual(["doc-1"]);
  });

  it("rejects empty Ghostwriter context updates", async () => {
    const res = await fetch(`${baseUrl}/api/jobs/job-1/chat/context`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(vi.mocked(updateContextForJob)).not.toHaveBeenCalled();
  });

  it("edits a user message", async () => {
    const res = await fetch(
      `${baseUrl}/api/jobs/job-1/chat/messages/user-1/edit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "edited content" }),
      },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.runId).toBe("run-3");
    expect(body.data.userMessage.content).toBe("edited");
  });

  it("switches branch", async () => {
    const res = await fetch(
      `${baseUrl}/api/jobs/job-1/chat/messages/message-1/switch-branch`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.messages.length).toBe(1);
    expect(body.data.branches).toEqual([]);
  });

  describe("resume edit proposals", () => {
    const proposalUrl = () =>
      `${baseUrl}/api/jobs/job-1/chat/messages/assistant-1/resume-edit`;

    beforeEach(() => {
      resumeEditMocks.getResumeEditProposal.mockResolvedValue({
        message: { id: "assistant-1", ...baseMsgFields, role: "assistant" },
        proposal: stagedProposal,
        document: null,
      });
      resumeEditMocks.applyResumeEditProposal.mockResolvedValue({
        message: { id: "assistant-1", ...baseMsgFields, role: "assistant" },
        proposal: { ...stagedProposal, status: "applied", appliedRevision: 5 },
        document: { id: "design-resume-1", revision: 5 },
      });
      resumeEditMocks.rejectResumeEditProposal.mockResolvedValue({
        message: { id: "assistant-1", ...baseMsgFields, role: "assistant" },
        proposal: { ...stagedProposal, status: "rejected" },
        document: null,
      });
      resumeEditMocks.revertResumeEditProposal.mockResolvedValue({
        message: { id: "assistant-1", ...baseMsgFields, role: "assistant" },
        proposal: { ...stagedProposal, status: "reverted" },
        document: { id: "design-resume-1", revision: 6 },
      });
    });

    it("reads a staged proposal without applying it", async () => {
      const res = await fetch(proposalUrl());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.proposal.status).toBe("pending");
      expect(resumeEditMocks.applyResumeEditProposal).not.toHaveBeenCalled();
    });

    it("applies a proposal only on an explicit apply request", async () => {
      const res = await fetch(`${proposalUrl()}/apply`, { method: "POST" });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.proposal.status).toBe("applied");
      expect(body.data.document.revision).toBe(5);
      expect(resumeEditMocks.applyResumeEditProposal).toHaveBeenCalledWith({
        jobId: "job-1",
        messageId: "assistant-1",
      });
    });

    it("returns 409 when applying against a stale revision", async () => {
      const { conflict } = await import("@server/infra/errors");
      resumeEditMocks.applyResumeEditProposal.mockRejectedValue(
        conflict("Your resume changed after Ghostwriter drafted this edit."),
      );

      const res = await fetch(`${proposalUrl()}/apply`, { method: "POST" });
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("CONFLICT");
    });

    it("rejects a proposal without touching the resume", async () => {
      const res = await fetch(`${proposalUrl()}/reject`, { method: "POST" });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.proposal.status).toBe("rejected");
      expect(resumeEditMocks.applyResumeEditProposal).not.toHaveBeenCalled();
    });

    it("reverts an applied proposal", async () => {
      const res = await fetch(`${proposalUrl()}/revert`, { method: "POST" });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.proposal.status).toBe("reverted");
      expect(body.data.document.revision).toBe(6);
    });

    it("returns 404 for a message with no staged proposal", async () => {
      const { notFound } = await import("@server/infra/errors");
      resumeEditMocks.getResumeEditProposal.mockRejectedValue(
        notFound("This message has no staged resume edit"),
      );

      const res = await fetch(proposalUrl());
      expect(res.status).toBe(404);
    });
  });
});
