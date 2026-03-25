import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Mention from "@tiptap/extension-mention";
import { Send, Image, X, Loader2 } from "lucide-react";
import { useStore, apiFetch } from "../store.ts";
import { useIsMobile } from "../hooks/useIsMobile.ts";

interface Attachment {
  url: string;
  filename: string;
  type: string;
}

interface MentionItem {
  id: string;
  label: string;
  model?: string;
}

// Mention suggestion dropdown rendered inline by Tiptap
function MentionList({
  items,
  command,
  selectedIndex,
}: {
  items: MentionItem[];
  command: (item: MentionItem) => void;
  selectedIndex: number;
}) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg overflow-hidden py-1 min-w-[180px]">
      {items.length === 0 ? (
        <div className="px-3 py-2 text-xs text-[var(--color-text-dim)]">No participants found</div>
      ) : (
        items.map((item, index) => (
          <button
            key={item.id}
            onClick={() => command(item)}
            className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors ${
              index === selectedIndex
                ? "bg-emerald-500/20 text-emerald-400"
                : "text-[var(--color-text)] hover:bg-[var(--color-hover)]"
            }`}
          >
            <span className="font-medium">{item.label}</span>
            {item.model && (
              <span className="text-[10px] text-[var(--color-text-dim)]">{item.model}</span>
            )}
          </button>
        ))
      )}
    </div>
  );
}

export default function InputArea({ sessionId: sessionIdProp }: { sessionId?: string } = {}) {
  const { sendMessage, sendMessageToSession, activeSessionId: storeActiveSessionId, uploadFile, sessions, saveDraft, clearDraft } = useStore();
  const activeSessionId = sessionIdProp ?? storeActiveSessionId;
  const isMobile = useIsMobile();

  // Refs to avoid stale closures in Tiptap's onUpdate callback
  const sessionIdRef = useRef(activeSessionId);
  sessionIdRef.current = activeSessionId;
  const saveDraftRef = useRef(saveDraft);
  saveDraftRef.current = saveDraft;
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionPos, setMentionPos] = useState<{ top: number; left: number } | null>(null);
  const mentionCommandRef = useRef<((item: MentionItem) => void) | null>(null);

  const activeSession = sessions.find(s => s.id === activeSessionId);

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
      Mention.configure({
        HTMLAttributes: {
          class: "text-emerald-400 font-medium",
        },
        suggestion: {
          items: async ({ query }: { query: string }): Promise<MentionItem[]> => {
            try {
              const seen = new Set<string>();
              const participants: MentionItem[] = [];

              // Primary source: sender_name values from this conversation's messages
              const sid = sessionIdRef.current;
              if (sid) {
                const msgs: Array<{ sender_name?: string; role?: string }> = await apiFetch(`/api/sessions/${sid}/messages`);
                for (const m of msgs) {
                  const name = m.sender_name;
                  if (name && !seen.has(name)) {
                    seen.add(name);
                    participants.push({ id: name, label: name });
                  }
                }
              }

              // Secondary source: registered chat room participants
              const rooms = await apiFetch("/api/chat-rooms");
              for (const room of rooms) {
                for (const p of room.participants || []) {
                  if (!seen.has(p.agentName)) {
                    seen.add(p.agentName);
                    participants.push({ id: p.terminalSessionId, label: p.agentName, model: p.model });
                  }
                }
              }

              return participants.filter((item: MentionItem) =>
                item.label.toLowerCase().includes(query.toLowerCase())
              );
            } catch {
              return [];
            }
          },
          render: () => ({
            onStart: (props: any) => {
              setMentionItems(props.items);
              setMentionIndex(0);
              setMentionOpen(true);
              mentionCommandRef.current = props.command;
              const rect = props.clientRect?.();
              if (rect) setMentionPos({ top: rect.top, left: rect.left });
            },
            onUpdate: (props: any) => {
              setMentionItems(props.items);
              mentionCommandRef.current = props.command;
              const rect = props.clientRect?.();
              if (rect) setMentionPos({ top: rect.top, left: rect.left });
            },
            onKeyDown: (props: any) => {
              if (props.event.key === "ArrowUp") {
                setMentionIndex((prev) => (prev - 1 + mentionItems.length) % mentionItems.length);
                return true;
              }
              if (props.event.key === "ArrowDown") {
                setMentionIndex((prev) => (prev + 1) % mentionItems.length);
                return true;
              }
              if (props.event.key === "Enter") {
                const items = mentionItems;
                // Use a callback to get fresh index
                setMentionIndex((idx) => {
                  if (items[idx]) mentionCommandRef.current?.(items[idx]);
                  return idx;
                });
                return true;
              }
              return false;
            },
            onExit: () => {
              setMentionOpen(false);
              setMentionItems([]);
              mentionCommandRef.current = null;
            },
          }),
        },
      }),
    ],
    onUpdate: ({ editor: e }) => {
      const sid = sessionIdRef.current;
      if (sid) saveDraftRef.current(sid, e.getText());
    },
    editorProps: {
      attributes: {
        class: "tiptap text-sm text-[var(--color-text)] px-4 py-3 outline-none",
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

  // Restore draft when switching sessions
  useEffect(() => {
    if (!editor || !activeSessionId) return;
    const draft = useStore.getState().draftsBySessionId[activeSessionId] || "";
    if (draft) {
      editor.commands.setContent(draft);
    } else {
      editor.commands.clearContent();
    }
  }, [editor, activeSessionId]);

  const handleSend = useCallback(async () => {
    if (!editor || !activeSessionId) return;

    const text = editor.getText().trim();
    if (!text && attachments.length === 0) return;

    const metadata = attachments.length > 0 ? { images: attachments.map(a => a.url) } : null;

    if (sessionIdProp) {
      sendMessageToSession(activeSessionId, text, "human");
    } else {
      sendMessage(text, "human", metadata);
    }
    editor.commands.clearContent();
    if (activeSessionId) clearDraft(activeSessionId);
    setAttachments([]);
  }, [editor, activeSessionId, sessionIdProp, sendMessage, sendMessageToSession, attachments, clearDraft]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setUploading(true);
    try {
      const newAttachments: Attachment[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        const result = await uploadFile(file);
        newAttachments.push({
          url: result.url,
          filename: result.filename,
          type: file.type
        });
      }
      setAttachments(prev => [...prev, ...newAttachments]);
    } catch (err) {
      console.error("Upload failed", err);
    } finally {
      setUploading(false);
    }
  }, [uploadFile]);

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  if (!activeSessionId) return null;

  return (
    <footer 
      className={`p-4 bg-[var(--color-surface)] border-t border-[var(--color-border)] transition-colors ${isDragging ? "bg-emerald-500/5" : ""}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <div className="max-w-3xl mx-auto relative">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {attachments.map((file, i) => (
              <div key={i} className="group relative w-16 h-16 rounded-lg border border-[var(--color-input-border)] overflow-hidden bg-[var(--color-hover)]">
                <img src={file.url} alt={file.filename} className="w-full h-full object-cover" />
                <button
                  onClick={() => removeAttachment(i)}
                  className="absolute top-0.5 right-0.5 p-0.5 bg-black/60 text-[var(--color-text)] rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            {uploading && (
              <div className="w-16 h-16 rounded-lg border border-[var(--color-input-border)] border-dashed flex items-center justify-center bg-[var(--color-hover)]">
                <Loader2 className="w-5 h-5 text-[var(--color-text-dim)] animate-spin" />
              </div>
            )}
          </div>
        )}

        <div className={`bg-[var(--color-hover)] border border-[var(--color-input-border)] rounded-xl overflow-hidden transition-all ${isDragging ? "border-emerald-500/40 ring-1 ring-emerald-500/20" : "focus-within:border-emerald-500/40 focus-within:ring-1 focus-within:ring-emerald-500/20"}`}>
          <EditorContent editor={editor} />
          {mentionOpen && mentionPos && (
            <div
              className="fixed z-50"
              style={{ left: mentionPos.left, top: mentionPos.top - 8, transform: "translateY(-100%)" }}
            >
              <MentionList
                items={mentionItems}
                command={(item) => mentionCommandRef.current?.(item)}
                selectedIndex={mentionIndex}
              />
            </div>
          )}

          <div className="flex items-center justify-between px-3 py-2 border-t border-[var(--color-border)]">
            <div className="flex items-center gap-2">
              <label className="p-1.5 text-[var(--color-text-dim)] hover:text-[var(--color-text)] cursor-pointer transition-colors">
                <Image className="w-4 h-4" />
                <input 
                  type="file" 
                  multiple 
                  accept="image/*" 
                  className="hidden" 
                  onChange={(e) => e.target.files && handleFiles(e.target.files)} 
                />
              </label>
              {isMobile ? null : (
                <div className="flex items-center gap-2 text-[var(--color-text-dim)] text-[10px]">
                  <kbd className="px-1.5 py-0.5 bg-[var(--color-hover)] rounded border border-[var(--color-input-border)]">
                    Cmd+Enter
                  </kbd>
                  <span>to send</span>
                </div>
              )}
            </div>
            
            <button
              onClick={handleSend}
              disabled={uploading || (!editor?.getText().trim() && attachments.length === 0)}
              className={`p-1.5 transition-colors disabled:opacity-30 ${
                isMobile
                  ? "bg-emerald-500/20 text-emerald-400 rounded-lg px-3"
                  : "text-[var(--color-text-dim)] hover:text-emerald-400"
              }`}
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
