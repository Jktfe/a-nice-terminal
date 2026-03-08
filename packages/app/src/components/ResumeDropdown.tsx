import { useState, useRef, useEffect } from "react";
import { RotateCcw, Copy, ChevronDown, X, Check } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useStore, type ResumeCommand } from "../store.ts";

const CLI_COLOURS: Record<string, string> = {
  claude: "bg-orange-500/20 text-orange-400",
  codex: "bg-green-500/20 text-green-400",
  gemini: "bg-blue-500/20 text-blue-400",
  copilot: "bg-purple-500/20 text-purple-400",
};

const CLI_FLAGS: Record<string, string[]> = {
  claude: ["--verbose", "--dangerously-skip-permissions"],
  codex: ["--last", "--all"],
  gemini: ["--list-sessions"],
  copilot: ["--continue"],
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={copy}
      className="p-1 rounded hover:bg-white/10 transition-colors"
      title="Copy command"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-emerald-400" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-white/40" />
      )}
    </button>
  );
}

function FlagCopyButton({ command, cli }: { command: string; cli: string }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const flags = CLI_FLAGS[cli] || [];

  if (!flags.length) return null;

  const toggle = (flag: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(flag)) next.delete(flag);
      else next.add(flag);
      return next;
    });
  };

  const copyWithFlags = async () => {
    const full = [command, ...Array.from(selected)].join(" ");
    await navigator.clipboard.writeText(full);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
      setOpen(false);
      setSelected(new Set());
    }, 1200);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-1 rounded hover:bg-white/10 transition-colors flex items-center gap-0.5"
        title="Copy with flags"
      >
        <Copy className="w-3.5 h-3.5 text-white/40" />
        <ChevronDown className="w-2.5 h-2.5 text-white/30" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full mt-1 z-50 bg-[#1a1a1a] border border-white/10 rounded-lg p-2 min-w-[200px] shadow-xl"
          >
            <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1.5">
              Flags
            </p>
            {flags.map((flag) => (
              <label
                key={flag}
                className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-white/5 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(flag)}
                  onChange={() => toggle(flag)}
                  className="accent-emerald-500 w-3 h-3"
                />
                <code className="text-xs text-white/60">{flag}</code>
              </label>
            ))}
            <button
              onClick={copyWithFlags}
              disabled={selected.size === 0}
              className="mt-2 w-full text-xs px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {copied ? "Copied!" : "Copy with flags"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ResumeEntry({ cmd }: { cmd: ResumeCommand }) {
  const { deleteResumeCommand } = useStore();
  const colour = CLI_COLOURS[cmd.cli] || "bg-white/10 text-white/60";

  return (
    <div className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 group">
      <span
        className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${colour} flex-shrink-0 mt-0.5`}
      >
        {cmd.cli}
      </span>

      <div className="min-w-0 flex-1">
        <code className="text-xs text-white/80 break-all">{cmd.command}</code>
        {cmd.description && (
          <p className="text-[10px] text-white/30 truncate mt-0.5">
            {cmd.description}
          </p>
        )}
        {cmd.root_path && (
          <p className="text-[10px] text-white/20 truncate">
            {cmd.root_path}
          </p>
        )}
        <p className="text-[10px] text-white/20 mt-0.5">
          {relativeTime(cmd.captured_at)}
        </p>
      </div>

      <div className="flex items-center gap-0.5 flex-shrink-0">
        <CopyButton text={cmd.command} />
        <FlagCopyButton command={cmd.command} cli={cmd.cli} />
        <button
          onClick={() => deleteResumeCommand(cmd.id)}
          className="p-1 rounded hover:bg-red-500/20 transition-colors opacity-0 group-hover:opacity-100"
          title="Remove"
        >
          <X className="w-3.5 h-3.5 text-red-400/60" />
        </button>
      </div>
    </div>
  );
}

export default function ResumeDropdown() {
  const { resumeCommands } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (resumeCommands.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 text-white/40 hover:text-white/80 hover:bg-white/5 rounded transition-colors"
        title="Resume commands"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        <span className="text-[10px] uppercase tracking-widest hidden sm:inline">
          Resume
        </span>
        <span className="text-[10px] bg-white/10 text-white/50 rounded-full px-1.5 min-w-[18px] text-center">
          {resumeCommands.length}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 z-50 bg-[#141414] border border-white/10 rounded-xl shadow-2xl w-[360px] max-h-[400px] overflow-y-auto"
          >
            <div className="px-3 py-2 border-b border-white/5">
              <p className="text-[10px] text-white/30 uppercase tracking-widest font-medium">
                Captured Resume Commands
              </p>
            </div>
            <div className="p-1.5 flex flex-col gap-0.5">
              {resumeCommands.map((cmd) => (
                <ResumeEntry key={cmd.id} cmd={cmd} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
