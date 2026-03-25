import { useMemo } from "react";
import { Check, Circle, Loader2, FileText, Users, MessageSquare, Clock } from "lucide-react";
import { useStore, type Session, type Message } from "../../store.ts";
import type { RoomDetail, Task } from "../../hooks/useChatRoom.ts";

const statusIcon = (status: Task["status"]) => {
  switch (status) {
    case "done":
      return <Check className="w-4 h-4 text-emerald-500" />;
    case "in-progress":
      return <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />;
    default:
      return <Circle className="w-4 h-4 text-[var(--color-text-dim)]" />;
  }
};

interface DerivedParticipant {
  name: string;
  senderType: string;
  messageCount: number;
  lastSeen: string;
}

interface Props {
  room: RoomDetail | null;
  session?: Session;
  messages?: Message[];
}

export default function AeroContextPanel({ room, session, messages }: Props) {
  const agentPresence = useStore((s) => s.agentPresence);

  // Derive participants from messages when no chat room is linked
  const derivedParticipants = useMemo(() => {
    if (room && room.participants.length > 0) return null; // use room participants instead
    if (!messages || messages.length === 0) return [];

    const map = new Map<string, DerivedParticipant>();
    for (const msg of messages) {
      const name = msg.sender_name || (msg.role === "human" ? "You" : msg.role);
      const key = name.toLowerCase();
      const existing = map.get(key);
      if (existing) {
        existing.messageCount++;
        existing.lastSeen = msg.created_at;
      } else {
        map.set(key, {
          name,
          senderType: msg.sender_type || msg.role,
          messageCount: 1,
          lastSeen: msg.created_at,
        });
      }
    }
    return [...map.values()].sort((a, b) => b.messageCount - a.messageCount);
  }, [messages, room]);

  const created = session?.created_at
    ? new Date(session.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <div className="w-72 flex-shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">

        {/* Session info — always visible */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-3.5 h-3.5 text-[var(--color-text-dim)]" />
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)]">
              Session
            </h3>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium text-[var(--color-text)]">
              {session?.name || "Untitled"}
            </div>
            {created && (
              <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-dim)]">
                <Clock className="w-3 h-3" />
                {created}
              </div>
            )}
            {room?.purpose && (
              <p className="text-xs text-[var(--color-text-muted)] leading-relaxed mt-1">
                {room.purpose}
              </p>
            )}
          </div>
        </section>

        {/* Participants */}
        {room && room.participants.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-3.5 h-3.5 text-[var(--color-text-dim)]" />
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)]">
                Participants
              </h3>
              <span className="text-[10px] text-[var(--color-text-dim)] bg-[var(--color-hover)] px-1.5 py-0.5 rounded ml-auto">
                {room.participants.length}
              </span>
            </div>
            <div className="space-y-2.5">
              {room.participants.map((p) => {
                const isHuman = !p.model;
                const presence = agentPresence[p.terminalSessionId];
                const isActive = presence?.state === "working" || presence?.state === "thinking";

                return (
                  <div key={p.terminalSessionId} className="flex items-center gap-2.5">
                    <div
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        isHuman
                          ? "bg-emerald-400"
                          : isActive
                            ? "bg-violet-400 animate-pulse"
                            : "bg-[var(--color-text-dim)]"
                      }`}
                    />
                    <span className={`text-xs truncate ${isHuman || isActive ? "font-medium text-[var(--color-text)]" : "text-[var(--color-text-muted)]"}`}>
                      {p.agentName}
                    </span>
                    {p.model && (
                      <span className="text-[10px] text-[var(--color-text-dim)] truncate ml-auto">
                        {p.model}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Derived participants from messages (when no chat room) */}
        {derivedParticipants && derivedParticipants.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-3.5 h-3.5 text-[var(--color-text-dim)]" />
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)]">
                Participants
              </h3>
              <span className="text-[10px] text-[var(--color-text-dim)] bg-[var(--color-hover)] px-1.5 py-0.5 rounded ml-auto">
                {derivedParticipants.length}
              </span>
            </div>
            <div className="space-y-2.5">
              {derivedParticipants.map((p) => {
                const isHuman = p.senderType === "human";
                const dotColor = isHuman
                  ? "bg-emerald-400"
                  : p.senderType === "agent" || p.senderType === "claude"
                    ? "bg-violet-400"
                    : p.senderType === "gemini"
                      ? "bg-blue-400"
                      : "bg-[var(--color-text-dim)]";

                return (
                  <div key={p.name} className="flex items-center gap-2.5">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
                    <span className="text-xs font-medium text-[var(--color-text)] truncate">
                      {p.name}
                    </span>
                    <span className="text-[10px] text-[var(--color-text-dim)] ml-auto">
                      {p.messageCount} msg{p.messageCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Active Tasks */}
        {room && room.tasks.length > 0 && (
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)] mb-3">
              Active Tasks
            </h3>
            <div className="space-y-2.5">
              {room.tasks.map((task) => (
                <div key={task.id} className="flex items-start gap-2.5">
                  <div className="mt-0.5 flex-shrink-0">{statusIcon(task.status)}</div>
                  <div className="min-w-0">
                    <div
                      className={`text-xs text-[var(--color-text)] ${
                        task.status === "done" ? "line-through opacity-50" : ""
                      }`}
                    >
                      {task.name}
                    </div>
                    {task.assignedTo && (
                      <div className="text-[10px] text-[var(--color-text-dim)] mt-0.5">
                        {task.assignedTo}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Context Files */}
        {room && room.files.length > 0 && (
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)] mb-3">
              Context Files
            </h3>
            <div className="space-y-2.5">
              {room.files.map((file) => (
                <div key={file.id} className="flex items-start gap-2.5">
                  <FileText className="w-3.5 h-3.5 text-violet-400 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-[var(--color-text)] truncate">
                      {file.path}
                    </div>
                    {file.description && (
                      <div className="text-[10px] text-[var(--color-text-dim)] mt-0.5">
                        {file.description}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
