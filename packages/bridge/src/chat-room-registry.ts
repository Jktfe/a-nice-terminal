/**
 * In-memory registry of ANTchat! rooms.
 *
 * Maps human-readable room names to their ANT conversation session ID
 * and the set of participant terminal session IDs. Used by the
 * TerminalWatcher ANTchat! handler to:
 *   1) Look up which conversation to post to
 *   2) Fan out messages to all other participant terminals
 */

export interface ChatRoom {
  /** Human-readable room name (e.g. "sb-m9f3k2") */
  name: string;
  /** ANT conversation session ID for this room */
  conversationSessionId: string;
  /** Room purpose/description */
  purpose?: string;
  /** Map of participant terminal session IDs to metadata */
  participants: Map<string, ParticipantInfo>;
  /** Task list for this room */
  tasks: RoomTask[];
  /** Relevant files shared in this room */
  files: RoomFile[];
  createdAt: Date;
}

export interface ParticipantInfo {
  /** Display name for this agent (e.g. "Claude Haiku") */
  agentName: string;
  /** Model identifier (e.g. "claude-haiku-4-5") */
  model?: string;
  /** Terminal session name in ANT */
  terminalName?: string;
}

export interface RoomTask {
  id: string;
  name: string;
  assignedTo?: string; // agent name or "TBA"
  status: "pending" | "in-progress" | "done";
  createdAt: Date;
}

export interface RoomFile {
  id: string;
  path: string;
  description?: string;
  addedBy?: string; // agent name
  createdAt: Date;
}

export class ChatRoomRegistry {
  private rooms = new Map<string, ChatRoom>();

  /** Create or update a room */
  registerRoom(
    name: string,
    conversationSessionId: string
  ): ChatRoom {
    const existing = this.rooms.get(name);
    if (existing) {
      existing.conversationSessionId = conversationSessionId;
      return existing;
    }

    const room: ChatRoom = {
      name,
      conversationSessionId,
      participants: new Map(),
      tasks: [],
      files: [],
      createdAt: new Date(),
    };
    this.rooms.set(name, room);
    return room;
  }

  /** Add a terminal session as a participant in a room */
  addParticipant(
    roomName: string,
    terminalSessionId: string,
    info: ParticipantInfo
  ): boolean {
    const room = this.rooms.get(roomName);
    if (!room) return false;
    room.participants.set(terminalSessionId, info);
    return true;
  }

  /** Remove a participant from a room */
  removeParticipant(roomName: string, terminalSessionId: string): boolean {
    const room = this.rooms.get(roomName);
    if (!room) return false;
    return room.participants.delete(terminalSessionId);
  }

  /** Look up a room by name */
  getRoom(name: string): ChatRoom | undefined {
    return this.rooms.get(name);
  }

  /** Get all other participant terminal IDs (excluding the sender) */
  getOtherParticipants(roomName: string, excludeSessionId: string): string[] {
    const room = this.rooms.get(roomName);
    if (!room) return [];
    return [...room.participants.keys()].filter((id) => id !== excludeSessionId);
  }

  /** Get participant info for formatting the attribution line */
  getParticipantInfo(
    roomName: string,
    sessionId: string
  ): ParticipantInfo | undefined {
    return this.rooms.get(roomName)?.participants.get(sessionId);
  }

  /** List all active rooms */
  listRooms(): ChatRoom[] {
    return [...this.rooms.values()];
  }

  /** Set room purpose */
  setPurpose(roomName: string, purpose: string): boolean {
    const room = this.rooms.get(roomName);
    if (!room) return false;
    room.purpose = purpose;
    return true;
  }

  /** Add a task to a room */
  addTask(roomName: string, name: string, assignedTo?: string): RoomTask | null {
    const room = this.rooms.get(roomName);
    if (!room) return null;
    const task: RoomTask = {
      id: `t-${Date.now().toString(36)}`,
      name,
      assignedTo: assignedTo || "TBA",
      status: "pending",
      createdAt: new Date(),
    };
    room.tasks.push(task);
    return task;
  }

  /** Update a task's status or assignment */
  updateTask(
    roomName: string,
    taskId: string,
    updates: { status?: RoomTask["status"]; assignedTo?: string }
  ): boolean {
    const room = this.rooms.get(roomName);
    if (!room) return false;
    const task = room.tasks.find((t) => t.id === taskId);
    if (!task) return false;
    if (updates.status) task.status = updates.status;
    if (updates.assignedTo) task.assignedTo = updates.assignedTo;
    return true;
  }

  /** Add a file reference to a room */
  addFile(roomName: string, path: string, description?: string, addedBy?: string): RoomFile | null {
    const room = this.rooms.get(roomName);
    if (!room) return null;
    const file: RoomFile = {
      id: `f-${Date.now().toString(36)}`,
      path,
      description,
      addedBy,
      createdAt: new Date(),
    };
    room.files.push(file);
    return file;
  }

  /** Remove a file from a room */
  removeFile(roomName: string, fileId: string): boolean {
    const room = this.rooms.get(roomName);
    if (!room) return false;
    const idx = room.files.findIndex((f) => f.id === fileId);
    if (idx === -1) return false;
    room.files.splice(idx, 1);
    return true;
  }

  /** Delete a room */
  deleteRoom(name: string): boolean {
    return this.rooms.delete(name);
  }
}
