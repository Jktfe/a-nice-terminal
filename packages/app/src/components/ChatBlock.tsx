import type { Message } from "../store.ts";
import MessageBubble from "./MessageBubble.tsx";
import TerminalOutputBlock from "./TerminalOutputBlock.tsx";

interface ChatBlockProps {
  message: Message;
  sessionId: string;
  onReply: (messageId: string) => void;
  onDelete: (messageId: string) => void;
  onAnnotationChange: (messageId: string, annotations: any[], starred: number) => void;
  replyCount?: number;
  onToggleThread?: () => void;
  showSessionRating?: boolean;
}

export default function ChatBlock({
  message,
  sessionId,
  onReply,
  onDelete,
  onAnnotationChange,
  replyCount = 0,
  onToggleThread,
  showSessionRating = false,
}: ChatBlockProps) {
  const messageType = message.message_type || "text";

  switch (messageType) {
    case "command_result":
    case "terminal_block":
      return <TerminalOutputBlock message={message} />;

    case "agent_action":
      return <AgentActionBlock message={message} />;

    default:
      return (
        <MessageBubble
          message={message}
          sessionId={sessionId}
          onReply={onReply}
          onDelete={onDelete}
          onAnnotationChange={onAnnotationChange}
          replyCount={replyCount}
          onToggleThread={onToggleThread}
          showSessionRating={showSessionRating}
        />
      );
  }
}

function AgentActionBlock({ message }: { message: Message }) {
  const meta = typeof message.metadata === "string"
    ? JSON.parse(message.metadata)
    : message.metadata || {};

  const timestamp = message.created_at
    ? new Date(message.created_at + "Z").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div className="my-1 px-4 py-1.5 flex items-center gap-2 text-xs text-[var(--color-text-dim)]">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-400/50 flex-shrink-0" />
      <span>
        {meta.agent_id || message.sender_name || "Agent"} {meta.action || "performed an action"}
        {meta.tool_name && <span className="text-[var(--color-text-muted)]"> using {meta.tool_name}</span>}
      </span>
      {timestamp && <span className="ml-auto">{timestamp}</span>}
    </div>
  );
}
