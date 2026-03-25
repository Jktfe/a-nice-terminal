import { useState, useEffect, useRef } from "react";
import { X, Send } from "lucide-react";
import { apiFetch, useStore, type Message } from "../store.ts";
import MessageBubble from "./MessageBubble.tsx";

interface ThreadPanelProps {
  parentMessage: Message;
  sessionId: string;
  onClose: () => void;
}

export default function ThreadPanel({ parentMessage, sessionId, onClose }: ThreadPanelProps) {
  const [replies, setReplies] = useState<Message[]>([]);
  const [replyInput, setReplyInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { chatSocket } = useStore();

  useEffect(() => {
    apiFetch(`/api/sessions/${sessionId}/messages/${parentMessage.id}/thread`)
      .then((data) => setReplies(data.replies || []))
      .catch(() => {});
  }, [sessionId, parentMessage.id]);

  // Listen for new thread replies
  useEffect(() => {
    if (!chatSocket) return;
    const handler = ({ threadId, message }: { threadId: string; message: Message }) => {
      if (threadId === parentMessage.id) {
        setReplies((prev) => [...prev, message]);
        requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
      }
    };
    chatSocket.on("thread_reply", handler);
    return () => { chatSocket.off("thread_reply", handler); };
  }, [chatSocket, parentMessage.id]);

  const sendReply = async () => {
    if (!replyInput.trim() || sending) return;
    setSending(true);
    try {
      await apiFetch(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "human",
          content: replyInput.trim(),
          sender_type: "human",
          sender_name: localStorage.getItem("ant_user_name") || "Human",
          thread_id: parentMessage.id,
        }),
      });
      setReplyInput("");
    } catch (err) {
      console.error("Failed to send reply", err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="ml-8 mt-1 rounded-lg border border-white/10 bg-[var(--color-surface)] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
        <span className="text-[10px] uppercase tracking-wider text-white/40">Thread</span>
        <button onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors">
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

      <div className="flex items-center gap-2 px-3 py-2 border-t border-white/5">
        <input
          value={replyInput}
          onChange={(e) => setReplyInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
          placeholder="Reply..."
          className="flex-1 bg-transparent text-sm text-white outline-none placeholder-white/30"
        />
        <button
          onClick={sendReply}
          disabled={!replyInput.trim() || sending}
          className="text-emerald-400 disabled:text-white/20 transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
