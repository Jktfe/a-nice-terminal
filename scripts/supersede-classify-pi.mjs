#!/usr/bin/env node
/**
 * supersede-classify-pi — flag mined lessons that describe SUPERSEDED (pre-Desk-
 * cutover) ANT identity/auth mechanics, so agents stop referencing old modes.
 * Uses pi workers on Ollama cloud models (off Claude). Conservative: default
 * KEEP; only clear old-mode workarounds are moved.
 *
 * Superseded ones are moved to _mined/_superseded/ with a `status: superseded`
 * frontmatter field + a loud "OLD — do not apply" banner — out of the active
 * set (doesn't clog) but preserved + unmistakably marked.
 *
 * Usage: node scripts/supersede-classify-pi.mjs --files <listfile> [--workers 8] [--limit N] [--dry-run]
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const MINED = join(homedir(), 'CascadeProjects', 'ObsidiANT', 'memory-pack', '_mined');
const SUP = join(MINED, '_superseded');
const MODELS = ['minimax-m3:cloud', 'kimi-k2.7-code:cloud'];
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const LIST = arg('--files', '/tmp/supersede-candidates.txt');
const WORKERS = parseInt(arg('--workers', '8'), 10) || 8;
const LIMIT = parseInt(arg('--limit', '0'), 10) || 0;
const DRY = process.argv.includes('--dry-run');

const SYS = `You decide whether a mined engineering "lesson" about ANT identity/auth describes a SUPERSEDED (obsolete) mechanism.

CURRENT model — "The Desk" (ratified 2026-06-15 clean-identity cutover): identity = an @ANThandle CLAIMED by one of two roots of trust — a daemon-WITNESSED tmux-pane pid, OR a remote invite token. The durable session (x-ant-session-id / sessionId) is the credential EVERY mutation verb must attach. pidChain is NOT identity (only corroboration). Lifecycle is active→retired→deleted. Pane death = PARK (recoverable), not death.

The cutover REPLACED these OLD mechanics — a lesson whose CORE advice is one of them is SUPERSEDED:
- pidChain treated AS identity / identity guessed from the process tree
- ANT_SESSION_ID env-var workarounds to fix rooms-post 403s
- the "ant rooms post vs ant chat send" credential divergence as a live workaround
- legacy/shadow/clean resolver ENV-MODE seams
- multi-membership-table resolution guesswork
- the in-room-but-unbound writer/reader split

Output ONLY JSON {"superseded":true|false,"reason":"short"}.
superseded=true ONLY if the lesson's core actionable advice is one of those replaced old mechanics an agent should NOT follow today.
superseded=false (DEFAULT) if the lesson is still valid under the Desk model (e.g. "mutations must attach the durable session token", "a pane witnesses identity", "park not tombstone", "ant chat reply still 401s use chat send"), is not really about the changed mechanics, or you are unsure. Be conservative — when in doubt, false.`;

function runPi(model, file) {
  return new Promise((resolve) => {
    const c = spawn('pi', ['-p', '--no-tools', '--no-session', '--mode', 'text', '--provider', 'ollama', '--model', model,
      '--append-system-prompt', SYS, `@${file}`, 'Judge this lesson. Output ONLY {"superseded":...,"reason":...}.'],
      { stdio: ['ignore', 'pipe', 'ignore'] });
    let o = ''; c.stdout.on('data', (d) => { o += d; }); c.on('close', () => resolve(o)); c.on('error', () => resolve(''));
  });
}
function verdict(o) { if (!o) return null; const a = o.indexOf('{'), b = o.lastIndexOf('}'); if (a < 0 || b <= a) return null; try { return JSON.parse(o.slice(a, b + 1)); } catch { return null; } }

function markSuperseded(file, reason) {
  const p = join(MINED, file);
  let t = readFileSync(p, 'utf8');
  // add status to frontmatter
  if (/^---\n/.test(t)) t = t.replace(/^---\n/, `---\nstatus: superseded-pre-desk-cutover\n`);
  const banner = `> ⚠️ **SUPERSEDED — OLD identity mode, DO NOT APPLY.** Replaced by the Desk model (2026-06-15 clean-identity cutover). Kept for history only. Reason: ${reason}\n\n`;
  // insert banner after frontmatter
  t = /^(---\n[\s\S]*?\n---\n)/.test(t) ? t.replace(/^(---\n[\s\S]*?\n---\n)/, `$1${banner}`) : banner + t;
  writeFileSync(p, t);
  if (!existsSync(SUP)) mkdirSync(SUP, { recursive: true });
  renameSync(p, join(SUP, file));
}

async function main() {
  let files = readFileSync(LIST, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  if (LIMIT) files = files.slice(0, LIMIT);
  const total = files.length;
  console.log(`${DRY ? '[DRY] ' : ''}classify ${total} candidates | workers=${WORKERS} (${MODELS.join(' + ')})`);
  let next = 0, done = 0, sup = 0, keep = 0, errs = 0;
  const moved = [];
  async function worker(mi) {
    const model = MODELS[mi];
    while (true) {
      const i = next++; if (i >= total) break;
      const f = files[i];
      const v = verdict(await runPi(model, join(MINED, f)));
      if (v == null) { errs++; keep++; }
      else if (v.superseded === true) { sup++; moved.push(`${f} :: ${v.reason || ''}`); if (!DRY) markSuperseded(f, (v.reason || '').replace(/\n/g, ' ').slice(0, 200)); }
      else keep++;
      done++;
      if (done % 40 === 0 || done === total) console.log(`  …${done}/${total}  superseded=${sup}  keep=${keep}  err=${errs}`);
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, (_, k) => worker(k < WORKERS / 2 ? 0 : 1)));
  writeFileSync('/tmp/superseded-moved.txt', moved.join('\n'));
  console.log(`\nDONE: ${sup} superseded ${DRY ? '(dry-run, not moved)' : '→ _superseded/'}, ${keep} kept, ${errs} errors. List: /tmp/superseded-moved.txt`);
}
main();
