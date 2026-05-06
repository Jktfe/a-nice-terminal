// Tests for antchat/lib/launchd.ts plist generation and write/remove I/O.
//
// We don't exercise launchctl itself — that's macOS-only and requires real
// system state — but the XML emitted into ~/Library/LaunchAgents is the
// piece most likely to drift, so we pin it here.

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildPlist,
  writePlist,
  removePlist,
  plistPath,
  defaultLabel,
} from '../antchat/lib/launchd.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'antchat-launchd-'));
});

describe('buildPlist', () => {
  it('emits a valid plist XML header and dict', () => {
    const xml = buildPlist({ binaryPath: '/usr/local/bin/antchat', args: ['watch', 'run'] });
    expect(xml).toMatch(/^<\?xml version="1\.0"/);
    expect(xml).toContain('<!DOCTYPE plist');
    expect(xml).toContain('<plist version="1.0">');
    expect(xml.trim().endsWith('</plist>')).toBe(true);
  });

  it('embeds the binary path and arguments verbatim', () => {
    const xml = buildPlist({ binaryPath: '/opt/x/antchat', args: ['watch', 'run', '--quiet'] });
    expect(xml).toContain('<string>/opt/x/antchat</string>');
    expect(xml).toContain('<string>watch</string>');
    expect(xml).toContain('<string>run</string>');
    expect(xml).toContain('<string>--quiet</string>');
  });

  it('XML-escapes special characters in label and paths', () => {
    const xml = buildPlist({
      label: 'com.example.<bad>',
      binaryPath: '/path/with & ampersand',
      args: ['"quoted"'],
    });
    expect(xml).toContain('&lt;bad&gt;');
    expect(xml).toContain('&amp; ampersand');
    expect(xml).toContain('&quot;quoted&quot;');
  });

  it('includes EnvironmentVariables when env is set', () => {
    const xml = buildPlist({
      binaryPath: '/x',
      args: ['run'],
      env: { ANT_SERVER: 'https://host.example' },
    });
    expect(xml).toContain('<key>EnvironmentVariables</key>');
    expect(xml).toContain('<key>ANT_SERVER</key>');
    expect(xml).toContain('<string>https://host.example</string>');
  });

  it('omits EnvironmentVariables when env is empty', () => {
    const xml = buildPlist({ binaryPath: '/x', args: ['run'] });
    expect(xml).not.toContain('EnvironmentVariables');
  });

  it('defaults RunAtLoad and KeepAlive to true', () => {
    const xml = buildPlist({ binaryPath: '/x', args: ['run'] });
    expect(xml).toContain('<key>RunAtLoad</key>\n      <true/>');
    expect(xml).toContain('<key>KeepAlive</key>\n      <true/>');
  });

  it('respects RunAtLoad / KeepAlive overrides', () => {
    const xml = buildPlist({ binaryPath: '/x', args: ['run'], runAtLoad: false, keepAlive: false });
    expect(xml).toContain('<key>RunAtLoad</key>\n      <false/>');
    expect(xml).toContain('<key>KeepAlive</key>\n      <false/>');
  });

  it('uses the supplied label for the Label key', () => {
    const xml = buildPlist({ label: 'com.test.foo', binaryPath: '/x', args: ['run'] });
    expect(xml).toContain('<key>Label</key>\n      <string>com.test.foo</string>');
  });
});

describe('writePlist + removePlist', () => {
  it('writes the plist to the given path and round-trips through readFileSync', () => {
    const path = join(dir, 'com.test.antchat.plist');
    writePlist({ label: 'com.test.antchat', binaryPath: '/x', args: ['run'] }, path);
    expect(existsSync(path)).toBe(true);
    const raw = readFileSync(path, 'utf8');
    expect(raw).toContain('<key>Label</key>');
    expect(raw).toContain('<string>com.test.antchat</string>');
  });

  it('creates parent directories if they are missing', () => {
    const nested = join(dir, 'a', 'b', 'c.plist');
    writePlist({ binaryPath: '/x', args: ['run'] }, nested);
    expect(existsSync(nested)).toBe(true);
  });

  it('removes a plist that already exists', () => {
    const label = 'com.test.removable';
    const path = plistPath(label);
    // Write something at the canonical path first by side-loading.
    writeFileSync(path, '<?xml version="1.0"?><plist version="1.0"><dict/></plist>', 'utf8');
    expect(existsSync(path)).toBe(true);
    expect(removePlist(label)).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it('returns false when removing a plist that is not there', () => {
    expect(removePlist('com.test.absent')).toBe(false);
  });
});

describe('plistPath / defaultLabel', () => {
  it('returns a path under ~/Library/LaunchAgents', () => {
    expect(plistPath()).toMatch(/Library\/LaunchAgents\/.+\.plist$/);
  });
  it('uses a stable namespaced default label', () => {
    expect(defaultLabel()).toBe('com.jktfe.antchat.watch');
  });
});
