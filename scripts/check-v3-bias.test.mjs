import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runV3BiasCheck, scanActiveConfig } from './check-v3-bias.mjs';

describe('check-v3-bias', () => {
  it('reports clean active v4 defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ant-v3-bias-'));
    const file = join(dir, 'config.json');
    writeFileSync(file, '{"serverUrl":"http://localhost:6174"}\n');
    const out = [];
    const result = runV3BiasCheck({ files: [file], writeOut: (line) => out.push(line) });
    expect(result.ok).toBe(true);
    expect(out.join('\n')).toContain('V3-BIAS OK');
  });

  it('flags v3 and transition ports without leaking key values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ant-v3-bias-'));
    const file = join(dir, '.env');
    writeFileSync(file, 'ANT_API_KEY=secret-value-for-http://localhost:6461\nOLD=http://127.0.0.1:6458\n');
    const findings = scanActiveConfig({ files: [file] });
    expect(findings).toHaveLength(2);
    expect(findings[0].preview).toContain('[REDACTED]');
    expect(findings.map((f) => f.needle)).toContain('localhost:6461');
    expect(findings.map((f) => f.needle)).toContain(':6458');
  });
});
