/**
 * ProtocolCard — renders structured protocol metadata as visual cards
 * within message bubbles. Each protocol type gets a distinct card layout.
 */
import {
  Crown, FileText, Hand, GitBranch, Activity,
  Eye, CheckCircle, XCircle, AlertCircle, Trophy, Terminal,
} from "lucide-react";
import type { ProtocolMetadata, ProtocolType } from "../utils/protocolTypes.ts";
import { protocolLabel, protocolAccent } from "../utils/protocolTypes.ts";
import { getSenderTheme } from "../utils/senderTheme.ts";

interface ProtocolCardProps {
  metadata: ProtocolMetadata;
}

const typeIcons: Record<ProtocolType, typeof Crown> = {
  architect_select: Crown,
  task_brief: FileText,
  offer: Hand,
  assignment: GitBranch,
  status_update: Activity,
  review_request: Eye,
  review_result: CheckCircle,
  completion: Trophy,
  terminal_approval: Terminal,
};

export default function ProtocolCard({ metadata }: ProtocolCardProps) {
  const accent = protocolAccent(metadata.type);
  const label = protocolLabel(metadata.type);
  const Icon = typeIcons[metadata.type] || Activity;

  return (
    <div
      className="rounded-lg border px-3 py-2 mt-2 text-xs"
      style={{
        borderColor: `${accent}33`,
        backgroundColor: `${accent}0a`,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon style={{ width: 14, height: 14, color: accent }} />
        <span className="uppercase tracking-wider font-medium" style={{ color: accent, fontSize: 10 }}>
          {label}
        </span>
      </div>

      {/* Body — varies by type */}
      {metadata.type === "architect_select" && (
        <div>
          <div className="text-white/80">
            <span className="font-medium" style={{ color: getSenderTheme(metadata.architect_type).accent }}>
              {metadata.architect_name}
            </span>
            {" "}selected as architect
          </div>
          <div className="text-white/40 mt-0.5">{metadata.reason}</div>
        </div>
      )}

      {metadata.type === "task_brief" && (
        <div>
          <div className="text-white/80 font-medium mb-1">{metadata.title}</div>
          <div className="space-y-1">
            {metadata.tasks.map((task) => (
              <div key={task.id} className="flex items-start gap-1.5">
                <span className="text-white/30 font-mono">{task.id}</span>
                <span className="text-white/60">{task.description}</span>
                {task.estimated_effort && (
                  <span className="ml-auto text-white/30 text-[10px] shrink-0">{task.estimated_effort}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {metadata.type === "offer" && (
        <div>
          <div className="flex items-center gap-2">
            <span className="text-white/60">Task:</span>
            <span className="font-mono text-white/80">{metadata.task_id}</span>
            <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] ${metadata.available ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}`}>
              {metadata.available ? "Available" : "Busy"}
            </span>
          </div>
          <div className="text-white/50 mt-1">{metadata.capability}</div>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${metadata.confidence * 100}%`, backgroundColor: accent }}
              />
            </div>
            <span className="text-white/40 text-[10px]">{Math.round(metadata.confidence * 100)}% confidence</span>
          </div>
        </div>
      )}

      {metadata.type === "assignment" && (
        <div className="space-y-1.5">
          {(metadata.assignments ?? []).map((a) => (
            <div key={a.task_id} className="flex items-center gap-2">
              <span className="font-mono text-white/50">{a.task_id}</span>
              <span className="text-white/30">→</span>
              <span className="font-medium" style={{ color: getSenderTheme(a.assigned_type).accent }}>
                {a.assigned_to}
              </span>
              {a.branch && (
                <span className="ml-auto font-mono text-[10px] text-white/30">
                  <GitBranch className="w-3 h-3 inline mr-0.5" />{a.branch}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {metadata.type === "status_update" && (
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-white/50">{metadata.task_id}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] ${
              metadata.status === "complete" ? "bg-emerald-500/20 text-emerald-300" :
              metadata.status === "blocked" ? "bg-red-500/20 text-red-300" :
              metadata.status === "failed" ? "bg-red-500/20 text-red-300" :
              "bg-blue-500/20 text-blue-300"
            }`}>
              {metadata.status}
            </span>
          </div>
          {metadata.progress && <div className="text-white/50 mt-1">{metadata.progress}</div>}
          {metadata.blockers && <div className="text-red-300/60 mt-1">{metadata.blockers}</div>}
          {metadata.branch && (
            <div className="text-white/30 mt-1 font-mono text-[10px]">
              <GitBranch className="w-3 h-3 inline mr-0.5" />{metadata.branch}
            </div>
          )}
        </div>
      )}

      {metadata.type === "review_request" && (
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-white/50">{metadata.task_id}</span>
            <span className="font-mono text-[10px] text-white/30">
              <GitBranch className="w-3 h-3 inline mr-0.5" />{metadata.branch}
            </span>
            {metadata.tests_passing !== undefined && (
              <span className={`ml-auto text-[10px] ${metadata.tests_passing ? "text-emerald-300" : "text-red-300"}`}>
                {metadata.tests_passing ? "Tests passing" : "Tests failing"}
              </span>
            )}
          </div>
          <div className="text-white/60 mt-1">{metadata.summary}</div>
          {metadata.files_changed && metadata.files_changed.length > 0 && (
            <div className="text-white/30 mt-1 font-mono text-[10px]">
              {metadata.files_changed.length} file{metadata.files_changed.length !== 1 ? "s" : ""} changed
            </div>
          )}
        </div>
      )}

      {metadata.type === "review_result" && (
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-white/50">{metadata.task_id}</span>
            {metadata.verdict === "approved" && <CheckCircle className="w-4 h-4 text-emerald-400" />}
            {metadata.verdict === "changes_requested" && <AlertCircle className="w-4 h-4 text-amber-400" />}
            {metadata.verdict === "rejected" && <XCircle className="w-4 h-4 text-red-400" />}
            <span className={`text-[10px] uppercase tracking-wider ${
              metadata.verdict === "approved" ? "text-emerald-300" :
              metadata.verdict === "changes_requested" ? "text-amber-300" :
              "text-red-300"
            }`}>
              {metadata.verdict.replace("_", " ")}
            </span>
          </div>
          {metadata.feedback && <div className="text-white/50 mt-1">{metadata.feedback}</div>}
          {metadata.merge && <div className="text-emerald-300/60 mt-1 text-[10px]">Ready to merge</div>}
        </div>
      )}

      {metadata.type === "completion" && (
        <div>
          <div className="text-white/80">{metadata.summary}</div>
          {metadata.tasks_completed.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {metadata.tasks_completed.map((t) => (
                <span key={t} className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px] font-mono">{t}</span>
              ))}
            </div>
          )}
          {metadata.next_steps && metadata.next_steps.length > 0 && (
            <div className="text-white/40 mt-1.5">
              Next: {metadata.next_steps.join(", ")}
            </div>
          )}
        </div>
      )}

      {metadata.type === "terminal_approval" && (
        <div>
          <div className="flex items-center gap-2">
            <span className="text-white/60">Tool:</span>
            <span className="font-mono text-white/80">{metadata.tool_type}</span>
            <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] ${
              metadata.status === "approved" ? "bg-emerald-500/20 text-emerald-300" :
              metadata.status === "rejected" ? "bg-red-500/20 text-red-300" :
              "bg-amber-500/20 text-amber-300"
            }`}>
              {metadata.status}
            </span>
          </div>
          <div className="text-white/50 mt-1 font-mono text-[10px] truncate">{metadata.detail}</div>
          <div className="text-white/40 mt-1 text-[10px]">{metadata.terminal_name}</div>
        </div>
      )}
    </div>
  );
}
