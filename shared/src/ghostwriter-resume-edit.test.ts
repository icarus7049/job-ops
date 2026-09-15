import { describe, expect, it } from "vitest";
import {
  GHOSTWRITER_RESUME_EDIT_MAX_EDITS,
  GHOSTWRITER_RESUME_EDIT_MAX_REASON_CHARS,
  GHOSTWRITER_RESUME_EDIT_MAX_VALUE_CHARS,
  isGhostwriterResumeEditProposalPending,
  normalizeGhostwriterResumeEditDraft,
  toDesignResumePatchOperations,
} from "./ghostwriter-resume-edit";

function draftEdit(overrides: Record<string, unknown> = {}) {
  return {
    op: "replace",
    path: "/summary/content",
    valueJson: JSON.stringify("<p>Updated summary</p>"),
    reason: "Leads with the platform scale the job description asks for.",
    ...overrides,
  };
}

describe("normalizeGhostwriterResumeEditDraft", () => {
  it("returns null for plain chat turns with no resume edit", () => {
    expect(normalizeGhostwriterResumeEditDraft(null)).toBeNull();
    expect(normalizeGhostwriterResumeEditDraft(undefined)).toBeNull();
  });

  it("treats an empty edit list as plain chat rather than an error", () => {
    expect(
      normalizeGhostwriterResumeEditDraft({ summary: "Nothing", edits: [] }),
    ).toBeNull();
  });

  it("normalizes a well-formed proposal and parses valueJson", () => {
    const result = normalizeGhostwriterResumeEditDraft({
      summary: "  Sharpen the summary  ",
      edits: [draftEdit()],
    });

    expect(result).toEqual({
      ok: true,
      summary: "Sharpen the summary",
      edits: [
        {
          op: "replace",
          path: "/summary/content",
          value: "<p>Updated summary</p>",
          reason: "Leads with the platform scale the job description asks for.",
        },
      ],
    });
  });

  it("parses structured object values", () => {
    const result = normalizeGhostwriterResumeEditDraft({
      summary: "Add a skill",
      edits: [
        draftEdit({
          op: "add",
          path: "/sections/skills/items/-",
          valueJson: JSON.stringify({ id: "s1", name: "Kubernetes" }),
          reason: "The posting lists Kubernetes as required.",
        }),
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      edits: [{ value: { id: "s1", name: "Kubernetes" } }],
    });
  });

  it("omits value entirely for remove operations", () => {
    const result = normalizeGhostwriterResumeEditDraft({
      summary: "Drop a stale project",
      edits: [
        {
          op: "remove",
          path: "/sections/projects/items/3",
          valueJson: JSON.stringify("ignored"),
          reason: "The project predates the target role by eight years.",
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      summary: "Drop a stale project",
      edits: [
        {
          op: "remove",
          path: "/sections/projects/items/3",
          reason: "The project predates the target role by eight years.",
        },
      ],
    });
    expect(
      result?.ok === true ? Object.hasOwn(result.edits[0], "value") : true,
    ).toBe(false);
  });

  it("falls back to a default summary when the model omits one", () => {
    const result = normalizeGhostwriterResumeEditDraft({
      edits: [draftEdit()],
    });
    expect(result).toMatchObject({
      ok: true,
      summary: "Proposed resume changes",
    });
  });

  it("truncates an over-long per-edit reason", () => {
    const result = normalizeGhostwriterResumeEditDraft({
      summary: "Long reason",
      edits: [draftEdit({ reason: "x".repeat(900) })],
    });

    expect(result?.ok).toBe(true);
    if (result?.ok !== true) return;
    expect(result.edits[0].reason).toHaveLength(
      GHOSTWRITER_RESUME_EDIT_MAX_REASON_CHARS,
    );
  });

  describe("rejects malformed proposals", () => {
    it.each([
      ["a non-object payload", "not an object"],
      ["an array payload", ["nope"]],
    ])("rejects %s", (_label, payload) => {
      expect(normalizeGhostwriterResumeEditDraft(payload)).toEqual({
        ok: false,
        reason: "Resume edit payload is not an object.",
      });
    });

    it("rejects an unsupported op", () => {
      const result = normalizeGhostwriterResumeEditDraft({
        edits: [draftEdit({ op: "move" })],
      });
      expect(result).toMatchObject({ ok: false });
      expect(result?.ok === false && result.reason).toContain("unsupported op");
    });

    it("rejects a path that is not a JSON Pointer", () => {
      const result = normalizeGhostwriterResumeEditDraft({
        edits: [draftEdit({ path: "summary.content" })],
      });
      expect(result?.ok === false && result.reason).toContain("JSON Pointer");
    });

    it("rejects the root pointer", () => {
      const result = normalizeGhostwriterResumeEditDraft({
        edits: [draftEdit({ path: "" })],
      });
      expect(result?.ok === false && result.reason).toContain("missing a path");
    });

    it("rejects edits targeting the asset-managed picture subtree", () => {
      const result = normalizeGhostwriterResumeEditDraft({
        edits: [draftEdit({ path: "/picture/url" })],
      });
      expect(result?.ok === false && result.reason).toContain("cannot change");
    });

    it("rejects an edit without a reason", () => {
      const result = normalizeGhostwriterResumeEditDraft({
        edits: [draftEdit({ reason: "   " })],
      });
      expect(result?.ok === false && result.reason).toContain(
        "missing a reason",
      );
    });

    it("rejects add/replace without a value", () => {
      const result = normalizeGhostwriterResumeEditDraft({
        edits: [draftEdit({ valueJson: "" })],
      });
      expect(result?.ok === false && result.reason).toContain(
        "missing a value",
      );
    });

    it("rejects a value that is not valid JSON", () => {
      const result = normalizeGhostwriterResumeEditDraft({
        edits: [draftEdit({ valueJson: "{not json" })],
      });
      expect(result?.ok === false && result.reason).toContain("not valid JSON");
    });

    it("rejects an oversized value", () => {
      const result = normalizeGhostwriterResumeEditDraft({
        edits: [
          draftEdit({
            valueJson: JSON.stringify(
              "y".repeat(GHOSTWRITER_RESUME_EDIT_MAX_VALUE_CHARS + 10),
            ),
          }),
        ],
      });
      expect(result?.ok === false && result.reason).toContain("too large");
    });

    it("rejects more edits than the cap", () => {
      const result = normalizeGhostwriterResumeEditDraft({
        edits: Array.from(
          { length: GHOSTWRITER_RESUME_EDIT_MAX_EDITS + 1 },
          () => draftEdit(),
        ),
      });
      expect(result?.ok === false && result.reason).toContain("more than the");
    });

    it("rejects the whole proposal when a single edit is invalid", () => {
      const result = normalizeGhostwriterResumeEditDraft({
        edits: [draftEdit(), draftEdit({ op: "delete" })],
      });
      expect(result).toMatchObject({ ok: false });
    });
  });
});

describe("toDesignResumePatchOperations", () => {
  it("maps edits onto design-resume patch operations without the reason", () => {
    expect(
      toDesignResumePatchOperations([
        {
          op: "replace",
          path: "/summary/content",
          value: "<p>Hi</p>",
          reason: "because",
        },
        { op: "remove", path: "/sections/projects/items/0", reason: "stale" },
      ]),
    ).toEqual([
      { op: "replace", path: "/summary/content", value: "<p>Hi</p>" },
      { op: "remove", path: "/sections/projects/items/0" },
    ]);
  });
});

describe("isGhostwriterResumeEditProposalPending", () => {
  const proposal = {
    id: "p1",
    baseRevision: 3,
    summary: "s",
    edits: [],
    createdAt: "2026-09-14T00:00:00.000Z",
    resolvedAt: null,
    appliedRevision: null,
    canRevert: false,
  };

  it("is true only for pending proposals", () => {
    expect(
      isGhostwriterResumeEditProposalPending({
        ...proposal,
        status: "pending",
      }),
    ).toBe(true);
    expect(
      isGhostwriterResumeEditProposalPending({
        ...proposal,
        status: "applied",
      }),
    ).toBe(false);
    expect(isGhostwriterResumeEditProposalPending(null)).toBe(false);
  });
});
