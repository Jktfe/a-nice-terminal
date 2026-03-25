import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Search, Brain, Trash2, ChevronDown, ChevronRight, Tag } from "lucide-react";
import { useStore, apiFetch } from "../store.ts";

interface Digest {
  id: string;
  session_name: string;
  session_type: string;
  summary: string;
  key_learnings: string;
  tags: string;
  session_created_at: string;
  session_archived_at: string | null;
  parsed_at: string;
  parsed_by: string | null;
  source_message_count: number;
  source_output_chunks: number;
}

export default function KnowledgePanel() {
  const { knowledgePanelOpen, toggleKnowledgePanel } = useStore();
  const [query, setQuery] = useState("");
  const [digests, setDigests] = useState<Digest[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadDigests = useCallback(async (q = "") => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      params.set("limit", "50");
      const data = await apiFetch(`/api/retention/digests?${params}`);
      setDigests(data);
    } catch {
      setDigests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (knowledgePanelOpen) loadDigests();
  }, [knowledgePanelOpen, loadDigests]);

  useEffect(() => {
    if (!knowledgePanelOpen) return;
    const timer = setTimeout(() => loadDigests(query), 300);
    return () => clearTimeout(timer);
  }, [query, knowledgePanelOpen, loadDigests]);

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/api/retention/digests/${id}`, { method: "DELETE" });
      setDigests((prev) => prev.filter((d) => d.id !== id));
    } catch { /* ignore */ }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") toggleKnowledgePanel();
  };

  const parseTags = (tags: string): string[] => {
    try { return JSON.parse(tags); } catch { return []; }
  };

  const parseLearnings = (learnings: string): string[] => {
    try { return JSON.parse(learnings); } catch { return []; }
  };

  if (!knowledgePanelOpen) return null;

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--color-overlay)] backdrop-blur-sm p-4 pt-[10vh]"
        onClick={(e) => { if (e.target === e.currentTarget) toggleKnowledgePanel(); }}
        onKeyDown={handleKeyDown}
      >
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="w-full max-w-2xl bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[70vh]"
        >
          {/* Header */}
          <div className="flex items-center gap-3 p-4 border-b border-[var(--color-border)]">
            <Brain className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-semibold text-[var(--color-text)] flex-1">Session Knowledge</h2>
            <kbd className="hidden sm:inline-block text-[10px] text-[var(--color-text-dim)] bg-[var(--color-hover)] px-1.5 py-0.5 rounded border border-[var(--color-border)]">
              ⌘⇧K
            </kbd>
            <button
              onClick={toggleKnowledgePanel}
              className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] bg-[var(--color-hover)] hover:bg-[var(--color-active)] rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Search */}
          <div className="px-4 py-3 border-b border-[var(--color-border)]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-dim)]" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search session knowledge..."
                className="w-full pl-9 pr-3 py-2 bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-dim)] focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="text-center text-[var(--color-text-muted)] py-8 text-sm">Loading...</div>
            ) : digests.length === 0 ? (
              <div className="text-center py-12 px-4">
                <Brain className="w-10 h-10 text-[var(--color-text-dim)] mx-auto mb-3 opacity-50" />
                <p className="text-sm text-[var(--color-text-muted)] mb-1">No session knowledge yet</p>
                <p className="text-xs text-[var(--color-text-dim)]">
                  When archived sessions expire or are manually parsed before deletion, their key learnings appear here.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {digests.map((d) => {
                  const expanded = expandedId === d.id;
                  const tags = parseTags(d.tags);
                  const learnings = parseLearnings(d.key_learnings);

                  return (
                    <div
                      key={d.id}
                      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden"
                    >
                      {/* Card header */}
                      <button
                        onClick={() => setExpandedId(expanded ? null : d.id)}
                        className="w-full text-left px-3 py-2.5 flex items-start gap-2 hover:bg-[var(--color-hover)] transition-colors"
                      >
                        {expanded ? (
                          <ChevronDown className="w-4 h-4 text-[var(--color-text-dim)] mt-0.5 flex-shrink-0" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-[var(--color-text-dim)] mt-0.5 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-[var(--color-text)] truncate">
                              {d.session_name}
                            </span>
                            <span className="text-[10px] text-[var(--color-text-dim)] uppercase px-1.5 py-0.5 bg-[var(--color-hover)] rounded flex-shrink-0">
                              {d.session_type}
                            </span>
                          </div>
                          <p className="text-xs text-[var(--color-text-muted)] line-clamp-2">{d.summary}</p>
                          {tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {tags.map((tag, i) => (
                                <span
                                  key={i}
                                  className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded"
                                >
                                  <Tag className="w-2.5 h-2.5" />
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </button>

                      {/* Expanded content */}
                      {expanded && (
                        <div className="px-3 pb-3 pt-0 border-t border-[var(--color-border)]">
                          {learnings.length > 0 && (
                            <div className="mt-2">
                              <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mb-1.5">
                                Key Learnings
                              </p>
                              <ul className="space-y-1">
                                {learnings.map((l, i) => (
                                  <li key={i} className="text-xs text-[var(--color-text-muted)] flex items-start gap-1.5">
                                    <span className="text-emerald-400 mt-0.5">•</span>
                                    {l}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          <div className="flex items-center justify-between mt-3 pt-2 border-t border-[var(--color-border)]">
                            <div className="text-[10px] text-[var(--color-text-dim)] space-x-3">
                              <span>Parsed: {new Date(d.parsed_at).toLocaleDateString()}</span>
                              {d.parsed_by && <span>Model: {d.parsed_by}</span>}
                              {d.source_output_chunks > 0 && <span>{d.source_output_chunks} chunks</span>}
                              {d.source_message_count > 0 && <span>{d.source_message_count} messages</span>}
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDelete(d.id); }}
                              className="p-1 text-[var(--color-text-dim)] hover:text-red-400 rounded transition-colors"
                              title="Delete digest"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
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
