export interface KeyboardShortcut {
  keys: string;
  label: string;
  description: string;
}

export const keyboardShortcuts: KeyboardShortcut[] = [
  {
    keys: "Cmd+N",
    label: "New terminal session",
    description: "Create a new terminal session with a PTY-backed shell.",
  },
  {
    keys: "Cmd+Shift+N",
    label: "New conversation session",
    description: "Create a new conversation session for structured messaging.",
  },
  {
    keys: "Cmd+K",
    label: "Quick switcher",
    description: "Open the quick switcher to jump between sessions by name.",
  },
  {
    keys: "Cmd+B",
    label: "Toggle sidebar",
    description: "Show or hide the session sidebar.",
  },
  {
    keys: "Cmd+Shift+F",
    label: "Global search",
    description: "Open the global search overlay to find sessions and messages.",
  },
  {
    keys: "Cmd+\\",
    label: "Toggle split view",
    description: "Toggle side-by-side split view for two sessions.",
  },
  {
    keys: "Cmd+/",
    label: "Toggle docs modal",
    description: "Open or close the in-app documentation modal.",
  },
  {
    keys: "Cmd+Shift+.",
    label: "Toggle AeroChat view",
    description: "Switch between classic and AeroChat view modes.",
  },
];
