import type { Client } from "./client.js";

export interface ResolvedSession {
  id: string;
  name: string;
  type: "terminal" | "conversation";
  archived?: number;
  workspace_id?: string | null;
  [key: string]: any;
}

export async function resolveSession(client: Client, input: string): Promise<ResolvedSession> {
  // Step 1: Try as ID
  try {
    const session = await client.get(`/api/sessions/${encodeURIComponent(input)}`);
    if (session && session.id) return session;
  } catch {
    // Not an ID — fall through to name search
  }

  // Step 2: Search by name
  const result = await client.get(`/api/search?q=${encodeURIComponent(input)}`);
  const sessions: { id: string; name: string; type: string }[] = result.sessions || [];

  if (sessions.length === 0) {
    throw new Error(`No session found matching "${input}"`);
  }

  // Step 3: Score matches — exact case-insensitive wins
  const inputLower = input.toLowerCase();
  const exact = sessions.filter((s) => s.name.toLowerCase() === inputLower);
  if (exact.length === 1) {
    return client.get(`/api/sessions/${exact[0].id}`);
  }

  // Substring match
  const substring = sessions.filter((s) => s.name.toLowerCase().includes(inputLower));
  if (substring.length === 1) {
    return client.get(`/api/sessions/${substring[0].id}`);
  }

  // Step 4: Ambiguous
  if (sessions.length === 1) {
    return client.get(`/api/sessions/${sessions[0].id}`);
  }

  const names = sessions.map((s) => `  ${s.name} (${s.id})`).join("\n");
  throw new Error(`Ambiguous: "${input}" matches ${sessions.length} sessions:\n${names}`);
}
