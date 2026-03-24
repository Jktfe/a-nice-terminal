import { LayoutGrid, Activity, MessageSquare, Terminal, MoreHorizontal } from "lucide-react";

export type MobileTab = "sessions" | "active" | "chat" | "terminal" | "more";

interface MobileTabBarProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  hasActiveSession: boolean;
}

const TABS: { id: MobileTab; label: string; Icon: typeof LayoutGrid }[] = [
  { id: "sessions", label: "Sessions", Icon: LayoutGrid },
  { id: "active", label: "Active", Icon: Activity },
  { id: "chat", label: "Chat", Icon: MessageSquare },
  { id: "terminal", label: "Terminal", Icon: Terminal },
  { id: "more", label: "More", Icon: MoreHorizontal },
];

export default function MobileTabBar({ activeTab, onTabChange, hasActiveSession }: MobileTabBarProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] border-t border-[var(--color-border)] pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-12">
        {TABS.map(({ id, label, Icon }) => {
          const isActive = activeTab === id;
          const disabled = (id === "chat" || id === "terminal") && !hasActiveSession;

          return (
            <button
              key={id}
              onClick={() => !disabled && onTabChange(id)}
              disabled={disabled}
              className={`flex flex-col items-center justify-center flex-1 h-full gap-0.5 transition-colors ${
                isActive
                  ? "text-emerald-400"
                  : disabled
                    ? "text-[var(--color-text-dim)] opacity-40"
                    : "text-[var(--color-text-muted)]"
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
