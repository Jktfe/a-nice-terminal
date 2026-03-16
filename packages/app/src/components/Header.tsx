import {
  PanelLeft,
  Menu,
  Pencil,
  Check,
  Download,
  FolderOpen,
  Camera,
} from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useStore, apiFetch } from "../store.ts";
import ResumeDropdown from "./ResumeDropdown.tsx";
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

function AgentStatus({ sessionId }: { sessionId: string }) {
  const presence = useStore((s) => s.agentPresence[sessionId]);
  if (!presence || presence.state === "idle") return null;

  return (
    <div className="flex items-center gap-2 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 ml-2">
      <div className={`w-1.5 h-1.5 rounded-full ${
        presence.state === "thinking" ? "bg-amber-400 animate-pulse" :
        presence.state === "working" ? "bg-emerald-400 animate-bounce" :
        "bg-blue-400"
      }`} />
      <span className="text-[9px] uppercase tracking-tighter text-white/50 font-medium">
        {presence.state}
      </span>
    </div>
  );
}


export default function Header() {
  const { sessions, activeSessionId, connected, sidebarOpen, toggleSidebar, renameSession } =
    useStore();
  const session = sessions.find((s) => s.id === activeSessionId);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
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
      if (!result.state) {
        throw new Error("Terminal session is not currently running.");
      }
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
          content: `Generated DTSS State Token for **${session.name}**.\n\n\`\`\`json\n${JSON.stringify({
            session: session.name,
            cwd: session.cwd,
            timestamp: tokenPayload.timestamp,
            proc: "dtach, node"
          }, null, 2)}\n\`\`\``,
          metadata: tokenPayload
        }),
      });
    } catch (err) {
      console.error("Snapshot failed:", err);
    }
  }, [session, activeSessionId]);

  const { Icon, ...tone } = getSessionTheme(session?.type ?? "conversation");

  return (
    <header className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center gap-3 min-w-0">
        {/* Show hamburger on mobile always, panel toggle on desktop when sidebar closed */}
        {isMobile ? (
          <button
            onClick={toggleSidebar}
            className="p-1.5 text-white/40 hover:text-white/80 transition-colors flex-shrink-0"
          >
            <Menu className="w-5 h-5" />
          </button>
        ) : (
          !sidebarOpen && (
            <button
              onClick={toggleSidebar}
              className="p-1.5 text-white/40 hover:text-white/80 transition-colors"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
          )
        )}

        {session && (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`p-1.5 rounded-md flex-shrink-0 ${tone.chip}`}>
              <Icon className={`w-4 h-4 ${tone.icon}`} />
            </div>

            {editing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  commitRename();
                }}
                className="flex items-center gap-1.5"
              >
                <input
                  ref={inputRef}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={commitRename}
                  className="bg-white/5 border border-white/10 rounded px-2 py-0.5 text-sm text-white outline-none focus:border-emerald-500/50 w-full max-w-[200px]"
                />
                <button type="submit" className="text-emerald-400">
                  <Check className="w-3.5 h-3.5" />
                </button>
              </form>
            ) : (
              <button
                onClick={startEditing}
                className="group flex items-center gap-1.5 min-w-0"
              >
                <h1 className="text-sm font-medium text-white truncate">
                  {session.name}
                </h1>
                <Pencil className="w-3 h-3 text-white/20 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </button>
            )}

            {session.type === "terminal" && (
              <button
                onClick={handleSnapshot}
                className="p-1.5 text-white/20 hover:text-emerald-400 transition-colors flex-shrink-0"
                title="Create DTSS State Token (Snapshot)"
              >
                <Camera className="w-3.5 h-3.5" />
              </button>
            )}

            <span className="text-[10px] uppercase tracking-widest text-white/30 bg-white/5 px-2 py-0.5 rounded flex-shrink-0 hidden sm:inline">
              {session.type}
            </span>

            <AgentStatus sessionId={session.id} />

            {session.cwd && (
              <span
                className="flex items-center gap-1 text-[10px] text-white/25 truncate max-w-[200px] flex-shrink hidden md:flex"
                title={session.cwd}
              >
                <FolderOpen className="w-3 h-3 flex-shrink-0" />
                {(() => {
                  const parts = session.cwd.split("/").filter(Boolean);
                  if (parts.length <= 3) return session.cwd;
                  return `.../${parts.slice(-3).join("/")}`;
                })()}
              </span>
            )}

            <button
              onClick={handleExport}
              className="p-1.5 text-white/30 hover:text-white/70 transition-colors flex-shrink-0"
              title={`Export ${session.type === "conversation" ? "as Markdown" : "as plain text"}`}
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <ResumeDropdown />
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            connected ? "bg-emerald-500 animate-pulse" : "bg-red-500"
          }`}
        />
        <span className="text-[10px] uppercase tracking-widest text-white/40 hidden sm:inline">
          {connected ? "Connected" : "Disconnected"}
        </span>
      </div>
    </header>
  );
}
