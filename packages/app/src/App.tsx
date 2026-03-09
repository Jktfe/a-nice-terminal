import { useEffect, useState, useCallback } from "react";
import { AnimatePresence } from "motion/react";
import { useStore } from "./store.ts";
import Sidebar from "./components/Sidebar.tsx";
import Header from "./components/Header.tsx";
import TerminalView from "./components/TerminalView.tsx";
import MessageList from "./components/MessageList.tsx";
import InputArea from "./components/InputArea.tsx";
import QuickSwitcher from "./components/QuickSwitcher.tsx";
import StatusBar from "./components/StatusBar.tsx";
import OfflineOverlay from "./components/OfflineOverlay.tsx";
import SettingsModal from "./components/SettingsModal.tsx";
import { Terminal, MessageSquare } from "lucide-react";

export default function App() {
  const { init, sessions, activeSessionId, createSession, toggleSidebar } =
    useStore();
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);

  useEffect(() => {
    init();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;

      if (e.key === "n" && e.shiftKey) {
        e.preventDefault();
        createSession("conversation");
      } else if (e.key === "n") {
        e.preventDefault();
        createSession("terminal");
      } else if (e.key === "k") {
        e.preventDefault();
        setQuickSwitcherOpen((v: boolean) => !v);
      } else if (e.key === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    },
    [createSession, toggleSidebar]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <div className="flex h-screen flex-col bg-[var(--color-bg)] font-sans selection:bg-emerald-500/30">
      <div className="flex flex-1 min-h-0">
        <AnimatePresence>
          <Sidebar />
        </AnimatePresence>

        <div className="flex-1 flex flex-col min-w-0">
          <Header />

          {activeSession ? (
            activeSession.type === "terminal" ? (
              <TerminalView />
            ) : (
              <>
                <MessageList />
                <InputArea />
              </>
            )
          ) : (
            <EmptyState onCreateSession={createSession} />
          )}
        </div>
      </div>

      <StatusBar />

      {quickSwitcherOpen && (
        <QuickSwitcher onClose={() => setQuickSwitcherOpen(false)} />
      )}

      <SettingsModal />

      <OfflineOverlay />
    </div>
  );
}

function EmptyState({
  onCreateSession,
}: {
  onCreateSession: (type: "terminal" | "conversation", name?: string) => void;
}) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-lg font-medium text-white/60 mb-6">
          Welcome to ANT
        </h2>
        <p className="text-sm text-white/30 mb-8 max-w-sm">
          A Nice Terminal. Beautiful sessions for humans, clean API for AI
          agents.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => onCreateSession("terminal")}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500/20 transition-colors text-sm font-medium"
          >
            <Terminal className="w-4 h-4" />
            New Terminal
          </button>
          <button
            onClick={() => onCreateSession("conversation")}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-500/10 text-blue-400 rounded-lg hover:bg-blue-500/20 transition-colors text-sm font-medium"
          >
            <MessageSquare className="w-4 h-4" />
            New Conversation
          </button>
        </div>
      </div>
    </div>
  );
}
