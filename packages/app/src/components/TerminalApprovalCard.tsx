/**
 * TerminalApprovalCard — rendered in MessageBubble when
 * metadata.type === "terminal_approval".
 *
 * Shows tool type, command detail, and three action buttons.
 * After approve/reject, buttons are replaced by a resolved badge.
 * View expands an inline terminal screenshot below the buttons.
 */
import { useState } from "react";
import { Terminal, Check, X, Eye, Loader2 } from "lucide-react";
import { apiFetch } from "../store.ts";
import type { TerminalApprovalMetadata } from "../utils/protocolTypes.ts";

interface TerminalApprovalCardProps {
  metadata: TerminalApprovalMetadata;
  messageId: string;
  sessionId: string;
}

export default function TerminalApprovalCard({
  metadata,
  messageId,
  sessionId,
}: TerminalApprovalCardProps) {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">(metadata.status);
  const [loading, setLoading] = useState<"approve" | "reject" | "view" | null>(null);
  const [screenLines, setScreenLines] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAction(action: "approve" | "reject" | "view") {
    setLoading(action);
    setError(null);
    try {
      const res = await apiFetch("/api/chairman/terminal-action", {
        method: "POST",
        body: JSON.stringify({
          terminal_id: metadata.terminal_id,
          action,
          message_id: messageId,
          session_id: sessionId,
        }),
      });
      if (action === "view") {
        setScreenLines(res.lines ?? []);
      } else {
        setStatus(action === "approve" ? "approved" : "rejected");
      }
    } catch (err: any) {
      setError(err.message ?? "Action failed");
    } finally {
      setLoading(null);
    }
  }

  const accent = "#f59e0b"; // amber — matches Chairman colour scheme

  return (
    <div
      className="rounded-lg border px-3 py-2 mt-2 text-xs"
      style={{ borderColor: `${accent}33`, backgroundColor: `${accent}0a` }}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <Terminal style={{ width: 14, height: 14, color: accent }} />
        <span
          className="uppercase tracking-wider font-medium"
          style={{ color: accent, fontSize: 10 }}
        >
          Terminal Approval
        </span>
        <span
          className={`ml-auto px-1.5 py-0.5 rounded text-[9px] font-medium ${
            status === "pending"
              ? "bg-amber-500/20 text-amber-300"
              : status === "approved"
              ? "bg-emerald-500/20 text-emerald-300"
              : "bg-red-500/20 text-red-300"
          }`}
        >
          {status.toUpperCase()}
        </span>
      </div>

      {/* Tool + detail */}
      <div className="mb-2">
        <span className="font-mono text-white/50 mr-1.5">{metadata.tool_type}</span>
        {metadata.detail && (
          <code className="text-white/70 break-all">{metadata.detail}</code>
        )}
        <div className="text-white/30 text-[10px] mt-0.5">{metadata.terminal_name}</div>
      </div>

      {/* Actions */}
      {status === "pending" ? (
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleAction("approve")}
            disabled={loading !== null}
            className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40 transition-colors"
          >
            {loading === "approve" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Check className="w-3 h-3" />
            )}
            Approve
          </button>
          <button
            onClick={() => handleAction("reject")}
            disabled={loading !== null}
            className="flex items-center gap-1 px-2 py-1 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 disabled:opacity-40 transition-colors"
          >
            {loading === "reject" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <X className="w-3 h-3" />
            )}
            Reject
          </button>
          <button
            onClick={() => handleAction("view")}
            disabled={loading !== null}
            className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 text-white/50 hover:bg-white/10 disabled:opacity-40 transition-colors"
          >
            {loading === "view" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Eye className="w-3 h-3" />
            )}
            View
          </button>
        </div>
      ) : (
        <div className={`flex items-center gap-1.5 ${status === "approved" ? "text-emerald-300" : "text-red-300"}`}>
          {status === "approved" ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
          <span className="text-[11px] font-medium">
            {status === "approved" ? "Approved" : "Rejected"}
          </span>
        </div>
      )}

      {/* Inline error */}
      {error && (
        <div className="mt-2 text-[10px] text-red-400">{error} — try again</div>
      )}

      {/* Screen snapshot (view action) */}
      {screenLines && screenLines.length > 0 && (
        <pre className="mt-2 p-2 bg-black/40 rounded text-[10px] text-white/60 font-mono overflow-x-auto max-h-48 overflow-y-auto leading-snug">
          {screenLines.join("\n")}
        </pre>
      )}
    </div>
  );
}
