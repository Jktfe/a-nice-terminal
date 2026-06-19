import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isWebhookUrlSafe, tickCronJobsOnce } from './cronJobTicker';
import { createCronJob, getCronJob } from './cronJobStore';
import { resetIdentityDbForTests } from './db';

const prevEnv = process.env.ANT_WEBHOOK_ALLOW_PRIVATE;
const prevDbPath = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  delete process.env.ANT_WEBHOOK_ALLOW_PRIVATE;
});

afterEach(() => {
  resetIdentityDbForTests();
  if (prevDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevDbPath;
  if (prevEnv === undefined) delete process.env.ANT_WEBHOOK_ALLOW_PRIVATE;
  else process.env.ANT_WEBHOOK_ALLOW_PRIVATE = prevEnv;
});

describe('isWebhookUrlSafe', () => {
  describe('allows public-internet HTTPS endpoints', () => {
    it.each([
      'https://example.com/hook',
      'https://api.stripe.com/v1/webhooks',
      'http://example.com/hook',
      'https://hooks.slack.com/services/T00/B00/XXX'
    ])('%s → ok', (url) => {
      expect(isWebhookUrlSafe(url)).toEqual({ ok: true });
    });
  });

  describe('blocks unsupported protocols', () => {
    it.each([
      'file:///etc/passwd',
      'ftp://example.com/',
      'gopher://example.com:6379/',
      'data:text/plain,hello',
      'javascript:alert(1)',
      'ws://example.com/'
    ])('%s → blocked', (url) => {
      const result = isWebhookUrlSafe(url);
      expect(result.ok).toBe(false);
    });
  });

  describe('blocks loopback / localhost', () => {
    it.each([
      'http://localhost/hook',
      'http://LOCALHOST/hook',
      'http://localhost:6174/api/cron-jobs',
      'http://127.0.0.1/',
      'http://127.0.0.1:6379/',
      'http://127.1.2.3/',
      'http://0.0.0.0/',
      'http://[::1]/'
    ])('%s → blocked', (url) => {
      const result = isWebhookUrlSafe(url);
      expect(result.ok).toBe(false);
    });
  });

  describe('blocks private IPv4 ranges (RFC1918)', () => {
    it.each([
      'http://10.0.0.1/',
      'http://10.255.255.255/',
      'http://172.16.0.1/',
      'http://172.31.255.254/',
      'http://192.168.1.1/'
    ])('%s → blocked', (url) => {
      const result = isWebhookUrlSafe(url);
      expect(result.ok).toBe(false);
    });
  });

  describe('blocks link-local + metadata-service IPs', () => {
    it.each([
      'http://169.254.169.254/latest/meta-data/',  // AWS / GCP / Azure metadata
      'http://169.254.1.1/'
    ])('%s → blocked', (url) => {
      const result = isWebhookUrlSafe(url);
      expect(result.ok).toBe(false);
    });
  });

  describe('blocks IPv6 ULA + link-local', () => {
    it.each([
      'http://[fc00::1]/',
      'http://[fd00::1]/',
      'http://[fe80::1]/'
    ])('%s → blocked', (url) => {
      const result = isWebhookUrlSafe(url);
      expect(result.ok).toBe(false);
    });
  });

  describe('blocks .local and .internal hostnames', () => {
    it.each([
      'http://my-mac.local/',
      'http://service.internal/'
    ])('%s → blocked', (url) => {
      const result = isWebhookUrlSafe(url);
      expect(result.ok).toBe(false);
    });
  });

  describe('rejects malformed URLs', () => {
    it.each([
      'not a url',
      'http://',
      ''
    ])('%s → blocked', (url) => {
      const result = isWebhookUrlSafe(url);
      expect(result.ok).toBe(false);
    });
  });

  it('ANT_WEBHOOK_ALLOW_PRIVATE=true bypasses every guard (self-host opt-in)', () => {
    process.env.ANT_WEBHOOK_ALLOW_PRIVATE = 'true';
    expect(isWebhookUrlSafe('http://localhost:6174/').ok).toBe(true);
    expect(isWebhookUrlSafe('http://10.0.0.1/').ok).toBe(true);
    expect(isWebhookUrlSafe('http://169.254.169.254/').ok).toBe(true);
  });
});

describe('tickCronJobsOnce outcome recording', () => {
  it('records skipped outcome for invalid room.message config while advancing the schedule', async () => {
    const job = createCronJob({
      name: 'bad room message',
      intervalMs: 1_000,
      action: 'room.message',
      startImmediately: true,
      nowMs: 1_000
    });

    expect(await tickCronJobsOnce(2_000)).toBe(1);

    const after = getCronJob(job.id)!;
    expect(after.fireCount).toBe(1);
    expect(after.lastFiredAtMs).toBe(2_000);
    expect(after.nextFireAtMs).toBe(3_000);
    expect(after.lastOutcomeStatus).toBe('skipped');
    expect(after.lastOutcomeMessage).toContain('targetRoomId');
    expect(after.lastOutcomeAtMs).toBe(2_000);
  });

  it('records failed outcome for non-2xx webhook responses while advancing the schedule', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('nope', { status: 500, statusText: 'Bad' });
    try {
      const job = createCronJob({
        name: 'bad webhook',
        intervalMs: 1_000,
        action: 'webhook.post',
        actionConfig: { url: 'https://example.com/hook' },
        startImmediately: true,
        nowMs: 1_000
      });

      expect(await tickCronJobsOnce(2_000)).toBe(1);

      const after = getCronJob(job.id)!;
      expect(after.fireCount).toBe(1);
      expect(after.lastFiredAtMs).toBe(2_000);
      expect(after.nextFireAtMs).toBe(3_000);
      expect(after.lastOutcomeStatus).toBe('failed');
      expect(after.lastOutcomeMessage).toContain('500 Bad');
      expect(after.lastOutcomeAtMs).toBe(2_000);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
