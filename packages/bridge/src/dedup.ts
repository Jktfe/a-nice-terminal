import type { AntMessage } from "./types.js";

const MAX_TRACKED_IDS = 500;

export class DedupTracker {
  readonly source: string;
  private recentIds: string[] = [];

  constructor(source: string) {
    this.source = source;
  }

  /** Returns true if this message should be skipped (it originated from this bridge) */
  shouldSkip(msg: AntMessage): boolean {
    // Primary check: metadata.source matches our source
    if (msg.metadata?.source === this.source) return true;

    // Secondary check: message ID was recently posted by us
    if (this.recentIds.includes(msg.id)) return true;

    return false;
  }

  /** Track a message ID that we posted, so we can skip it on echo */
  trackPosted(messageId: string): void {
    this.recentIds.push(messageId);
    if (this.recentIds.length > MAX_TRACKED_IDS) {
      this.recentIds = this.recentIds.slice(-MAX_TRACKED_IDS);
    }
  }
}
