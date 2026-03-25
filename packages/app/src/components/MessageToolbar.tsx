import { ThumbsUp, ThumbsDown, Flag, Star, Reply, Copy, Download, Trash2 } from "lucide-react";
import { apiFetch, type Message } from "../store.ts";

interface MessageToolbarProps {
  message: Message;
  sessionId: string;
  onReply: () => void;
  onDelete: () => void;
  onAnnotationChange: (annotations: any[], starred: number) => void;
}

export default function MessageToolbar({ message, sessionId, onReply, onDelete, onAnnotationChange }: MessageToolbarProps) {
  const hasAnnotation = (type: string) =>
    message.annotations?.some((a) => a.type === type && a.by === "human") ?? false;

  const toggleAnnotation = async (type: string) => {
    try {
      const result = await apiFetch(`/api/sessions/${sessionId}/messages/${message.id}/annotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, by: "human" }),
      });
      onAnnotationChange(result.annotations, result.starred);
    } catch (err) {
      console.error("Failed to toggle annotation", err);
    }
  };

  const copyContent = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
    } catch {}
  };

  const storeToObsidian = async () => {
    try {
      await apiFetch("/api/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: message.id, sessionId }),
      });
    } catch (err) {
      console.error("Failed to store to Obsidian", err);
    }
  };

  const btnClass = "p-1 rounded hover:bg-[var(--color-hover)] transition-colors";
  const activeClass = "text-amber-400";
  const inactiveClass = "text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)]";

  return (
    <div className="flex items-center gap-0.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-1 py-0.5 shadow-lg">
      <button onClick={() => toggleAnnotation("thumbs_up")} className={`${btnClass} ${hasAnnotation("thumbs_up") ? activeClass : inactiveClass}`} title="Thumbs up">
        <ThumbsUp className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => toggleAnnotation("thumbs_down")} className={`${btnClass} ${hasAnnotation("thumbs_down") ? activeClass : inactiveClass}`} title="Thumbs down">
        <ThumbsDown className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => toggleAnnotation("flag")} className={`${btnClass} ${hasAnnotation("flag") ? activeClass : inactiveClass}`} title="Flag">
        <Flag className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => toggleAnnotation("star")} className={`${btnClass} ${hasAnnotation("star") ? "text-yellow-400" : inactiveClass}`} title="Star">
        <Star className="w-3.5 h-3.5" />
      </button>
      <div className="w-px h-4 bg-[var(--color-border)] mx-0.5" />
      <button onClick={onReply} className={`${btnClass} ${inactiveClass}`} title="Reply">
        <Reply className="w-3.5 h-3.5" />
      </button>
      <button onClick={copyContent} className={`${btnClass} ${inactiveClass}`} title="Copy">
        <Copy className="w-3.5 h-3.5" />
      </button>
      <button onClick={storeToObsidian} className={`${btnClass} ${inactiveClass}`} title="Store to Obsidian">
        <Download className="w-3.5 h-3.5" />
      </button>
      <div className="w-px h-4 bg-[var(--color-border)] mx-0.5" />
      <button onClick={onDelete} className={`${btnClass} text-[var(--color-text-dim)] hover:text-red-400`} title="Delete">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
