import { useEffect, useState, useCallback } from "react";
import { AnimatePresence } from "motion/react";
import { useStore, type Session } from "./store.ts";
import Sidebar from "./components/Sidebar.tsx";
import Header from "./components/Header.tsx";
import TerminalView from "./components/TerminalViewV2.tsx";
import MessageList from "./components/MessageList.tsx";
import ChatThread from "./components/ChatThread.tsx";
import InputArea from "./components/InputArea.tsx";
import QuickSwitcher from "./components/QuickSwitcher.tsx";
import SearchPanel from "./components/SearchPanel.tsx";
import SplitHeader from "./components/SplitHeader.tsx";
import StatusBar from "./components/StatusBar.tsx";
import OfflineOverlay from "./components/OfflineOverlay.tsx";
import SettingsModal from "./components/SettingsModal.tsx";
import DocsModal from "./components/DocsModal.tsx";
import ParseDeleteDialog from "./components/ParseDeleteDialog.tsx";
import KnowledgePanel from "./components/KnowledgePanel.tsx";
import CommonCallsPanel from "./components/CommonCallsPanel.tsx";
import TaskPanel from "./components/TaskPanel.tsx";
import ChairmanPanel from "./components/ChairmanPanel.tsx";
import RightPanel from "./components/RightPanel.tsx";
import { Terminal, MessageSquare, Layers } from "lucide-react";
import { useIsMobile } from "./hooks/useIsMobile.ts";
import MobileTabBar, { type MobileTab } from "./components/MobileTabBar.tsx";
import SessionDashboard from "./components/SessionDashboard.tsx";

function renderSessionContent(session: Session | undefined, sessionId?: string, splitMessages?: any[]) {
  if (!session) return null;

  if (session.type === "terminal") {
    return <TerminalView sessionId={sessionId} />;
  }

  if (session.type === "unified") {
    return (
      <>
        <ChatThread sessionId={sessionId} messages={splitMessages} />
        <InputArea sessionId={sessionId} />
      </>
    );
  }

  return (
    <>
      <MessageList sessionId={sessionId} messages={splitMessages} />
      <InputArea sessionId={sessionId} />
    </>
  );
}

