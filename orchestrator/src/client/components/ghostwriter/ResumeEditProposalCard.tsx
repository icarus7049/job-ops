import type { GhostwriterResumeEditProposal } from "@shared/types";
import { Check, FileText, RotateCcw, X } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type ResumeEditProposalCardProps = {
  proposal: GhostwriterResumeEditProposal;
  disabled?: boolean;
  onApply: () => Promise<void>;
  onReject: () => Promise<void>;
  onRevert: () => Promise<void>;
};

const OP_LABELS: Record<string, string> = {
  add: "Add",
  replace: "Change",
  remove: "Remove",
};

const STATUS_LABELS: Record<GhostwriterResumeEditProposal["status"], string> = {
  pending: "Awaiting your approval",
  applied: "Applied to your resume",
  rejected: "Discarded",
  reverted: "Reverted",
};

/**
 * Render the value the model wants to write, in a form a human can judge.
 * Strings are shown as text; anything structural falls back to pretty JSON.
 */
function formatValue(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

/** Turn `/sections/experience/items/0/description` into a readable trail. */
function formatPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"))
    .join(" › ");
}

export const ResumeEditProposalCard: React.FC<ResumeEditProposalCardProps> = ({
  proposal,
  disabled = false,
  onApply,
  onReject,
  onRevert,
}) => {
  const [pendingAction, setPendingAction] = useState<
    "apply" | "reject" | "revert" | null
  >(null);

  const isPending = proposal.status === "pending";
  const isBusy = pendingAction !== null;

  const run = async (
    action: "apply" | "reject" | "revert",
    handler: () => Promise<void>,
  ) => {
    setPendingAction(action);
    try {
      await handler();
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section
      aria-label="Proposed resume changes"
      className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3"
    >
      <header className="flex flex-wrap items-center gap-2">
        <FileText className="h-4 w-4 text-amber-600" aria-hidden="true" />
        <span className="text-xs font-medium">Proposed resume changes</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {STATUS_LABELS[proposal.status]}
        </span>
      </header>

      <p className="mt-2 text-sm text-foreground">{proposal.summary}</p>

      {isPending ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Nothing has been written to your resume yet. Review each change below,
          then apply or discard.
        </p>
      ) : null}

      <ol className="mt-3 space-y-2">
        {proposal.edits.map((edit) => {
          const value = formatValue(edit.value);
          return (
            <li
              key={`${edit.op}-${edit.path}`}
              className="rounded border border-border/60 bg-background p-2"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                  {OP_LABELS[edit.op] ?? edit.op}
                </span>
                <code className="text-[11px] text-muted-foreground">
                  {formatPath(edit.path)}
                </code>
              </div>
              {value ? (
                <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-xs">
                  {value}
                </pre>
              ) : null}
              <p className="mt-1.5 text-xs text-muted-foreground">
                {edit.reason}
              </p>
            </li>
          );
        })}
      </ol>

      <footer className="mt-3 flex flex-wrap items-center gap-2">
        {isPending ? (
          <>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={disabled || isBusy}
              onClick={() => void run("apply", onApply)}
            >
              <Check className="h-3.5 w-3.5" />
              {pendingAction === "apply" ? "Applying…" : "Apply to resume"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              disabled={disabled || isBusy}
              onClick={() => void run("reject", onReject)}
            >
              <X className="h-3.5 w-3.5" />
              Discard
            </Button>
          </>
        ) : null}

        {proposal.canRevert ? (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={disabled || isBusy}
            onClick={() => void run("revert", onRevert)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {pendingAction === "revert" ? "Reverting…" : "Undo"}
          </Button>
        ) : null}

        {proposal.appliedRevision !== null ? (
          <span className="text-[11px] text-muted-foreground">
            Resume revision {proposal.appliedRevision}
          </span>
        ) : null}
      </footer>
    </section>
  );
};
