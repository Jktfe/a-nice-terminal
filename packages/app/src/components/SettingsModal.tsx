import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Save, AlertCircle } from "lucide-react";
import { useStore, apiFetch } from "../store.ts";

export default function SettingsModal() {
  const { settingsOpen, toggleSettings } = useStore();
  const [port, setPort] = useState("");
  const [rootDir, setRootDir] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (settingsOpen) {
      loadSettings();
    } else {
      setSuccessMsg(null);
      setError(null);
    }
  }, [settingsOpen]);

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch("/api/settings");
      setPort(data.ANT_PORT || "3000");
      setRootDir(data.ANT_ROOT_DIR || "");
    } catch (err: any) {
      setError(err.message || "Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await apiFetch("/api/settings", {
        method: "POST",
        body: JSON.stringify({ ANT_PORT: port, ANT_ROOT_DIR: rootDir }),
      });
      setSuccessMsg("Settings saved. Please restart the ANT server to apply changes.");
    } catch (err: any) {
      setError(err.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (!settingsOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="w-full max-w-md bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl flex flex-col overflow-hidden"
        >
          <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
            <h2 className="text-lg font-semibold text-white">Settings</h2>
            <button
              onClick={toggleSettings}
              className="p-1.5 text-white/50 hover:text-white bg-white/5 hover:bg-white/10 rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-6 flex flex-col gap-5 overflow-y-auto max-h-[70vh]">
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <p>{error}</p>
              </div>
            )}
            
            {successMsg && (
              <div className="flex items-center gap-2 p-3 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <p>{successMsg}</p>
              </div>
            )}

            {loading ? (
              <div className="text-center text-white/40 py-8">Loading settings...</div>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-white/80">
                    Server Port (ANT_PORT)
                  </label>
                  <input
                    type="text"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    placeholder="3000"
                    className="bg-black/20 border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                  />
                  <p className="text-xs text-white/40">
                    The port ANT will listen on. Default is 3000.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-white/80">
                    Terminal Root Directory (ANT_ROOT_DIR)
                  </label>
                  <input
                    type="text"
                    value={rootDir}
                    onChange={(e) => setRootDir(e.target.value)}
                    placeholder="~/CascadeProjects"
                    className="bg-black/20 border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                  />
                  <p className="text-xs text-white/40">
                    The default folder where new terminal sessions will start.
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="p-4 border-t border-[var(--color-border)] flex justify-end gap-3 bg-black/20">
            <button
              onClick={toggleSettings}
              className="px-4 py-2 text-sm font-medium text-white/70 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={loading || saving}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Save className="w-4 h-4" />
              {saving ? "Saving..." : "Save Settings"}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
