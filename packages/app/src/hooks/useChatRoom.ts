import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../store.ts";

export interface Participant {
  terminalSessionId: string;
  agentName: string;
  model?: string;
  terminalName?: string;
}

export interface Task {
  id: string;
  name: string;
  assignedTo?: string;
  status: "pending" | "in-progress" | "done";
}

export interface RoomFile {
  id: string;
  path: string;
  description?: string;
  addedBy?: string;
}

export interface RoomDetail {
  name: string;
  conversationSessionId: string;
  purpose?: string;
  participants: Participant[];
  tasks: Task[];
  files: RoomFile[];
}

export function useChatRoom(sessionId: string | null): {
  room: RoomDetail | null;
  loading: boolean;
  refetch: () => Promise<void>;
} {
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchRoom = useCallback(async () => {
    if (!sessionId) {
      setRoom(null);
      setLoading(false);
      return;
    }
    try {
      const rooms = await apiFetch("/api/chat-rooms");
      const match = rooms.find(
        (r: RoomDetail) => r.conversationSessionId === sessionId
      );
      setRoom(match || null);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchRoom();
    const interval = setInterval(fetchRoom, 10000);
    return () => clearInterval(interval);
  }, [fetchRoom]);

  return { room, loading, refetch: fetchRoom };
}
