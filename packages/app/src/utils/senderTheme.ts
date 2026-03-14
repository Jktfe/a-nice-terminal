import { User, Bot, Settings, Sparkles, Code, Cpu, CircleHelp } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface SenderTheme {
  accent: string;
  bg: string;
  border: string;
  icon: LucideIcon;
  label: string;
}

const themes: Record<string, SenderTheme> = {
  human: {
    accent: "#10b981",
    bg: "rgba(16, 185, 129, 0.08)",
    border: "rgba(16, 185, 129, 0.3)",
    icon: User,
    label: "Human",
  },
  claude: {
    accent: "#f59e0b",
    bg: "rgba(245, 158, 11, 0.08)",
    border: "rgba(245, 158, 11, 0.3)",
    icon: Sparkles,
    label: "Claude",
  },
  codex: {
    accent: "#22c55e",
    bg: "rgba(34, 197, 94, 0.08)",
    border: "rgba(34, 197, 94, 0.3)",
    icon: Code,
    label: "Codex",
  },
  gemini: {
    accent: "#3b82f6",
    bg: "rgba(59, 130, 246, 0.08)",
    border: "rgba(59, 130, 246, 0.3)",
    icon: Cpu,
    label: "Gemini",
  },
  copilot: {
    accent: "#a855f7",
    bg: "rgba(168, 85, 247, 0.08)",
    border: "rgba(168, 85, 247, 0.3)",
    icon: Bot,
    label: "Copilot",
  },
  system: {
    accent: "#525252",
    bg: "rgba(82, 82, 82, 0.06)",
    border: "rgba(82, 82, 82, 0.2)",
    icon: Settings,
    label: "System",
  },
  unknown: {
    accent: "#e5e5e5",
    bg: "rgba(229, 229, 229, 0.06)",
    border: "rgba(229, 229, 229, 0.15)",
    icon: CircleHelp,
    label: "Unknown",
  },
};

export function getSenderTheme(senderType?: string | null): SenderTheme {
  return themes[senderType || "unknown"] || themes.unknown;
}

export function isHuman(senderType?: string | null): boolean {
  return senderType === "human";
}

export function isSystem(senderType?: string | null): boolean {
  return senderType === "system";
}
