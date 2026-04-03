export type Role = "human" | "agent" | "system";

export const VALID_FORMATS = new Set(["markdown", "text", "plaintext", "json"]);
export const SAFE_TEXT_LIMIT = 10_000;

export function normalizeRole(role: string): Role | null {
  switch (role) {
    case "human":
    case "user":
      return "human";
    case "agent":
    case "assistant":
      return "agent";
    case "system":
      return "system";
    default:
      return null;
  }
}
