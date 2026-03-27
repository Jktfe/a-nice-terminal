import { Router, type Request, type Response } from "express";

/**
 * Chat room API routes.
 *
 * These endpoints expose the ChatRoomRegistry for:
 * - Room creation/registration by SoundboardBot or other orchestrators
 * - Participant management
 * - @ autocomplete in the conversation UI
 * - Protocol documentation for agents
 */

const router = Router();

// Protocol documentation — agents GET this on startup to learn the ANTchat! format
router.get("/api/protocol", (_req: Request, res: Response) => {
  res.json({
    version: "1.0",
    commands: {
      "ANTchat!": {
        description: "Post a message to a chat room from a terminal",
        format: 'ANTchat! [room-name] "message text"',
        threading: 'ANTchat! [room-name:2026-03-25T10:09:33Z] "threaded reply"',
        examples: [
          'ANTchat! [design-room] "I think we should use SwiftUI for the iPad app"',
          "ANTchat! design-room 'Brackets are optional'",
          'ANTchat! [design-room:2026-03-25T10:09:33Z] "Replying to the thread above"',
        ],
        notes: [
          "Brackets around room-name are optional",
          "Single or double quotes both work",
          "Thread timestamp is the created_at of the message being replied to",
          "Room name is case-insensitive and matched to a conversation session",
        ],
      },
      "ANTtask!": {
        description: "Create or update a task in a chat room",
        format: 'ANTtask! [room-name] "task name" status:pending|in-progress|done assigned:AgentName',
        examples: [
          'ANTtask! [design-room] "Design SwiftUI navigation"',
          'ANTtask! [design-room] "Design SwiftUI navigation" status:in-progress assigned:Claude',
          'ANTtask! [design-room] "Design SwiftUI navigation" status:done',
        ],
        notes: [
          "status and assigned fields are optional",
          "If task name matches an existing task (case-insensitive), it updates rather than creates",
          "Valid statuses: pending, in-progress, done",
        ],
      },
      "ANTfile!": {
        description: "Register a relevant file in a chat room",
        format: 'ANTfile! [room-name] "/path/to/file" "optional description"',
        examples: [
          'ANTfile! [design-room] "/src/components/Navigation.swift" "Main navigation component"',
          "ANTfile! design-room '/docs/architecture.md'",
        ],
        notes: [
          "Description is optional (second quoted string)",
          "Files are shown in the room detail panel",
          "Attribution is automatic based on the sending terminal",
        ],
      },
    },
    search: {
      endpoint: "GET /api/search?q=<query>",
      description: "Search across sessions and messages",
      scopedSearch: "GET /api/search?q=<query>&session=<session-id> (search within a conversation)",
    },
  });
});

/**
 * Chat room routes are mounted dynamically by the bridge when it starts.
 * The registry is passed in via the mount function below.
 */
