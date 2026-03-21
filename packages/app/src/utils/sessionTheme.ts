import { Terminal, MessageSquare } from "lucide-react";

export function getSessionTheme(type: "terminal" | "conversation", uiTheme: "light" | "dark" | "system" = "dark") {
  const isLight = uiTheme === "light" || (uiTheme === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
  
  if (type === "terminal") {
    return {
      chip: isLight ? "bg-emerald-500/10" : "bg-emerald-500/10",
      icon: isLight ? "text-emerald-600" : "text-emerald-400",
      Icon: Terminal
    };
  }
  
  return {
    chip: isLight ? "bg-blue-500/10" : "bg-blue-500/10",
    icon: isLight ? "text-blue-600" : "text-blue-400",
    Icon: MessageSquare
  };
}
