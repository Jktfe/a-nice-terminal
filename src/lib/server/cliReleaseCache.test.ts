import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseVersionFromTag,
  fetchLatestFromGitHub,
  getLatestCliRelease,
  _resetCliReleaseCacheForTests
} from './cliReleaseCache';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('parseVersionFromTag', () => {
  it('strips ant-v prefix', () => {
    expect(parseVersionFromTag('ant-v0.1.9')).toBe('0.1.9');
  });
  it('strips bare v prefix', () => {
    expect(parseVersionFromTag('v1.2.3')).toBe('1.2.3');
  });
  it('passes raw tag through if no recognised prefix', () => {
    // Defensive — if tag scheme changes, user still sees SOMETHING.
    expect(parseVersionFromTag('release-2026-05-26')).toBe('release-2026-05-26');
  });
});

describe('fetchLatestFromGitHub', () => {
  it('returns parsed payload from GitHub response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      tag_name: 'ant-v0.1.9',
      published_at: '2026-05-25T12:00:00Z',
      html_url: 'https://github.com/Jktfe/a-nice-terminal/releases/tag/ant-v0.1.9'
    }));
    const payload = await fetchLatestFromGitHub(fetchImpl);
    expect(payload.version).toBe('0.1.9');
    expect(payload.tag).toBe('ant-v0.1.9');
    expect(payload.releaseNotesUrl).toBe('https://github.com/Jktfe/a-nice-terminal/releases/tag/ant-v0.1.9');
    expect(payload.installCommand).toBe('brew install jktfe/antchat/ant');
    expect(payload.upgradeCommand).toBe('brew upgrade jktfe/antchat/ant');
    expect(typeof payload.fetchedAt).toBe('string');
  });

  it('throws on non-OK response', async () => {
    const fetchImpl = vi.fn(async () => new Response('rate limit', { status: 403 }));
    await expect(fetchLatestFromGitHub(fetchImpl)).rejects.toThrow(/github releases 403/);
  });

  it('throws when tag_name is missing from response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    await expect(fetchLatestFromGitHub(fetchImpl)).rejects.toThrow(/missing tag_name/);
  });
});

describe('getLatestCliRelease (cache layer)', () => {
  beforeEach(() => _resetCliReleaseCacheForTests());
  afterEach(() => _resetCliReleaseCacheForTests());

  it('caches across calls within TTL', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      tag_name: 'ant-v0.1.9',
      published_at: '2026-05-25T12:00:00Z',
      html_url: 'https://github.com/x/y/releases/tag/ant-v0.1.9'
    }));
    const first = await getLatestCliRelease(fetchImpl);
    const second = await getLatestCliRelease(fetchImpl);
    expect(first).toEqual(second);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('re-throws on upstream failure when cache is empty', async () => {
    const fetchImpl = vi.fn(async () => new Response('upstream down', { status: 500 }));
    await expect(getLatestCliRelease(fetchImpl)).rejects.toThrow(/github releases 500/);
  });
});
