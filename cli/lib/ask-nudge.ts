// ant ask nudge / ant ask outstanding helpers.
//
// Pure functions that turn an ask record into a paste-ready CLI snippet so
// human responders can answer without having to remember the syntax. Used by
// the `nudge` subcommand (posts the snippet into the asks own room) and by
// `outstanding` (prints the same snippet locally for the operator).

export interface NudgeAsk {
  id: string;
  title: string;
  status?: string;
  assigned_to?: string | null;
  body?: string | null;
  recommendation?: string | null;
  session_id?: string | null;
  session_name?: string | null;
}

export interface NudgeOptions {
  // Optional override for the leading address line; defaults to the asks
  // assigned_to (or @everyone if unassigned). Caller can pass an explicit
  // handle for `outstanding --to @x` flows.
  addressedTo?: string | null;
}

export function buildNudgeSnippet(ask: NudgeAsk, opts: NudgeOptions = {}): string {
  const assignee = (opts.addressedTo ?? ask.assigned_to ?? '@everyone') || '@everyone';
  const status = ask.status ?? 'open';
  const id = ask.id;
  const lines: string[] = [];
  lines.push(`${assignee} — ${status} ask [${id}]: ${ask.title}`);
  if (ask.body && ask.body.trim().length > 0) lines.push(`Context: ${ask.body.trim()}`);
  if (ask.recommendation && ask.recommendation.trim().length > 0) {
    lines.push(`Recommend: ${ask.recommendation.trim()}`);
  }
  lines.push('');
  lines.push('To answer, paste ONE of these:');
  lines.push(`  ant ask answer ${id} approve --msg "your reply"`);
  lines.push(`  ant ask answer ${id} reject  --msg "why not"`);
  lines.push(`  ant ask answer ${id} defer   --msg "later"`);
  lines.push(`  ant ask answer ${id} dismiss --msg "n/a"`);
  return lines.join('\n');
}
