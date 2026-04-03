import { useState } from "react";
import { ChevronDown, ChevronRight, Clock, Folder, CheckCircle, XCircle, Loader } from "lucide-react";

export interface CommandEvent {
  id: string;
  session_id: string;
  command: string;
  exit_code: number | null;
  output: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  cwd: string | null;
  detection_method: string;
}

interface CommandBlockProps {
  event: CommandEvent;
  /** Collapse output by default when output exceeds this many lines. */
  collapseThreshold?: number;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function cwdLabel(cwd: string | null): string {
  if (!cwd) return "";
  // Show last 2 path segments for readability
  const parts = cwd.replace(/\/$/, "").split("/");
  return parts.slice(-2).join("/");
}

// Strip ANSI escape sequences for display in plain-text mode.
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-Za-z]/g;
function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

export default function CommandBlock({ event, collapseThreshold = 30 }: CommandBlockProps) {
  const outputLines = event.output ? stripAnsi(event.output).split("\n") : [];
  const isLong = outputLines.length > collapseThreshold;
  const [expanded, setExpanded] = useState(!isLong);

  const running = !event.completed_at;
  const failed = !running && event.exit_code !== null && event.exit_code !== 0;
  const success = !running && event.exit_code === 0;

  const headerBg = running
    ? "bg-blue-950/40 border-blue-700/30"
    : failed
    ? "bg-red-950/40 border-red-700/30"
    : "bg-zinc-900/60 border-zinc-700/30";

  const statusIcon = running ? (
    <Loader className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
  ) : failed ? (
    <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
  ) : success ? (
    <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
  ) : (
    <div className="w-3.5 h-3.5 rounded-full bg-zinc-600 shrink-0" />
  );

  return (
    <div className="rounded-lg border border-zinc-700/40 overflow-hidden font-mono text-sm mb-2">
      {/* Header row */}
      <button
        onClick={() => outputLines.length > 0 && setExpanded((e) => !e)}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-left border-b ${headerBg} cursor-default select-text`}
        style={{ cursor: outputLines.length > 0 ? "pointer" : "default" }}
      >
        {/* Collapse chevron */}
        {outputLines.length > 0 ? (
          expanded ? (
            <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-zinc-500 shrink-0" />
          )
        ) : (
          <div className="w-3 h-3 shrink-0" />
        )}

        {statusIcon}

        {/* Command */}
        <span className="flex-1 text-zinc-100 truncate">
          <span className="text-emerald-400 mr-1 select-none">❯</span>
          {event.command}
        </span>

        {/* CWD */}
        {event.cwd && (
          <span className="flex items-center gap-1 text-zinc-500 text-xs shrink-0 hidden sm:flex">
            <Folder className="w-3 h-3" />
            {cwdLabel(event.cwd)}
          </span>
        )}

        {/* Duration */}
        {event.duration_ms !== null && (
          <span className="flex items-center gap-1 text-zinc-500 text-xs shrink-0">
            <Clock className="w-3 h-3" />
            {formatDuration(event.duration_ms)}
          </span>
        )}

        {/* Exit code badge */}
        {!running && event.exit_code !== null && event.exit_code !== 0 && (
          <span className="text-xs bg-red-900/60 text-red-300 px-1.5 py-0.5 rounded shrink-0">
            exit {event.exit_code}
          </span>
        )}
      </button>

      {/* Output body */}
      {expanded && outputLines.length > 0 && (
        <div className="bg-zinc-950/80">
          {isLong && (
            <div className="px-3 py-1 text-xs text-zinc-500 border-b border-zinc-800 flex justify-between">
              <span>{outputLines.length} lines</span>
              <button
                onClick={() => setExpanded(false)}
                className="text-zinc-400 hover:text-zinc-200"
              >
                collapse
              </button>
            </div>
          )}
          <pre className="px-3 py-2 text-xs text-zinc-300 overflow-x-auto whitespace-pre-wrap break-words leading-relaxed max-h-[60vh] overflow-y-auto">
            {outputLines.join("\n")}
          </pre>
        </div>
      )}

      {/* Collapsed summary */}
      {!expanded && outputLines.length > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full px-3 py-1 text-xs text-zinc-500 hover:text-zinc-300 text-left bg-zinc-950/40 hover:bg-zinc-900/60 transition-colors"
        >
          {outputLines.length} lines — click to expand
        </button>
      )}
    </div>
  );
}
