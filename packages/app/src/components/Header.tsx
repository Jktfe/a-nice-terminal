import {
  Menu,
  Pencil,
  Check,
  Download,
  FolderOpen,
  Camera,
  Sun,
  Moon,
  Terminal,
  MessageSquare,
  Copy,
  RefreshCw,
  Search,
  SlidersHorizontal,
  SquarePen,
  Clock,
  ChevronDown,
  Layers,
} from "lucide-react";
import { useState, useRef, useCallback } from "react";
import { useStore, apiFetch } from "../store.ts";
import { useIsMobile } from "../hooks/useIsMobile.ts";
import { stripAnsi } from "../utils/stripAnsi.ts";
import { getSessionTheme } from "../utils/sessionTheme.ts";

function downloadAsFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Sep() {
  return <div className="w-px h-5 bg-[var(--color-border)] flex-shrink-0" />;
}

function AgentStatusPill({ sessionId }: { sessionId: string }) {
  const presence = useStore((s) => s.agentPresence[sessionId]);
  const state = presence?.state ?? "idle";

  const config: Record<string, { dot: string; label: string }> = {
    working: { dot: "bg-emerald-400 animate-bounce", label: "WORKING" },
    thinking: { dot: "bg-amber-400 animate-pulse", label: "THINKING" },
    wrapped: { dot: "bg-blue-400", label: "WRAPPED" },
    idle: { dot: "bg-[var(--color-text-dim)]", label: "IDLE" },
  };
  const { dot, label } = config[state] ?? config.idle;

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-0 h-[34px] rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)]">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
      <span className="text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)]">
        {label}
      </span>
    </div>
  );
}

