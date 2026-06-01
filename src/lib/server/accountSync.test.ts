import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getAccountMe,
  refreshIfNeeded,
  startAccountRefreshLoop,
  _resetAccountRefreshLoopForTests
} from './accountSync';

const tempRoots: string[] = [];

function makeHome(): string {
  const root = mkdtempSync(join(tmpdir(), 'ant-account-sync-'));
  tempRoots.push(root);
  return root;
}

function seedWorkspace(home: string, accountId = 'acct_nmvc') {
  const antRoot = join(home, '.ant');
  mkdirSync(antRoot, { recursive: true });
  writeFileSync(
    join(antRoot, 'active-workspace.json'),
    JSON.stringify({ activeAccountId: accountId })
  );
  return antRoot;
}

function seedDeviceToken(home: string, accountId = 'acct_nmvc', deviceId = 'dev_m5') {
  const antRoot = seedWorkspace(home, accountId);
  const deviceDir = join(antRoot, 'account', accountId, 'devices', deviceId);
  mkdirSync(deviceDir, { recursive: true });
  const tokenPath = join(deviceDir, 'device-token.json');
  writeFileSync(
    tokenPath,
    JSON.stringify({
      refreshJwt: 'refresh.jwt',
      accessToken: 'access.jwt',
      licenseBundle: 'license.jwt',
      device_id: deviceId,
      org_id: 'org_nmvc',
      membership_id: 'mem_nmvc',
      tier: 'bundle',
      features: 1,
      feature_names: ['mcp_gateway']
    })
  );
  return tokenPath;
}

afterEach(() => {
  _resetAccountRefreshLoopForTests();
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('accountSync', () => {
  it('returns free tier when no active workspace exists', async () => {
    const home = makeHome();

    const result = await getAccountMe({ env: { HOME: home } });

    expect(result).toMatchObject({
      linked: false,
      tier: 'free',
      features: 0,
      featureNames: [],
      account: null,
      source: 'no-workspace'
    });
  });

  it('returns free tier when the active workspace has no readable device token', async () => {
    const home = makeHome();
    seedWorkspace(home);

    const result = await getAccountMe({ env: { HOME: home } });

    expect(result).toMatchObject({
      linked: false,
      tier: 'free',
      features: 0,
      featureNames: [],
      account: null,
      source: 'no-token'
    });
  });

  it('reads the active device-token.json and returns account metadata', async () => {
    const home = makeHome();
    seedDeviceToken(home);

    const result = await getAccountMe({ env: { HOME: home } });

    expect(result).toMatchObject({
      linked: true,
      tier: 'bundle',
      features: 1,
      featureNames: ['mcp_gateway'],
      account: {
        id: 'mem_nmvc',
        orgId: 'org_nmvc',
        deviceId: 'dev_m5'
      }
    });
  });

  it('refreshes the active token through the S3 POST /api/devices/refresh contract', async () => {
    const home = makeHome();
    const tokenPath = seedDeviceToken(home);
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({
        accessToken: 'new-access.jwt',
        licenseBundle: 'new-license.jwt'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const result = await refreshIfNeeded({
      env: { HOME: home },
      fetchImpl,
      accountsBaseUrl: 'https://accounts.antonline.dev'
    });

    expect(result.linked).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://accounts.antonline.dev/api/devices/refresh');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ refreshToken: 'refresh.jwt' });
    const stored = JSON.parse(readFileSync(tokenPath, 'utf8'));
    expect(stored.accessToken).toBe('new-access.jwt');
    expect(stored.licenseBundle).toBe('new-license.jwt');
  });

  it('degrades to free tier when refresh is rejected as expired or revoked', async () => {
    const home = makeHome();
    seedDeviceToken(home);
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ message: 'revoked' }), { status: 401 });

    const result = await refreshIfNeeded({ env: { HOME: home }, fetchImpl });

    expect(result).toMatchObject({
      linked: false,
      tier: 'free',
      source: 'expired'
    });
  });

  it('uses cached bundle metadata when the refresh endpoint is unreachable', async () => {
    const home = makeHome();
    seedDeviceToken(home);
    const fetchImpl: typeof fetch = async () => {
      throw new Error('network down');
    };

    const result = await refreshIfNeeded({ env: { HOME: home }, fetchImpl });

    expect(result).toMatchObject({
      linked: true,
      tier: 'bundle',
      features: 1,
      source: 'cached-bundle'
    });
  });

  it('degrades to free tier when offline and no cached bundle exists', async () => {
    const home = makeHome();
    const tokenPath = seedDeviceToken(home);
    const stored = JSON.parse(readFileSync(tokenPath, 'utf8'));
    delete stored.licenseBundle;
    writeFileSync(tokenPath, JSON.stringify(stored));
    const fetchImpl: typeof fetch = async () => {
      throw new Error('network down');
    };

    const result = await refreshIfNeeded({ env: { HOME: home }, fetchImpl });

    expect(result).toMatchObject({
      linked: false,
      tier: 'free',
      source: 'offline-no-cache'
    });
  });

  it('starts one hourly refresh loop even when booted more than once', () => {
    let intervalCalls = 0;
    const timers: unknown[] = [];
    const setIntervalImpl = (fn: () => void, ms: number) => {
      intervalCalls += 1;
      timers.push({ fn, ms });
      return `timer-${intervalCalls}`;
    };

    const first = startAccountRefreshLoop({ setIntervalImpl, runImmediately: false });
    const second = startAccountRefreshLoop({ setIntervalImpl, runImmediately: false });

    expect(first.booted).toBe(true);
    expect(second.booted).toBe(false);
    expect(intervalCalls).toBe(1);
    expect(timers).toEqual([{ fn: expect.any(Function), ms: 60 * 60 * 1000 }]);
  });
});
