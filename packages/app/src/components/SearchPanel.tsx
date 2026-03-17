import { useState, useEffect, useRef, useCallback } from "react";
import { Terminal, MessageSquare, Search, X } from "lucide-react";
import { useStore, apiFetch } from "../store.ts";

interface SessionMatch {
  id: string;
  name: string;
  type: "terminal" | "conversation";
  workspace_id: string | null;
}

interface MessageMatch {
  id: string;
  session_id: string;
  session_name: string;
  session_type: string;
  role: string;
  content_snippet: string;
  created_at: string;
}

export default function SearchPanel({ onClose }: { onClose: () => void }) {
  const { setActiveSession } = useStore();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sessions, setSessions] = useState<SessionMatch[]>([]);
  const [messages, setMessages] = useState<MessageMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totalResults = sessions.length + messages.length;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [sessions, messages]);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setSessions([]);
      setMessages([]);
      return;
    }
    setLoading(true);
    try {
      const result = await apiFetch(`/api/search?q=${encodeURIComponent(q.trim())}&limit=50`);
      setSessions(result.sessions || []);
      setMessages(result.messages || []);
    } catch {
      setSessions([]);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, doSearch]);

  const selectResult = (index: number) => {
    if (index < sessions.length) {
      setActiveSession(sessions[index].id);
    } else {
      const msgIndex = index - sessions.length;
      if (messages[msgIndex]) {
        setActiveSession(messages[msgIndex].session_id);
      }
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, totalResults - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && totalResults > 0) {
      selectResult(selectedIndex);
    }
  };

  const highlightMatch = (text: string, q: string) => {
    if (!q.trim()) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <span className="font-bold text-[var(--color-text)]">{text.slice(idx, idx + q.length)}</span>
        {text.slice(idx + q.length)}
      </>
    );
  };

  let flatIndex = 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-[var(--color-overlay)] backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
          <Search className="w-4 h-4 text-[var(--color-text-dim)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search sessions and messages..."
            className="flex-1 bg-transparent text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-dim)]"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)]">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto py-1">
          {loading && (
            <div className="px-4 py-3 text-xs text-[var(--color-text-dim)]">Searching...</div>
          )}

          {!loading && query.trim() && totalResults === 0 && (
            <div className="px-4 py-6 text-center text-xs text-[var(--color-text-dim)]">
              No results found.
            </div>
          )}

          {sessions.length > 0 && (
            <>
              <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] font-semibold">
                Sessions
              </div>
              {sessions.map((session) => {
                const idx = flatIndex++;
                const Icon = session.type === "terminal" ? Terminal : MessageSquare;
                const iconColor = session.type === "terminal" ? "text-emerald-400" : "text-blue-400";
                return (
                  <button
                    key={`s-${session.id}`}
                    onClick={() => selectResult(idx)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                      idx === selectedIndex
                        ? "bg-[var(--color-active)] text-[var(--color-text)]"
                        : "text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]"
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${iconColor}`} />
                    <span className="truncate">{highlightMatch(session.name, query)}</span>
                    <span className="ml-auto text-[10px] uppercase tracking-widest text-[var(--color-text-dim)]">
                      {session.type}
                    </span>
                  </button>
                );
              })}
            </>
          )}

          {messages.length > 0 && (
            <>
              <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] font-semibold">
                Messages
              </div>
              {messages.map((msg) => {
                const idx = flatIndex++;
                const Icon = msg.session_type === "terminal" ? Terminal : MessageSquare;
                const iconColor = msg.session_type === "terminal" ? "text-emerald-400" : "text-blue-400";
                return (
                  <button
                    key={`m-${msg.id}`}
                    onClick={() => selectResult(idx)}
                    className={`w-full flex flex-col gap-1 px-4 py-2.5 text-left transition-colors ${
                      idx === selectedIndex
                        ? "bg-[var(--color-active)] text-[var(--color-text)]"
                        : "text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]"
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs">
                      <Icon className={`w-3 h-3 flex-shrink-0 ${iconColor}`} />
                      <span className="truncate text-[var(--color-text-dim)]">{msg.session_name}</span>
                      <span className="px-1.5 py-0.5 rounded bg-[var(--color-hover)] text-[9px] uppercase tracking-wider text-[var(--color-text-dim)]">
                        {msg.role}
                      </span>
                      <span className="ml-auto text-[9px] text-[var(--color-text-dim)]">
                        {new Date(msg.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <span className="text-xs text-[var(--color-text-muted)] truncate">
                      {highlightMatch(msg.content_snippet, query)}
                    </span>
                  </button>
                );
              })}
            </>
          )}

          {!query.trim() && !loading && (
            <div className="px-4 py-6 text-center text-xs text-[var(--color-text-dim)]">
              Type to search across all sessions and messages.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
