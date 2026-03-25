import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Zap, Copy, Plus, Trash2, Check } from "lucide-react";
import { useStore, apiFetch } from "../store.ts";

interface CommonCall {
  id: string;
  name: string;
  command: string;
  sort_order: number;
  created_at: string;
}

export default function CommonCallsPanel() {
  const { commonCallsOpen, toggleCommonCalls } = useStore();
  const [calls, setCalls] = useState<CommonCall[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [copied, setCopied] = useState(false);

  const loadCalls = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/api/common-calls");
      setCalls(data);
    } catch {
      setCalls([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (commonCallsOpen) {
      loadCalls();
      setSelectedIds(new Set());
      setCopied(false);
      setAdding(false);
    }
  }, [commonCallsOpen, loadCalls]);

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => {
      toggleCommonCalls();
      setCopied(false);
    }, 400);
  };

  const handleSingleClick = (call: CommonCall) => {
    if (selectedIds.size > 0) {
      // In multi-select mode, toggle the checkbox instead
      toggleSelect(call.id);
      return;
    }
    copyToClipboard(call.command);
  };

  const handleCopySelected = () => {
    const selected = calls.filter((c) => selectedIds.has(c.id));
    const combined = selected.map((c) => c.command).join(" && ");
    copyToClipboard(combined);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = async () => {
    if (!newName.trim() || !newCommand.trim()) return;
    try {
      const created = await apiFetch("/api/common-calls", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), command: newCommand.trim() }),
      });
      setCalls((prev) => [...prev, created]);
      setNewName("");
      setNewCommand("");
      setAdding(false);
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/api/common-calls/${id}`, { method: "DELETE" });
      setCalls((prev) => prev.filter((c) => c.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch { /* ignore */ }
  };

  if (!commonCallsOpen) return null;

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--color-overlay)] backdrop-blur-sm p-4 pt-[10vh]"
        onClick={(e) => { if (e.target === e.currentTarget) toggleCommonCalls(); }}
        onKeyDown={(e) => { if (e.key === "Escape") toggleCommonCalls(); }}
      >
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="w-full max-w-md bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[60vh]"
        >
          {/* Header */}
          <div className="flex items-center gap-3 p-4 border-b border-[var(--color-border)]">
            <Zap className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-semibold text-[var(--color-text)] flex-1">Common Calls</h2>
            <kbd className="hidden sm:inline-block text-[10px] text-[var(--color-text-dim)] bg-[var(--color-hover)] px-1.5 py-0.5 rounded border border-[var(--color-border)]">
              ⌘⇧C
            </kbd>
            <button
              onClick={toggleCommonCalls}
              className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] bg-[var(--color-hover)] hover:bg-[var(--color-active)] rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="text-center text-[var(--color-text-muted)] py-8 text-sm">Loading...</div>
            ) : calls.length === 0 && !adding ? (
              <div className="text-center py-10 px-4">
                <Zap className="w-8 h-8 text-[var(--color-text-dim)] mx-auto mb-3 opacity-50" />
                <p className="text-sm text-[var(--color-text-muted)] mb-1">No common calls yet</p>
                <p className="text-xs text-[var(--color-text-dim)]">
                  Add frequently-used commands for quick copying.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {calls.map((call) => (
                  <div
                    key={call.id}
                    className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 group hover:bg-[var(--color-hover)] transition-colors"
                    title={call.command}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(call.id)}
                      onChange={() => toggleSelect(call.id)}
                      className="w-3.5 h-3.5 rounded border-[var(--color-border)] accent-emerald-500 flex-shrink-0 cursor-pointer"
                    />
                    <button
                      onClick={() => handleSingleClick(call)}
                      className="flex-1 text-left text-sm font-medium text-[var(--color-text)] truncate"
                    >
                      {call.name}
                    </button>
                    <span className="hidden group-hover:inline-block text-[10px] text-[var(--color-text-dim)] max-w-[150px] truncate">
                      {call.command}
                    </span>
                    <button
                      onClick={() => handleDelete(call.id)}
                      className="p-1 text-[var(--color-text-dim)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add form */}
            {adding && (
              <div className="mt-2 p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 space-y-2">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Name (e.g. Go to ANT)"
                  className="w-full bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-dim)] focus:outline-none focus:border-emerald-500/50"
                  onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setAdding(false); }}
                />
                <input
                  value={newCommand}
                  onChange={(e) => setNewCommand(e.target.value)}
                  placeholder="Command (e.g. cd ~/CascadeProjects/a-nice-terminal)"
                  className="w-full bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-sm text-[var(--color-text)] font-mono placeholder:text-[var(--color-text-dim)] focus:outline-none focus:border-emerald-500/50"
                  onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setAdding(false); }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleAdd}
                    disabled={!newName.trim() || !newCommand.trim()}
                    className="px-3 py-1.5 text-xs font-medium bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded-lg disabled:opacity-30 transition-colors"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setAdding(false); setNewName(""); setNewCommand(""); }}
                    className="px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-[var(--color-border)] flex items-center gap-2 bg-[var(--color-input-bg)]">
            {!adding && (
              <button
                onClick={() => setAdding(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)] rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            )}
            <div className="flex-1" />
            {selectedIds.size > 0 && (
              <button
                onClick={handleCopySelected}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded-lg transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copied!" : `Copy Selected (${selectedIds.size})`}
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
