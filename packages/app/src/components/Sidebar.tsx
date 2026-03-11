import {
  Terminal,
  MessageSquare,
  Trash2,
  PanelLeftClose,
  Search,
  Settings,
  Pin,
  ChevronRight,
  ChevronDown,
  FolderPlus,
  Pencil,
  Check,
  X,
  Archive,
  RotateCcw,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useStore, type Session, type Workspace } from "../store.ts";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isMobile;
}

export default function Sidebar() {
  const {
    sessions,
    workspaces,
    activeSessionId,
    sidebarOpen,
    pinnedSessionIds,
    unreadCounts,
    showArchived,
    setActiveSession,
    createSession,
    deleteSession,
    archiveSession,
    restoreSession,
    toggleShowArchived,
    toggleSidebar,
    toggleSettings,
    togglePin,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    moveSessionToWorkspace,
  } = useStore();
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [editingWorkspaceName, setEditingWorkspaceName] = useState("");
  const newWorkspaceInputRef = useRef<HTMLInputElement>(null);
  const editWorkspaceInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (showNewWorkspace) {
      requestAnimationFrame(() => newWorkspaceInputRef.current?.focus());
    }
  }, [showNewWorkspace]);

  useEffect(() => {
    if (editingWorkspaceId) {
      requestAnimationFrame(() => editWorkspaceInputRef.current?.select());
    }
  }, [editingWorkspaceId]);

  if (!sidebarOpen) return null;

  const filtered = search
    ? sessions.filter((s) =>
        s.name.toLowerCase().includes(search.toLowerCase())
      )
    : sessions;

  // Sort: pinned first, then by updated_at
  const sorted = [...filtered].sort((a, b) => {
    const aPinned = pinnedSessionIds.has(a.id) ? 1 : 0;
    const bPinned = pinnedSessionIds.has(b.id) ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    return 0; // preserve server order (updated_at DESC)
  });

  // Separate archived from active, then group by workspace
  const activeSessions = sorted.filter((s) => !s.archived);
  const archivedSessions = sorted.filter((s) => s.archived);

  const workspaceSessionMap = new Map<string, Session[]>();
  const ungrouped: Session[] = [];

  for (const session of activeSessions) {
    if (session.workspace_id) {
      const list = workspaceSessionMap.get(session.workspace_id) || [];
      list.push(session);
      workspaceSessionMap.set(session.workspace_id, list);
    } else {
      ungrouped.push(session);
    }
  }

  const handleSessionSelect = (id: string) => {
    setActiveSession(id);
    if (isMobile) toggleSidebar();
  };

  const handleCreate = (type: "terminal" | "conversation") => {
    createSession(type);
    if (isMobile) toggleSidebar();
  };

  const toggleCollapsed = (workspaceId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }
      return next;
    });
  };

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;
    await createWorkspace(newWorkspaceName.trim());
    setNewWorkspaceName("");
    setShowNewWorkspace(false);
  };

  const handleRenameWorkspace = async (id: string) => {
    if (editingWorkspaceName.trim()) {
      await renameWorkspace(id, editingWorkspaceName.trim());
    }
    setEditingWorkspaceId(null);
    setEditingWorkspaceName("");
  };

  const handleDragStart = (e: React.DragEvent, sessionId: string) => {
    e.dataTransfer.setData("text/plain", sessionId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDropOnWorkspace = (e: React.DragEvent, workspaceId: string | null) => {
    e.preventDefault();
    const sessionId = e.dataTransfer.getData("text/plain");
    if (sessionId) {
      moveSessionToWorkspace(sessionId, workspaceId);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const sidebar = (
    <motion.aside
      initial={isMobile ? { x: -280 } : false}
      animate={isMobile ? { x: 0 } : { width: 260, opacity: 1 }}
      exit={isMobile ? { x: -280 } : { width: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className={`h-full bg-[var(--color-surface)] border-r border-[var(--color-border)] flex flex-col overflow-hidden ${
        isMobile ? "fixed inset-y-0 left-0 z-50 w-[280px]" : ""
      }`}
      style={isMobile ? undefined : { width: 260 }}
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
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowNewWorkspace((v) => !v)}
            className="p-1.5 text-white/40 hover:text-white/80 transition-colors"
            title="New Workspace"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
          <button
            onClick={toggleSidebar}
            className="p-1.5 text-white/40 hover:text-white/80 transition-colors"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* New workspace input */}
      {showNewWorkspace && (
        <div className="px-3 pt-2 flex gap-1.5">
          <input
            ref={newWorkspaceInputRef}
            value={newWorkspaceName}
            onChange={(e) => setNewWorkspaceName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateWorkspace();
              if (e.key === "Escape") setShowNewWorkspace(false);
            }}
            placeholder="Workspace name..."
            className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white outline-none focus:border-emerald-500/50 placeholder:text-white/20"
          />
          <button
            onClick={handleCreateWorkspace}
            className="p-1 text-emerald-400 hover:text-emerald-300"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowNewWorkspace(false)}
            className="p-1 text-white/40 hover:text-white/80"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* New session buttons */}
      <div className="p-3 flex gap-2">
        <button
          onClick={() => handleCreate("terminal")}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-500/10 text-emerald-400 text-xs font-medium rounded-lg hover:bg-emerald-500/20 transition-colors"
        >
          <Terminal className="w-3.5 h-3.5" />
          Terminal
        </button>
        <button
          onClick={() => handleCreate("conversation")}
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
        {/* Workspace groups */}
        {workspaces.map((workspace) => {
          const wsSessions = workspaceSessionMap.get(workspace.id) || [];
          const isCollapsed = collapsed.has(workspace.id);
          const isEditing = editingWorkspaceId === workspace.id;

          return (
            <div
              key={workspace.id}
              className="mb-1"
              onDragOver={handleDragOver}
              onDrop={(e) => handleDropOnWorkspace(e, workspace.id)}
            >
              {/* Workspace header */}
              <div className="group flex items-center gap-1 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors cursor-pointer">
                <button
                  onClick={() => toggleCollapsed(workspace.id)}
                  className="text-white/30 hover:text-white/60 flex-shrink-0"
                >
                  {isCollapsed ? (
                    <ChevronRight className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </button>

                {isEditing ? (
                  <input
                    ref={editWorkspaceInputRef}
                    value={editingWorkspaceName}
                    onChange={(e) => setEditingWorkspaceName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameWorkspace(workspace.id);
                      if (e.key === "Escape") setEditingWorkspaceId(null);
                    }}
                    onBlur={() => handleRenameWorkspace(workspace.id)}
                    className="flex-1 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[11px] text-white outline-none focus:border-emerald-500/50"
                  />
                ) : (
                  <span
                    onClick={() => toggleCollapsed(workspace.id)}
                    className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-white/40 truncate"
                  >
                    {workspace.name}
                  </span>
                )}

                {(() => {
                  const wsUnread = wsSessions.reduce((sum, s) => sum + (unreadCounts[s.id] || 0), 0);
                  return wsUnread > 0 ? (
                    <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-[10px] font-bold text-white mr-1">
                      {wsUnread}
                    </span>
                  ) : (
                    <span className="text-[10px] text-white/20 mr-1">
                      {wsSessions.length}
                    </span>
                  );
                })()}

                {!isEditing && (
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingWorkspaceId(workspace.id);
                        setEditingWorkspaceName(workspace.name);
                      }}
                      className="p-0.5 text-white/30 hover:text-white/60"
                    >
                      <Pencil className="w-2.5 h-2.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteWorkspace(workspace.id);
                      }}
                      className="p-0.5 text-white/30 hover:text-red-400"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Workspace sessions */}
              {!isCollapsed && (
                <div className="ml-3">
                  <AnimatePresence mode="popLayout">
                    {wsSessions.map((session) => (
                      <SessionItem
                        key={session.id}
                        session={session}
                        active={session.id === activeSessionId}
                        pinned={pinnedSessionIds.has(session.id)}
                        unreadCount={unreadCounts[session.id] || 0}
                        onSelect={() => handleSessionSelect(session.id)}
                        onArchive={() => archiveSession(session.id)}
                        onDelete={(e) => {
                          if (e.shiftKey && window.confirm("Permanently delete this session?")) {
                            deleteSession(session.id);
                          } else if (!e.shiftKey) {
                            archiveSession(session.id);
                          }
                        }}
                        onTogglePin={() => togglePin(session.id)}
                        onDragStart={(e) => handleDragStart(e, session.id)}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          );
        })}

        {/* Ungrouped sessions */}
        {ungrouped.length > 0 && workspaces.length > 0 && (
          <div
            className="mt-1 mb-1"
            onDragOver={handleDragOver}
            onDrop={(e) => handleDropOnWorkspace(e, null)}
          >
            <div className="px-2 py-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-white/25">
                Ungrouped
              </span>
            </div>
          </div>
        )}

        <div
          onDragOver={workspaces.length > 0 ? handleDragOver : undefined}
          onDrop={workspaces.length > 0 ? (e) => handleDropOnWorkspace(e, null) : undefined}
        >
          <AnimatePresence mode="popLayout">
            {ungrouped.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                active={session.id === activeSessionId}
                pinned={pinnedSessionIds.has(session.id)}
                unreadCount={unreadCounts[session.id] || 0}
                onSelect={() => handleSessionSelect(session.id)}
                onArchive={() => archiveSession(session.id)}
                onDelete={(e) => {
                  if (e.shiftKey && window.confirm("Permanently delete this session?")) {
                    deleteSession(session.id);
                  } else if (!e.shiftKey) {
                    archiveSession(session.id);
                  }
                }}
                onTogglePin={() => togglePin(session.id)}
                onDragStart={(e) => handleDragStart(e, session.id)}
              />
            ))}
          </AnimatePresence>
        </div>

        {/* Archived sessions section */}
        {showArchived && archivedSessions.length > 0 && (
          <div className="mt-2 mb-1">
            <div className="px-2 py-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-white/25">
                Archived
              </span>
            </div>
            <AnimatePresence mode="popLayout">
              {archivedSessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  active={session.id === activeSessionId}
                  pinned={false}
                  unreadCount={0}
                  archived
                  onSelect={() => handleSessionSelect(session.id)}
                  onArchive={() => {}}
                  onRestore={() => restoreSession(session.id)}
                  onDelete={(e) => {
                    if (window.confirm("Permanently delete this archived session?")) {
                      deleteSession(session.id);
                    }
                  }}
                  onTogglePin={() => {}}
                  onDragStart={(e) => handleDragStart(e, session.id)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}

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

      {/* Settings Footer */}
      <div className="p-3 border-t border-[var(--color-border)] space-y-1">
        <button
          onClick={toggleShowArchived}
          className={`flex items-center gap-2 p-2 w-full rounded-lg transition-colors ${
            showArchived ? "text-amber-400 bg-amber-500/10" : "text-white/50 hover:text-white/90 hover:bg-white/5"
          }`}
        >
          <Archive className="w-4 h-4" />
          <span className="text-xs font-medium">
            {showArchived ? "Hide Archived" : "Show Archived"}
          </span>
        </button>
        <button
          onClick={toggleSettings}
          className="flex items-center gap-2 p-2 w-full text-white/50 hover:text-white/90 hover:bg-white/5 rounded-lg transition-colors"
        >
          <Settings className="w-4 h-4" />
          <span className="text-xs font-medium">Settings</span>
        </button>
      </div>
    </motion.aside>
  );

  // On mobile, render as overlay with backdrop
  if (isMobile) {
    return (
      <>
        <div className="sidebar-backdrop" onClick={toggleSidebar} />
        {sidebar}
      </>
    );
  }

  return sidebar;
}

function SessionItem({
  session,
  active,
  pinned,
  unreadCount,
  archived,
  onSelect,
  onArchive,
  onRestore,
  onDelete,
  onTogglePin,
  onDragStart,
}: {
  session: Session;
  active: boolean;
  pinned: boolean;
  unreadCount: number;
  archived?: boolean;
  onSelect: () => void;
  onArchive: () => void;
  onRestore?: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onTogglePin: () => void;
  onDragStart: (e: React.DragEvent) => void;
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
      animate={{ opacity: archived ? 0.5 : 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      draggable={!archived}
      onDragStart={onDragStart as any}
      onClick={onSelect}
      className={`group flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors mb-0.5 ${
        active ? `${tone.activeBg} text-white` : "text-white/50 hover:text-white/80 hover:bg-white/5"
      }`}
    >
      {pinned && (
        <Pin className="w-2.5 h-2.5 text-amber-400/60 flex-shrink-0 -mr-1" />
      )}
      <Icon
        className={`w-3.5 h-3.5 flex-shrink-0 ${active ? tone.activeIcon : ""}`}
      />
      <span className="text-xs font-medium truncate flex-1">
        {session.name}
      </span>
      {unreadCount > 0 && (
        <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-[10px] font-bold text-white">
          {unreadCount}
        </span>
      )}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
        {archived ? (
          <>
            {onRestore && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRestore();
                }}
                className="p-1 text-white/30 hover:text-emerald-400 transition-colors"
                title="Restore"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(e);
              }}
              className="p-1 text-white/30 hover:text-red-400 transition-colors"
              title="Delete permanently"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin();
              }}
              className={`p-1 transition-colors ${
                pinned ? "text-amber-400" : "text-white/30 hover:text-amber-400"
              }`}
              title={pinned ? "Unpin" : "Pin"}
            >
              <Pin className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(e);
              }}
              className="p-1 text-white/30 hover:text-red-400 transition-colors"
              title="Archive (Shift+click to delete)"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}
