import {
  type AiAssistMessage,
  AiAssistMessageList,
} from "@client/components/ai-assist/AiAssistMessageList";
import type {
  BranchInfo,
  GhostwriterResumeEditProposal,
  JobChatImageAttachment,
  JobChatMessage,
} from "@shared/types";
import type React from "react";
import { bucketQueryLength, trackProductEvent } from "@/lib/analytics";
import { ResumeEditProposalCard } from "./ResumeEditProposalCard";

type MessageListProps = {
  messages: JobChatMessage[];
  branches: BranchInfo[];
  isStreaming: boolean;
  streamingMessageId: string | null;
  onRegenerate: (messageId: string) => void;
  onEdit: (
    messageId: string,
    content: string,
    attachments: JobChatImageAttachment[],
  ) => void;
  onSwitchBranch: (messageId: string) => void;
  onApplyResumeEdit?: (messageId: string) => Promise<void>;
  onRejectResumeEdit?: (messageId: string) => Promise<void>;
  onRevertResumeEdit?: (messageId: string) => Promise<void>;
};

type GhostwriterAiAssistMessage = AiAssistMessage & {
  resumeEditProposal: GhostwriterResumeEditProposal | null;
};

function toAiAssistMessage(
  message: JobChatMessage,
): GhostwriterAiAssistMessage {
  return {
    id: message.id,
    role: message.role === "user" ? "user" : "assistant",
    content: message.content,
    status: message.status,
    attachments: message.attachments,
    resumeEditProposal: message.resumeEditProposal,
  };
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  branches,
  isStreaming,
  streamingMessageId,
  onRegenerate,
  onEdit,
  onSwitchBranch,
  onApplyResumeEdit,
  onRejectResumeEdit,
  onRevertResumeEdit,
}) => (
  <AiAssistMessageList
    messages={messages
      .filter(
        (message) => message.role === "user" || message.role === "assistant",
      )
      .map(toAiAssistMessage)}
    branches={branches}
    isStreaming={isStreaming}
    streamingMessageId={streamingMessageId}
    assistantLabel="Ghostwriter"
    onRegenerate={onRegenerate}
    onEdit={onEdit}
    onSwitchBranch={onSwitchBranch}
    onAssistantCopy={(message) =>
      trackProductEvent("ghostwriter_response_copied", {
        message_length_bucket: bucketQueryLength(message.content),
      })
    }
    renderAssistantActions={(message) =>
      message.resumeEditProposal ? (
        <ResumeEditProposalCard
          proposal={message.resumeEditProposal}
          disabled={isStreaming}
          onApply={async () => {
            await onApplyResumeEdit?.(message.id);
          }}
          onReject={async () => {
            await onRejectResumeEdit?.(message.id);
          }}
          onRevert={async () => {
            await onRevertResumeEdit?.(message.id);
          }}
        />
      ) : null
    }
  />
);
