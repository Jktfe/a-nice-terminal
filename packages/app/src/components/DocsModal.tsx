import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Search, Terminal as TerminalIcon, Wrench } from "lucide-react";
import { useStore } from "../store.ts";
import { mcpTools, cliCommands, mcpCategories, cliCategories, type DocEntry } from "../docs.ts";

type Tab = "cli" | "mcp";

export default function DocsModal() {
  const { docsOpen, toggleDocs } = useStore();
  const [tab, setTab] = useState<Tab>("cli");
  const [query, setQuery] = useState("");

  const entries = tab === "cli" ? cliCommands : mcpTools;
  const categories = tab === "cli" ? cliCategories : mcpCategories;

  const filtered = useMemo(() => {
    if (!query.trim()) return entries;
    const q = query.toLowerCase();
    return entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q)
    );
  }, [entries, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, DocEntry[]>();
    for (const cat of categories) {
      const items = filtered.filter((e) => e.category === cat);
      if (items.length > 0) map.set(cat, items);
    }
    return map;
  }, [filtered, categories]);

  if (!docsOpen) return null;

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] backdrop-blur-sm p-4"
        onClick={toggleDocs}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="w-full max-w-2xl max-h-[80vh] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
            <h2 className="text-lg font-semibold text-[var(--color-text)]">Documentation</h2>
            <button
              onClick={toggleDocs}
              className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] bg-[var(--color-hover)] hover:bg-[var(--color-active)] rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Tabs + Search */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)]">
            <div className="flex gap-1">
              <button
                onClick={() => { setTab("cli"); setQuery(""); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  tab === "cli"
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]"
                }`}
              >
                <TerminalIcon className="w-3 h-3" />
                CLI Commands
              </button>
              <button
                onClick={() => { setTab("mcp"); setQuery(""); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  tab === "mcp"
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]"
                }`}
              >
                <Wrench className="w-3 h-3" />
                MCP Tools
              </button>
            </div>
            <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 bg-[var(--color-input-bg)] rounded-lg border border-[var(--color-border)] focus-within:border-emerald-500/40 transition-colors">
              <Search className="w-3 h-3 text-[var(--color-text-dim)] flex-shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Filter ${tab === "cli" ? "commands" : "tools"}...`}
                className="flex-1 bg-transparent text-xs text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-dim)]"
              />
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {grouped.size === 0 && (
              <div className="text-center text-[var(--color-text-dim)] text-xs py-8">
                No results found.
              </div>
            )}

            {[...grouped.entries()].map(([category, items]) => (
              <div key={category}>
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)] mb-2">
                  {category}
                </h3>
                <div className="space-y-2">
                  {items.map((entry) => (
                    <EntryCard key={entry.name} entry={entry} tab={tab} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-dim)]">
            {tab === "cli" ? `${cliCommands.length} commands` : `${mcpTools.length} tools`}
            {" · "}
            <kbd className="px-1 py-0.5 bg-[var(--color-hover)] rounded border border-[var(--color-border)]">Cmd+/</kbd>
            {" to toggle"}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

function EntryCard({ entry, tab }: { entry: DocEntry; tab: Tab }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = entry.params.length > 0 || entry.example;

  return (
    <div
      className={`rounded-lg border border-[var(--color-border)] overflow-hidden transition-colors ${
        hasDetails ? "cursor-pointer" : ""
      }`}
      onClick={() => hasDetails && setExpanded((v) => !v)}
    >
      <div className="flex items-start gap-2 px-3 py-2">
        <code className="text-xs font-mono text-emerald-400 flex-shrink-0 pt-0.5">
          {tab === "cli" ? `ant ${entry.name}` : entry.name}
        </code>
        <span className="text-xs text-[var(--color-text-muted)] flex-1">
          {entry.description}
        </span>
        {hasDetails && (
          <span className="text-[10px] text-[var(--color-text-dim)] flex-shrink-0">
            {expanded ? "▴" : "▾"}
          </span>
        )}
      </div>

      {expanded && (
        <div className="px-3 pb-2 border-t border-[var(--color-border)]">
          {entry.params.length > 0 && (
            <table className="w-full mt-2 text-[11px]">
              <thead>
                <tr className="text-left text-[var(--color-text-dim)]">
                  <th className="pb-1 pr-3 font-medium">Param</th>
                  <th className="pb-1 pr-3 font-medium">Type</th>
                  <th className="pb-1 font-medium">Description</th>
                </tr>
              </thead>
              <tbody>
                {entry.params.map((p) => (
                  <tr key={p.name} className="text-[var(--color-text-muted)]">
                    <td className="py-0.5 pr-3 font-mono text-[var(--color-text)]">
                      {p.name}
                      {p.required && <span className="text-red-400 ml-0.5">*</span>}
                    </td>
                    <td className="py-0.5 pr-3 text-[var(--color-text-dim)]">{p.type}</td>
                    <td className="py-0.5">{p.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {entry.example && (
            <div className="mt-2 px-2 py-1.5 bg-[var(--color-input-bg)] rounded text-[11px] font-mono text-[var(--color-text-muted)]">
              {entry.example}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
