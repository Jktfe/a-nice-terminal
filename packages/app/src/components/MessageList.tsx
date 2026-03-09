import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Copy, Check, User, Bot, Info, ChevronDown } from "lucide-react";
import { useStore, type Message } from "../store.ts";

export default function MessageList() {
  const { messages } = useStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);

  const isNearBottomRef = useRef(true);
  const isSelectingRef = useRef(false);

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

  // Auto-scroll on new messages only when user is already at bottom AND not selecting
  useEffect(() => {
    if (isNearBottomRef.current && !isSelectingRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="flex-1 overflow-hidden relative">
      <div
        ref={scrollContainerRef}
        className="h-full overflow-y-auto px-6 py-4"
      >
        <AnimatePresence mode="popLayout">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </AnimatePresence>

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-white/20">
            <Bot className="w-10 h-10 mb-3" />
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

const remarkPluginsArr = [remarkGfm];
const rehypePluginsArr = [rehypeHighlight];

const markdownComponents = {
  code: ({ className, children, ...props }: any) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <CodeBlock className={className}>
          {children as any}
        </CodeBlock>
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }: any) => <>{children}</>,
};

function MessageBubble({ message }: { message: Message }) {
  const isHuman = message.role === "human";
  const isSystem = message.role === "system";

  const Icon = isHuman ? User : isSystem ? Info : Bot;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`group relative flex gap-3 mb-4 ${
        isHuman ? "flex-row-reverse" : ""
      } ${isSystem ? "justify-center" : ""}`}
    >
      {!isSystem && (
        <div className="flex flex-col items-center gap-1 mt-0.5">
          <div
            className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
              isHuman
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-white/5 text-white/50"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
          </div>
          {message.created_at && (
            <span className="text-[9px] text-white/30 whitespace-nowrap">
              {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      )}

      <div
        className={`max-w-[75%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
          isSystem
            ? "bg-white/5 text-white/50 text-center text-xs max-w-[50%]"
            : isHuman
              ? "bg-emerald-500/10 text-white/90 border border-emerald-500/10"
              : "bg-[var(--color-surface)] text-white/80 border border-[var(--color-border)]"
        }`}
      >
        {message.status === "streaming" && !message.content ? (
          <StreamingIndicator />
        ) : (
          <div className="prose prose-invert prose-sm max-w-none">
            {message.metadata?.images && (
              <div className="flex flex-wrap gap-2 mb-3">
                {message.metadata.images.map((url: string, i: number) => (
                  <img
                    key={i}
                    src={url}
                    alt="attachment"
                    className="max-w-full max-h-64 rounded-lg object-contain bg-black/20"
                    onClick={() => window.open(url, "_blank")}
                  />
                ))}
              </div>
            )}
            <ReactMarkdown
              remarkPlugins={remarkPluginsArr}
              rehypePlugins={rehypePluginsArr}
              components={markdownComponents}
            >
              {message.content}
            </ReactMarkdown>
            {message.status === "streaming" && message.content && (
              <span className="inline-block w-[2px] h-[1em] bg-emerald-400 ml-0.5 align-text-bottom animate-pulse" />
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function CodeBlock({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  const copy = async () => {
    if (codeRef.current) {
      await navigator.clipboard.writeText(codeRef.current.textContent || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="relative group my-2">
      <pre className="bg-black/40 rounded-lg p-3 overflow-x-auto">
        <code ref={codeRef} className={className}>{children}</code>
      </pre>
      <button
        onClick={copy}
        className="absolute top-2 right-2 p-1.5 bg-white/5 rounded-md text-white/30 hover:text-white/70 opacity-0 group-hover:opacity-100 transition-all"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-emerald-400" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  );
}

function StreamingIndicator() {
  return (
    <div className="flex gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="w-1.5 h-1.5 bg-emerald-400 rounded-full"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{
            duration: 1,
            repeat: Infinity,
            delay: i * 0.2,
          }}
        />
      ))}
    </div>
  );
}
