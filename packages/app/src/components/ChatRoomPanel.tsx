import { useState, useEffect, useCallback } from "react";
import {
  Users,
  ListTodo,
  FileText,
  ChevronRight,
  ChevronDown,
  X,
  Check,
  Loader2,
  Circle,
} from "lucide-react";
import { apiFetch } from "../store.ts";

interface Participant {
  terminalSessionId: string;
  agentName: string;
  model?: string;
  terminalName?: string;
}

interface Task {
  id: string;
  name: string;
  assignedTo?: string;
  status: "pending" | "in-progress" | "done";
}

interface RoomFile {
  id: string;
  path: string;
  description?: string;
  addedBy?: string;
}

interface RoomDetail {
  name: string;
  conversationSessionId: string;
  purpose?: string;
  participants: Participant[];
  tasks: Task[];
  files: RoomFile[];
}

const statusIcon = (status: Task["status"]) => {
  switch (status) {
    case "done":
      return <Check className="w-3.5 h-3.5 text-emerald-400" />;
    case "in-progress":
      return <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />;
    default:
      return <Circle className="w-3.5 h-3.5 text-[var(--color-text-dim)]" />;
  }
};

export default function ChatRoomPanel({
  roomName,
  onClose,
}: {
  roomName: string;
  onClose: () => void;
}) {
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [expandedSections, setExpandedSections] = useState({
    participants: true,
    tasks: true,
    files: true,
  });
  const [loading, setLoading] = useState(true);

  const fetchRoom = useCallback(async () => {
    try {
      const rooms = await apiFetch("/api/chat-rooms");
      const match = rooms.find(
        (r: RoomDetail) => r.name.toLowerCase() === roomName.toLowerCase()
      );
      if (match) setRoom(match);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [roomName]);

  useEffect(() => {
    fetchRoom();
    const interval = setInterval(fetchRoom, 10000); // refresh every 10s
    return () => clearInterval(interval);
  }, [fetchRoom]);

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  if (loading) {
    return (
      <div className="w-72 border-l border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-[var(--color-text-dim)] animate-spin" />
      </div>
    );
  }

  if (!room) {
    return (
      <div className="w-72 border-l border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm text-[var(--color-text-dim)]">Room Details</span>
          <button onClick={onClose} className="p-1 text-[var(--color-text-dim)] hover:text-[var(--color-text)]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-[var(--color-text-dim)]">
          No active chat room for this session.
        </p>
      </div>
    );
  }

  return (
    <div className="w-72 border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <span className="text-sm font-medium text-[var(--color-text)] truncate">
          {room.name}
        </span>
        <button
          onClick={onClose}
          className="p-1 text-[var(--color-text-dim)] hover:text-[var(--color-text)] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Purpose */}
      {room.purpose && (
        <div className="px-4 py-2 border-b border-[var(--color-border)]">
          <p className="text-xs text-[var(--color-text-dim)] leading-relaxed">
            {room.purpose}
          </p>
        </div>
      )}

      {/* Scrollable sections */}
      <div className="flex-1 overflow-y-auto">
        {/* Section 1: Participants */}
        <div className="border-b border-[var(--color-border)]">
          <button
            onClick={() => toggleSection("participants")}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-[var(--color-text-dim)] uppercase tracking-wider hover:bg-[var(--color-hover)] transition-colors"
          >
            {expandedSections.participants ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            <Users className="w-3.5 h-3.5" />
            <span>Participants</span>
            <span className="ml-auto text-[10px] bg-[var(--color-hover)] px-1.5 py-0.5 rounded">
              {room.participants.length}
            </span>
          </button>

          {expandedSections.participants && (
            <div className="px-4 pb-3 space-y-1.5">
              {room.participants.length === 0 ? (
                <p className="text-xs text-[var(--color-text-dim)] italic">
                  No participants yet
                </p>
              ) : (
                room.participants.map((p) => (
                  <div
                    key={p.terminalSessionId}
                    className="flex items-center gap-2 text-xs"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    <span className="text-[var(--color-text)] font-medium truncate">
                      {p.agentName}
                    </span>
                    {p.model && (
                      <span className="text-[10px] text-[var(--color-text-dim)] truncate">
                        {p.model}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Section 2: Tasks */}
        <div className="border-b border-[var(--color-border)]">
          <button
            onClick={() => toggleSection("tasks")}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-[var(--color-text-dim)] uppercase tracking-wider hover:bg-[var(--color-hover)] transition-colors"
          >
            {expandedSections.tasks ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            <ListTodo className="w-3.5 h-3.5" />
            <span>Tasks</span>
            <span className="ml-auto text-[10px] bg-[var(--color-hover)] px-1.5 py-0.5 rounded">
              {room.tasks.length}
            </span>
          </button>

          {expandedSections.tasks && (
            <div className="px-4 pb-3 space-y-2">
              {room.tasks.length === 0 ? (
                <p className="text-xs text-[var(--color-text-dim)] italic">
                  No tasks yet
                </p>
              ) : (
                room.tasks.map((task) => (
                  <div key={task.id} className="flex items-start gap-2 text-xs">
                    <div className="mt-0.5 shrink-0">{statusIcon(task.status)}</div>
                    <div className="min-w-0">
                      <div
                        className={`text-[var(--color-text)] ${
                          task.status === "done"
                            ? "line-through opacity-60"
                            : ""
                        }`}
                      >
                        {task.name}
                      </div>
                      <div className="text-[10px] text-[var(--color-text-dim)]">
                        {task.assignedTo || "TBA"}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Section 3: Files */}
        <div>
          <button
            onClick={() => toggleSection("files")}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-[var(--color-text-dim)] uppercase tracking-wider hover:bg-[var(--color-hover)] transition-colors"
          >
            {expandedSections.files ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            <FileText className="w-3.5 h-3.5" />
            <span>Files</span>
            <span className="ml-auto text-[10px] bg-[var(--color-hover)] px-1.5 py-0.5 rounded">
              {room.files.length}
            </span>
          </button>

          {expandedSections.files && (
            <div className="px-4 pb-3 space-y-1.5">
              {room.files.length === 0 ? (
                <p className="text-xs text-[var(--color-text-dim)] italic">
                  No files shared yet
                </p>
              ) : (
                room.files.map((file) => (
                  <div key={file.id} className="text-xs">
                    <div className="text-emerald-400 font-mono truncate">
                      {file.path.split("/").pop()}
                    </div>
                    {file.description && (
                      <div className="text-[10px] text-[var(--color-text-dim)]">
                        {file.description}
                      </div>
                    )}
                    {file.addedBy && (
                      <div className="text-[10px] text-[var(--color-text-dim)]">
                        by {file.addedBy}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
