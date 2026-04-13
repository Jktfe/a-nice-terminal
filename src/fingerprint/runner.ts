// ANT Fingerprinting Pipeline — probe runner
// File: src/fingerprint/runner.ts
//
// Sequences probe prompts against a target agent via an AgentDriver,
// captures NormalisedEvents from the CaptureSession, and persists
// results to fingerprint.db.

import { readFileSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';
import { nanoid } from 'nanoid';
import { execFileNoThrow } from '../utils/execFileNoThrow.js';
import { CaptureSession } from './capture.js';
import type {
  ProbeHarness,
  DriverSpec,
  NormalisedEvent,
  ProbeDefinition,
  ProbePromptFile,
  ProbeResult,
  ProbeRun,
  TmuxDriverConfig,
} from './types.js';

const _require = createRequire(import.meta.url);

// ─── DB setup ─────────────────────────────────────────────────────────────────

const DATA_DIR   = process.env.ANT_DATA_DIR ?? join(process.env.HOME ?? '/tmp', '.ant-v3');
const FP_DB_PATH = join(DATA_DIR, 'fingerprint.db');
const SCHEMA_SQL = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function openDb(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isBun = typeof (globalThis as any).Bun !== 'undefined';
  let db: any;
  if (isBun) {
    const { Database } = _require('bun:sqlite');
    db = new Database(FP_DB_PATH);
  } else {
    const Database = _require('better-sqlite3');
    db = new Database(FP_DB_PATH);
  }
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

// ─── TmuxAgentDriver ─────────────────────────────────────────────────────────
// Drives an agent running inside a tmux pane by sending keys via `tmux send-keys`.
// The CaptureSession (read-only, -r flag) listens on the same session.

class TmuxAgentDriver implements ProbeHarness {
  private capture: CaptureSession;
  private buffer: NormalisedEvent[] = [];
  private idleResolve: ((sig: ProbeResult['exit_signal']) => void) | null = null;
  private started = false;

  constructor(public spec: DriverSpec) {
    const cfg = spec.config as TmuxDriverConfig;
    this.capture = new CaptureSession({
      tmuxSession: cfg.session,
      prompt_pattern: cfg.prompt_pattern ? new RegExp(cfg.prompt_pattern) : undefined,
    });

    this.capture.on('event', (e: NormalisedEvent) => this.buffer.push(e));
    this.capture.on('prompt', () => { this.idleResolve?.('prompt_detected'); this.idleResolve = null; });
    this.capture.on('exit',   () => { this.idleResolve?.('error');            this.idleResolve = null; });
  }

  async sendPrompt(prompt: string): Promise<void> {
    if (!this.started) {
      await this.capture.start();
      this.started = true;
    }
    this.capture.resetClock();
    this.buffer = [];

    const cfg    = this.spec.config as TmuxDriverConfig;
    const target = cfg.pane ? `${cfg.session}:${cfg.pane}` : cfg.session;

    // tmux send-keys — args passed as array via execFileNoThrow (no shell injection)
    const result = await execFileNoThrow('tmux', ['send-keys', '-t', target, prompt, 'Enter']);
    if (result.status === 'error') {
      throw new Error(`tmux send-keys failed: ${result.stderr}`);
    }
  }

  waitForIdle(timeout_ms = 30_000): Promise<ProbeResult['exit_signal']> {
    const cfg = this.spec.config as TmuxDriverConfig;
    const effective = cfg.idle_timeout_ms ?? timeout_ms;

    return new Promise<ProbeResult['exit_signal']>((resolve) => {
      this.idleResolve = resolve;
      setTimeout(() => { this.idleResolve?.('idle_timeout'); this.idleResolve = null; }, effective);
    });
  }

  drainOutput(): NormalisedEvent[] {
    const events = [...this.buffer];
    this.buffer  = [];
    return events;
  }

  dispose(): void {
    this.capture.dispose();
  }
}

// ─── Driver factory ───────────────────────────────────────────────────────────

function createDriver(spec: DriverSpec): ProbeHarness {
  switch (spec.driver_type) {
    case 'tmux':
      return new TmuxAgentDriver(spec);
    default:
      throw new Error(`Unsupported driver_type "${spec.driver_type}". Only 'tmux' is implemented.`);
  }
}

// ─── ProbeRunner ──────────────────────────────────────────────────────────────

export interface ProbeRunnerOptions {
  driverSpec: DriverSpec;
  /** Path to probe-prompts.json. Defaults to ant-probe/probe-prompts.json in cwd. */
  probeFile?: string;
  /** Subset of probe IDs to run (e.g. ['P01', 'P03']). Defaults to all. */
  probeIds?: string[];
  /** Inter-probe pause in ms (default 2000) to let the agent settle. */
  inter_probe_pause_ms?: number;
}

export class ProbeRunner {
  private db: ReturnType<typeof openDb>;
  private probes: ProbeDefinition[];
  private driver: ProbeHarness;
  private inter_probe_pause_ms: number;

  constructor(private opts: ProbeRunnerOptions) {
    this.db     = openDb();
    this.driver = createDriver(opts.driverSpec);
    this.inter_probe_pause_ms = opts.inter_probe_pause_ms ?? 2000;

    const probeFile = opts.probeFile
      ?? join(process.cwd(), 'ant-probe', 'probe-prompts.json');
    const raw: ProbePromptFile = JSON.parse(readFileSync(probeFile, 'utf8'));

    this.probes = opts.probeIds
      ? raw.probes.filter(p => opts.probeIds!.includes(p.id))
      : raw.probes;

    if (this.probes.length === 0) {
      throw new Error('No probes matched. Check probeIds or probe-prompts.json.');
    }
  }

  private upsertDriverSpec(): void {
    this.db.prepare(`
      INSERT INTO driver_specs (id, name, driver_type, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        name        = excluded.name,
        driver_type = excluded.driver_type,
        config      = excluded.config,
        updated_at  = datetime('now')
    `).run(
      this.opts.driverSpec.id,
      this.opts.driverSpec.name,
      this.opts.driverSpec.driver_type,
      JSON.stringify(this.opts.driverSpec.config),
    );
  }

  /** Run all selected probes sequentially and return a ProbeRun summary. */
  async run(): Promise<ProbeRun> {
    this.upsertDriverSpec();

    const run_id     = nanoid();
    const started_at = new Date().toISOString();
    const results: ProbeResult[] = [];

    console.log(`[fingerprint] run ${run_id} — ${this.probes.length} probes via ${this.opts.driverSpec.id}`);

    for (const probe of this.probes) {
      const result = await this.runProbe(run_id, probe);
      results.push(result);
      this.persistResult(result);
      console.log(`[fingerprint] ${probe.id} (${probe.event_class}) — ${result.duration_ms}ms [${result.exit_signal}]`);

      if (this.inter_probe_pause_ms > 0) await sleep(this.inter_probe_pause_ms);
    }

    this.driver.dispose();

    return {
      run_id,
      driver:      this.opts.driverSpec,
      probes:      this.probes,
      results,
      started_at,
      finished_at: new Date().toISOString(),
    };
  }

  private async runProbe(run_id: string, probe: ProbeDefinition): Promise<ProbeResult> {
    const start = Date.now();

    await this.driver.sendPrompt(probe.prompt);
    const exit_signal = await this.driver.waitForIdle();
    const events      = this.driver.drainOutput();
    const duration_ms = Date.now() - start;

    const raw_output = events.map((e: NormalisedEvent) => e.raw).join('\n');
    const normalised = events.filter((e: NormalisedEvent) => e.type === 'output').map((e: NormalisedEvent) => e.text).join('\n');

    return {
      id:          nanoid(),
      run_id,
      driver_id:   this.opts.driverSpec.id,
      probe_id:    probe.id,
      event_class: probe.event_class,
      prompt_sent: probe.prompt,
      raw_output,
      normalised,
      events,
      duration_ms,
      exit_signal,
      created_at:  new Date().toISOString(),
    };
  }

  private persistResult(result: ProbeResult): void {
    this.db.prepare(`
      INSERT INTO probe_output
        (id, run_id, driver_id, probe_id, event_class, prompt_sent,
         raw_output, normalised, events_json, duration_ms, exit_signal, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      result.id,       result.run_id,    result.driver_id, result.probe_id,
      result.event_class, result.prompt_sent, result.raw_output,  result.normalised,
      JSON.stringify(result.events), result.duration_ms, result.exit_signal, result.created_at,
    );
  }
}

// ─── CLI entry point ──────────────────────────────────────────────────────────
// Usage: npx tsx src/fingerprint/runner.ts --session=ant --driver=claude-code-tmux
// Optional: --probes=P01,P03  --timeout=10000  --name="My Agent"

if (process.argv[1]?.endsWith('runner.ts') || process.argv[1]?.endsWith('runner.js')) {
  const args = Object.fromEntries(
    process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).filter(([k]) => k)
  );

  const spec: DriverSpec = {
    id:          args['driver']  ?? 'claude-code-tmux',
    name:        args['name']    ?? 'Claude Code (tmux)',
    driver_type: 'tmux',
    config: {
      session:         args['session']  ?? 'ant',
      idle_timeout_ms: args['timeout'] ? parseInt(args['timeout'], 10) : 10_000,
    } satisfies TmuxDriverConfig,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const runner = new ProbeRunner({
    driverSpec: spec,
    probeIds: args['probes'] ? args['probes'].split(',') : undefined,
  });

  runner.run()
    .then(run => { console.log(`\n[fingerprint] done — ${run.results.length} probes, run_id=${run.run_id}`); process.exit(0); })
    .catch(err => { console.error('[fingerprint] failed:', err); process.exit(1); });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