export function mountChatRoomRoutes(
  app: { get: Function; post: Function; patch: Function; delete: Function },
  getRegistry: () => any
): void {
  // List all rooms
  app.get("/api/chat-rooms", (_req: Request, res: Response) => {
    const registry = getRegistry();
    if (!registry) return res.json([]);
    const rooms = registry.listRooms().map((r: any) => ({
      name: r.name,
      conversationSessionId: r.conversationSessionId,
      purpose: r.purpose || null,
      participantCount: r.participants.size,
      participants: [...r.participants.entries()].map(([id, info]: [string, any]) => ({
        terminalSessionId: id,
        agentName: info.agentName,
        model: info.model,
        terminalName: info.terminalName,
      })),
      tasks: r.tasks || [],
      files: r.files || [],
      createdAt: r.createdAt,
    }));
    res.json(rooms);
  });

  // Get participants for a specific room (for @ autocomplete)
  app.get("/api/chat-rooms/:name/participants", (req: Request, res: Response) => {
    const registry = getRegistry();
    if (!registry) return res.json([]);
    const room = registry.getRoom(req.params.name);
    if (!room) return res.status(404).json({ error: "Room not found" });
    const participants = [...room.participants.entries()].map(([id, info]: [string, any]) => ({
      terminalSessionId: id,
      agentName: info.agentName,
      model: info.model,
      terminalName: info.terminalName,
    }));
    res.json(participants);
  });

  // Register a new room
  app.post("/api/chat-rooms", (req: Request, res: Response) => {
    const registry = getRegistry();
    if (!registry) return res.status(503).json({ error: "Chat room registry not available" });
    const { name, conversationSessionId } = req.body;
    if (!name || !conversationSessionId) {
      return res.status(400).json({ error: "name and conversationSessionId required" });
    }
    const room = registry.registerRoom(name, conversationSessionId);
    res.json({ name: room.name, conversationSessionId: room.conversationSessionId });
  });

  // Add a participant to a room
  app.post("/api/chat-rooms/:name/participants", (req: Request, res: Response) => {
    const registry = getRegistry();
    if (!registry) return res.status(503).json({ error: "Chat room registry not available" });
    const { terminalSessionId, agentName, model, terminalName } = req.body;
    if (!terminalSessionId || !agentName) {
      return res.status(400).json({ error: "terminalSessionId and agentName required" });
    }
    const ok = registry.addParticipant(req.params.name, terminalSessionId, {
      agentName,
      model,
      terminalName,
    });
    if (!ok) return res.status(404).json({ error: "Room not found" });
    res.json({ ok: true });
  });

  // Remove a participant
  app.delete("/api/chat-rooms/:name/participants/:terminalSessionId", (req: Request, res: Response) => {
    const registry = getRegistry();
    if (!registry) return res.status(503).json({ error: "Chat room registry not available" });
    const ok = registry.removeParticipant(req.params.name, req.params.terminalSessionId);
    if (!ok) return res.status(404).json({ error: "Room or participant not found" });
    res.json({ ok: true });
  });

  // Update a participant's agentName
  app.patch("/api/chat-rooms/:name/participants/:terminalSessionId", (req: Request, res: Response) => {
    const registry = getRegistry();
    if (!registry) return res.status(503).json({ error: "Chat room registry not available" });
    const { agentName } = req.body;
    if (!agentName) return res.status(400).json({ error: "agentName required" });
    const room = registry.getRoom(req.params.name);
    if (!room) return res.status(404).json({ error: "Room not found" });
    const existing = room.participants.get(req.params.terminalSessionId);
    if (!existing) return res.status(404).json({ error: "Participant not found" });
    registry.addParticipant(req.params.name, req.params.terminalSessionId, { ...existing, agentName });
    res.json({ ok: true });
  });

  // Update room purpose
  app.patch("/api/chat-rooms/:name", (req: Request, res: Response) => {
    const registry = getRegistry();
    if (!registry) return res.status(503).json({ error: "Chat room registry not available" });
    const { purpose } = req.body;
    if (purpose !== undefined) {
      registry.setPurpose(req.params.name, purpose);
    }
    const room = registry.getRoom(req.params.name);
    if (!room) return res.status(404).json({ error: "Room not found" });
    res.json({ name: room.name, purpose: room.purpose });
  });

  // --- Tasks ---

  // Add a task
  app.post("/api/chat-rooms/:name/tasks", (req: Request, res: Response) => {
    const registry = getRegistry();
    if (!registry) return res.status(503).json({ error: "Chat room registry not available" });
    const { name: taskName, assignedTo } = req.body;
    if (!taskName) return res.status(400).json({ error: "name required" });
    const task = registry.addTask(req.params.name, taskName, assignedTo);
    if (!task) return res.status(404).json({ error: "Room not found" });
    res.json(task);
  });

  // Update a task
  app.patch("/api/chat-rooms/:name/tasks/:taskId", (req: Request, res: Response) => {
    const registry = getRegistry();
    if (!registry) return res.status(503).json({ error: "Chat room registry not available" });
    const { status, assignedTo } = req.body;
    const ok = registry.updateTask(req.params.name, req.params.taskId, { status, assignedTo });
    if (!ok) return res.status(404).json({ error: "Room or task not found" });
    res.json({ ok: true });
  });

  // --- Files ---

  // Add a file reference
  app.post("/api/chat-rooms/:name/files", (req: Request, res: Response) => {
    const registry = getRegistry();
    if (!registry) return res.status(503).json({ error: "Chat room registry not available" });
    const { path, description, addedBy } = req.body;
    if (!path) return res.status(400).json({ error: "path required" });
    const file = registry.addFile(req.params.name, path, description, addedBy);
    if (!file) return res.status(404).json({ error: "Room not found" });
    res.json(file);
  });

  // Remove a file
  app.delete("/api/chat-rooms/:name/files/:fileId", (req: Request, res: Response) => {
    const registry = getRegistry();
    if (!registry) return res.status(503).json({ error: "Chat room registry not available" });
    const ok = registry.removeFile(req.params.name, req.params.fileId);
    if (!ok) return res.status(404).json({ error: "Room or file not found" });
    res.json({ ok: true });
  });
}

export default router;
