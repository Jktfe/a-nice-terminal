import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  CheckSquare,
  Plus,
  Trash2,
  User,
  Circle,
  CheckCircle2,
  AlertCircle,
  Clock,
} from "lucide-react";
import { useStore, apiFetch } from "../store.ts";

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

export default function TaskPanel() {
  const { taskPanelOpen, toggleTaskPanel, socket } = useStore();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [saving, setSaving] = useState(false);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/api/tasks");
      setTasks(data);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (taskPanelOpen) loadTasks();
  }, [taskPanelOpen, loadTasks]);

  // Live updates via WebSocket
  useEffect(() => {
    if (!socket) return;
    const handler = (payload: { action: string; task?: Task; taskId?: string }) => {
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
    socket.on("task_changed", handler);
    return () => { socket.off("task_changed", handler); };
  }, [socket]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      await apiFetch("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: newTitle.trim(),
          assigned_name: newAssignee.trim() || null,
        }),
      });
      setNewTitle("");
      setNewAssignee("");
      setAdding(false);
    } catch {
      // ignore — WS will update state
    } finally {
      setSaving(false);
    }
  };

  const handleStatusCycle = async (task: Task) => {
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

  const handleDelete = async (id: string) => {
    await apiFetch(`/api/tasks/${id}`, { method: "DELETE" }).catch(() => {});
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (adding) { setAdding(false); return; }
      toggleTaskPanel();
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && adding) {
      handleCreate();
    }
  };

  if (!taskPanelOpen) return null;

  const grouped = STATUS_ORDER.map((status) => ({
    status,
    tasks: tasks.filter((t) => t.status === status),
  })).filter((g) => g.tasks.length > 0 || g.status === "in_progress");

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--color-overlay)] backdrop-blur-sm p-4 pt-[8vh]"
        onClick={(e) => { if (e.target === e.currentTarget) toggleTaskPanel(); }}
        onKeyDown={handleKeyDown}
      >
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="w-full max-w-lg bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[76vh]"
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)]">
            <CheckSquare className="w-4 h-4 text-violet-400" />
            <h2 className="text-sm font-semibold text-[var(--color-text)] flex-1">
              Task Board
            </h2>
            <span className="text-[10px] text-[var(--color-text-dim)] bg-[var(--color-hover)] px-1.5 py-0.5 rounded border border-[var(--color-border)]">
              {tasks.length} task{tasks.length !== 1 ? "s" : ""}
            </span>
            <kbd className="hidden sm:inline-block text-[10px] text-[var(--color-text-dim)] bg-[var(--color-hover)] px-1.5 py-0.5 rounded border border-[var(--color-border)]">
              ⌘⇧T
            </kbd>
            <button
              onClick={() => { setAdding(true); setTimeout(() => document.getElementById("new-task-title")?.focus(), 50); }}
              className="p-1.5 text-violet-400 hover:text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 rounded-md transition-colors"
              title="Add task"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={toggleTaskPanel}
              className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] bg-[var(--color-hover)] hover:bg-[var(--color-active)] rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Add task form */}
          <AnimatePresence>
            {adding && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="border-b border-[var(--color-border)] overflow-hidden"
              >
                <div className="px-4 py-3 flex flex-col gap-2">
                  <input
                    id="new-task-title"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setAdding(false); }}
                    placeholder="Task title…"
                    className="w-full px-3 py-1.5 bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-dim)] focus:outline-none focus:border-violet-500/50"
                  />
                  <div className="flex gap-2 items-center">
                    <div className="relative flex-1">
                      <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-dim)]" />
                      <input
                        value={newAssignee}
                        onChange={(e) => setNewAssignee(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setAdding(false); }}
                        placeholder="Working on it (@handle)…"
                        className="w-full pl-8 pr-3 py-1.5 bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-dim)] focus:outline-none focus:border-violet-500/50"
                      />
                    </div>
                    <button
                      onClick={handleCreate}
                      disabled={!newTitle.trim() || saving}
                      className="px-3 py-1.5 text-sm font-medium bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
                    >
                      {saving ? "Adding…" : "Add"}
                    </button>
                    <button
                      onClick={() => setAdding(false)}
                      className="px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Task list */}
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">
            {loading ? (
              <div className="text-center text-[var(--color-text-muted)] py-8 text-sm">
                Loading…
              </div>
            ) : tasks.length === 0 ? (
              <div className="text-center py-12 px-4">
                <CheckSquare className="w-10 h-10 text-[var(--color-text-dim)] mx-auto mb-3 opacity-40" />
                <p className="text-sm text-[var(--color-text-muted)] mb-1">No tasks yet</p>
                <p className="text-xs text-[var(--color-text-dim)]">
                  Hit <kbd className="px-1 py-0.5 bg-[var(--color-hover)] border border-[var(--color-border)] rounded text-[10px]">+</kbd> to add a task and assign it to a model or human.
                </p>
              </div>
            ) : (
              grouped.map(({ status, tasks: groupTasks }) => {
                const meta = STATUS_META[status];
                if (groupTasks.length === 0) return null;
                return (
                  <div key={status}>
                    <div className={`flex items-center gap-1.5 mb-2 ${meta.colour}`}>
                      {meta.icon}
                      <span className="text-[10px] font-semibold uppercase tracking-wider">
                        {meta.label}
                      </span>
                      <span className="text-[10px] opacity-60">({groupTasks.length})</span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {groupTasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          onStatusCycle={handleStatusCycle}
                          onDelete={handleDelete}
                        />
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

function TaskCard({
  task,
  onStatusCycle,
  onDelete,
}: {
  task: Task;
  onStatusCycle: (task: Task) => void;
  onDelete: (id: string) => void;
}) {
  const meta = STATUS_META[task.status];
  const [editing, setEditing] = useState(false);
  const [assigneeDraft, setAssigneeDraft] = useState(task.assigned_name ?? "");

  const saveAssignee = async () => {
    setEditing(false);
    if (assigneeDraft.trim() === (task.assigned_name ?? "")) return;
    await apiFetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      body: JSON.stringify({ assigned_name: assigneeDraft.trim() || null }),
    }).catch(() => {});
  };

  return (
    <div className="group flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] hover:border-[var(--color-text-dim)]/30 transition-colors">
      {/* Status toggle button */}
      <button
        onClick={() => onStatusCycle(task)}
        className={`mt-0.5 flex-shrink-0 ${meta.colour} hover:opacity-70 transition-opacity`}
        title={`Status: ${meta.label} — click to advance`}
      >
        {meta.icon}
      </button>

      <div className="flex-1 min-w-0">
        <p
          className={`text-sm text-[var(--color-text)] leading-snug ${task.status === "done" ? "line-through opacity-50" : ""}`}
        >
          {task.title}
        </p>

        {/* Assignee row */}
        <div className="mt-1 flex items-center gap-1.5">
          {editing ? (
            <input
              autoFocus
              value={assigneeDraft}
              onChange={(e) => setAssigneeDraft(e.target.value)}
              onBlur={saveAssignee}
              onKeyDown={(e) => { if (e.key === "Enter") saveAssignee(); if (e.key === "Escape") { setEditing(false); setAssigneeDraft(task.assigned_name ?? ""); } }}
              className="text-xs px-1.5 py-0.5 bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)] focus:outline-none focus:border-violet-500/50 w-36"
              placeholder="@handle"
            />
          ) : task.assigned_name ? (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1 text-[10px] text-violet-400 hover:text-violet-300 transition-colors"
            >
              <User className="w-3 h-3" />
              {task.assigned_name}
            </button>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)] transition-colors opacity-0 group-hover:opacity-100"
            >
              + assign
            </button>
          )}

          <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${meta.bg} ${meta.colour} flex items-center gap-1`}>
            {meta.icon}
            {meta.label}
          </span>
        </div>
      </div>

      {/* Delete */}
      <button
        onClick={() => onDelete(task.id)}
        className="flex-shrink-0 p-1 text-[var(--color-text-dim)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all rounded"
        title="Delete task"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
