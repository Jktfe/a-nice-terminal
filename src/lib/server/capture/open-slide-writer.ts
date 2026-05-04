import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  collectSessionEvidence,
  safeEvidenceName,
  sessionEvidenceMarkdown,
  type SessionEvidence,
} from './session-evidence.js';
import { registerDeck } from '../decks.js';

const DEFAULT_OPEN_SLIDE_DIR = join(homedir(), 'CascadeProjects', 'ANT-Open-Slide');

export interface OpenSlideExportResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  slug?: string;
  deck_dir?: string;
  evidence_path?: string;
  readme_path?: string;
  slides_path?: string;
  render_command?: string;
  dev_command?: string;
  note?: string;
}

function openSlideRoot(): string {
  return process.env.ANT_OPEN_SLIDE_DIR || DEFAULT_OPEN_SLIDE_DIR;
}

function tsLiteral(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

function buildSlidesTsx(evidence: SessionEvidence): string {
  const tasks = evidence.tasks.slice(0, 8);
  const refs = evidence.file_refs.slice(0, 8);
  const commands = evidence.commands.slice(0, 8);
  const messages = evidence.key_messages.slice(-8);
  const events = evidence.run_events.slice(-10);

  return `import type { Page } from '@open-slide/core';

const evidence = ${tsLiteral(evidence)} as const;

const ACCENT = '#f4b860';
const BG = '#08090a';
const PANEL = '#111318';
const TEXT = '#f7f8f8';
const MUTED = '#9ca3af';
const LINE = '#2a2f3a';

function Shell({ eyebrow, title, children }: { eyebrow: string; title: string; children: any }) {
  return (
    <div style={{
      width: '1920px',
      height: '1080px',
      background: BG,
      color: TEXT,
      fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      padding: '86px 104px',
      boxSizing: 'border-box',
    }}>
      <div style={{ color: ACCENT, fontSize: 26, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{eyebrow}</div>
      <h1 style={{ fontSize: 92, lineHeight: 1.02, margin: '18px 0 42px', maxWidth: 1320 }}>{title}</h1>
      {children}
      <div style={{ position: 'absolute', left: 104, bottom: 54, color: MUTED, fontSize: 24 }}>
        ANT evidence · {evidence.session.id} · {new Date(evidence.generated_at).toLocaleString()}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ borderTop: '2px solid ' + LINE, paddingTop: 20 }}>
      <div style={{ fontSize: 62, fontWeight: 800 }}>{value}</div>
      <div style={{ color: MUTED, fontSize: 24, marginTop: 8 }}>{label}</div>
    </div>
  );
}

function statusColor(status: string) {
  if (status === 'complete' || status === 'done' || status === 'passing') return '#8fb996';
  if (status === 'failed' || status === 'blocked') return '#f07178';
  if (status === 'active' || status === 'in_progress') return '#f4b860';
  return MUTED;
}

const Cover: Page = () => (
  <Shell eyebrow="ANT session evidence" title={evidence.session.name}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 28, marginTop: 92 }}>
      <Stat label="messages" value={evidence.counts.messages} />
      <Stat label="commands" value={evidence.counts.commands} />
      <Stat label="tasks" value={evidence.counts.tasks} />
      <Stat label="file refs" value={evidence.counts.file_refs} />
      <Stat label="events" value={evidence.counts.run_events} />
    </div>
    <div style={{ marginTop: 72, color: MUTED, fontSize: 34, maxWidth: 1180, lineHeight: 1.34 }}>
      Root: {evidence.session.root_dir || 'none'}<br />
      Period: {evidence.session.created_at || 'unknown'} → {evidence.session.last_activity || 'unknown'}
    </div>
  </Shell>
);

const TasksAndFiles: Page = () => (
  <Shell eyebrow="work surface" title="Tasks and file references">
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 42 }}>
      <div style={{ background: PANEL, border: '1px solid ' + LINE, padding: 36, borderRadius: 18 }}>
        <h2 style={{ marginTop: 0, fontSize: 44 }}>Tasks</h2>
        {${tsLiteral(tasks)}.length === 0 ? <p style={{ color: MUTED, fontSize: 28 }}>No tasks captured.</p> : ${tsLiteral(tasks)}.map((task: any) => (
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', margin: '22px 0', fontSize: 28, lineHeight: 1.24 }}>
            <span style={{ background: statusColor(task.status), width: 14, height: 14, borderRadius: 999, marginTop: 11 }} />
            <div><strong>{task.title}</strong><div style={{ color: MUTED, fontSize: 22, marginTop: 4 }}>{task.status}</div></div>
          </div>
        ))}
      </div>
      <div style={{ background: PANEL, border: '1px solid ' + LINE, padding: 36, borderRadius: 18 }}>
        <h2 style={{ marginTop: 0, fontSize: 44 }}>Files</h2>
        {${tsLiteral(refs)}.length === 0 ? <p style={{ color: MUTED, fontSize: 28 }}>No file references captured.</p> : ${tsLiteral(refs)}.map((ref: any) => (
          <div style={{ margin: '22px 0', fontSize: 26, lineHeight: 1.3 }}>
            <code style={{ color: ACCENT }}>{ref.file_path}</code>
            {ref.note ? <div style={{ color: MUTED, marginTop: 6 }}>{ref.note}</div> : null}
          </div>
        ))}
      </div>
    </div>
  </Shell>
);

const Commands: Page = () => (
  <Shell eyebrow="terminal proof" title="Commands and recent evidence">
    <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 42 }}>
      <div>
        {${tsLiteral(commands)}.length === 0 ? <p style={{ color: MUTED, fontSize: 30 }}>No commands captured.</p> : ${tsLiteral(commands)}.map((cmd: any) => (
          <div style={{ borderBottom: '1px solid ' + LINE, padding: '20px 0', fontSize: 26 }}>
            <code style={{ color: TEXT }}>{cmd.command}</code>
            <span style={{ color: cmd.exit_code === 0 ? '#8fb996' : cmd.exit_code === null ? MUTED : '#f07178', marginLeft: 18 }}>
              {cmd.exit_code === null ? 'exit unknown' : 'exit ' + cmd.exit_code}
            </span>
          </div>
        ))}
      </div>
      <div style={{ background: PANEL, border: '1px solid ' + LINE, padding: 32, borderRadius: 18 }}>
        <h2 style={{ marginTop: 0, fontSize: 38 }}>Run events</h2>
        {${tsLiteral(events)}.map((event: any) => (
          <div style={{ margin: '16px 0', fontSize: 23, lineHeight: 1.25 }}>
            <span style={{ color: ACCENT }}>{event.kind}</span>
            <span style={{ color: MUTED }}> · {event.source}:{event.trust}</span>
            {event.text ? <div style={{ marginTop: 4 }}>{event.text}</div> : null}
          </div>
        ))}
      </div>
    </div>
  </Shell>
);

const Messages: Page = () => (
  <Shell eyebrow="narrative" title="Key messages">
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
      {${tsLiteral(messages)}.length === 0 ? <p style={{ color: MUTED, fontSize: 30 }}>No key messages captured.</p> : ${tsLiteral(messages)}.map((message: any) => (
        <div style={{ background: PANEL, border: '1px solid ' + LINE, padding: 28, borderRadius: 18, minHeight: 126 }}>
          <div style={{ color: ACCENT, fontSize: 24, fontWeight: 700 }}>{message.sender}</div>
          <div style={{ fontSize: 27, lineHeight: 1.25, marginTop: 12 }}>{message.content}</div>
        </div>
      ))}
    </div>
  </Shell>
);

export default [Cover, TasksAndFiles, Commands, Messages] satisfies Page[];
`;
}

function buildReadme(evidence: SessionEvidence, deckDir: string): string {
  return [
    `# ${evidence.session.name}`,
    '',
    'ANT generated this as an Open-Slide-ready evidence deck.',
    '',
    '## Commands',
    '',
    '```bash',
    'npm install',
    'npm run dev',
    'npm run build',
    '```',
    '',
    '## Contract',
    '',
    '- ANT owns evidence selection and provenance.',
    '- Open-Slide owns the visual editing/rendering workflow.',
    '- Raw terminal bytes stay in ANT; this deck is a derived view.',
    '',
    `Deck directory: \`${deckDir}\``,
  ].join('\n');
}

export function writeOpenSlideDeck(sessionId: string): OpenSlideExportResult {
  const evidence = collectSessionEvidence(sessionId);
  if (!evidence) return { ok: false, reason: 'session not found' };

  const root = openSlideRoot();
  const deckDir = join(root, `${safeEvidenceName(evidence.session.name)}-${sessionId.slice(0, 8)}`);
  const slidesDir = join(deckDir, 'slides', 'ant-evidence');

  try {
    mkdirSync(slidesDir, { recursive: true });
    const evidencePath = join(deckDir, 'ant-evidence.md');
    const readmePath = join(deckDir, 'README.md');
    const slidesPath = join(slidesDir, 'index.tsx');
    const packagePath = join(deckDir, 'package.json');
    const configPath = join(deckDir, 'open-slide.config.ts');

    writeFileSync(evidencePath, sessionEvidenceMarkdown(evidence), 'utf-8');
    writeFileSync(readmePath, buildReadme(evidence, deckDir), 'utf-8');
    writeFileSync(slidesPath, buildSlidesTsx(evidence), 'utf-8');
    if (!existsSync(packagePath)) {
      writeFileSync(packagePath, JSON.stringify({
        private: true,
        scripts: {
          dev: 'open-slide dev',
          build: 'open-slide build',
          preview: 'open-slide preview',
        },
        dependencies: {
          '@open-slide/core': 'latest',
          react: 'latest',
          'react-dom': 'latest',
        },
        devDependencies: {},
      }, null, 2) + '\n', 'utf-8');
    }
    if (!existsSync(configPath)) {
      writeFileSync(configPath, "export default {};\n", 'utf-8');
    }
    const slug = `${safeEvidenceName(evidence.session.name)}-${sessionId.slice(0, 8)}`;
    const deck = registerDeck({
      slug,
      owner_session_id: sessionId,
      allowed_room_ids: [sessionId],
      deck_dir: deckDir,
    });

    return {
      ok: true,
      note: 'Deterministic deck path: repeat exports update the same local bundle for this session.',
      slug: deck.slug,
      deck_dir: deckDir,
      evidence_path: evidencePath,
      readme_path: readmePath,
      slides_path: slidesPath,
      dev_command: `cd ${JSON.stringify(deckDir)} && npm install && npm run dev`,
      render_command: `cd ${JSON.stringify(deckDir)} && npm install && npm run build`,
    };
  } catch (err: any) {
    return { ok: false, reason: err?.message ?? String(err), deck_dir: deckDir };
  }
}
