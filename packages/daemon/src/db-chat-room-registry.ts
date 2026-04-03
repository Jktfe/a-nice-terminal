/**
 * DB-backed chat room registry.
 *
 * Drop-in replacement for the in-memory ChatRoomRegistry from the bridge
 * package, persisting rooms, participants, tags, tasks, and context files
 * to SQLite via better-sqlite3.
 */
import type Database from "better-sqlite3";
import { nanoid } from "nanoid";

// ---------------------------------------------------------------------------
// Interfaces — compatible with bridge/src/chat-room-registry.ts
// ---------------------------------------------------------------------------

export interface ParticipantInfo {
  agentName: string;
  model?: string;
  terminalName?: string;
}

export interface RoomTask {
  id: string;
  name: string;
  assignedTo?: string;
  status:
    | "pending"
    | "assigned"
    | "in-progress"
    | "review"
    | "being-reviewed"
    | "reviewed-agent-signed-off"
    | "reviewed-needs-work"
    | "user-signed-off";
  createdAt: Date;
}

export interface RoomFile {
  id: string;
  path: string;
  fileType?: string;
  shortName?: string;
  description?: string;
  addedBy?: string;
  createdAt: Date;
}

export interface RoomTag {
  id: number;
  terminalSessionId: string;
  tag: string;
  createdAt: Date;
}

export interface ChatRoom {
  name: string;
  conversationSessionId: string;
  purpose?: string;
  participants: Map<string, ParticipantInfo>;
  tasks: RoomTask[];
  files: RoomFile[];
  tags: RoomTag[];
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// DbChatRegistry
// ---------------------------------------------------------------------------

export class DbChatRegistry {
  // Prepared statements
  private stmts: ReturnType<DbChatRegistry["prepareStatements"]>;

  constructor(private db: Database.Database) {
    this.stmts = this.prepareStatements();
  }

  // -- Rooms -----------------------------------------------------------------

  registerRoom(name: string, conversationSessionId: string): ChatRoom {
    const existing = this.stmts.getRoomByName.get(name) as any;
    if (existing) {
      this.stmts.updateRoomSession.run(conversationSessionId, existing.id);
      return this.getRoom(name)!;
    }

    const id = nanoid(12);
    this.stmts.insertRoom.run(id, name, conversationSessionId);
    return this.getRoom(name)!;
  }

  getRoom(name: string): ChatRoom | undefined {
    const row = this.stmts.getRoomByName.get(name) as any;
    if (!row) return undefined;
    return this.assembleRoom(row);
  }

  getRoomById(id: string): ChatRoom | undefined {
    const row = this.stmts.getRoomById.get(id) as any;
    if (!row) return undefined;
    return this.assembleRoom(row);
  }

  listRooms(): ChatRoom[] {
    const rows = this.stmts.listActiveRooms.all() as any[];
    return rows.map((r) => this.assembleRoom(r));
  }

  setPurpose(roomName: string, purpose: string): boolean {
    const room = this.stmts.getRoomByName.get(roomName) as any;
    if (!room) return false;
    this.stmts.updatePurpose.run(purpose, room.id);
    return true;
  }

  deleteRoom(name: string): boolean {
    const room = this.stmts.getRoomByName.get(name) as any;
    if (!room) return false;
    this.stmts.archiveRoom.run(room.id);
    return true;
  }

  // -- Participants ----------------------------------------------------------

  addParticipant(
    roomName: string,
    terminalSessionId: string,
    info: ParticipantInfo
  ): boolean {
    const room = this.stmts.getRoomByName.get(roomName) as any;
    if (!room) return false;
    this.stmts.upsertParticipant.run(
      room.id,
      terminalSessionId,
      info.agentName,
      info.model ?? null,
      info.terminalName ?? null
    );
    return true;
  }

  removeParticipant(roomName: string, terminalSessionId: string): boolean {
    const room = this.stmts.getRoomByName.get(roomName) as any;
    if (!room) return false;
    const result = this.stmts.deleteParticipant.run(room.id, terminalSessionId);
    return result.changes > 0;
  }

  getOtherParticipants(roomName: string, excludeSessionId: string): string[] {
    const room = this.stmts.getRoomByName.get(roomName) as any;
    if (!room) return [];
    const rows = this.stmts.getOtherParticipants.all(
      room.id,
      excludeSessionId
    ) as any[];
    return rows.map((r) => r.terminal_session_id);
  }

  getParticipantInfo(
    roomName: string,
    sessionId: string
  ): ParticipantInfo | undefined {
    const room = this.stmts.getRoomByName.get(roomName) as any;
    if (!room) return undefined;
    const row = this.stmts.getParticipant.get(room.id, sessionId) as any;
    if (!row) return undefined;
    return {
      agentName: row.agent_name,
      model: row.model ?? undefined,
      terminalName: row.terminal_name ?? undefined,
    };
  }

  // -- Tags ------------------------------------------------------------------