export default function App() {
  const {
    init,
    sessions,
    activeSessionId,
    createSession,
    toggleSidebar,
    unreadCounts,
    splitMode,
    splitSessionId,
    splitMessages,
    toggleSplit,
    setSplitSession,
    toggleDocs,
    toggleSettings,
    knowledgePanelOpen,
    toggleKnowledgePanel,
    toggleCommonCalls,
    toggleTaskPanel,
    toggleChairmanPanel,
    showRightPanel,
    searchOpen,
    toggleSearch,
  } = useStore();
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [splitPickerOpen, setSplitPickerOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("sessions");
  const isMobile = useIsMobile();

  useEffect(() => {
    init();
  }, []);

  // Title badge: (N) ANT
  useEffect(() => {
    const total = Object.values(unreadCounts).reduce((sum, n) => sum + n, 0);
    document.title = total > 0 ? `(${total}) ANT` : "ANT";
  }, [unreadCounts]);

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
      } else if (e.key === "F" && e.shiftKey) {
        e.preventDefault();
        toggleSearch();
      } else if (e.key === "K" && e.shiftKey) {
        e.preventDefault();
        toggleKnowledgePanel();
      } else if (e.key === "C" && e.shiftKey) {
        e.preventDefault();
        toggleCommonCalls();
      } else if (e.key === "T" && e.shiftKey) {
        e.preventDefault();
        toggleTaskPanel();
      } else if (e.key === "H" && e.shiftKey) {
        e.preventDefault();
        toggleChairmanPanel();
      } else if (e.key === "/") {
        e.preventDefault();
        toggleDocs();
      } else if (e.key === ",") {
        e.preventDefault();
        toggleSettings();
      } else if (e.key === "\\") {
        e.preventDefault();
        if (splitMode) {
          toggleSplit();
          setSplitPickerOpen(false);
        } else {
          toggleSplit();
          setSplitPickerOpen(true);
        }
      }
    },
    [createSession, toggleSidebar, splitMode, toggleSplit, toggleDocs, toggleSettings, toggleKnowledgePanel, toggleCommonCalls, toggleTaskPanel, toggleChairmanPanel, toggleSearch]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // When split mode activates without a session, show picker
  useEffect(() => {
    if (splitMode && !splitSessionId && !splitPickerOpen) {
      setSplitPickerOpen(true);
    }
  }, [splitMode, splitSessionId, splitPickerOpen]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const splitSession = splitSessionId ? sessions.find((s) => s.id === splitSessionId) : undefined;

  // Auto-switch to chat/terminal tab when a session is selected on mobile
  useEffect(() => {
    if (isMobile && activeSessionId && (mobileTab === "sessions" || mobileTab === "active")) {
      const s = sessions.find((s) => s.id === activeSessionId);
      if (s?.type === "terminal") setMobileTab("terminal");
      else setMobileTab("chat");
    }
  }, [activeSessionId, isMobile]);

  // Mobile layout
  if (isMobile) {
    return (
      <div className="flex h-screen flex-col bg-[var(--color-bg)] font-sans selection:bg-emerald-500/30">
        {/* Compact header on mobile */}
        {(mobileTab === "chat" || mobileTab === "terminal") && activeSession && (
          <Header />
        )}

        {/* Content area — switches based on tab */}
        <div className="flex-1 flex flex-col min-h-0 pb-12">
          {mobileTab === "sessions" && (
            <div className="flex-1 flex flex-col">
              <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
                <h1 className="text-lg font-semibold text-[var(--color-text)]">Sessions</h1>
                <div className="flex gap-2">
                  <button
                    onClick={() => createSession("terminal")}
                    className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                  >
                    <Terminal className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => createSession("conversation")}
                    className="p-2 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
                  >
                    <MessageSquare className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => createSession("unified")}
                    className="p-2 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20"
                  >
                    <Layers className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <Sidebar />
            </div>
          )}

          {mobileTab === "active" && <SessionDashboard />}

          {mobileTab === "chat" && activeSession && (
            renderSessionContent(activeSession)
          )}

          {mobileTab === "terminal" && activeSession?.type === "terminal" && (
            renderSessionContent(activeSession)
          )}

          {mobileTab === "terminal" && activeSession?.type === "unified" && (
            renderSessionContent(activeSession)
          )}

          {(mobileTab === "chat" || mobileTab === "terminal") && !activeSession && (
            <EmptyState onCreateSession={createSession} />
          )}

          {mobileTab === "more" && (
            <div className="flex-1 flex flex-col gap-3 p-4">
              <button onClick={() => toggleSearch()} className="p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-left text-sm text-[var(--color-text)]">
                Search sessions & messages
              </button>
              <button onClick={() => toggleSettings()} className="p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-left text-sm text-[var(--color-text)]">
                Settings
              </button>
              <button onClick={() => toggleDocs()} className="p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-left text-sm text-[var(--color-text)]">
                Documentation
              </button>
            </div>
          )}
        </div>

        <MobileTabBar
          activeTab={mobileTab}
          onTabChange={setMobileTab}
          hasActiveSession={!!activeSession}
        />

        {/* Overlays */}
        {quickSwitcherOpen && <QuickSwitcher onClose={() => setQuickSwitcherOpen(false)} />}
        {searchOpen && <SearchPanel onClose={() => toggleSearch()} />}
        <SettingsModal />
        <DocsModal />
        <ParseDeleteDialog />
        <KnowledgePanel />
        <CommonCallsPanel />
        <TaskPanel />
        <ChairmanPanel />
        <OfflineOverlay />
      </div>
    );
  }

  // Desktop layout (unchanged)
  return (
    <div className="flex h-screen flex-col bg-[var(--color-bg)] font-sans selection:bg-emerald-500/30">
      <div className="flex flex-1 min-h-0">
        <AnimatePresence>
          <Sidebar />
        </AnimatePresence>

        {splitMode && splitSession ? (
          // Split view: two panels side by side
          <div className="flex-1 flex min-w-0">
            {/* Left panel — active session */}
            <div className="flex-1 flex flex-col min-w-0 border-r border-[var(--color-border)]">
              <Header />
              {activeSession ? (
                renderSessionContent(activeSession)
              ) : (
                <EmptyState onCreateSession={createSession} />
              )}
            </div>
            {/* Right panel — split session */}
            <div className="flex-1 flex flex-col min-w-0">
              <SplitHeader session={splitSession} onClose={toggleSplit} />
              {renderSessionContent(splitSession, splitSessionId ?? undefined, splitMessages)}
            </div>
          </div>
        ) : (
          // Normal single-panel view
          <div className="flex-1 flex min-w-0">
            <div className="flex-1 flex flex-col min-w-0">
              <Header />
              {activeSession ? (
                renderSessionContent(activeSession)
              ) : (
                <EmptyState onCreateSession={createSession} />
              )}
            </div>
            {activeSession && activeSession.type !== "terminal" && showRightPanel && <RightPanel />}
          </div>
        )}
      </div>

      <StatusBar />

      {quickSwitcherOpen && (
        <QuickSwitcher onClose={() => setQuickSwitcherOpen(false)} />
      )}

      {searchOpen && (
        <SearchPanel onClose={() => toggleSearch()} />
      )}

      {splitPickerOpen && splitMode && !splitSessionId && (
        <QuickSwitcher
          onClose={() => {
            setSplitPickerOpen(false);
            if (!splitSessionId) toggleSplit();
          }}
          onSelect={(id) => {
            setSplitSession(id);
            setSplitPickerOpen(false);
          }}
        />
      )}

      <SettingsModal />
      <DocsModal />
      <ParseDeleteDialog />
      <KnowledgePanel />
      <CommonCallsPanel />
      <TaskPanel />
      <ChairmanPanel />

      <OfflineOverlay />
    </div>
  );
}

function EmptyState({
  onCreateSession,
}: {
  onCreateSession: (type: "terminal" | "conversation" | "unified", name?: string) => void;
}) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-lg font-medium text-[var(--color-text-muted)] mb-6">
          Welcome to ANT
        </h2>
        <p className="text-sm text-[var(--color-text-dim)] mb-8 max-w-sm">
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
