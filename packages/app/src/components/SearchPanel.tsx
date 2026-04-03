import { useState, useEffect, useRef, useCallback } from "react";
import { Search, X, Terminal, MessageSquare } from "lucide-react";
import { useStore, apiFetch } from "../store.ts";
import { getSessionTheme } from "../utils/sessionTheme.ts";

type SearchTab = "all" | "terminal";

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

interface CommandMatch {
  id: string;
  session_id: string;
  command: string;
  cwd: string | null;
  exit_code: number | null;
  started_at: string;
  output_snippet: string | null;
}

export default function SearchPanel({ onClose }: { onClose: () => void }) {
  const { setActiveSession, uiTheme } = useStore();
  const [tab, setTab] = useState<SearchTab>("all");
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sessions, setSessions] = useState<SessionMatch[]>([]);
  const [messages, setMessages] = useState<MessageMatch[]>([]);
  const [commands, setCommands] = useState<CommandMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totalResults = tab === "terminal"
    ? commands.length
    : sessions.length + messages.length;

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setSelectedIndex(0); }, [sessions, messages, commands, tab]);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setSessions([]); setMessages([]); setCommands([]);
      return;
    }
    setLoading(true);
    try {
      if (tab === "terminal") {
        const result = await apiFetch(`/api/capture/search?q=${encodeURIComponent(q.trim())}&limit=50`);
        setCommands(result as CommandMatch[]);
      } else {
        const result = await apiFetch(`/api/search?q=${encodeURIComponent(q.trim())}&limit=50`);
        setSessions(result.sessions || []);
        setMessages(result.messages || []);
      }
    } catch {
      setSessions([]); setMessages([]); setCommands([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, doSearch]);

  // Re-run search when tab changes (same query, different endpoint)
  useEffect(() => {
    if (query.trim()) doSearch(query);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const selectResult = (index: number) => {
    if (tab === "terminal") {
      const cmd = commands[index];
      if (cmd) setActiveSession(cmd.session_id);
    } else if (index < sessions.length) {
      setActiveSession(sessions[index].id);
    } else {
      const msg = messages[index - sessions.length];
      if (msg) setActiveSession(msg.session_id);
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

  // Render snippet with <mark> tags from FTS5 (server-side highlights)
  const renderSnippet = (snippet: string | null) => {
    if (!snippet) return null;
    const parts = snippet.split(/(<mark>|<\/mark>)/);
    let inMark = false;
    return parts.map((part, i) => {
      if (part === "<mark>") { inMark = true; return null; }
      if (part === "</mark>") { inMark = false; return null; }
      return inMark
        ? <mark key={i} className="bg-yellow-400/30 text-yellow-200 rounded-sm">{part}</mark>
        : <span key={i}>{part}</span>;
    });
  };

  let flatIndex = 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-[var(--color-overlay)] backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
          <Search className="w-4 h-4 text-[var(--color-text-dim)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={tab === "terminal" ? "Search terminal output…" : "Search sessions and messages…"}
            className="flex-1 bg-transparent text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-dim)]"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)]">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-[var(--color-border)]">
          {(["all", "terminal"] as SearchTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
                tab === t
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)]"
              }`}
            >
              {t === "terminal" ? <Terminal className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />}
              {t === "all" ? "Sessions & Chat" : "Terminal output"}
            </button>
          ))}
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-1">
          {loading && (
            <div className="px-4 py-3 text-xs text-[var(--color-text-dim)]">Searching…</div>
          )}

          {!loading && query.trim() && totalResults === 0 && (
            <div className="px-4 py-6 text-center text-xs text-[var(--color-text-dim)]">
              No results found.
            </div>
          )}

          {/* Terminal output results */}
          {tab === "terminal" && commands.length > 0 && (
            <>
              <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] font-semibold">
                Commands
              </div>
              {commands.map((cmd) => {
                const idx = flatIndex++;
                return (
                  <button
                    key={`c-${cmd.id}`}
                    onClick={() => selectResult(idx)}
                    className={`w-full flex flex-col gap-1 px-4 py-2.5 text-left transition-colors ${
                      idx === selectedIndex
                        ? "bg-[var(--color-active)] text-[var(--color-text)]"
                        : "text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]"
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs font-mono">
                      <Terminal className="w-3 h-3 shrink-0 text-emerald-400" />
                      <span className="text-emerald-400">❯</span>
                      <span className="truncate">{cmd.command}</span>
                      {cmd.exit_code !== null && cmd.exit_code !== 0 && (
                        <span className="ml-auto text-red-400 text-[9px] shrink-0">exit {cmd.exit_code}</span>
                      )}
                    </div>
                    {cmd.output_snippet && (
                      <span className="text-xs text-[var(--color-text-dim)] font-mono pl-5 truncate">
                        {renderSnippet(cmd.output_snippet)}
                      </span>
                    )}
                    <div className="flex items-center gap-2 text-[9px] text-[var(--color-text-dim)] pl-5">
                      {cmd.cwd && <span className="truncate">{cmd.cwd.split("/").slice(-2).join("/")}</span>}
                      <span className="ml-auto shrink-0">{new Date(cmd.started_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  </button>
                );
              })}
            </>
          )}

          {/* Sessions + messages results */}
          {tab === "all" && sessions.length > 0 && (
            <>
              <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] font-semibold">Sessions</div>
              {sessions.map((session) => {
                const idx = flatIndex++;
                const { Icon, icon: iconColor } = getSessionTheme(session.type, uiTheme);
                return (
                  <button
                    key={`s-${session.id}`}
                    onClick={() => selectResult(idx)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                      idx === selectedIndex ? "bg-[var(--color-active)] text-[var(--color-text)]" : "text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]"
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${iconColor}`} />
                    <span className="truncate">{highlightMatch(session.name, query)}</span>
                    <span className="ml-auto text-[10px] uppercase tracking-widest text-[var(--color-text-dim)]">{session.type}</span>
                  </button>
                );
              })}
            </>
          )}

          {tab === "all" && messages.length > 0 && (
            <>
              <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] font-semibold">Messages</div>
              {messages.map((msg) => {
                const idx = flatIndex++;
                const { Icon, icon: iconColor } = getSessionTheme(msg.session_type as any, uiTheme);
                return (
                  <button
                    key={`m-${msg.id}`}
                    onClick={() => selectResult(idx)}
                    className={`w-full flex flex-col gap-1 px-4 py-2.5 text-left transition-colors ${
                      idx === selectedIndex ? "bg-[var(--color-active)] text-[var(--color-text)]" : "text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]"
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs">
                      <Icon className={`w-3 h-3 flex-shrink-0 ${iconColor}`} />
                      <span className="truncate text-[var(--color-text-dim)]">{msg.session_name}</span>
                      <span className="px-1.5 py-0.5 rounded bg-[var(--color-hover)] text-[9px] uppercase tracking-wider text-[var(--color-text-dim)]">{msg.role}</span>
                      <span className="ml-auto text-[9px] text-[var(--color-text-dim)]">{new Date(msg.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <span className="text-xs text-[var(--color-text-muted)] truncate">{highlightMatch(msg.content_snippet, query)}</span>
                  </button>
                );
              })}
            </>
          )}

          {!query.trim() && !loading && (
            <div className="px-4 py-6 text-center text-xs text-[var(--color-text-dim)]">
              {tab === "terminal" ? "Search across all captured terminal output." : "Type to search across all sessions and messages."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