  addTag(
    roomName: string,
    terminalSessionId: string,
    tag: string
  ): RoomTag | null {
    const room = this.stmts.getRoomByName.get(roomName) as any;
    if (!room) return null;
    try {
      this.stmts.insertTag.run(room.id, terminalSessionId, tag);
    } catch {
      // UNIQUE constraint — tag already exists
      return null;
    }
    const row = this.stmts.getTag.get(room.id, terminalSessionId, tag) as any;
    return row
      ? {
          id: row.id,
          terminalSessionId: row.terminal_session_id,
          tag: row.tag,
          createdAt: new Date(row.created_at),
        }
      : null;
  }

  removeTag(roomName: string, tagId: number): boolean {
    const room = this.stmts.getRoomByName.get(roomName) as any;
    if (!room) return false;
    const result = this.stmts.deleteTag.run(tagId, room.id);
    return result.changes > 0;
  }

  getTagsForRoom(roomName: string): RoomTag[] {
    const room = this.stmts.getRoomByName.get(roomName) as any;
    if (!room) return [];
    const rows = this.stmts.getTagsByRoom.all(room.id) as any[];
    return rows.map((r) => ({
      id: r.id,
      terminalSessionId: r.terminal_session_id,
      tag: r.tag,
      createdAt: new Date(r.created_at),
    }));
  }

  // -- Tasks -----------------------------------------------------------------

  addTask(
    roomName: string,
    name: string,
    assignedTo?: string
  ): RoomTask | null {
    const room = this.stmts.getRoomByName.get(roomName) as any;
    if (!room) return null;
    const id = 't-' + nanoid(12);
    this.stmts.insertTask.run(
      id,
      room.id,
      name,
      assignedTo ? "assigned" : "pending",
      assignedTo ?? null,
      assignedTo ?? null
    );
    return {
      id,
      name,
      assignedTo: assignedTo || undefined,
      status: assignedTo ? "assigned" : "pending",
      createdAt: new Date(),
    };
  }

  updateTask(
    roomName: string,
    taskId: string,
    updates: { status?: RoomTask["status"]; assignedTo?: string }
  ): boolean {
    const room = this.stmts.getRoomByName.get(roomName) as any;
    if (!room) return false;
    // Verify task belongs to room
    const task = this.stmts.getTask.get(taskId, room.id) as any;
    if (!task) return false;
    if (updates.status) {
      this.stmts.updateTaskStatus.run(updates.status, taskId);
    }
    if (updates.assignedTo) {
      this.stmts.updateTaskAssignment.run(
        updates.assignedTo,
        updates.assignedTo,
        taskId
      );
    }
    return true;
  }

  // -- Files -----------------------------------------------------------------

  addFile(
    roomName: string,
    filePath: string,
    description?: string,
    addedBy?: string,
    fileType?: string,
    shortName?: string
  ): RoomFile | null {
    const room = this.stmts.getRoomByName.get(roomName) as any;
    if (!room) return null;
    const id = 'f-' + nanoid(12);
    try {
      this.stmts.insertFile.run(
        id,
        room.id,
        filePath,
        fileType ?? null,
        shortName ?? null,
        description ?? null,
        addedBy ?? null
      );
    } catch {
      // UNIQUE constraint — file path already registered
      return null;
    }
    return {
      id,
      path: filePath,
      fileType: fileType ?? undefined,
      shortName: shortName ?? undefined,
      description: description ?? undefined,
      addedBy: addedBy ?? undefined,
      createdAt: new Date(),
    };
  }

  removeFile(roomName: string, fileId: string): boolean {
    const room = this.stmts.getRoomByName.get(roomName) as any;
    if (!room) return false;
    const result = this.stmts.deleteFile.run(fileId, room.id);
    return result.changes > 0;
  }

  // -- Room ID lookup (needed by message routes) -----------------------------

  getActiveRoomIdByName(name: string): string | undefined {
    const row = this.stmts.getRoomByName.get(name) as any;
    return row?.id;
  }

  // -- Helpers ---------------------------------------------------------------

  private assembleRoom(row: any): ChatRoom {
    const participantRows = this.stmts.getParticipantsByRoom.all(
      row.id
    ) as any[];
    const participants = new Map<string, ParticipantInfo>();
    for (const p of participantRows) {
      participants.set(p.terminal_session_id, {
        agentName: p.agent_name,
        model: p.model ?? undefined,
        terminalName: p.terminal_name ?? undefined,
      });
    }

    const taskRows = this.stmts.getTasksByRoom.all(row.id) as any[];
    const tasks: RoomTask[] = taskRows.map((t) => ({
      id: t.id,
      name: t.contents,
      assignedTo: t.assigned_name ?? undefined,
      status: t.status,
      createdAt: new Date(t.created_at),
    }));

    const fileRows = this.stmts.getFilesByRoom.all(row.id) as any[];
    const files: RoomFile[] = fileRows.map((f) => ({
      id: f.id,
      path: f.file_path,
      fileType: f.file_type ?? undefined,
      shortName: f.short_name ?? undefined,
      description: f.description ?? undefined,
      addedBy: f.added_by ?? undefined,
      createdAt: new Date(f.created_at),
    }));

    const tagRows = this.stmts.getTagsByRoom.all(row.id) as any[];
    const tags: RoomTag[] = tagRows.map((t) => ({
      id: t.id,
      terminalSessionId: t.terminal_session_id,
      tag: t.tag,
      createdAt: new Date(t.created_at),
    }));

    return {
      name: row.name,
      conversationSessionId: row.conversation_session_id,
      purpose: row.purpose ?? undefined,
      participants,
      tasks,
      files,
      tags,
      createdAt: new Date(row.created_at),
    };
  }

