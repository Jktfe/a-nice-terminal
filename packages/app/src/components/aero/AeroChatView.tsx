import { GitBranch } from "lucide-react";
import { useStore, type Message } from "../../store.ts";
import { useChatRoom } from "../../hooks/useChatRoom.ts";
import AeroContextPanel from "./AeroContextPanel.tsx";
import MessageList from "../MessageList.tsx";
import InputArea from "../InputArea.tsx";

interface Props {
  sessionId?: string;
  messages?: Message[];
}

function truncateCwd(cwd: string | null | undefined): string {
  if (!cwd) return "";
  const parts = cwd.split("/").filter(Boolean);
  return parts.length > 3 ? ".../" + parts.slice(-3).join("/") : cwd;
}

export default function AeroChatView({ sessionId, messages: propMessages }: Props) {
  const { sessions, activeSessionId, messages: storeMessages } = useStore();
  const effectiveId = sessionId ?? activeSessionId;
  const session = sessions.find((s) => s.id === effectiveId);
  const { room } = useChatRoom(effectiveId);
  const activeMessages = propMessages ?? storeMessages;

  return (
    <div className="aero-view flex flex-1 min-h-0">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Context bar */}
        <div className="flex items-center gap-2.5 px-6 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
          <GitBranch className="w-4 h-4 text-[var(--color-text-dim)]" />
          <span className="text-sm font-mono text-[var(--color-text-muted)] truncate">
            {session?.cwd ? truncateCwd(session.cwd) : room?.name || session?.name || "Conversation"}
          </span>
        </div>

        {/* Messages */}
        <MessageList sessionId={sessionId} messages={propMessages} />

        {/* Input */}
        <InputArea sessionId={sessionId} />
      </div>

      {/* Right sidebar */}
      <AeroContextPanel room={room} session={session} messages={activeMessages} />
    </div>
  );
}
