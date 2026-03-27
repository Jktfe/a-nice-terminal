import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Crown, Power, AlertTriangle } from "lucide-react";
import { useStore, apiFetch } from "../store.ts";

export default function ChairmanPanel() {
  const { chairmanPanelOpen, toggleChairmanPanel } = useStore();
  const [enabled, setEnabled] = useState(false);
  const [currentModel, setCurrentModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!chairmanPanelOpen) return;
    apiFetch("/api/chairman/status")
      .then((data) => {
        setEnabled(data.enabled);
        setCurrentModel(data.model);
      })
      .catch(() => {});

    setLoadingModels(true);
    setModelsError(null);
    apiFetch("/api/chairman/models")
      .then((data) => setModels(data.models))
      .catch(() => setModelsError("Cannot reach LM Studio"))
      .finally(() => setLoadingModels(false));
  }, [chairmanPanelOpen]);

  const handleToggle = async () => {
    setSaving(true);
    try {
      const data = await apiFetch("/api/chairman/toggle", { method: "POST" });
      setEnabled(data.enabled);
    } finally {
      setSaving(false);
    }
  };

  const handleModelChange = async (model: string) => {
    setCurrentModel(model);
    await apiFetch("/api/chairman/model", {
      method: "POST",
      body: JSON.stringify({ model }),
    }).catch(() => {});
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") toggleChairmanPanel();
  };

  if (!chairmanPanelOpen) return null;

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--color-overlay)] backdrop-blur-sm p-4 pt-[8vh]"
        onClick={(e) => {
          if (e.target === e.currentTarget) toggleChairmanPanel();
        }}
        onKeyDown={handleKeyDown}
      >
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="w-full max-w-md bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)]">
            <Crown className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-[var(--color-text)] flex-1">
              Chairman
            </h2>
            <kbd className="hidden sm:inline-block text-[10px] text-[var(--color-text-dim)] bg-[var(--color-hover)] px-1.5 py-0.5 rounded border border-[var(--color-border)]">
              ⌘⇧H
            </kbd>
            <button
              onClick={toggleChairmanPanel}
              className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] bg-[var(--color-hover)] hover:bg-[var(--color-active)] rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-4 flex flex-col gap-4">
            {/* Toggle row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    enabled ? "bg-amber-400 animate-pulse" : "bg-[var(--color-text-dim)]"
                  }`}
                />
                <span className="text-sm text-[var(--color-text)]">
                  {enabled ? "Chairman Active" : "Chairman Standby"}
                </span>
              </div>
              <button
                onClick={handleToggle}
                disabled={saving}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  enabled
                    ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                    : "bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:bg-[var(--color-active)] hover:text-[var(--color-text)]"
                } disabled:opacity-40`}
              >
                <Power className="w-3 h-3" />
                {saving ? "..." : enabled ? "Disable" : "Enable"}
              </button>
            </div>

            {/* Model selector */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] font-semibold">
                LM Studio Model
              </label>
              {modelsError ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-300">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  {modelsError}
                </div>
              ) : loadingModels ? (
                <div className="px-3 py-2 text-xs text-[var(--color-text-dim)]">
                  Loading models...
                </div>
              ) : (
                <select
                  value={currentModel}
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text)] focus:outline-none focus:border-amber-500/50 appearance-none cursor-pointer"
                >
                  {models.length === 0 && currentModel && (
                    <option value={currentModel}>{currentModel}</option>
                  )}
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Info */}
            <div className="text-[11px] text-[var(--color-text-dim)] leading-relaxed border-t border-[var(--color-border)] pt-3">
              <p className="mb-1.5">
                <strong className="text-[var(--color-text-muted)]">@Chatlead</strong> routes tasks
                to agents based on domain:
              </p>
              <div className="flex flex-col gap-0.5 ml-2">
                <span>ANT tasks → @ANTClaude / @ANTGem</span>
                <span>MMD tasks → @MMDClaude / @MMDGem</span>
              </div>
              <p className="mt-2 text-[10px]">
                Trigger with <code className="px-1 py-0.5 bg-[var(--color-hover)] border border-[var(--color-border)] rounded">@chatlead</code> or{" "}
                <code className="px-1 py-0.5 bg-[var(--color-hover)] border border-[var(--color-border)] rounded">assign this</code> in chat.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
