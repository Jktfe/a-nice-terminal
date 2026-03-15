import { useMemo, useState } from "react";
import { ThumbsDown, ThumbsUp, ChevronDown, ChevronUp } from "lucide-react";
import { chatApiFetch, type Message } from "../store.ts";

interface SessionRatingProps {
  message: Message;
  sessionId: string;
  onAnnotationChange: (annotations: Message["annotations"], starred: number) => void;
}

type RatingKey = "outcome" | "speed" | "trust";

const LABELS: Record<RatingKey, string> = {
  outcome: "Outcome",
  speed: "Speed",
  trust: "Trust",
};

export default function SessionRating({ message, sessionId, onAnnotationChange }: SessionRatingProps) {
  const existing = useMemo(
    () => message.annotations?.find((annotation) => annotation.type === "session_rating" && annotation.by === "human"),
    [message.annotations]
  );
  const [expanded, setExpanded] = useState(Boolean(existing?.data?.outcome || existing?.data?.speed || existing?.data?.trust));
  const [saving, setSaving] = useState(false);

  const sentiment = existing?.data?.sentiment;
  const details = existing?.data ?? {};
  const note = existing?.note ?? "";

  const sendRating = async (next: { sentiment?: "up" | "down"; outcome?: number; speed?: number; trust?: number; note?: string }) => {
    setSaving(true);
    try {
      const payload = {
        type: "session_rating",
        by: "human",
        note: next.note,
        data: {
          sentiment: next.sentiment,
          outcome: next.outcome,
          speed: next.speed,
          trust: next.trust,
        },
      };
      const result = await chatApiFetch(`/api/sessions/${sessionId}/messages/${message.id}/annotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      onAnnotationChange(result.annotations, result.starred);
    } catch (error) {
      console.error("Failed to update session rating", error);
    } finally {
      setSaving(false);
    }
  };

  const setSentiment = (nextSentiment: "up" | "down") => {
    void sendRating({
      sentiment: nextSentiment,
      outcome: details.outcome,
      speed: details.speed,
      trust: details.trust,
      note,
    });
  };

  const setDetail = (key: RatingKey, value: number) => {
    void sendRating({
      sentiment,
      outcome: key === "outcome" ? value : details.outcome,
      speed: key === "speed" ? value : details.speed,
      trust: key === "trust" ? value : details.trust,
      note,
    });
  };

  const toggleExpanded = () => setExpanded((current) => !current);

  return (
    <div className="mt-3 rounded-xl border border-emerald-400/15 bg-black/20 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/45">Session rating</p>
          <p className="text-xs text-white/55">Quick read first, optional detail after.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={saving}
            onClick={() => setSentiment("up")}
            className={`rounded-lg border px-2.5 py-1.5 transition-colors ${
              sentiment === "up"
                ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-300"
                : "border-white/10 text-white/55 hover:border-white/20 hover:text-white/80"
            }`}
            title="Useful"
          >
            <ThumbsUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => setSentiment("down")}
            className={`rounded-lg border px-2.5 py-1.5 transition-colors ${
              sentiment === "down"
                ? "border-rose-400/40 bg-rose-400/15 text-rose-300"
                : "border-white/10 text-white/55 hover:border-white/20 hover:text-white/80"
            }`}
            title="Missed"
          >
            <ThumbsDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={toggleExpanded}
            className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/55 transition-colors hover:border-white/20 hover:text-white/80"
          >
            <span className="inline-flex items-center gap-1">
              Detail
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </span>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2">
          {(Object.keys(LABELS) as RatingKey[]).map((key) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <span className="text-xs text-white/55">{LABELS[key]}</span>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((value) => {
                  const active = details[key] === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      disabled={saving}
                      onClick={() => setDetail(key, value)}
                      className={`h-7 w-7 rounded-md border text-xs transition-colors ${
                        active
                          ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-300"
                          : "border-white/10 text-white/55 hover:border-white/20 hover:text-white/80"
                      }`}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
