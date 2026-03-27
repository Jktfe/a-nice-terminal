import { useMemo, useState, useEffect, useCallback } from "react";
import { 
  Check, 
  Circle, 
  Loader2, 
  FileText, 
  Users, 
  MessageSquare, 
  Clock, 
  CheckSquare, 
  Plus, 
  User, 
  Trash2,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import { useStore, type Session, type Message, apiFetch } from "../store.ts";
import { useChatRoom } from "../hooks/useChatRoom.ts";

// --- Types ---

type TaskStatus = "todo" | "in_progress" | "done" | "blocked";

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assigned_to: string | null;
  assigned_name: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_META: Record<
  TaskStatus,
  { label: string; icon: React.ReactNode; colour: string; bg: string }
> = {
  todo: {
    label: "To Do",
    icon: <Circle className="w-3.5 h-3.5" />,
    colour: "text-[var(--color-text-muted)]",
    bg: "bg-[var(--color-hover)]",
  },
  in_progress: {
    label: "In Progress",
    icon: <Clock className="w-3.5 h-3.5" />,
    colour: "text-blue-400",
    bg: "bg-blue-500/10",
  },
  done: {
    label: "Done",
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
    colour: "text-emerald-400",
    bg: "bg-emerald-500/10",
  },
  blocked: {
    label: "Blocked",
    icon: <AlertCircle className="w-3.5 h-3.5" />,
    colour: "text-red-400",
    bg: "bg-red-500/10",
  },
};

const STATUS_ORDER: TaskStatus[] = ["in_progress", "todo", "blocked", "done"];

interface DerivedParticipant {
  name: string;
  senderType: string;
  messageCount: number;
  lastSeen: string;
}

// --- Component ---

export default function RightPanel() {
  const { activeSessionId, sessions, messages, agentPresence, socket } = useStore();
  const session = sessions.find(s => s.id === activeSessionId);
  const { room } = useChatRoom(activeSessionId);
  
  // Task State
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessionTasks, setSessionTasks] = useState<any[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState("");

  // Derive participants from messages
  const derivedParticipants = useMemo(() => {
    if (room && room.participants.length > 0) return null;
    if (!messages || messages.length === 0) return [];

    const map = new Map<string, DerivedParticipant>();
    for (const msg of messages) {
      if (msg.session_id !== activeSessionId) continue;
      const name = msg.sender_name || (msg.role === "human" ? "You" : msg.role);
      const key = name.toLowerCase();
      const existing = map.get(key);
      if (existing) {
        existing.messageCount++;
        existing.lastSeen = msg.created_at;
      } else {
        map.set(key, {
          name,
          senderType: msg.sender_type || msg.role,
          messageCount: 1,
          lastSeen: msg.created_at,
        });
      }
    }
    return [...map.values()].sort((a, b) => b.messageCount - a.messageCount);
  }, [messages, room, activeSessionId]);

  // Load General Tasks
  const loadGlobalTasks = useCallback(async () => {
    try {
      const data = await apiFetch("/api/tasks");
      setTasks(data);
    } catch {
      setTasks([]);
    }
  }, []);

  const loadSessionTasks = useCallback(async () => {
    if (!activeSessionId) return;
    try {
      const data = await apiFetch(`/api/v2/agent/context?session_id=${activeSessionId}`);
      setSessionTasks(data.active_tasks || []);
    } catch {
      setSessionTasks([]);
    }
  }, [activeSessionId]);

  const loadAllTasks = useCallback(async () => {
    setLoadingTasks(true);
    await Promise.all([loadGlobalTasks(), loadSessionTasks()]);
    setLoadingTasks(false);
  }, [loadGlobalTasks, loadSessionTasks]);

  useEffect(() => {
    loadAllTasks();
  }, [loadAllTasks]);

  // Live updates for tasks via WebSocket
  useEffect(() => {
    if (!socket) return;
    const taskHandler = (payload: { action: string; task?: Task; taskId?: string }) => {
      if (payload.action === "created" && payload.task) {
        setTasks((prev) => {
          if (prev.find((t) => t.id === payload.task!.id)) return prev;
          return [...prev, payload.task!];
        });
      } else if (payload.action === "updated" && payload.task) {
        setTasks((prev) =>
          prev.map((t) => (t.id === payload.task!.id ? payload.task! : t))
        );
      } else if (payload.action === "deleted" && payload.taskId) {
        setTasks((prev) => prev.filter((t) => t.id !== payload.taskId));
      }
    };

    const coordinationHandler = () => {
      loadSessionTasks();
    };

    socket.on("task_changed", taskHandler);
    socket.on("agent_notification", coordinationHandler);
    socket.on("task_claimed", coordinationHandler);
    socket.on("task_completed", coordinationHandler);

    return () => { 
      socket.off("task_changed", taskHandler); 
      socket.off("agent_notification", coordinationHandler);
      socket.off("task_claimed", coordinationHandler);
      socket.off("task_completed", coordinationHandler);
    };
  }, [socket, loadSessionTasks]);

  const handleCreateTask = async () => {
    if (!newTaskTitle.trim()) return;
    try {
      await apiFetch("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: newTaskTitle.trim(),
          assigned_name: newTaskAssignee.trim() || null,
        }),
      });
      setNewTaskTitle("");
      setNewTaskAssignee("");
      setAddingTask(false);
    } catch { /* ignore */ }
  };

  const handleTaskStatusCycle = async (task: Task) => {
    const next: Record<TaskStatus, TaskStatus> = {
      todo: "in_progress",
      in_progress: "done",
      done: "todo",
      blocked: "todo",
    };
    await apiFetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: next[task.status] }),
    }).catch(() => {});
  };

  const handleSessionTaskCycle = async (task: any) => {
    if (task.status === "pending") {
      await apiFetch(`/api/v2/tasks/${task.id}/claim`, {
        method: "POST",
        body: JSON.stringify({ agent_id: "human" })
      });
    } else if (task.status === "claimed") {
      await apiFetch(`/api/v2/tasks/${task.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ agent_id: "human", result: "Completed by user in UI" })
      });
    }
    loadSessionTasks();
  };

  const handleTaskDelete = async (id: string) => {
    await apiFetch(`/api/tasks/${id}`, { method: "DELETE" }).catch(() => {});
  };

  // Merge and normalize all tasks for display
  const allTasks = useMemo(() => {
    const merged: Task[] = [...tasks];
    for (const st of sessionTasks) {
      const status: TaskStatus = st.status === "pending" ? "todo" : st.status === "claimed" ? "in_progress" : "done";
      merged.push({
        id: st.id,
        title: st.description,
        description: null,
        status,
        assigned_to: st.assigned_to,
        assigned_name: st.assigned_to,
        created_at: st.created_at,
        updated_at: st.created_at,
        // @ts-ignore
        isCoordination: true
      });
    }
    return merged;
  }, [tasks, sessionTasks]);

  const taskGroups = STATUS_ORDER.map((status) => ({
    status,
    tasks: allTasks.filter((t) => t.status === status),
  })).filter((g) => g.tasks.length > 0 || g.status === "in_progress");

  if (!activeSessionId) return null;

  return (
    <aside className="w-80 flex-shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-8">
        
        {/* Participants Section */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-emerald-400" />
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-dim)]">
              Participants
            </h3>
            <span className="text-[10px] text-[var(--color-text-dim)] bg-[var(--color-hover)] px-1.5 py-0.5 rounded ml-auto">
              {(room?.participants.length || derivedParticipants?.length || 0)}
            </span>
          </div>
          <div className="space-y-3">
            {room && room.participants.map((p) => {
              const isHuman = !p.model;
              const presence = agentPresence[p.terminalSessionId];
              const isActive = presence?.state === "working" || presence?.state === "thinking";
              return (
                <div key={p.terminalSessionId} className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isHuman ? "bg-emerald-400" : isActive ? "bg-violet-400 animate-pulse" : "bg-[var(--color-text-dim)]"}`} />
                  <span className={`text-xs truncate ${isHuman || isActive ? "font-semibold text-[var(--color-text)]" : "text-[var(--color-text-muted)]"}`}>
                    {p.agentName}
                  </span>
                  {p.model && <span className="text-[10px] text-[var(--color-text-dim)] truncate ml-auto">{p.model}</span>}
                </div>
              );
            })}
            {derivedParticipants && derivedParticipants.map((p) => (
              <div key={p.name} className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${p.senderType === "human" ? "bg-emerald-400" : "bg-violet-400"}`} />
                <span className="text-xs font-semibold text-[var(--color-text)] truncate">{p.name}</span>
                <span className="text-[10px] text-[var(--color-text-dim)] ml-auto">{p.messageCount} msg</span>
              </div>
            ))}
          </div>
        </section>

        {/* Task Board Section */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <CheckSquare className="w-4 h-4 text-violet-400" />
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-dim)]">
              Task Board
            </h3>
            <button 
              onClick={() => setAddingTask(v => !v)}
              className="p-1 text-violet-400 hover:text-violet-300 ml-auto"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {addingTask && (
            <div className="mb-4 space-y-2 p-3 bg-[var(--color-bg)] rounded-lg border border-dashed border-violet-500/30">
              <input
                autoFocus
                value={newTaskTitle}
                onChange={e => setNewTaskTitle(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleCreateTask(); if (e.key === "Escape") setAddingTask(false); }}
                placeholder="New task title..."
                className="w-full bg-transparent text-xs text-[var(--color-text)] outline-none"
              />
              <input
                value={newTaskAssignee}
                onChange={e => setNewTaskAssignee(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleCreateTask(); }}
                placeholder="Assignee (@handle)"
                className="w-full bg-transparent text-[10px] text-[var(--color-text-dim)] outline-none"
              />
              <div className="flex gap-2 justify-end pt-1">
                <button onClick={() => setAddingTask(false)} className="text-[10px] text-[var(--color-text-dim)]">Cancel</button>
                <button onClick={handleCreateTask} className="text-[10px] text-violet-400 font-bold">Add</button>
              </div>
            </div>
          )}

          <div className="space-y-5">
            {taskGroups.map(({ status, tasks: groupTasks }) => {
              const meta = STATUS_META[status];
              if (groupTasks.length === 0 && status !== "in_progress") return null;
              return (
                <div key={status}>
                  <div className={`flex items-center gap-1.5 mb-2.5 ${meta.colour}`}>
                    {meta.icon}
                    <span className="text-[9px] font-bold uppercase tracking-tighter">{meta.label}</span>
                  </div>
                  <div className="space-y-2">
                    {groupTasks.map((task) => (
                      <div key={task.id} className="group relative bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md p-2.5 hover:border-[var(--color-text-dim)]/40 transition-colors">
                        <div className="flex items-start gap-2">
                          <button 
                            onClick={() => {
                              // @ts-ignore
                              if (task.isCoordination) handleSessionTaskCycle(task);
                              else handleTaskStatusCycle(task);
                            }} 
                            className={`mt-0.5 ${meta.colour}`}
                          >
                            {meta.icon}
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className={`text-xs text-[var(--color-text)] leading-normal ${task.status === "done" ? "line-through opacity-40" : ""}`}>
                              {task.title}
                            </p>
                            {task.assigned_name && (
                              <div className="flex items-center gap-1 mt-1 text-[10px] text-violet-400">
                                <User className="w-2.5 h-2.5" />
                                {task.assigned_name}
                              </div>
                            )}
                          </div>
                          {!// @ts-ignore
                          task.isCoordination && (
                            <button 
                              onClick={() => handleTaskDelete(task.id)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-[var(--color-text-dim)] hover:text-red-400"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Context Files Section */}
        {room && room.files.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-4">
              <FileText className="w-4 h-4 text-blue-400" />
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-dim)]">
                Key Context
              </h3>
            </div>
            <div className="space-y-3">
              {room.files.map((file) => (
                <div key={file.id} className="flex items-start gap-3 p-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md">
                  <FileText className="w-3.5 h-3.5 text-blue-400 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[11px] font-mono text-[var(--color-text)] truncate" title={file.path}>
                      {file.path.split('/').pop()}
                    </div>
                    {file.description && (
                      <p className="text-[10px] text-[var(--color-text-dim)] mt-0.5 line-clamp-2">
                        {file.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

      </div>
    </aside>
  );
}
