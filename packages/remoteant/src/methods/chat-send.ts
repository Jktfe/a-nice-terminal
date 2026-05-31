import { parseEnv } from "../env.ts";
import { antApiFetch } from "./http-client.ts";
import { processIdentityChain } from "./identity-chain.ts";
import { validateChatSendParams } from "./validation.ts";

export async function antChatSend(params: unknown) {
  const { roomId, body, kind } = validateChatSendParams(params);
  const response = await antApiFetch<{ message: { id: string; postedAt: string } }>(
    `/api/chat-rooms/${encodeURIComponent(roomId)}/messages`,
    {
      method: "POST",
      env: parseEnv(),
      body: JSON.stringify({
        body,
        kind: kind ?? "human",
        authorHandle: process.env.ANT_AS_HANDLE ?? "@remoteant",
        pidChain: processIdentityChain(),
      }),
    },
  );
  return { messageId: response.message.id, ts: response.message.postedAt };
}
