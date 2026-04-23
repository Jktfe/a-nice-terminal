#!/usr/bin/env bun
// scripts/distill/extract-chunk.ts
//
// Takes a cleaned transcript file, extracts the first N chars, sends to
// Gemma 4 via LM Studio, prints the structured findings.
//
// Usage:
//   bun scripts/distill/extract-chunk.ts <cleaned-file> [--max-chars N] [--out path]

import { readFileSync, writeFileSync } from 'fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: bun extract-chunk.ts <cleaned-file> [--max-chars N] [--out path]');
  process.exit(1);
}

const maxCharsIdx = process.argv.indexOf('--max-chars');
const maxChars = maxCharsIdx >= 0 ? parseInt(process.argv[maxCharsIdx + 1]) : 320_000;  // ~80K tokens
const outIdx = process.argv.indexOf('--out');
const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : undefined;

const full = readFileSync(file, 'utf8');
const chunk = full.slice(0, maxChars);

console.error(`input file:     ${file}`);
console.error(`total size:     ${full.length.toLocaleString()} chars`);
console.error(`chunk size:     ${chunk.length.toLocaleString()} chars (~${Math.round(chunk.length/4).toLocaleString()} tokens)`);
console.error(`sending to Gemma…`);

const SYSTEM = `You are a session distillation assistant. You are given a cleaned transcript of a terminal session where a developer used AI coding agents (Claude Code, Gemini CLI, Codex, etc.).

The transcript has formatting artefacts (collapsed whitespace, TUI box-drawing characters, dedup markers like "[↺ previous line repeated Nx]"). Read through them and extract meaning.

Produce a structured JSON digest with these fields:
{
  "session_purpose": "one-sentence statement of what the user was trying to accomplish",
  "timeline": [ { "approx_when": "early|mid|late", "event": "short description" } ],
  "commands_worth_remembering": [ "concrete shell/CLI commands or patterns that solved a real problem" ],
  "errors_encountered": [ { "error": "what went wrong", "resolution": "how it was fixed, or 'unresolved'" } ],
  "decisions": [ "key technical/architectural choices made" ],
  "insights": [ "patterns, techniques, or learnings worth recording for future reference" ],
  "red_flags": [ "things that went wrong, were wasteful, or showed process problems" ],
  "open_threads": [ "unfinished work, TODOs, questions left hanging" ]
}

Rules:
- Only include entries you can reasonably ground in the transcript. Don't invent.
- If a field has no entries, use an empty array.
- Be concise. Each entry one short line.
- Skip pure chrome/banner noise in your analysis. Focus on the human's work.
- Output ONLY the JSON object, no prose, no markdown fence.`;

const USER = `Here is the cleaned transcript chunk. Produce the structured JSON digest as specified.

\`\`\`
${chunk}
\`\`\``;

const body = {
  model: 'google/gemma-4-26b-a4b',
  messages: [
    { role: 'system', content: SYSTEM },
    { role: 'user',   content: USER   },
  ],
  max_tokens: 6000,
  temperature: 0.2,
};

const t0 = Date.now();
const res = await fetch('http://localhost:1234/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

if (!res.ok) {
  console.error(`LM Studio returned HTTP ${res.status}`);
  console.error(await res.text());
  process.exit(2);
}

const data = await res.json() as any;
const dt = ((Date.now() - t0) / 1000).toFixed(1);
const msg = data.choices?.[0]?.message ?? {};
const content = msg.content || '';
const reasoning = msg.reasoning_content || '';
const usage = data.usage ?? {};

console.error(`\ncompleted in ${dt}s`);
console.error(`prompt tokens:     ${usage.prompt_tokens?.toLocaleString() ?? '?'}`);
console.error(`completion tokens: ${usage.completion_tokens?.toLocaleString() ?? '?'}`);
console.error(`  (of which reasoning: ${usage.completion_tokens_details?.reasoning_tokens?.toLocaleString() ?? '?'})`);
console.error(`finish reason:     ${data.choices?.[0]?.finish_reason ?? '?'}`);

const output = content || `(empty content; reasoning_content shown instead)\n\n${reasoning}`;
if (outPath) {
  writeFileSync(outPath, output);
  console.error(`wrote output to ${outPath}`);
} else {
  process.stdout.write(output);
  process.stdout.write('\n');
}
