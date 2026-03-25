import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { ChevronDown, ChevronUp, Send } from "lucide-react";
import { useStore, type Message } from "../store.ts";
import { getSenderTheme, isHuman, isSystem } from "../utils/senderTheme.ts";
import { isProtocolMessage } from "../utils/protocolTypes.ts";
import SenderAvatar from "./SenderAvatar.tsx";
import MessageToolbar from "./MessageToolbar.tsx";
import ProtocolCard from "./ProtocolCard.tsx";
import SessionRating from "./SessionRating.tsx";

const PLATFORM_LABELS: Record<string, { label: string; color: string }> = {
  telegram: { label: "Telegram", color: "#0088cc" },
  slack: { label: "Slack", color: "#4a154b" },
  discord: { label: "Discord", color: "#5865f2" },
};

const COLLAPSE_THRESHOLD = 15;
const COLLAPSED_LINES = 6;

interface MessageBubbleProps {
  message: Message;
  sessionId: string;
  onReply: (messageId: string) => void;
  onDelete: (messageId: string) => void;
  onAnnotationChange: (messageId: string, annotations: any[], starred: number) => void;
  replyCount?: number;
  onToggleThread?: () => void;
  scale?: number;
  showSessionRating?: boolean;
}

export default function MessageBubble({
  message, sessionId, onReply, onDelete, onAnnotationChange,
  replyCount = 0, onToggleThread, scale = 1, showSessionRating = false,
}: MessageBubbleProps) {
  const uiTheme = useStore((s) => s.uiTheme);
  const theme = getSenderTheme(message.sender_type, uiTheme);
  const human = isHuman(message.sender_type);
  const system = isSystem(message.sender_type);
  const [hovered, setHovered] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    const lineCount = message.content.split("\n").length;
    return lineCount > COLLAPSE_THRESHOLD;
  });

  const annotations = message.annotations || [];
  const pills = annotations.filter((a) => a.type !== "star" && a.type !== "session_rating");
  const isStarred = message.starred === 1;
  const platformInfo = message.metadata?.source ? PLATFORM_LABELS[message.metadata.source as string] : undefined;

  const alignment = system ? "justify-center" : human ? "justify-end" : "justify-start";
  const maxWidth = system ? "max-w-lg" : "max-w-2xl";
  const fontSize = scale < 1 ? "text-[13px]" : "text-sm";

  const timestamp = message.created_at
    ? new Date(message.created_at + "Z").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div
      className={`flex ${alignment} group relative mb-4`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={`${maxWidth} w-full`}>
        <div
          className={`relative rounded-xl px-4 py-3 ${fontSize}`}
          style={{
            backgroundColor: theme.bg,
            borderLeft: !human && !system ? `3px solid ${isStarred ? "#eab308" : theme.accent}` : undefined,
            borderRight: human ? `3px solid ${isStarred ? "#eab308" : theme.accent}` : undefined,
            boxShadow: isStarred ? "0 0 0 1px rgba(234, 179, 8, 0.3)" : undefined,
          }}
        >
          {/* Hover toolbar */}
          {hovered && (
            <div className="absolute -top-4 right-2 z-10">
              <MessageToolbar
                message={message}
                sessionId={sessionId}
                onReply={() => onReply(message.id)}
                onDelete={() => onDelete(message.id)}
                onAnnotationChange={(anns, starred) => onAnnotationChange(message.id, anns, starred)}
              />
            </div>
          )}

          {/* Avatar + content row */}
          <div className={`flex items-start gap-2 ${human ? "flex-row-reverse" : ""}`}>
            <SenderAvatar
              senderType={message.sender_type}
              senderName={message.sender_name}
              senderPersona={message.sender_persona}
              senderCwd={message.sender_cwd}
              size={scale < 1 ? 16 : 20}
            />
            <div className="min-w-0 flex-1">
              {/* Sender name — shown for all non-human messages with a sender_name */}
              {!human && message.sender_name && (
                <div
                  className="text-[11px] font-medium mb-0.5"
                  style={{ color: platformInfo?.color || theme.accent }}
                >
                  {message.sender_name}
                  {platformInfo && (
                    <span className="ml-1 opacity-60">via {platformInfo.label}</span>
                  )}
                </div>
              )}
              {/* Content */}
              <div className={`prose prose-invert prose-sm max-w-none ${collapsed ? "overflow-hidden" : ""}`}>
                {system ? (
                  <span className="text-[var(--color-text-muted)] text-xs">{message.content}</span>
                ) : (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                    {collapsed
                      ? message.content.split("\n").slice(0, COLLAPSED_LINES).join("\n")
                      : message.content}
                  </ReactMarkdown>
                )}
              </div>

              {/* Protocol card — rendered when metadata is a structured protocol message */}
              {isProtocolMessage(message.metadata) && (
                <ProtocolCard metadata={message.metadata} />
              )}

              {/* Collapse toggle */}
              {message.content.split("\n").length > COLLAPSE_THRESHOLD && (
                <button
                  onClick={() => setCollapsed((v) => !v)}
                  className="flex items-center gap-1 mt-1 text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)] transition-colors"
                >
                  {collapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                  {collapsed ? "Show more" : "Show less"}
                </button>
              )}

              {/* Annotation pills */}
              {pills.length > 0 && (
                <div className="flex items-center gap-1.5 mt-2">
                  {pills.map((a, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded-full text-[10px] bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                      {a.type === "thumbs_up" ? "\ud83d\udc4d" : a.type === "thumbs_down" ? "\ud83d\udc4e" : "\ud83d\udea9"}
                      {a.note && <span className="ml-1">{a.note}</span>}
                    </span>
                  ))}
                </div>
              )}

              {/* Thread indicator */}
              {replyCount > 0 && onToggleThread && (
                <button
                  onClick={onToggleThread}
                  className="mt-2 text-[11px] text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)] transition-colors"
                >
                  {replyCount} {replyCount === 1 ? "reply" : "replies"} &#x25BE;
                </button>
              )}

              {/* Timestamp + source badge */}
              <div className={`flex items-center gap-1.5 mt-1 ${human ? "justify-end" : ""}`}>
                {platformInfo && (
                  <span
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium text-white"
                    style={{ backgroundColor: platformInfo.color }}
                  >
                    <Send className="w-2 h-2" />
                    {platformInfo.label}
                  </span>
                )}
                <span className="text-[10px] text-[var(--color-text-dim)]">{timestamp}</span>
              </div>

              {showSessionRating && (
                <SessionRating
                  message={message}
                  sessionId={sessionId}
                  onAnnotationChange={(annotations, starred) => onAnnotationChange(message.id, annotations ?? [], starred)}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
