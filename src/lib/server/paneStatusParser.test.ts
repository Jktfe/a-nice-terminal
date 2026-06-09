import { describe, it, expect } from 'vitest';
import { parsePaneState, tailHash, isLabelCli } from './paneStatusParser';

// Real captures from the Agents Agents room (2026-06-09), trimmed to the strip.
const FIX = {
  claudeWorking:
    'I am holding for JWPK to run the rating.\n❯ \n  sent:18:19:47  resp:16:50:21  edit:16:50:03  |  a-nice-terminal  |  Opus 4.8 (1M context)  |  7h:53%  |  Working                          Remote Control active\n  paste again to expand',
  claudeRespNeeded:
    "I'm holding for JWPK.\n✻ Brewed for 6m 4s\n❯ \n  sent:18:19:47  resp:16:50:21  edit:16:50:03  |  a-nice-terminal  |  Opus 4.8 (1M context)  |  6h:53%  |  Response needed              Remote Control active",
  claudeWaiting:
    '  sent:15:14:39  resp:15:41:51  edit:15:48:18  |  a-nice-terminal  |  Opus 4.8 (1M context)  |  84:82%  |  Waiting                           Remote Control active',
  codexReady:
    '• Posted final READY vote.\n─ Worked for 1m 13s ─\n› Find and fix a bug in @filename\n  gpt-5.5 high · ~/CascadeProjects/a-nice-terminal · gpt-5.5 · Ready',
  codexWorking:
    '[ANT reply instruction: …]\n• Running UserPromptSubmit hook\n• Working (1s • esc to interrupt)\n› Find and fix a bug in @filename\n  gpt-5.5 high · ~/CascadeProjects/a-nice-terminal · gpt-5.5 · Working',
  qwenWorking:
    '✦ Message posted successfully.\n*   Type your message or @path/to/file\n  Working                                       10.9% context used\n  YOLO mode (shift + tab to cycle) · 2 tasks done',
  qwenComplete:
    '| 3 | @qwens-qwen | 4.5/10 | clean |\n  Complete                                      12.8% context used\n  YOLO mode (shift + tab to cycle) · 2 tasks done',
  // copilot with a STALE bullet (an old "No reply needed" message) — must NOT read working
  copilotStaleBullet:
    '● No reply needed — final state is already clear: 7/7 READY\n ~/CascadeProjects/a-nice-terminal [⎇ detached@5aa802a*+%]\n❯\n v1.0.60 available · run /update · / commands · ? help                 GPT-5.5'
};

describe('label CLIs — read the printed state (single sample)', () => {
  it('claude: Working / Response needed / Waiting', () => {
    expect(parsePaneState('claude', FIX.claudeWorking)).toMatchObject({ state: 'working', source: 'label' });
    expect(parsePaneState('claude', FIX.claudeRespNeeded)).toMatchObject({ state: 'response-required', source: 'label' });
    expect(parsePaneState('claude', FIX.claudeWaiting)).toMatchObject({ state: 'idle', source: 'label' });
  });
  it('codex: Ready=idle, Working=working, and the • Working/hook strip', () => {
    expect(parsePaneState('codex', FIX.codexReady)).toMatchObject({ state: 'idle', source: 'label' });
    const w = parsePaneState('codex', FIX.codexWorking);
    expect(w.state).toBe('working');
    expect(w.evidence).toMatch(/Working \(|Running \w+ hook/);
  });
  it('qwen: Working vs Complete', () => {
    expect(parsePaneState('qwen', FIX.qwenWorking)).toMatchObject({ state: 'working', source: 'label' });
    expect(parsePaneState('qwen', FIX.qwenComplete)).toMatchObject({ state: 'complete', source: 'label' });
  });
  it('label CLIs are flagged as such', () => {
    expect(isLabelCli('claude')).toBe(true);
    expect(isLabelCli('copilot')).toBe(false);
  });
});

describe('label-less CLIs — streaming-diff, not presence-of-text', () => {
  it('first sample (no prevHash) → unknown', () => {
    expect(parsePaneState('copilot', FIX.copilotStaleBullet)).toMatchObject({ state: 'unknown', source: 'first-sample' });
  });
  it('THE false-positive fix: a stale ● bullet with an unchanged pane → idle (NOT working)', () => {
    const first = parsePaneState('copilot', FIX.copilotStaleBullet);
    const second = parsePaneState('copilot', FIX.copilotStaleBullet, first.tailHash); // pane unchanged
    expect(second).toMatchObject({ state: 'idle', source: 'stream' });
  });
  it('pane changed between polls → working', () => {
    const first = parsePaneState('agy', 'old output line\n>');
    const second = parsePaneState('agy', '● Bash(running…)\nnew output\n>', first.tailHash);
    expect(second).toMatchObject({ state: 'working', source: 'stream' });
  });
  it('pi uses streaming-diff too', () => {
    const a = parsePaneState('pi', 'standing by\n╰─');
    const b = parsePaneState('pi', 'standing by\n╰─', a.tailHash);
    expect(b.state).toBe('idle');
  });
});

describe('label CLI with no label visible this frame → falls back to streaming-diff', () => {
  it('claude mid-scroll without the strip uses the prev hash', () => {
    const noStrip = 'just some conversation text\nmore text';
    const a = parsePaneState('claude', noStrip);
    expect(a.source).toBe('first-sample');
    const b = parsePaneState('claude', noStrip, a.tailHash);
    expect(b.source).toBe('stream');
    expect(b.state).toBe('idle');
  });
});

describe('tailHash', () => {
  it('is deterministic and changes when the tail changes', () => {
    expect(tailHash('a\nb\nc')).toBe(tailHash('a\nb\nc'));
    expect(tailHash('a\nb\nc')).not.toBe(tailHash('a\nb\nd'));
  });
  it('ignores trailing whitespace + blank lines', () => {
    expect(tailHash('a\nb  \n\n')).toBe(tailHash('a\nb'));
  });
});
