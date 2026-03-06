import {
  Terminal,
  MessageSquare,
  Plus,
  Trash2,
  PanelLeftClose,
  Search,
} from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useStore, type Session } from "../store.ts";

export default function Sidebar() {
  const {
    sessions,
    activeSessionId,
    sidebarOpen,
    setActiveSession,
    createSession,
    deleteSession,
    toggleSidebar,
  } = useStore();
  const [search, setSearch] = useState("");

  if (!sidebarOpen) return null;

  const filtered = search
    ? sessions.filter((s) =>
        s.name.toLowerCase().includes(search.toLowerCase())
      )
    : sessions;

  return (
    <motion.aside
      initial={false}
      animate={{ width: 260, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="h-full bg-[var(--color-surface)] border-r border-[var(--color-border)] flex flex-col overflow-hidden"
      style={{ width: 260 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-emerald-500/10 rounded-lg">
            <Terminal className="w-4 h-4 text-emerald-500" />
          </div>
          <span className="text-sm font-semibold text-white tracking-tight">
            ANT
          </span>
        </div>
        <button
          onClick={toggleSidebar}
          className="p-1.5 text-white/40 hover:text-white/80 transition-colors"
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>

      {/* New session buttons */}
      <div className="p-3 flex gap-2">
        <button
          onClick={() => createSession("terminal")}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-500/10 text-emerald-400 text-xs font-medium rounded-lg hover:bg-emerald-500/20 transition-colors"
        >
          <Terminal className="w-3.5 h-3.5" />
          Terminal
        </button>
        <button
          onClick={() => createSession("conversation")}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-blue-500/10 text-blue-400 text-xs font-medium rounded-lg hover:bg-blue-500/20 transition-colors"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Chat
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 px-2.5 py-1.5 bg-white/5 rounded-lg border border-white/5 focus-within:border-white/10 transition-colors">
          <Search className="w-3 h-3 text-white/25 flex-shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter sessions..."
            className="flex-1 bg-transparent text-xs text-white/80 outline-none placeholder:text-white/20"
          />
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <AnimatePresence mode="popLayout">
          {filtered.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              active={session.id === activeSessionId}
              onSelect={() => setActiveSession(session.id)}
              onDelete={() => deleteSession(session.id)}
            />
          ))}
        </AnimatePresence>

        {sessions.length === 0 && (
          <div className="text-center text-white/20 text-xs py-8">
            No sessions yet.
            <br />
            Create one above.
          </div>
        )}

        {sessions.length > 0 && filtered.length === 0 && (
          <div className="text-center text-white/20 text-xs py-8">
            No matching sessions.
          </div>
        )}
      </div>
    </motion.aside>
  );
}

function SessionItem({
  session,
  active,
  onSelect,
  onDelete,
}: {
  session: Session;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const Icon = session.type === "terminal" ? Terminal : MessageSquare;
  const tone = session.type === "terminal"
    ? {
        activeBg: "bg-emerald-500/10",
        activeIcon: "text-emerald-400",
      }
    : {
        activeBg: "bg-blue-500/10",
        activeIcon: "text-blue-400",
      };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      onClick={onSelect}
      className={`group flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors mb-0.5 ${
        active ? `${tone.activeBg} text-white` : "text-white/50 hover:text-white/80 hover:bg-white/5"
      }`}
    >
      <Icon
        className={`w-3.5 h-3.5 flex-shrink-0 ${active ? tone.activeIcon : ""}`}
      />
      <span className="text-xs font-medium truncate flex-1">
        {session.name}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="opacity-0 group-hover:opacity-100 p-1 text-white/30 hover:text-red-400 transition-all"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </motion.div>
  );
}
