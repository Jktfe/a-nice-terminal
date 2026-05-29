/**
 * identityKeysSignature tests — substrate v0.2 Part 4 (2026-05-29).
 *
 * Deterministic ed25519 round-trip vectors. The same keypair generated in
 * a single test run is used for all assertions so we don't depend on
 * external fixtures (which would risk drift if node:crypto's JWK importer
 * ever changes shape) and yet the round-trip property is locked in.
 */

import { describe, expect, it } from 'vitest';
import {
  generateChallengeNonce,
  generateEd25519KeyPair,
  sha256Hex,
  signCanonicalPayload,
  verifySignature
} from './identityKeysStore';

describe('ed25519 round-trip', () => {
  it('signs and verifies the same payload', () => {
    const kp = generateEd25519KeyPair();
    expect(Buffer.from(kp.publicKey, 'base64').length).toBe(32);
    expect(Buffer.from(kp.privateKey, 'base64').length).toBe(32);
    const payload = 'hello-substrate-v0.2-part-4';
    const sig = signCanonicalPayload(payload, kp.privateKey, kp.publicKey);
    expect(Buffer.from(sig, 'base64').length).toBe(64);
    expect(verifySignature(payload, sig, kp.publicKey)).toBe(true);
  });

  it('rejects a forged signature', () => {
    const kp = generateEd25519KeyPair();
    const payload = 'message-1';
    const sig = signCanonicalPayload(payload, kp.privateKey, kp.publicKey);
    // Flip a byte in the signature (well, replace with a random valid sig
    // over a different message — node:crypto verify must reject).
    const forged = signCanonicalPayload('message-2', kp.privateKey, kp.publicKey);
    expect(verifySignature(payload, forged, kp.publicKey)).toBe(false);
  });

  it('rejects when verifying against a stranger key', () => {
    const alice = generateEd25519KeyPair();
    const bob = generateEd25519KeyPair();
    const payload = 'shared-truth';
    const sigByAlice = signCanonicalPayload(payload, alice.privateKey, alice.publicKey);
    expect(verifySignature(payload, sigByAlice, alice.publicKey)).toBe(true);
    expect(verifySignature(payload, sigByAlice, bob.publicKey)).toBe(false);
  });

  it('verifySignature returns false for a malformed signature instead of throwing', () => {
    const kp = generateEd25519KeyPair();
    expect(verifySignature('payload', 'not-base64!@#', kp.publicKey)).toBe(false);
    expect(verifySignature('payload', '', kp.publicKey)).toBe(false);
  });
});

describe('challenge nonce + paper-mnemonic hash', () => {
  it('generateChallengeNonce returns 32 raw bytes (base64)', () => {
    const nonce = generateChallengeNonce();
    expect(Buffer.from(nonce, 'base64').length).toBe(32);
  });

  it('generateChallengeNonce returns a fresh value each call', () => {
    const a = generateChallengeNonce();
    const b = generateChallengeNonce();
    expect(a).not.toBe(b);
  });

  it('sha256Hex is deterministic + 64 hex chars', () => {
    const a = sha256Hex('paper-mnemonic-test-vector');
    const b = sha256Hex('paper-mnemonic-test-vector');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sha256Hex differentiates similar-looking inputs', () => {
    expect(sha256Hex('a')).not.toBe(sha256Hex('A'));
    expect(sha256Hex('twenty four words mnemonic ')).not.toBe(
      sha256Hex('twenty four words mnemonic')
    );
  });
});
