import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Copy, Check, User, Sparkles, Info, ChevronDown, Zap } from "lucide-react";
import { useStore, type Message } from "../store.ts";
import { stripAnsi } from "../utils/stripAnsi.ts";

export default function MessageList({ sessionId, messages: messagesProp }: { sessionId?: string; messages?: Message[] } = {}) {
  const { messages: storeMessages } = useStore();
  const messages = messagesProp ?? storeMessages;
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
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }

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
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </AnimatePresence>

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-white/20">
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

const remarkPluginsArr = [remarkGfm];
const rehypePluginsArr = [rehypeHighlight];

function CodeBlock({ children, className }: { children: any; className?: string }) {
  const [copied, setCopied] = useState(false);
  const code = String(children).replace(/\n$/, "");

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="relative group my-4">
      <div className="absolute right-2 top-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleCopy}
          className="p-1.5 rounded-md bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/80 transition-colors"
          title="Copy code"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      <code className={`${className} block overflow-x-auto rounded-lg bg-black/40 p-4 border border-white/5`}>
        {children}
      </code>
    </div>
  );
}

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

function DtssToken({ payload }: { payload: any }) {
  const { setActiveSession } = useStore();

  const handleResume = () => {
    setActiveSession(payload.sessionId);
  };

  return (
    <div className="my-2 p-4 rounded-xl bg-[#16161a] border border-emerald-500/30 shadow-lg shadow-emerald-500/5 flex flex-col gap-3 max-w-full sm:max-w-[320px]">
      <div className="flex items-center gap-2">
        <Zap className="w-4 h-4 text-emerald-400" />
        <span className="text-[11px] font-bold tracking-widest text-emerald-400 uppercase">
          DTSS State Token
        </span>
      </div>
      
      <div className="flex flex-col gap-1">
        <div className="text-sm font-semibold text-white/90 truncate">
          {payload.sessionName}
        </div>
        <div className="text-[10px] font-mono text-white/40 leading-relaxed">
          TIMESTAMP: {new Date(payload.timestamp).toLocaleString()}
          <br />
          CURSOR: {payload.cursor?.x}, {payload.cursor?.y}
          <br />
          STATE: SNAPSHOT READY
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-white/5">
        <span className="text-[9px] text-white/20 uppercase tracking-tighter">
          Expires in 48h
        </span>
        <button
          onClick={handleResume}
          className="px-3 py-1 rounded-full bg-emerald-500 text-[#0b0b0e] text-[11px] font-bold hover:bg-emerald-400 transition-all active:scale-95 shadow-lg shadow-emerald-500/20"
        >
          Resume
        </button>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isHuman = message.role === "human";
  const isSystem = message.role === "system";
  const isAgent = !isHuman && !isSystem;
  const isStreaming = message.status === "streaming";
  const isDTSS = (message as any).metadata?.type === "dtss_token";

  const Icon = isHuman ? User : isSystem ? Info : Sparkles;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`group relative flex gap-3 mb-4 ${isHuman ? "flex-row-reverse" : ""} ${isSystem ? "justify-center" : ""}`}
    >
      {!isSystem && (
        <div className="flex flex-col items-center gap-1 mt-0.5">
          <div className="relative">
            {isAgent ? (
              <motion.div
                className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30"
                animate={{ scale: isStreaming ? [1, 1.05, 1] : 1 }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              >
                <Icon className="w-3.5 h-3.5" />
              </motion.div>
            ) : (
              <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
                <Icon className="w-3.5 h-3.5" />
              </div>
            )}
            {isStreaming && isAgent && (
              <motion.span
                className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border border-[var(--color-bg)]"
                animate={{ opacity: [1, 0.4, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              />
            )}
          </div>
          {message.created_at && (
            <span className="text-[9px] text-white/30 whitespace-nowrap">
              {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      )}

      <div className={`flex flex-col min-w-0 max-w-[85%] ${isHuman ? "items-end" : "items-start"}`}>
        {!isSystem && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/10 mb-1">
            {message.role}
          </span>
        )}

        {isDTSS ? (
          <DtssToken payload={(message as any).metadata} />
        ) : (
          <div
            className={`relative px-4 py-2.5 text-sm leading-relaxed rounded-2xl ${
              isHuman
                ? "bg-emerald-600 text-white selection:bg-white/30"
                : isSystem
                ? "bg-white/5 text-white/40 italic"
                : "bg-white/5 text-white/90 border border-white/5 selection:bg-emerald-500/30"
            }`}
          >
            <div className="markdown-body">
              <ReactMarkdown
                remarkPlugins={remarkPluginsArr}
                rehypePlugins={rehypePluginsArr}
                components={markdownComponents}
              >
                {stripAnsi(message.content)}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
