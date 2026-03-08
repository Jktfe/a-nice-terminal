import { useCallback, useEffect, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Send } from "lucide-react";
import { useStore } from "../store.ts";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isMobile;
}

export default function InputArea() {
  const { sendMessage, activeSessionId } = useStore();
  const isMobile = useIsMobile();

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: {
          HTMLAttributes: { class: "font-mono text-sm" },
        },
      }),
      Placeholder.configure({
        placeholder: isMobile
          ? "Type a message..."
          : "Type a message... (Cmd+Enter to send)",
      }),
    ],
    editorProps: {
      attributes: {
        class: "tiptap text-sm text-white/90 px-4 py-3 outline-none",
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          handleSend();
          return true;
        }
        return false;
      },
    },
  });

  const handleSend = useCallback(() => {
    if (!editor || !activeSessionId) return;

    const text = editor.getText().trim();
    if (!text) return;

    sendMessage(text);
    editor.commands.clearContent();
  }, [editor, activeSessionId, sendMessage]);

  if (!activeSessionId) return null;

  return (
    <footer className="p-4 bg-[var(--color-surface)] border-t border-[var(--color-border)]">
      <div className="max-w-3xl mx-auto relative">
        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden focus-within:border-emerald-500/40 focus-within:ring-1 focus-within:ring-emerald-500/20 transition-all">
          <EditorContent editor={editor} />

          <div className="flex items-center justify-between px-3 py-2 border-t border-white/5">
            {isMobile ? (
              <div />
            ) : (
              <div className="flex items-center gap-2 text-white/30 text-[10px]">
                <kbd className="px-1.5 py-0.5 bg-white/5 rounded border border-white/10">
                  Cmd+Enter
                </kbd>
                <span>to send</span>
              </div>
            )}
            <button
              onClick={handleSend}
              className={`p-1.5 transition-colors ${
                isMobile
                  ? "bg-emerald-500/20 text-emerald-400 rounded-lg px-3"
                  : "text-white/40 hover:text-emerald-400"
              }`}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
