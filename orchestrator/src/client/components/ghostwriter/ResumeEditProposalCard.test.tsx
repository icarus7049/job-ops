import type { GhostwriterResumeEditProposal } from "@shared/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResumeEditProposalCard } from "./ResumeEditProposalCard";

function buildProposal(
  overrides: Partial<GhostwriterResumeEditProposal> = {},
): GhostwriterResumeEditProposal {
  return {
    id: "proposal-1",
    baseRevision: 4,
    summary: "Sharpen the summary for a platform role",
    edits: [
      {
        op: "replace",
        path: "/summary/content",
        value: "<p>Platform engineer</p>",
        reason: "Mirrors the platform focus in the job description.",
      },
      {
        op: "remove",
        path: "/sections/projects/items/2",
        reason: "The project predates the target role by eight years.",
      },
    ],
    status: "pending",
    createdAt: "2026-09-14T10:00:00.000Z",
    resolvedAt: null,
    appliedRevision: null,
    canRevert: false,
    ...overrides,
  };
}

function renderCard(
  proposal: GhostwriterResumeEditProposal,
  handlers: {
    onApply?: () => Promise<void>;
    onReject?: () => Promise<void>;
    onRevert?: () => Promise<void>;
    disabled?: boolean;
  } = {},
) {
  const onApply = handlers.onApply ?? vi.fn(async () => undefined);
  const onReject = handlers.onReject ?? vi.fn(async () => undefined);
  const onRevert = handlers.onRevert ?? vi.fn(async () => undefined);

  render(
    <ResumeEditProposalCard
      proposal={proposal}
      disabled={handlers.disabled}
      onApply={onApply}
      onReject={onReject}
      onRevert={onRevert}
    />,
  );

  return { onApply, onReject, onRevert };
}

describe("ResumeEditProposalCard", () => {
  it("stages every edit with its own reason", () => {
    renderCard(buildProposal());

    expect(
      screen.getByText("Sharpen the summary for a platform role"),
    ).toBeInTheDocument();
    expect(screen.getByText("<p>Platform engineer</p>")).toBeInTheDocument();
    expect(
      screen.getByText("Mirrors the platform focus in the job description."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The project predates the target role by eight years."),
    ).toBeInTheDocument();
    expect(screen.getByText("Change")).toBeInTheDocument();
    expect(screen.getByText("Remove")).toBeInTheDocument();
  });

  it("makes clear nothing is written until the user approves", () => {
    renderCard(buildProposal());

    expect(
      screen.getByText(/Nothing has been written to your resume yet/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Awaiting your approval")).toBeInTheDocument();
  });

  it("renders a readable pointer trail instead of a raw JSON pointer", () => {
    renderCard(buildProposal());
    expect(
      screen.getByText("sections › projects › items › 2"),
    ).toBeInTheDocument();
  });

  it("does not call apply until the apply button is pressed", () => {
    const { onApply } = renderCard(buildProposal());
    expect(onApply).not.toHaveBeenCalled();
  });

  it("applies only on an explicit click", async () => {
    const { onApply, onReject } = renderCard(buildProposal());

    fireEvent.click(screen.getByRole("button", { name: /apply to resume/i }));

    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(onReject).not.toHaveBeenCalled();
  });

  it("discards on an explicit click without applying", async () => {
    const { onApply, onReject } = renderCard(buildProposal());

    fireEvent.click(screen.getByRole("button", { name: /discard/i }));

    await waitFor(() => expect(onReject).toHaveBeenCalledTimes(1));
    expect(onApply).not.toHaveBeenCalled();
  });

  it("hides the approval buttons once the proposal is resolved", () => {
    renderCard(
      buildProposal({
        status: "applied",
        appliedRevision: 5,
        resolvedAt: "2026-09-14T11:00:00.000Z",
        canRevert: true,
      }),
    );

    expect(
      screen.queryByRole("button", { name: /apply to resume/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /discard/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Applied to your resume")).toBeInTheDocument();
    expect(screen.getByText("Resume revision 5")).toBeInTheDocument();
  });

  it("offers undo only when a revert snapshot exists", async () => {
    const { onRevert } = renderCard(
      buildProposal({
        status: "applied",
        appliedRevision: 5,
        canRevert: true,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    await waitFor(() => expect(onRevert).toHaveBeenCalledTimes(1));
  });

  it("hides undo when no snapshot is stored", () => {
    renderCard(
      buildProposal({
        status: "applied",
        appliedRevision: 5,
        canRevert: false,
      }),
    );

    expect(
      screen.queryByRole("button", { name: /undo/i }),
    ).not.toBeInTheDocument();
  });

  it("disables approval while a run is streaming", () => {
    renderCard(buildProposal(), { disabled: true });

    expect(
      screen.getByRole("button", { name: /apply to resume/i }),
    ).toBeDisabled();
  });
});
