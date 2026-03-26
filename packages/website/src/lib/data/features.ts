export type FeatureCategory =
  | "Terminal"
  | "Conversations"
  | "Multi-Agent"
  | "UI"
  | "Developer Tools";

export interface Feature {
  id: string;
  title: string;
  category: FeatureCategory;
  description: string;
  details: string;
  icon: string;
}

export const features: Feature[] = [
  {
    id: "real-terminal",
    title: "Real Terminal",
    category: "Terminal",
    description: "PTY-backed shells with dtach persistence that survive server restarts.",
    details:
      "Every terminal session runs a real pseudo-terminal via node-pty, wrapped in dtach for persistence. Sessions survive server restarts through Unix domain sockets, and a configurable TTL grace period ensures long-running processes are never killed unexpectedly.",
    icon: "M4 17l6-6-6-6M12 19h8",
  },
  {
    id: "conversation-mode",
    title: "Conversation Mode",
    category: "Conversations",
    description: "Rich messaging with markdown rendering and code blocks.",
    details:
      "Structured text conversations with full markdown support, syntax-highlighted code blocks, and role-based messages (human, agent, system). Messages are stored in SQLite and searchable across sessions. Tiptap provides a rich editing experience with formatting shortcuts.",
    icon: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
  },
  {
    id: "agent-api",
    title: "Agent API",
    category: "Developer Tools",
    description: "REST and WebSocket APIs purpose-built for AI agent integration.",
    details:
      "A full REST API for session CRUD, message management, and terminal control, plus Socket.IO WebSocket connections for real-time streaming. Agents can execute commands, read terminal state, update presence, and interact with conversations programmatically via the MCP server or direct HTTP calls.",
    icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4",
  },
  {
    id: "multi-agent-platform",
    title: "Multi-Agent Platform",
    category: "Multi-Agent",
    description: "Agent registration with unique handles and @mention routing.",
    details:
      "Multiple AI agents can register with unique handles and participate in shared conversations. Messages display sender type and name with distinct visual styling per agent. The system supports Claude, Codex, Gemini, Copilot and custom agent types, each with their own colour-coded cards.",
    icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  },
  {
    id: "antchat-protocol",
    title: "ANTchat! Protocol",
    category: "Multi-Agent",
    description: "Multi-agent chat rooms with bidirectional terminal-conversation routing.",
    details:
      "A text-based protocol that agents can use directly from terminal sessions. ANTchat! posts messages, ANTtask! manages tasks, and ANTfile! registers files — all parsed from terminal output via regex and routed bidirectionally between terminals and conversation sessions through the bridge system.",
    icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
  },
  {
    id: "bridge-system",
    title: "Bridge System",
    category: "Multi-Agent",
    description: "Connect external platforms like Telegram and LMStudio to ANT sessions.",
    details:
      "The bridge package provides a two-tier Telegram bot model (direct and relay bots) and an LMStudio adapter for local LLM integration. BridgeCore handles inbound/outbound routing with deduplication tracking to prevent echo loops. External channels map to ANT sessions with configurable direction and per-agent ownership.",
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
  },
  {
    id: "aerochat-view",
    title: "AeroChat View",
    category: "UI",
    description: "Alternative two-panel chat layout with context sidebar.",
    details:
      "Toggle between classic and Aero view modes with Cmd+Shift+Period. Aero view provides a full-width message area with a right-hand context panel showing session info, derived participants, tasks, and files. CSS variable scoping via the .aero-view class gives it a distinct lighter aesthetic while reusing existing components.",
    icon: "M9 3H4a1 1 0 00-1 1v5a1 1 0 001 1h5a1 1 0 001-1V4a1 1 0 00-1-1zM20 3h-5a1 1 0 00-1 1v5a1 1 0 001 1h5a1 1 0 001-1V4a1 1 0 00-1-1zM20 14h-5a1 1 0 00-1 1v5a1 1 0 001 1h5a1 1 0 001-1v-5a1 1 0 00-1-1zM9 14H4a1 1 0 00-1 1v5a1 1 0 001 1h5a1 1 0 001-1v-5a1 1 0 00-1-1z",
  },
  {
    id: "split-view",
    title: "Split View",
    category: "UI",
    description: "Side-by-side panels for viewing two sessions simultaneously.",
    details:
      "Press Cmd+Backslash to toggle split view, placing two sessions side-by-side. Each panel independently renders terminals or conversations, and components accept an optional sessionId prop to drive the right panel. Useful for monitoring a terminal while composing in a conversation.",
    icon: "M12 3v18M3 3h18v18H3z",
  },
  {
    id: "global-search",
    title: "Global Search",
    category: "UI",
    description: "Cross-session search for sessions and messages.",
    details:
      "Cmd+Shift+F opens the search overlay, querying the /api/search endpoint to find matching sessions by name and messages by content across the entire database. Results are grouped and clickable, navigating directly to the relevant session and message.",
    icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  },
  {
    id: "archive-restore",
    title: "Archive / Restore",
    category: "UI",
    description: "Soft-delete session lifecycle with restore and permanent delete.",
    details:
      "Sessions can be archived (soft-deleted) to keep the sidebar tidy without losing data. Archived sessions are hidden by default but visible via a sidebar toggle. Restore brings them back with their original name if available. Shift+click on an archived session permanently deletes it.",
    icon: "M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8M10 12h4",
  },
  {
    id: "light-dark-mode",
    title: "Light / Dark Mode",
    category: "UI",
    description: "Theme support with Dracula, Solarized Dark, Nord, and more.",
    details:
      "Toggle between dark, light, and system-preference modes via Settings. The UI uses CSS custom properties for seamless switching, and the terminal canvas supports independent xterm.js themes including Default Light, Default Dark, Dracula, Solarized Dark, and Nord.",
    icon: "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z",
  },
  {
    id: "keyboard-shortcuts",
    title: "Keyboard Shortcuts",
    category: "UI",
    description: "Full keyboard navigation with Cmd+N, Cmd+K, and more.",
    details:
      "Comprehensive keyboard shortcuts for every major action: create sessions, toggle sidebar, quick-switch between sessions, open search, toggle split view, open docs, and switch view modes. All shortcuts are documented in the in-app docs modal accessible via Cmd+Slash.",
    icon: "M12 14l9-5-9-5-9 5 9 5zM12 14l6.16-3.422A12.083 12.083 0 0124 12.083M12 14l-6.16-3.422A12.083 12.083 0 000 12.083",
  },
  {
    id: "resume-capture",
    title: "Resume Capture",
    category: "Developer Tools",
    description: "Auto-captures LLM CLI resume commands from terminal output.",
    details:
      "ANT monitors terminal output for resume commands from AI CLIs (claude --resume, codex resume, etc.) and captures them automatically. Captured commands appear in a dropdown for one-click re-entry, making it easy to resume interrupted AI coding sessions.",
    icon: "M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664zM21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    id: "unread-badges",
    title: "Unread Badges",
    category: "UI",
    description: "Browser notifications and title badges for new messages.",
    details:
      "Client-side unread tracking in the Zustand store shows badge counts on each session in the sidebar. The browser tab title updates to show total unread count as (N) ANT, and the Notification API delivers desktop alerts for new messages in background sessions.",
    icon: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
  },
];

export const featureCategories = [...new Set(features.map((f) => f.category))];
