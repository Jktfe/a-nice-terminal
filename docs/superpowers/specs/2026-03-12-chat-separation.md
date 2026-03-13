# ANT Spec: Decoupled Chat Layer

**Date**: 2026-03-12
**Status**: Proposal
**Objective**: Decouple the conversation logic from the terminal/PTY logic to ensure chat persistence during server restarts.

## 1. Problem Statement
Currently, the ANT server handles both terminal PTYs and chat conversations in a single Node process. When a server-side file is edited (e.g., in `pty-manager.ts`), the `tsx` watcher restarts the entire process. This causes:
- WebSocket disconnections for all active chats.
- Loss of ephemeral "thinking" states.
- Interruption of agent-to-agent coordination.

## 2. Proposed Architecture: The Chat Sidecar

We will split the backend into two distinct services:

### A. Main Service (PTY/Terminal)
- **Port**: 6458
- **Role**: Process management, tmux interaction, terminal snapshots (DTSS).
- **Restart frequency**: High (during development of terminal features).

### B. Chat Service (Sidecar)
- **Port**: 6459
- **Role**: Conversation persistence, message history, agent-to-human communication.
- **Restart frequency**: Very Low (once stable, it rarely needs to bounce).
- **Database**: Dedicated `chat.db` or shared `ant.db` with WAL mode enabled.

## 3. Implementation Plan

### Phase 1: Shared Database
- Both services will point to `ant.db`.
- Main service handles `sessions`, `workspaces`, and `resume_commands`.
- Chat service handles `messages`.

### Phase 2: Frontend Dual-Binding
- `store.ts` will manage two WebSocket connections: `terminalSocket` and `chatSocket`.
- API calls will be routed based on the resource:
  - `/api/messages` -> Port 6459
  - `/api/terminal` -> Port 6458

### Phase 3: Agent Protocol
- Agents will connect to the Chat Service for coordination and the Main Service for tool execution.
- If the Main Service goes down, agents can still post "I am waiting for the terminal server to come back" messages.

## 4. Visual Mockup (Concept)
- **Indicator**: A small "Chat Link" icon in the status bar showing the health of the independent chat process.
- **Resilience**: A "Terminal Offline" banner that appears over the terminal view while the Main Service restarts, without obscuring or disabling the chat window.

## 5. Next Steps
1. Create `packages/app/server/chat-server.ts`.
2. Extract message routes and DB logic.
3. Update `store.ts` to support dual endpoints.
