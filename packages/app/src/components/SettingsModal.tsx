import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Save, AlertCircle } from "lucide-react";
import { useStore, apiFetch } from "../store.ts";
import { terminalThemes } from "../themes.ts";

export default function SettingsModal() {
  const { settingsOpen, toggleSettings, terminalFontSize, terminalTheme, setTerminalFontSize, setTerminalTheme } = useStore();
  const [port, setPort] = useState("");
  const [rootDir, setRootDir] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [vaultPath, setVaultPath] = useState("");
  const [vaultSaved, setVaultSaved] = useState(false);

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
      try {
        const obsidian = await apiFetch("/api/settings/obsidian");
        setVaultPath(obsidian.vault_path || "");
      } catch {
        // Chat sidecar may not be running yet
      }
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

  const saveVaultPath = async () => {
    try {
      await apiFetch("/api/settings/obsidian", {
        method: "PATCH",
        body: JSON.stringify({ vault_path: vaultPath }),
      });
      setVaultSaved(true);
      setTimeout(() => setVaultSaved(false), 2000);
    } catch (err: any) {
      setError(err.message || "Failed to save Obsidian vault path");
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
                {/* Server settings */}
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

                {/* Terminal section */}
                <div className="border-t border-[var(--color-border)] pt-4 mt-1">
                  <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider mb-3">
                    Terminal
                  </h3>

                  <div className="flex flex-col gap-1.5 mb-4">
                    <label className="text-sm font-medium text-white/80">
                      Font Size
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={10}
                        max={20}
                        step={1}
                        value={terminalFontSize}
                        onChange={(e) => setTerminalFontSize(Number(e.target.value))}
                        className="flex-1 accent-emerald-500"
                      />
                      <span className="text-sm text-white/60 w-8 text-right tabular-nums">
                        {terminalFontSize}px
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-white/80">
                      Colour Scheme
                    </label>
                    <select
                      value={terminalTheme}
                      onChange={(e) => setTerminalTheme(e.target.value)}
                      className="bg-black/20 border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      {terminalThemes.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Obsidian vault */}
                <div className="border-t border-[var(--color-border)] pt-4 mt-1">
                  <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider mb-3">
                    Integrations
                  </h3>
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-wider text-white/40">Obsidian Vault Path</label>
                    <div className="flex gap-2">
                      <input
                        value={vaultPath}
                        onChange={(e) => setVaultPath(e.target.value)}
                        placeholder="/Users/james/Obsidian/MyVault"
                        className="flex-1 rounded border border-white/15 bg-[var(--color-bg)] px-3 py-1.5 text-sm text-white placeholder-white/30 outline-none"
                      />
                      <button
                        onClick={saveVaultPath}
                        className="px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 text-sm"
                      >
                        {vaultSaved ? "Saved!" : "Save"}
                      </button>
                    </div>
                  </div>
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