export default function Header() {
  const {
    sessions,
    activeSessionId,
    connected,
    sidebarOpen,
    toggleSidebar,
    renameSession,
    uiTheme,
    setUiTheme,
    createSession,
    loadMessages,
    loadSessions,
    slowEditMode,
    toggleSlowEditMode,
    requestTerminalRefresh,
    toggleSearch,
  } = useStore();

  const session = sessions.find((s) => s.id === activeSessionId);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();

  const startEditing = () => {
    if (!session) return;
    setEditName(session.name);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitRename = () => {
    if (session && editName.trim()) {
      renameSession(session.id, editName.trim());
    }
    setEditing(false);
  };

  const handleExport = useCallback(async () => {
    if (!session || !activeSessionId) return;
    try {
      if (session.type === "conversation") {
        const messages = await apiFetch(`/api/sessions/${activeSessionId}/messages`);
        const md = messages
          .map((m: any) => {
            const ts = m.created_at ? ` (${m.created_at})` : "";
            return `## ${m.role}${ts}\n\n${m.content}`;
          })
          .join("\n\n---\n\n");
        const safeName = session.name.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "conversation";
        downloadAsFile(`${safeName}.md`, md, "text/markdown");
      } else {
        const result = await apiFetch(
          `/api/sessions/${activeSessionId}/terminal/state?format=ansi`
        );
        const plainText = stripAnsi(result.state);
        const safeName = session.name.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "terminal";
        downloadAsFile(`${safeName}.txt`, plainText, "text/plain");
      }
    } catch (err) {
      console.error("Export failed:", err);
    }
  }, [session, activeSessionId]);

  const handleSnapshot = useCallback(async () => {
    if (!session || !activeSessionId || session.type !== "terminal") return;
    try {
      const result = await apiFetch(`/api/sessions/${activeSessionId}/terminal/state?format=ansi`);
      if (!result.state) throw new Error("Terminal session is not currently running.");
      const tokenPayload = {
        type: "dtss_token",
        sessionId: activeSessionId,
        sessionName: session.name,
        state: result.state,
        cursor: result.cursor,
        timestamp: new Date().toISOString(),
      };
      await apiFetch(`/api/sessions/${activeSessionId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          role: "agent",
          content: `Generated DTSS State Token for **${session.name}**.\n\n\`\`\`json\n${JSON.stringify(
            { session: session.name, cwd: session.cwd, timestamp: tokenPayload.timestamp, proc: "dtach, node" },
            null,
            2
          )}\n\`\`\``,
          metadata: tokenPayload,
        }),
      });
    } catch (err) {
      console.error("Snapshot failed:", err);
    }
  }, [session, activeSessionId]);

  const handleCopy = useCallback(async () => {
    if (!session || !activeSessionId) return;
    try {
      let text = "";
      if (session.type === "conversation") {
        const messages = await apiFetch(`/api/sessions/${activeSessionId}/messages`);
        text = messages
          .map((m: any) => `[${m.role}]: ${m.content}`)
          .join("\n\n");
      } else {
        const result = await apiFetch(
          `/api/sessions/${activeSessionId}/terminal/state?format=ansi`
        );
        text = stripAnsi(result.state);
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  }, [session, activeSessionId]);

  const handleRefresh = useCallback(async () => {
    if (!session || !activeSessionId) return;
    if (session.type === "terminal") {
      requestTerminalRefresh();
      await loadSessions(); // refreshes CWD and session metadata
    } else {
      await loadMessages(activeSessionId);
    }
  }, [session, activeSessionId, requestTerminalRefresh, loadMessages, loadSessions]);

  const { Icon } = getSessionTheme(session?.type ?? "conversation", uiTheme);

  const SessionIcon =
    session?.type === "terminal"
      ? Terminal
      : session?.type === "unified"
      ? Layers
      : MessageSquare;

  return (
    <header className="flex flex-col border-b border-[var(--color-border)] bg-[var(--color-surface)]">

      {/* ── Row 1: Brand + global actions ── */}
      <div
        className="flex items-center justify-between px-5"
        style={{ height: 64 }}
      >
        {/* Left: logo / sidebar toggle */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {isMobile ? (
            <button
              onClick={toggleSidebar}
              className="p-1.5 text-[var(--color-text-dim)] hover:text-[var(--color-text)] transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
          ) : (
            !sidebarOpen && (
              <button
                onClick={toggleSidebar}
                className="p-1.5 text-[var(--color-text-dim)] hover:text-[var(--color-text)] transition-colors"
              >
                <Menu className="w-4 h-4" />
              </button>
            )
          )}
          {/* ANT logo */}
          <img
            src="/ANTlogo.png"
            alt="ANT"
            className="h-8 w-auto max-w-[138px] object-contain"
            style={{ imageRendering: "auto" }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>

        {/* Center: session name */}
        {session && (
          <div className="flex items-center gap-2 min-w-0 flex-1 justify-center px-4">
            <SessionIcon className="w-6 h-6 flex-shrink-0 text-[var(--color-text-muted)]" />
            {editing ? (
              <form
                onSubmit={(e) => { e.preventDefault(); commitRename(); }}
                className="flex items-center gap-2"
              >
                <input
                  ref={inputRef}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={commitRename}
                  className="bg-[var(--color-hover)] border border-[var(--color-input-border)] rounded px-2 py-0.5 text-lg font-semibold text-[var(--color-text)] outline-none focus:border-emerald-500/50 w-full max-w-[260px]"
                />
                <button type="submit" className="text-emerald-400 flex-shrink-0">
                  <Check className="w-4 h-4" />
                </button>
              </form>
            ) : (
              <h1 className="text-lg font-semibold text-[var(--color-text)] truncate max-w-[280px]">
                {session.name}
              </h1>
            )}
            {!editing && (
              <button
                onClick={startEditing}
                className="flex items-center gap-1 px-2.5 h-5 rounded bg-[var(--color-hover)] border border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-input-border)] transition-colors flex-shrink-0"
              >
                <Pencil className="w-2.5 h-2.5" />
                Edit
              </button>
            )}
          </div>
        )}

        {/* Right: global actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Connection status */}
          <div
            className={`flex items-center gap-1.5 px-3 h-[34px] rounded-xl text-xs font-semibold ${
              connected
                ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                : "bg-red-500/10 text-red-400 border border-red-500/20"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                connected ? "bg-emerald-400 animate-pulse" : "bg-red-500"
              }`}
            />
            <span className="hidden sm:inline">
              {connected ? "Connected" : "Disconnected"}
            </span>
          </div>

          <Sep />

          {/* Export */}
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 h-[34px] rounded-xl bg-[var(--color-hover)] border border-[var(--color-border)] text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-input-border)] transition-colors"
            title="Export session"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export</span>
          </button>

          <Sep />

          {/* Light / Dark toggle */}
          <button
            onClick={() => setUiTheme(uiTheme === "light" ? "dark" : "light")}
            className="flex items-center gap-1.5 px-3 h-[34px] rounded-xl bg-[var(--color-hover)] border border-[var(--color-border)] text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-input-border)] transition-colors"
            title={`Switch to ${uiTheme === "light" ? "dark" : "light"} mode`}
          >
            {uiTheme === "light" ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{uiTheme === "light" ? "Dark" : "Light"}</span>
          </button>

          <Sep />

          {/* New Chat */}
          <button
            onClick={() => createSession("conversation")}
            className="flex items-center gap-1.5 px-3.5 h-[34px] rounded-xl bg-emerald-400 text-[#071019] text-xs font-semibold hover:bg-emerald-300 transition-colors"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New Chat</span>
          </button>

          {/* New Terminal */}
          <button
            onClick={() => createSession("terminal")}
            className="flex items-center gap-1.5 px-3.5 h-[34px] rounded-xl bg-emerald-400 text-[#071019] text-xs font-semibold hover:bg-emerald-300 transition-colors"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New Terminal</span>
          </button>
        </div>
      </div>

      {/* ── Row 2: Workspace toolbar ── */}
      {session && (
        <div
          className="flex items-center justify-between px-5 border-t border-[var(--color-border)]"
          style={{ height: 64 }}
        >
          {/* Left cluster */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* Search bar */}
            <button
              onClick={() => toggleSearch?.()}
              className="flex items-center justify-between gap-2 px-3 h-[34px] rounded-xl bg-[var(--color-hover)] border border-[var(--color-border)] text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:border-[var(--color-input-border)] transition-colors"
              style={{ width: 180 }}
              title="Search (⌘F)"
            >
              <div className="flex items-center gap-2">
                <Search className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="text-xs">Search</span>
              </div>
              <SlidersHorizontal className="w-3.5 h-3.5 flex-shrink-0" />
            </button>

            {/* Terminal-only: SNAPSHOT + CWD */}
            {session.type === "terminal" && (
              <>
                <button
                  onClick={handleSnapshot}
                  className="flex items-center gap-1.5 px-3 h-[34px] rounded-xl bg-[var(--color-hover)] border border-[var(--color-border)] text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-input-border)] transition-colors flex-shrink-0"
                  title="Create DTSS State Token"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">SNAPSHOT</span>
                </button>

                {session.cwd && (
                  <span
                    className="flex items-center gap-1 text-[11px] text-[var(--color-text-dim)] truncate max-w-[280px] hidden md:flex"
                    title={session.cwd}
                  >
                    <FolderOpen className="w-3 h-3 flex-shrink-0" />
                    {(() => {
                      const parts = session.cwd.split("/").filter(Boolean);
                      return parts.length <= 3
                        ? session.cwd
                        : `.../${parts.slice(-3).join("/")}`;
                    })()}
                  </span>
                )}
              </>
            )}

            {/* COPY */}
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 h-[34px] rounded-xl bg-[var(--color-hover)] border border-[var(--color-border)] text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-input-border)] transition-colors flex-shrink-0"
              title="Copy content to clipboard"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{copied ? "COPIED" : "COPY"}</span>
            </button>

            {/* REFRESH */}
            <button
              onClick={handleRefresh}
              className="flex items-center gap-1.5 px-3 h-[34px] rounded-xl bg-[var(--color-hover)] border border-[var(--color-border)] text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-input-border)] transition-colors flex-shrink-0"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">REFRESH</span>
            </button>
          </div>

          {/* Right cluster */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Agent status pill */}
            <AgentStatusPill sessionId={session.id} />

            {session.type === "terminal" && (
              <>
                <Sep />
                <div className="relative flex items-center">
                  <Clock className="w-3 h-3 text-[var(--color-text-dim)] absolute left-2.5 pointer-events-none z-10" />
                  <select
                    value={session.ttl_minutes === null ? "" : String(session.ttl_minutes)}
                    onChange={async (e) => {
                      const val = e.target.value;
                      const ttl = val === "" ? null : Number(val);
                      await apiFetch(`/api/sessions/${session.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ ttl_minutes: ttl }),
                      });
                      loadSessions();
                    }}
                    className="appearance-none pl-7 pr-6 h-[34px] rounded-xl text-[11px] uppercase tracking-widest font-bold bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] cursor-pointer transition-colors outline-none"
                    title="Session keep-alive duration"
                  >
                    <option value="">15m</option>
                    <option value="5">5m</option>
                    <option value="15">15m</option>
                    <option value="30">30m</option>
                    <option value="45">45m</option>
                    <option value="60">1h</option>
                    <option value="120">2h</option>
                    <option value="0">AON</option>
                  </select>
                  <ChevronDown className="w-3 h-3 text-[var(--color-text-dim)] absolute right-2 pointer-events-none" />
                </div>
              </>
            )}

            {session.type === "terminal" && (
              <>
                <Sep />
                {/* SLOW EDIT — terminal only */}
                <button
                  onClick={toggleSlowEditMode}
                  className={`flex items-center gap-1.5 px-3.5 h-[34px] rounded-xl text-xs font-semibold transition-colors ${
                    slowEditMode
                      ? "bg-amber-400 text-[#071019] hover:bg-amber-300"
                      : "bg-emerald-400 text-[#071019] hover:bg-emerald-300"
                  }`}
                  title="Toggle Slow Edit mode"
                >
                  <span className="hidden sm:inline">{slowEditMode ? "EXIT SLOW EDIT" : "SLOW EDIT"}</span>
                  <SquarePen className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
