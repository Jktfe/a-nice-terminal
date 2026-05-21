#!/usr/bin/env node
/** M6.6 driver — see docs/m6-6-acceptance-checklist.md.
 *  Usage: node check-clean-machine-acceptance.mjs --room <id> [--os mac|win|both] [--include-app] */

const CLI = [
  ['install', 'brew tap Jktfe/antchat && brew install ant', 'scoop bucket add antchat https://github.com/Jktfe/scoop-antchat && scoop install ant'],
  ['version', 'ant --version', 'ant --version'],
  ['register', 'ant register --handle @clean-mac --name clean-mac-shell', 'ant register --handle @clean-win --name clean-win-shell'],
  ['invite', 'ant rooms invite <ROOM_ID> @clean-mac (operator-side)', 'ant rooms invite <ROOM_ID> @clean-win (operator-side)'],
  ['post', 'ant rooms post <ROOM_ID> "hello from clean Mac"', 'ant rooms post <ROOM_ID> "hello from clean Windows"'],
  ['read', 'ant rooms messages <ROOM_ID>', 'ant rooms messages <ROOM_ID>']
];
const APP = [
  ['install', 'Open signed .dmg/.msi from m6.4 release; complete installer.'],
  ['wizard', 'Launch ANT desktop; paste operator URL + roomId + bridge token.'],
  ['webview', 'Confirm chat room visible in webview.']
];

export class CliInputError extends Error {}

function steps(table, osTag, col) {
  return table.map((row, i) => ({
    n: i + 1, desc: row[0], cmd: typeof col === 'number' ? row[col] : row[1], osTag
  }));
}

export function buildPlan({ roomId, os = 'both', includeApp = false }) {
  if (!roomId) throw new CliInputError('--room <roomId> is required');
  const out = [];
  if (os === 'mac' || os === 'both') out.push({ label: 'Mac CLI', osTag: 'mac', steps: steps(CLI, 'mac', 1) });
  if (os === 'win' || os === 'both') out.push({ label: 'Windows CLI', osTag: 'win', steps: steps(CLI, 'win', 2) });
  if (includeApp) {
    if (os === 'mac' || os === 'both') out.push({ label: 'Mac desktop app', osTag: 'mac-app', steps: steps(APP, 'mac-app') });
    if (os === 'win' || os === 'both') out.push({ label: 'Windows desktop app', osTag: 'win-app', steps: steps(APP, 'win-app') });
  }
  return out.map((s) => ({ ...s, steps: s.steps.map((step) => ({
    ...step,
    topic: `m6.6-${s.osTag}-${step.n}-${step.desc}`,
    screenshotCmd: `ant screenshot take ${roomId} --file step-${step.n}.png --topic m6.6-${s.osTag}-${step.n}-${step.desc}`
  })) }));
}

export function renderPlan(sections) {
  return sections.flatMap((s) => [
    `\n## ${s.label}\n`,
    ...s.steps.flatMap((step) => [
      `Step ${step.n} — ${step.desc}`,
      `  on clean machine: ${step.cmd}`,
      `  evidence:         ${step.screenshotCmd}`,
      ''
    ])
  ]).join('\n');
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length;) {
    const t = argv[i];
    if (!t?.startsWith('--')) { i += 1; continue; }
    const name = t.slice(2);
    if (name === 'include-app') { flags.includeApp = true; i += 1; continue; }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new CliInputError(`--${name} needs a value`);
    flags[name] = v; i += 2;
  }
  return flags;
}

if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    const f = parseFlags(process.argv.slice(2));
    const sections = buildPlan({ roomId: f.room, os: f.os, includeApp: !!f.includeApp });
    console.log(`# M6.6 clean-machine acceptance — paste-driven recipe`);
    console.log(`# room: ${f.room}`);
    console.log(renderPlan(sections));
  } catch (cause) {
    console.error(`Error: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exit(1);
  }
}
