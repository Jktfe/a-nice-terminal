import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  GitBranch,
  Play,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { useStore, apiFetch } from "../store.ts";

interface WorkflowStep {
  id: string;
  step_index: number;
  step_title: string;
  session_id: string;
  last_command: string | null;
  last_exit_code: number | null;
  last_completed_at: string | null;
}

interface Workflow {
  id: string;
  recipe_id: string;
  recipe_name: string;
  status: "running" | "done" | "failed" | "cancelled";
  started_at: string;
  finished_at: string | null;
  step_count?: number;
  steps?: WorkflowStep[];
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Workflow["status"] }) {
  const map: Record<Workflow["status"], { label: string; className: string }> = {
    running: { label: "Running", className: "bg-blue-500/10 text-blue-400" },
    done: { label: "Done", className: "bg-emerald-500/10 text-emerald-400" },
    failed: { label: "Failed", className: "bg-red-500/10 text-red-400" },
    cancelled: { label: "Cancelled", className: "bg-[var(--color-hover)] text-[var(--color-text-muted)]" },
  };
  const { label, className } = map[status] ?? map.running;
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${className}`}>{label}</span>
  );
}

// ─── Step icon ────────────────────────────────────────────────────────────────

function StepIcon({ exitCode }: { exitCode: number | null }) {
  if (exitCode === null) return <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin flex-shrink-0" />;
  if (exitCode === 0) return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />;
  return <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />;
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function WorkflowPanel() {
  const { workflowPanelOpen, toggleWorkflowPanel, setActiveSession } = useStore();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadList = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiFetch("/api/v2/workflows") as Workflow[];
      setWorkflows(data);
    } catch {
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const data = await apiFetch(`/api/v2/workflows/${encodeURIComponent(id)}`) as Workflow;
      setExpandedDetail(data);
    } catch { /* ignore */ }
  }, []);

  // Initial load + auto-refresh every 5s while panel is open
  useEffect(() => {
    if (!workflowPanelOpen) return;
    loadList();
    const interval = setInterval(() => loadList(true), 5_000);
    return () => clearInterval(interval);
  }, [workflowPanelOpen, loadList]);

  // Load detail when a workflow is expanded
  useEffect(() => {
    if (expandedId) loadDetail(expandedId);
  }, [expandedId, loadDetail]);

  // Re-poll detail of expanded running workflow
  useEffect(() => {
    if (!workflowPanelOpen || !expandedId) return;
    const wf = workflows.find((w) => w.id === expandedId);
    if (wf?.status !== "running") return;
    const interval = setInterval(() => loadDetail(expandedId), 3_000);
    return () => clearInterval(interval);
  }, [workflowPanelOpen, expandedId, workflows, loadDetail]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadList();
    if (expandedId) await loadDetail(expandedId);
    setRefreshing(false);
  };

  const handleToggle = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedDetail(null);
    } else {
      setExpandedId(id);
      setExpandedDetail(null);
    }
  };

  const handleCancel = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await apiFetch(`/api/v2/workflows/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      setWorkflows((prev) => prev.map((w) => w.id === id ? { ...w, status: "cancelled" } : w));
    } catch { /* ignore */ }
  };

  if (!workflowPanelOpen) return null;

  const detail = expandedId ? expandedDetail : null;

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--color-overlay)] backdrop-blur-sm p-4 pt-[10vh]"
        onClick={(e) => { if (e.target === e.currentTarget) toggleWorkflowPanel(); }}
        onKeyDown={(e) => { if (e.key === "Escape") toggleWorkflowPanel(); }}
      >
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="w-full max-w-2xl bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[75vh]"
        >
          {/* Header */}
          <div className="flex items-center gap-3 p-4 border-b border-[var(--color-border)]">
            <GitBranch className="w-5 h-5 text-violet-400" />
            <h2 className="text-base font-semibold text-[var(--color-text)] flex-1">Workflows</h2>
            <kbd className="hidden sm:inline-block text-[10px] text-[var(--color-text-dim)] bg-[var(--color-hover)] px-1.5 py-0.5 rounded border border-[var(--color-border)]">
              ⌘⇧W
            </kbd>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] bg-[var(--color-hover)] hover:bg-[var(--color-active)] rounded-md transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={toggleWorkflowPanel}
              className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] bg-[var(--color-hover)] hover:bg-[var(--color-active)] rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="text-center text-[var(--color-text-muted)] py-8 text-sm">Loading…</div>
            ) : workflows.length === 0 ? (
              <div className="text-center py-12 px-4">
                <GitBranch className="w-10 h-10 text-[var(--color-text-dim)] mx-auto mb-3 opacity-50" />
                <p className="text-sm text-[var(--color-text-muted)] mb-1">No workflows yet</p>
                <p className="text-xs text-[var(--color-text-dim)]">
                  Launch a workflow with <code className="bg-[var(--color-hover)] px-1 rounded">ant workflow launch &lt;recipe-id&gt;</code>
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {workflows.map((wf) => {
                  const expanded = expandedId === wf.id;
                  return (
                    <div
                      key={wf.id}
                      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden"
                    >
                      {/* Card header */}
                      <button
                        onClick={() => handleToggle(wf.id)}
                        className="w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-[var(--color-hover)] transition-colors"
                      >
                        {expanded ? (
                          <ChevronDown className="w-4 h-4 text-[var(--color-text-dim)] flex-shrink-0" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-[var(--color-text-dim)] flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-medium text-[var(--color-text)] truncate">
                              {wf.recipe_name}
                            </span>
                            <StatusBadge status={wf.status} />
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-dim)]">
                            <span className="font-mono">{wf.id}</span>
                            {wf.step_count !== undefined && (
                              <span>{wf.step_count} step{wf.step_count !== 1 ? "s" : ""}</span>
                            )}
                            <span>{new Date(wf.started_at).toLocaleString()}</span>
                          </div>
                        </div>
                        {wf.status === "running" && (
                          <button
                            onClick={(e) => handleCancel(e, wf.id)}
                            className="flex-shrink-0 text-[10px] text-red-400 hover:text-red-300 px-2 py-0.5 rounded border border-red-400/30 hover:border-red-400/60 transition-colors"
                          >
                            Cancel
                          </button>
                        )}
                      </button>

                      {/* Expanded steps */}
                      {expanded && (
                        <div className="border-t border-[var(--color-border)] px-3 py-2">
                          {!detail ? (
                            <div className="text-center py-4 text-xs text-[var(--color-text-muted)]">
                              <Loader2 className="w-4 h-4 animate-spin mx-auto mb-1" />
                              Loading steps…
                            </div>
                          ) : detail.steps && detail.steps.length > 0 ? (
                            <div className="space-y-1.5">
                              {detail.steps.map((step) => (
                                <div
                                  key={step.id}
                                  className="flex items-start gap-2 py-1.5 px-2 rounded-md hover:bg-[var(--color-hover)] group"
                                >
                                  <StepIcon exitCode={step.last_exit_code} />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-[var(--color-text-dim)] flex-shrink-0">
                                        {step.step_index + 1}.
                                      </span>
                                      <span className="text-xs font-medium text-[var(--color-text)] truncate">
                                        {step.step_title}
                                      </span>
                                      {step.last_exit_code !== null && step.last_exit_code !== 0 && (
                                        <span className="text-[10px] text-red-400 flex-shrink-0">
                                          exit {step.last_exit_code}
                                        </span>
                                      )}
                                    </div>
                                    {step.last_command && (
                                      <p className="text-[10px] text-[var(--color-text-dim)] font-mono truncate mt-0.5 ml-5">
                                        $ {step.last_command}
                                      </p>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => {
                                      setActiveSession(step.session_id);
                                      toggleWorkflowPanel();
                                    }}
                                    className="flex-shrink-0 opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-text)] transition-all"
                                    title="Go to session"
                                  >
                                    <Play className="w-3 h-3" />
                                    Open
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-[var(--color-text-muted)] py-2">No steps found.</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
