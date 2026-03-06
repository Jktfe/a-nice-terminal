import {
  PanelLeft,
  Terminal,
  MessageSquare,
  Pencil,
  Check,
} from "lucide-react";
import { useState, useRef } from "react";
import { useStore } from "../store.ts";

export default function Header() {
  const { sessions, activeSessionId, connected, sidebarOpen, toggleSidebar, renameSession } =
    useStore();
  const session = sessions.find((s) => s.id === activeSessionId);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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

  const Icon = session?.type === "terminal" ? Terminal : MessageSquare;
  const tone = session?.type === "terminal"
    ? { chip: "bg-emerald-500/10", icon: "text-emerald-400" }
    : { chip: "bg-blue-500/10", icon: "text-blue-400" };

  return (
    <header className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center gap-3">
        {!sidebarOpen && (
          <button
            onClick={toggleSidebar}
            className="p-1.5 text-white/40 hover:text-white/80 transition-colors"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}

        {session && (
          <div className="flex items-center gap-2.5">
            <div className={`p-1.5 rounded-md ${tone.chip}`}>
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
                  className="bg-white/5 border border-white/10 rounded px-2 py-0.5 text-sm text-white outline-none focus:border-emerald-500/50"
                />
                <button type="submit" className="text-emerald-400">
                  <Check className="w-3.5 h-3.5" />
                </button>
              </form>
            ) : (
              <button
                onClick={startEditing}
                className="group flex items-center gap-1.5"
              >
                <h1 className="text-sm font-medium text-white">
                  {session.name}
                </h1>
                <Pencil className="w-3 h-3 text-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}

            <span className="text-[10px] uppercase tracking-widest text-white/30 bg-white/5 px-2 py-0.5 rounded">
              {session.type}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            connected ? "bg-emerald-500 animate-pulse" : "bg-red-500"
          }`}
        />
        <span className="text-[10px] uppercase tracking-widest text-white/40">
          {connected ? "Connected" : "Disconnected"}
        </span>
      </div>
    </header>
  );
}