  private prepareStatements() {
    return {
      // Rooms
      getRoomByName: this.db.prepare(
        `SELECT * FROM antchat_rooms WHERE name = ? COLLATE NOCASE AND status = 'active'`
      ),
      getRoomById: this.db.prepare(
        `SELECT * FROM antchat_rooms WHERE id = ? AND status = 'active'`
      ),
      listActiveRooms: this.db.prepare(
        `SELECT * FROM antchat_rooms WHERE status = 'active' ORDER BY created_at`
      ),
      insertRoom: this.db.prepare(
        `INSERT INTO antchat_rooms (id, name, conversation_session_id) VALUES (?, ?, ?)`
      ),
      updateRoomSession: this.db.prepare(
        `UPDATE antchat_rooms SET conversation_session_id = ?, updated_at = datetime('now') WHERE id = ?`
      ),
      updatePurpose: this.db.prepare(
        `UPDATE antchat_rooms SET purpose = ?, updated_at = datetime('now') WHERE id = ?`
      ),
      archiveRoom: this.db.prepare(
        `UPDATE antchat_rooms SET status = 'archived', archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
      ),

      // Participants
      upsertParticipant: this.db.prepare(
        `INSERT INTO antchat_participants (room_id, terminal_session_id, agent_name, model, terminal_name)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(room_id, terminal_session_id) DO UPDATE SET
           agent_name = excluded.agent_name,
           model = excluded.model,
           terminal_name = excluded.terminal_name`
      ),
      deleteParticipant: this.db.prepare(
        `DELETE FROM antchat_participants WHERE room_id = ? AND terminal_session_id = ?`
      ),
      getParticipantsByRoom: this.db.prepare(
        `SELECT * FROM antchat_participants WHERE room_id = ?`
      ),
      getParticipant: this.db.prepare(
        `SELECT * FROM antchat_participants WHERE room_id = ? AND terminal_session_id = ?`
      ),
      getOtherParticipants: this.db.prepare(
        `SELECT terminal_session_id FROM antchat_participants WHERE room_id = ? AND terminal_session_id != ?`
      ),

      // Tags
      insertTag: this.db.prepare(
        `INSERT INTO antchat_tags (room_id, terminal_session_id, tag) VALUES (?, ?, ?)`
      ),
      deleteTag: this.db.prepare(
        `DELETE FROM antchat_tags WHERE id = ? AND room_id = ?`
      ),
      getTag: this.db.prepare(
        `SELECT * FROM antchat_tags WHERE room_id = ? AND terminal_session_id = ? AND tag = ?`
      ),
      getTagsByRoom: this.db.prepare(
        `SELECT * FROM antchat_tags WHERE room_id = ? ORDER BY created_at`
      ),

      // Tasks
      insertTask: this.db.prepare(
        `INSERT INTO antchat_tasks (id, room_id, contents, status, assigned_to, assigned_name) VALUES (?, ?, ?, ?, ?, ?)`
      ),
      getTask: this.db.prepare(
        `SELECT * FROM antchat_tasks WHERE id = ? AND room_id = ?`
      ),
      getTasksByRoom: this.db.prepare(
        `SELECT * FROM antchat_tasks WHERE room_id = ? ORDER BY created_at`
      ),
      updateTaskStatus: this.db.prepare(
        `UPDATE antchat_tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`
      ),
      updateTaskAssignment: this.db.prepare(
        `UPDATE antchat_tasks SET assigned_to = ?, assigned_name = ?, updated_at = datetime('now') WHERE id = ?`
      ),

      // Files
      insertFile: this.db.prepare(
        `INSERT INTO antchat_context_files (id, room_id, file_path, file_type, short_name, description, added_by) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ),
      deleteFile: this.db.prepare(
        `DELETE FROM antchat_context_files WHERE id = ? AND room_id = ?`
      ),
      getFilesByRoom: this.db.prepare(
        `SELECT * FROM antchat_context_files WHERE room_id = ? ORDER BY created_at`
      ),
    };
  }
}

// Backwards-compat alias
export { DbChatRegistry as DbChatRoomRegistry };
