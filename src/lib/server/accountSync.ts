/**
 * OSS account bridge.
 *
 * The private ant-accounts service owns identity. This server only reads the
 * local device-token cache, reports current tier state, and refreshes cached
 * access/license tokens on a timer. Missing or bad tokens always degrade to
 * free tier.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const ONE_HOUR_MS = 60 * 60 * 1000;
const DEFAULT_ACCOUNTS_BASE_URL = 'https://accounts.antonline.dev';
const LOOP_KEY = '__antAccountRefreshLoop';

type EnvLike = {
  HOME?: string;
  ANT_ACCOUNTS_URL?: string;
};

type TokenJson = Record<string, unknown>;

type TokenFile = {
  accountId: string;
  deviceId: string;
  path: string;
  token: TokenJson;
};

export type AccountMeResponse = {
  linked: boolean;
  tier: string;
  features: number;
  featureNames: string[];
  account: null | {
    id: string;
    orgId: string | null;
    deviceId: string | null;
    accountId: string;
  };
  source:
    | 'no-workspace'
    | 'no-token'
    | 'device-token'
    | 'refreshed'
    | 'cached-bundle'
    | 'offline-no-cache'
    | 'expired';
  reason?: string;
};

type SyncOptions = {
  env?: EnvLike;
  fetchImpl?: typeof fetch;
  accountsBaseUrl?: string;
};

type LoopOptions = SyncOptions & {
  runImmediately?: boolean;
  setIntervalImpl?: (fn: () => void, ms: number) => unknown;
};

function freeAccount(source: AccountMeResponse['source'], reason?: string): AccountMeResponse {
  return {
    linked: false,
    tier: 'free',
    features: 0,
    featureNames: [],
    account: null,
    source,
    reason
  };
}

function stringField(token: TokenJson, ...names: string[]): string | null {
  for (const name of names) {
    const value = token[name];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function numberField(token: TokenJson, ...names: string[]): number {
  for (const name of names) {
    const value = token[name];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

function stringArrayField(token: TokenJson, ...names: string[]): string[] {
  for (const name of names) {
    const value = token[name];
    if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  }
  return [];
}

function antRoot(env: EnvLike = process.env): string {
  return join(env.HOME ?? homedir(), '.ant');
}

function readJsonFile(path: string): TokenJson | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as TokenJson : null;
  } catch {
    return null;
  }
}

function readActiveAccountId(root: string): string | null {
  const active = readJsonFile(join(root, 'active-workspace.json'));
  return active ? stringField(active, 'activeAccountId', 'active_account_id') : null;
}

function readFirstDeviceToken(root: string, accountId: string): TokenFile | null {
  const devicesRoot = join(root, 'account', accountId, 'devices');
  if (!existsSync(devicesRoot)) return null;
  let entries: string[];
  try {
    entries = readdirSync(devicesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return null;
  }
  for (const deviceId of entries) {
    const path = join(devicesRoot, deviceId, 'device-token.json');
    if (!existsSync(path)) continue;
    const token = readJsonFile(path);
    if (token) return { accountId, deviceId, path, token };
  }
  return null;
}

type ActiveTokenResult =
  | { ok: true; file: TokenFile }
  | { ok: false; source: 'no-workspace' | 'no-token' };

function findActiveTokenFile(env: EnvLike = process.env): ActiveTokenResult {
  const root = antRoot(env);
  const accountId = readActiveAccountId(root);
  if (!accountId) return { ok: false, source: 'no-workspace' };
  const file = readFirstDeviceToken(root, accountId);
  if (!file) return { ok: false, source: 'no-token' };
  return { ok: true, file };
}

function accountFromToken(file: TokenFile, source: AccountMeResponse['source']): AccountMeResponse {
  const membershipId = stringField(file.token, 'membership_id', 'membershipId') ?? file.accountId;
  const orgId = stringField(file.token, 'org_id', 'orgId');
  const deviceId = stringField(file.token, 'device_id', 'deviceId') ?? file.deviceId;
  const tier = stringField(file.token, 'tier') ?? 'free';
  return {
    linked: true,
    tier,
    features: numberField(file.token, 'features', 'featuresBitfield'),
    featureNames: stringArrayField(file.token, 'feature_names', 'featureNames'),
    account: {
      id: membershipId,
      orgId,
      deviceId,
      accountId: file.accountId
    },
    source
  };
}

export async function getAccountMe(options: SyncOptions = {}): Promise<AccountMeResponse> {
  const result = findActiveTokenFile(options.env);
  if (!result.ok) return freeAccount(result.source);
  return accountFromToken(result.file, 'device-token');
}

function accountsBaseUrl(options: SyncOptions): string {
  return (options.accountsBaseUrl ?? options.env?.ANT_ACCOUNTS_URL ?? DEFAULT_ACCOUNTS_BASE_URL).replace(/\/+$/, '');
}

async function readResponseJson(response: Response): Promise<TokenJson> {
  const parsed = await response.json().catch(() => ({}));
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as TokenJson : {};
}

function writeTokenFile(path: string, token: TokenJson): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(token, null, 2));
  try {
    chmodSync(path, 0o600);
  } catch {
    /* chmod is best-effort on non-POSIX filesystems. */
  }
}

export async function refreshIfNeeded(options: SyncOptions = {}): Promise<AccountMeResponse> {
  const result = findActiveTokenFile(options.env);
  if (!result.ok) return freeAccount(result.source);
  const file = result.file;
  const refreshToken = stringField(file.token, 'refreshJwt', 'refreshToken', 'refresh_token', 'deviceToken');
  if (!refreshToken) return freeAccount('no-token', 'no_refresh_token');

  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  try {
    const response = await fetchImpl(`${accountsBaseUrl(options)}/api/devices/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });
    if (response.status === 401) return freeAccount('expired');
    if (!response.ok) throw new Error(`refresh failed: ${response.status}`);
    const payload = await readResponseJson(response);
    const nextToken = {
      ...file.token,
      ...(typeof payload.accessToken === 'string' && { accessToken: payload.accessToken }),
      ...(typeof payload.licenseBundle === 'string' && { licenseBundle: payload.licenseBundle }),
      ...(typeof payload.refreshToken === 'string' && { refreshToken: payload.refreshToken })
    };
    writeTokenFile(file.path, nextToken);
    return accountFromToken({ ...file, token: nextToken }, 'refreshed');
  } catch {
    if (stringField(file.token, 'licenseBundle', 'license_bundle')) {
      return accountFromToken(file, 'cached-bundle');
    }
    return freeAccount('offline-no-cache');
  }
}

function loopSlot(): Record<string, unknown> {
  return globalThis as unknown as Record<string, unknown>;
}

export function startAccountRefreshLoop(options: LoopOptions = {}): { booted: boolean } {
  const slot = loopSlot();
  if (slot[LOOP_KEY]) return { booted: false };
  const tick = () => {
    refreshIfNeeded(options).catch(() => {
      /* degrade-on-failure is handled by refreshIfNeeded; timer must live. */
    });
  };
  const setIntervalImpl = options.setIntervalImpl ?? setInterval;
  slot[LOOP_KEY] = setIntervalImpl(tick, ONE_HOUR_MS);
  if (options.runImmediately !== false) tick();
  return { booted: true };
}

export function _resetAccountRefreshLoopForTests(): void {
  delete loopSlot()[LOOP_KEY];
}
