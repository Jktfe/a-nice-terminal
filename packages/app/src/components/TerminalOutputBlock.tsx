import { useState } from "react";
import { ChevronDown, ChevronUp, Copy, Check, Terminal } from "lucide-react";
import type { Message } from "../store.ts";

const MAX_COLLAPSED_LINES = 6;

interface TerminalOutputBlockProps {
  message: Message;
}

export default function TerminalOutputBlock({ message }: TerminalOutputBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const meta = typeof message.metadata === "string"
    ? JSON.parse(message.metadata)
    : message.metadata || {};

  const command = meta.command || "unknown command";
  const exitCode = meta.exit_code;
  const durationMs = meta.duration_ms;
  const cwd = meta.cwd;
  const output = message.content || "";
  const lines = output.split("\n");
  const isLong = lines.length > MAX_COLLAPSED_LINES;
  const displayLines = expanded || !isLong ? lines : lines.slice(0, MAX_COLLAPSED_LINES);

  const isSuccess = exitCode === 0;
  const isFailure = exitCode !== null && exitCode !== 0;
  const isRunning = exitCode === null || exitCode === undefined;

  const durationLabel = durationMs != null
    ? durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`
    : null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`$ ${command}\n${output}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const timestamp = message.created_at
    ? new Date(message.created_at + "Z").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "";

  return (
    <div className="my-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden font-mono text-sm">
      {/* Command header */}
      <div
        className="flex items-center gap-2 px-3 py-2 bg-[var(--color-hover)] border-b border-[var(--color-border)] cursor-pointer select-none"
        onClick={() => isLong && setExpanded(!expanded)}
      >
        <Terminal className="w-3.5 h-3.5 text-[var(--color-text-muted)] flex-shrink-0" />
        <code className="text-[var(--color-text)] font-semibold truncate flex-1">
          $ {command}
        </code>

        {/* Exit code badge */}
        {isSuccess && (
          <span className="px-1.5 py-0.5 text-xs rounded bg-emerald-500/20 text-emerald-400 font-medium">
            0
          </span>
        )}
        {isFailure && (
          <span className="px-1.5 py-0.5 text-xs rounded bg-red-500/20 text-red-400 font-medium">
            {exitCode}
          </span>
        )}
        {isRunning && (
          <span className="px-1.5 py-0.5 text-xs rounded bg-yellow-500/20 text-yellow-400 font-medium">
            running
          </span>
        )}

        {durationLabel && (
          <span className="text-xs text-[var(--color-text-dim)]">{durationLabel}</span>
        )}

        <button
          onClick={(e) => { e.stopPropagation(); handleCopy(); }}
          className="p-1 rounded hover:bg-[var(--color-active)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          title="Copy command + output"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Output body */}
      {output.trim() && (
        <div className="px-3 py-2 overflow-x-auto">
          <div className="flex">
            {/* Timestamp gutter */}
            {timestamp && (
              <div className="pr-3 text-xs text-[var(--color-text-dim)] select-none flex-shrink-0 pt-0.5">
                {timestamp}
              </div>
            )}
            {/* Output lines */}
            <pre className="whitespace-pre-wrap break-words text-[var(--color-text)] flex-1 leading-relaxed">
              {displayLines.join("\n")}
            </pre>
          </div>

          {/* Expand/collapse */}
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 mt-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              {expanded ? (
                <>
                  <ChevronUp className="w-3 h-3" />
                  Collapse ({lines.length} lines)
                </>
              ) : (
                <>
                  <ChevronDown className="w-3 h-3" />
                  Show {lines.length - MAX_COLLAPSED_LINES} more lines
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* CWD footer */}
      {cwd && (
        <div className="px-3 py-1 text-xs text-[var(--color-text-dim)] border-t border-[var(--color-border)] bg-[var(--color-hover)]">
          {cwd}
        </div>
      )}
    </div>
  );
}
