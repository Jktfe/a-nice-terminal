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
  Zap,
} from "lucide-react";
import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useStore, type Session, type Workspace } from "../store.ts";
import { useIsMobile } from "../hooks/useIsMobile.ts";
import { getSessionTheme } from "../utils/sessionTheme.ts";

export default function Sidebar() {
  const {
    sessions,
    workspaces,
    activeSessionId,
    sidebarOpen,
    pinnedSessionIds,
    unreadCounts,
    showArchived,
    agentPresence,
    sessionHealth,
    setActiveSession,
    createSession,
    deleteSession,
    archiveSession,
    archiveOrDeleteSession,
    restoreSession,
    toggleShowArchived,
    toggleSidebar,
    toggleSettings,
    togglePin,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    moveSessionToWorkspace,
    uiTheme,
    openParseDeleteDialog,
    toggleCommonCalls,
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

  const { sorted, activeSessions, archivedSessions, workspaceSessionMap, ungrouped } = useMemo(() => {
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

    return { sorted, activeSessions, archivedSessions, workspaceSessionMap, ungrouped };
  }, [sessions, pinnedSessionIds, search]);

  if (!sidebarOpen) return null;

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
        <span className="text-sm font-semibold text-[var(--color-text)] tracking-tight">
          Workspaces
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowNewWorkspace((v) => !v)}
            className="p-1.5 text-[var(--color-text-dim)] hover:text-[var(--color-text)] transition-colors"
            title="New Workspace"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
          <button
            onClick={toggleSidebar}
            className="p-1.5 text-[var(--color-text-dim)] hover:text-[var(--color-text)] transition-colors"
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
            className="flex-1 bg-[var(--color-hover)] border border-[var(--color-input-border)] rounded px-2 py-1 text-xs text-[var(--color-text)] outline-none focus:border-emerald-500/50 placeholder:text-[var(--color-text-dim)]"
          />
          <button
            onClick={handleCreateWorkspace}
            className="p-1 text-emerald-400 hover:text-emerald-300"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowNewWorkspace(false)}
            className="p-1 text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
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
        <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[var(--color-hover)] rounded-lg border border-[var(--color-border)] focus-within:border-[var(--color-input-border)] transition-colors">
          <Search className="w-3 h-3 text-[var(--color-text-dim)] flex-shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter sessions..."
            className="flex-1 bg-transparent text-xs text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-dim)]"
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
              <div className="group flex items-center gap-1 px-2 py-1.5 rounded-md hover:bg-[var(--color-hover)] transition-colors cursor-pointer">
                <button
                  onClick={() => toggleCollapsed(workspace.id)}
                  className="text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)] flex-shrink-0"
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
                    className="flex-1 bg-[var(--color-hover)] border border-[var(--color-input-border)] rounded px-1.5 py-0.5 text-[11px] text-[var(--color-text)] outline-none focus:border-emerald-500/50"
                  />
                ) : (
                  <span
                    onClick={() => toggleCollapsed(workspace.id)}
                    className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)] truncate"
                  >
                    {workspace.name}
                  </span>
                )}

                {(() => {
                  const wsUnread = wsSessions.reduce((sum, s) => sum + (unreadCounts[s.id] || 0), 0);
                  return wsUnread > 0 ? (
                    <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-[10px] font-bold text-[var(--color-text)] mr-1">
                      {wsUnread}
                    </span>
                  ) : (
                    <span className="text-[10px] text-[var(--color-text-dim)] mr-1">
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
                      className="p-0.5 text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)]"
                    >
                      <Pencil className="w-2.5 h-2.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteWorkspace(workspace.id);
                      }}
                      className="p-0.5 text-[var(--color-text-dim)] hover:text-red-400"
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
                        agentState={agentPresence[session.id]?.state}
                        hasError={sessionHealth[session.id] === false}
                        onSelect={() => handleSessionSelect(session.id)}
                        onArchive={() => archiveSession(session.id)}
                        onDelete={(e) => {
                          if (e.shiftKey && window.confirm("Permanently delete this session?")) {
                            deleteSession(session.id);
                          } else if (!e.shiftKey) {
                            archiveOrDeleteSession(session.id);
                          }
                        }}
                        onTogglePin={() => togglePin(session.id)}
                        onDragStart={(e) => handleDragStart(e, session.id)}
                        uiTheme={uiTheme}
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
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)]">
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
                agentState={agentPresence[session.id]?.state}
                hasError={sessionHealth[session.id] === false}
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
                uiTheme={uiTheme}
              />
            ))}
          </AnimatePresence>
        </div>

        {/* Archived sessions section */}
        {showArchived && archivedSessions.length > 0 && (
          <div className="mt-2 mb-1">
            <div className="px-2 py-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)]">
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
                    if (e.shiftKey && window.confirm("Permanently delete this archived session?")) {
                      deleteSession(session.id);
                    } else if (!e.shiftKey) {
                      openParseDeleteDialog(session.id);
                    }
                  }}
                  onTogglePin={() => {}}
                  onDragStart={(e) => handleDragStart(e, session.id)}
                  uiTheme={uiTheme}
                  agentState={undefined}
                  hasError={false}
                />
              ))}
            </AnimatePresence>
          </div>
        )}

        {sessions.length === 0 && (
          <div className="text-center text-[var(--color-text-dim)] text-xs py-8">
            No sessions yet.
            <br />
            Create one above.
          </div>
        )}

        {sessions.length > 0 && sorted.length === 0 && (
          <div className="text-center text-[var(--color-text-dim)] text-xs py-8">
            No matching sessions.
          </div>
        )}
      </div>

      {/* Settings Footer */}
      <div className="p-3 border-t border-[var(--color-border)] flex gap-1">
        <button
          onClick={toggleCommonCalls}
          className="flex items-center justify-center gap-1.5 p-2 flex-1 rounded-lg transition-colors text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]"
          title="Common Calls"
        >
          <Zap className="w-4 h-4" />
          <span className="text-xs font-medium">Calls</span>
        </button>
        <button
          onClick={toggleShowArchived}
          className={`flex items-center justify-center gap-1.5 p-2 flex-1 rounded-lg transition-colors ${
            showArchived ? "text-amber-400 bg-amber-500/10" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]"
          }`}
          title={showArchived ? "Hide Archived" : "Show Archived"}
        >
          <Archive className="w-4 h-4" />
          <span className="text-xs font-medium">Archive</span>
        </button>
        <button
          onClick={toggleSettings}
          className="flex items-center justify-center gap-1.5 p-2 flex-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)] rounded-lg transition-colors"
          title="Settings"
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
  agentState,
  hasError,
  onSelect,
  onArchive,
  onRestore,
  onDelete,
  onTogglePin,
  onDragStart,
  uiTheme,
}: {
  session: Session;
  active: boolean;
  pinned: boolean;
  unreadCount: number;
  archived?: boolean;
  agentState?: string;
  hasError?: boolean;
  onSelect: () => void;
  onArchive: () => void;
  onRestore?: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onTogglePin: () => void;
  onDragStart: (e: React.DragEvent) => void;
  uiTheme: any;
}) {
  const { Icon, chip: activeBg } = getSessionTheme(session.type, uiTheme);

  // Icon colour based on agent state
  const iconColor =
    agentState === "working" ? "text-emerald-400" :
    agentState === "thinking" ? "text-amber-400" :
    hasError ? "text-red-400" :
    active ? "text-[var(--color-text)]" : "text-[var(--color-text-dim)]";

  // Status badge
  const badge = hasError
    ? { label: "ERROR", cls: "bg-red-950 text-red-400" }
    : agentState === "working"
    ? { label: "WORKING", cls: "bg-green-950 text-green-400" }
    : agentState === "thinking"
    ? { label: "NEEDS INPUT", cls: "bg-amber-950 text-amber-400" }
    : { label: "IDLE", cls: "bg-[var(--color-hover)] text-[var(--color-text-dim)]" };

  const typeLabel = session.type === "terminal" ? "terminal" : session.type === "conversation" ? "conversation" : "unified";

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
        active ? `${activeBg} text-[var(--color-text)]` : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]"
      }`}
    >
      {pinned && (
        <Pin className="w-2.5 h-2.5 text-amber-400/60 flex-shrink-0 -mr-1" />
      )}
      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${iconColor}`} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{session.name}</div>
        <div className="text-[10px] text-[var(--color-text-dim)] truncate">{typeLabel}</div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {unreadCount > 0 && (
          <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-[10px] font-bold text-[var(--color-text)]">
            {unreadCount}
          </span>
        )}
        {!archived && (
          <span className={`hidden group-hover:hidden px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide ${badge.cls}`}>
            {badge.label}
          </span>
        )}
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide group-hover:hidden ${badge.cls}`}>
          {badge.label}
        </span>
      </div>
      <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
        {archived ? (
          <>
            {onRestore && (
              <button
                onClick={(e) => { e.stopPropagation(); onRestore(); }}
                className="p-1 text-[var(--color-text-dim)] hover:text-emerald-400 transition-colors"
                title="Restore"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(e); }}
              className="p-1 text-[var(--color-text-dim)] hover:text-red-400 transition-colors"
              title="Delete permanently"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
              className={`p-1 transition-colors ${pinned ? "text-amber-400" : "text-[var(--color-text-dim)] hover:text-amber-400"}`}
              title={pinned ? "Unpin" : "Pin"}
            >
              <Pin className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(e); }}
              className="p-1 text-[var(--color-text-dim)] hover:text-red-400 transition-colors"
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
