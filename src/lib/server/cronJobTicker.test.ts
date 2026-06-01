import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isWebhookUrlSafe } from './cronJobTicker';

const prevEnv = process.env.ANT_WEBHOOK_ALLOW_PRIVATE;

beforeEach(() => {
  delete process.env.ANT_WEBHOOK_ALLOW_PRIVATE;
});

afterEach(() => {
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
