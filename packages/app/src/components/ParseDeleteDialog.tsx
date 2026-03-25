import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Trash2, Brain, Loader2, AlertCircle } from "lucide-react";
import { useStore, apiFetch } from "../store.ts";

export default function ParseDeleteDialog() {
  const { parseDeleteSessionId, closeParseDeleteDialog, deleteSession, sessions } = useStore();
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<{ summary: string; factsEmitted: number } | null>(null);

  const session = sessions.find((s) => s.id === parseDeleteSessionId);

  const handleStraightDelete = async () => {
    if (!parseDeleteSessionId) return;
    await deleteSession(parseDeleteSessionId);
    closeParseDeleteDialog();
  };

  const handleParseAndDelete = async () => {
    if (!parseDeleteSessionId) return;
    setParsing(true);
    setError(null);

    try {
      const result = await apiFetch(`/api/sessions/${parseDeleteSessionId}/parse`, {
        method: "POST",
      });
      setParseResult({ summary: result.digest?.summary || "Parsed successfully", factsEmitted: result.factsEmitted || 0 });

      // Now delete
      await deleteSession(parseDeleteSessionId);
      // Brief pause to show success before closing
      setTimeout(() => {
        closeParseDeleteDialog();
        setParseResult(null);
      }, 1500);
    } catch (err: any) {
      setError(err.message || "LLM parsing failed");
      setParsing(false);
    }
  };

  const handleDeleteAnyway = async () => {
    if (!parseDeleteSessionId) return;
    await deleteSession(parseDeleteSessionId);
    closeParseDeleteDialog();
    setError(null);
  };

  const handleClose = () => {
    closeParseDeleteDialog();
    setError(null);
    setParseResult(null);
    setParsing(false);
  };

  if (!parseDeleteSessionId) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] backdrop-blur-sm p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="w-full max-w-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl flex flex-col overflow-hidden"
        >
          <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
            <h2 className="text-base font-semibold text-[var(--color-text)]">Delete Session</h2>
            <button
              onClick={handleClose}
              className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] bg-[var(--color-hover)] hover:bg-[var(--color-active)] rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 flex flex-col gap-4">
            <p className="text-sm text-[var(--color-text-muted)]">
              <span className="font-medium text-[var(--color-text)]">{session?.name || "Session"}</span>
              {" "}will be permanently deleted.
            </p>

            {parseResult && (
              <div className="p-3 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg text-sm">
                <p className="font-medium mb-1">Knowledge extracted</p>
                <p className="text-xs text-emerald-400/80">{parseResult.summary}</p>
                <p className="text-xs text-emerald-400/60 mt-1">{parseResult.factsEmitted} fact(s) saved</p>
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <div className="flex items-center gap-2 text-red-400 text-sm mb-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <p>LLM unavailable: {error}</p>
                </div>
                <button
                  onClick={handleDeleteAnyway}
                  className="text-xs text-red-400/80 hover:text-red-400 underline"
                >
                  Delete without parsing
                </button>
              </div>
            )}

            {parsing && !parseResult && (
              <div className="flex items-center gap-2 text-[var(--color-text-muted)] text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Extracting knowledge from session...</span>
              </div>
            )}
          </div>

          {!parsing && !parseResult && !error && (
            <div className="p-4 border-t border-[var(--color-border)] flex flex-col gap-2 bg-[var(--color-input-bg)]">
              <button
                onClick={handleParseAndDelete}
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-sm font-medium rounded-lg transition-colors"
              >
                <Brain className="w-4 h-4" />
                Parse & Delete
              </button>
              <button
                onClick={handleStraightDelete}
                className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium rounded-lg transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Straight Delete
              </button>
              <button
                onClick={handleClose}
                className="w-full px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
