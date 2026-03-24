import { useEffect, useState } from "react";
import { Terminal, MessageSquare, Layers, Clock, Zap, Shield } from "lucide-react";
import { useStore, apiFetch } from "../store.ts";

interface DashboardSession {
  id: string;
  name: string;
  type: "terminal" | "conversation" | "unified";
  status: "active" | "running" | "idle" | "dead" | "archived";
  tier: "sprint" | "session" | "persistent";
  ttl_minutes: number | null;
  cwd: string | null;
  last_activity: string;
  preview: string;
  shell_state: string;
  terminals: string[];
  created_at: string;
}

const TIER_CONFIG = {
  sprint: { label: "15m", color: "bg-orange-500/20 text-orange-400", Icon: Zap },
  session: { label: "1h45", color: "bg-blue-500/20 text-blue-400", Icon: Clock },
  persistent: { label: "AON", color: "bg-emerald-500/20 text-emerald-400", Icon: Shield },
};

const STATUS_DOT: Record<string, string> = {
  running: "bg-emerald-400 animate-pulse",
  active: "bg-emerald-400",
  idle: "bg-yellow-400",
  dead: "bg-red-400",
  archived: "bg-zinc-500",
};

const TYPE_ICON = {
  terminal: Terminal,
  conversation: MessageSquare,
  unified: Layers,
};

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate + (isoDate.endsWith("Z") ? "" : "Z")).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function SessionDashboard() {
  const [sessions, setSessions] = useState<DashboardSession[]>([]);
  const [loading, setLoading] = useState(true);
  const setActiveSession = useStore((s) => s.setActiveSession);
  const pinnedSessionIds = useStore((s) => s.pinnedSessionIds);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const data = await apiFetch("/api/v2/sessions/dashboard");
        if (mounted) setSessions(data);
      } catch {
        // ignore
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 5000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  // Sort: pinned first, then by last_activity
  const sorted = [...sessions].sort((a, b) => {
    const aPinned = pinnedSessionIds.has(a.id) ? 1 : 0;
    const bPinned = pinnedSessionIds.has(b.id) ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    return new Date(b.last_activity).getTime() - new Date(a.last_activity).getTime();
  });

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--color-text-dim)]">
        <div className="animate-spin w-5 h-5 border-2 border-[var(--color-text-dim)] border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {sorted.map((s) => {
          const TypeIcon = TYPE_ICON[s.type] || Layers;
          const tierConfig = TIER_CONFIG[s.tier] || TIER_CONFIG.session;
          const TierIcon = tierConfig.Icon;
          const dotClass = STATUS_DOT[s.status] || STATUS_DOT.idle;

          return (
            <button
              key={s.id}
              onClick={() => setActiveSession(s.id)}
              className="text-left p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-hover)] transition-colors group"
            >
              {/* Header row */}
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotClass}`} />
                <TypeIcon className="w-3.5 h-3.5 text-[var(--color-text-muted)] flex-shrink-0" />
                <span className="font-medium text-sm text-[var(--color-text)] truncate flex-1">
                  {s.name}
                </span>
                <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${tierConfig.color} flex items-center gap-1`}>
                  <TierIcon className="w-2.5 h-2.5" />
                  {tierConfig.label}
                </span>
              </div>

              {/* Preview */}
              {s.preview && (
                <p className="text-xs text-[var(--color-text-muted)] truncate mb-2 font-mono">
                  {s.preview}
                </p>
              )}

              {/* Footer */}
              <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-dim)]">
                <span>{timeAgo(s.last_activity)}</span>
                {s.cwd && (
                  <>
                    <span className="text-[var(--color-border)]">|</span>
                    <span className="truncate">{s.cwd.replace(/^\/Users\/[^/]+/, "~")}</span>
                  </>
                )}
                {s.type === "unified" && s.terminals.length > 0 && (
                  <>
                    <span className="text-[var(--color-border)]">|</span>
                    <span>{s.terminals.length} terminal{s.terminals.length > 1 ? "s" : ""}</span>
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {sessions.length === 0 && (
        <div className="flex flex-col items-center justify-center h-64 text-[var(--color-text-dim)]">
          <Layers className="w-10 h-10 mb-3" />
          <p className="text-sm">No active sessions</p>
        </div>
      )}
    </div>
  );
}
