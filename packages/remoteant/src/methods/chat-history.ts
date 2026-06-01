import { parseEnv } from "../env.ts";
import { antApiFetch } from "./http-client.ts";
import { validateChatHistoryParams } from "./validation.ts";

type DaemonMessage = {
  id: string;
  authorHandle?: string;
  handle?: string;
  body: string;
  postedAt?: string;
  ts?: string;
  parentMessageId?: string;
};

export async function antChatHistory(params: unknown) {
  const { roomId, since, limit } = validateChatHistoryParams(params);
  const qs = new URLSearchParams();
  if (limit !== undefined) qs.set("limit", String(limit));
  if (since) qs.set("since", since);
  const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
  const response = await antApiFetch<{ messages: DaemonMessage[] }>(
    `/api/chat-rooms/${encodeURIComponent(roomId)}/messages${suffix}`,
    { method: "GET", env: parseEnv() },
  );
  return {
    messages: response.messages.map((message) => ({
      id: message.id,
      handle: message.authorHandle ?? message.handle ?? "@unknown",
      body: message.body,
      ts: message.postedAt ?? message.ts ?? "",
      replyTo: message.parentMessageId ?? null,
    })),
  };
}
