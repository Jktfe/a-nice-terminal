"use client";

import { useState, useEffect, useRef } from "react";
import { X, Send } from "lucide-react";
import { apiFetch, useStore, type Message } from "../store.ts";
import MessageBubble from "./MessageBubble.tsx";

interface ThreadPanelProps {
  parentMessage: Message;
  sessionId: string;
  senderTerminalId?: string; // Optional: bind replies to a specific terminal for identity security
  onClose: () => void;
}

export default function ThreadPanel({ parentMessage, sessionId, senderTerminalId, onClose }: ThreadPanelProps) {
  const [replies, setReplies] = useState<Message[]>([]);
  const [replyInput, setReplyInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { socket } = useStore();

  useEffect(() => {
    apiFetch(`/api/sessions/${sessionId}/messages/${parentMessage.id}/thread`)
      .then((data) => setReplies(data.replies || []))
      .catch(() => {});
  }, [sessionId, parentMessage.id]);

  // Listen for new thread replies
  useEffect(() => {
    if (!socket) return;
    const handler = ({ threadId, message }: { threadId: string; message: Message }) => {
      if (threadId === parentMessage.id) {
        setReplies((prev) => [...prev, message]);
        requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
      }
    };
    socket.on("thread_reply", handler);
    return () => { socket.off("thread_reply", handler); };
  }, [socket, parentMessage.id]);

  const sendReply = async () => {
    if (!replyInput.trim() || sending) return;
    setSending(true);
    try {
      const payload: any = {
        role: "human",
        content: replyInput.trim(),
        sender_type: "human",
        thread_id: parentMessage.id,
      };

      // If terminal ID is provided, bind to it (prevents identity spoofing)
      // Otherwise fall back to sender_name
      if (senderTerminalId) {
        payload.sender_terminal_id = senderTerminalId;
      } else {
        payload.sender_name = localStorage.getItem("ant_user_name") || "Human";
      }

      await apiFetch(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setReplyInput("");
    } catch (err) {
      console.error("Failed to send reply", err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="ml-8 mt-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)]">
        <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)]">Thread</span>
        <button onClick={onClose} className="text-[var(--color-text-dim)] hover:text-[var(--color-text)] transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto p-2 space-y-2">
        {replies.map((reply) => (
          <MessageBubble
            key={reply.id}
            message={reply}
            sessionId={sessionId}
            onReply={() => {}}
            onDelete={() => {}}
            onAnnotationChange={() => {}}
            scale={0.85}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-t border-[var(--color-border)]">
        <input
          value={replyInput}
          onChange={(e) => setReplyInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
          placeholder="Reply..."
          className="flex-1 bg-[var(--color-hover)] text-sm text-[var(--color-text)] outline-none placeholder:[var(--color-text-dim)] px-2 py-1.5 rounded border border-[var(--color-border)] focus:border-emerald-500/50 transition-colors"
        />
        <button
          onClick={sendReply}
          disabled={!replyInput.trim() || sending}
          className="text-emerald-400 disabled:text-[var(--color-text-dim)] transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
