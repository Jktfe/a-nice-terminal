import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, ChevronDown } from "lucide-react";
import { useStore, chatApiFetch, type Message } from "../store.ts";
import MessageBubble from "./MessageBubble.tsx";
import ThreadPanel from "./ThreadPanel.tsx";

export default function MessageList({ sessionId, messages: messagesProp }: { sessionId?: string; messages?: Message[] } = {}) {
  const { messages: storeMessages, activeSessionId } = useStore();
  const messages = messagesProp ?? storeMessages;
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);

  const isNearBottomRef = useRef(true);
  const isSelectingRef = useRef(false);
  const prevSessionId = useRef(activeSessionId);

  const checkScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distFromBottom < 100;
    setShowScrollButton(!nearBottom);
    setIsNearBottom(nearBottom);
    isNearBottomRef.current = nearBottom;
  }, []);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScroll, { passive: true });
    return () => el.removeEventListener("scroll", checkScroll);
  }, [checkScroll]);

  // Track selection to avoid auto-scrolling while user is trying to copy
  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      const selecting = !!selection && selection.toString().length > 0;
      isSelectingRef.current = selecting;
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

  // Reset scroll state when switching sessions
  useEffect(() => {
    if (prevSessionId.current !== activeSessionId) {
      hasScrolledInitial.current = false;
      prevMessageCount.current = 0;
      prevSessionId.current = activeSessionId;
    }
  }, [activeSessionId]);

  // Scroll to bottom when messages first appear (page load / session switch)
  const hasScrolledInitial = useRef(false);
  useEffect(() => {
    if (messages.length > 0 && !hasScrolledInitial.current) {
      hasScrolledInitial.current = true;
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: "instant" });
      });
    }
    if (messages.length === 0) {
      hasScrolledInitial.current = false;
    }
  }, [messages]);

  // Auto-scroll when new messages arrive or content updates (streaming)
  const prevMessageCount = useRef(messages.length);
  useEffect(() => {
    const isNewMessage = messages.length > prevMessageCount.current;
    prevMessageCount.current = messages.length;

    if (isNewMessage && !isSelectingRef.current) {
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
      return;
    }

    if (isNearBottomRef.current && !isSelectingRef.current) {
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
    }
  }, [messages]);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const effectiveSessionId = activeSessionId || sessionId || "";
  const lastRateableMessageId = [...messages]
    .reverse()
    .find((message) => message.role !== "human" && message.status === "complete" && !message.thread_id)?.id;

  return (
    <div className="flex-1 overflow-hidden relative">
      <div
        ref={scrollContainerRef}
        className="h-full overflow-y-auto px-6 py-4"
      >
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <MessageBubble
                message={msg}
                sessionId={effectiveSessionId}
                onReply={(id) => setOpenThreadId(openThreadId === id ? null : id)}
                onDelete={async (id) => {
                  try {
                    await chatApiFetch(`/api/sessions/${effectiveSessionId}/messages/${id}`, { method: "DELETE" });
                  } catch {}
                }}
                onAnnotationChange={(id, annotations, starred) => {
                  useStore.setState((s) => ({
                    messages: s.messages.map((m) => m.id === id ? { ...m, annotations, starred } : m),
                    splitMessages: s.splitMessages.map((m) => m.id === id ? { ...m, annotations, starred } : m),
                  }));
                }}
                replyCount={msg.reply_count || 0}
                onToggleThread={() => setOpenThreadId(openThreadId === msg.id ? null : msg.id)}
                showSessionRating={msg.id === lastRateableMessageId}
              />
              {openThreadId === msg.id && (
                <ThreadPanel
                  parentMessage={msg}
                  sessionId={effectiveSessionId}
                  onClose={() => setOpenThreadId(null)}
                />
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-dim)]">
            <Sparkles className="w-10 h-10 mb-3" />
            <p className="text-sm">No messages yet. Start a conversation.</p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <AnimatePresence>
        {showScrollButton && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.15 }}
            onClick={scrollToBottom}
            className="absolute bottom-4 right-4 p-2 bg-emerald-500/20 text-emerald-400 rounded-full hover:bg-emerald-500/30 transition-colors shadow-lg backdrop-blur-sm"
            title="Scroll to bottom"
          >
            <ChevronDown className="w-5 h-5" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
