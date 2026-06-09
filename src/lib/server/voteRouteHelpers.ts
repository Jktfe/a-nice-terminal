import { error } from '@sveltejs/kit';
import { postSystemMessage } from './chatMessageStore';
import type { VoteView } from './voteStore';

export function postVoteReceipts(vote: VoteView, body: string): void {
  for (const roomId of vote.roomIds) {
    postSystemMessage({ roomId, body });
  }
}

export function voteSummary(vote: VoteView): string {
  const options = vote.tally.map((row) => `${row.label}=${row.count}`).join(' · ');
  return `voteID=${vote.id} state=${vote.state} voters=${vote.eligibleVoters.join(', ')} missing=${vote.missingVoters.join(', ') || '-'} options=${options}`;
}

export function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw error(400, `${name} (non-empty string) is required.`);
  }
  return value.trim();
}

export function readStringList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return unique(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()));
  }
  if (typeof value === 'string') {
    return unique(value.split(',').map((item) => item.trim()));
  }
  return [];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0))).sort();
}
