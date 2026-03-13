import { Terminal, MessageSquare } from "lucide-react";

export function getSessionTheme(type: "terminal" | "conversation") {
  return type === "terminal"
    ? { chip: "bg-emerald-500/10", icon: "text-emerald-400", Icon: Terminal }
    : { chip: "bg-blue-500/10", icon: "text-blue-400", Icon: MessageSquare };
}
