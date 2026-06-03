import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getOperatorHandle,
  canonicaliseOperatorHandle,
  isOperatorHandle
} from './operatorHandle';
import { OPERATOR_SENTINEL } from '$lib/operatorSentinel';

describe('operatorHandle — single configurable operator identity', () => {
  const prior = process.env.ANT_OPERATOR_HANDLE;
  beforeEach(() => {
    delete process.env.ANT_OPERATOR_HANDLE;
  });
  afterEach(() => {
    if (prior === undefined) delete process.env.ANT_OPERATOR_HANDLE;
    else process.env.ANT_OPERATOR_HANDLE = prior;
  });

  it('defaults to the legacy sentinel when ANT_OPERATOR_HANDLE is unset', () => {
    expect(getOperatorHandle()).toBe(OPERATOR_SENTINEL);
    // With no operator configured, the sentinel maps to itself (no transform).
    expect(canonicaliseOperatorHandle('@you')).toBe('@you');
  });

  it('reads the configured operator handle from the env', () => {
    process.env.ANT_OPERATOR_HANDLE = '@JWPK';
    expect(getOperatorHandle()).toBe('@JWPK');
  });

  it('canonicalises the sentinel to the configured handle, passes others through', () => {
    process.env.ANT_OPERATOR_HANDLE = '@JWPK';
    expect(canonicaliseOperatorHandle('@you')).toBe('@JWPK');
    expect(canonicaliseOperatorHandle('you')).toBe('@JWPK'); // adds leading @
    expect(canonicaliseOperatorHandle('@speedy')).toBe('@speedy');
    expect(canonicaliseOperatorHandle('agent')).toBe('@agent');
    expect(canonicaliseOperatorHandle('')).toBe('');
  });

  it('does NOT canonicalise non-sentinel handles (case-sensitive structural map)', () => {
    process.env.ANT_OPERATOR_HANDLE = '@JWPK';
    // Only the exact sentinel maps; a stray `@You` is left alone structurally.
    expect(canonicaliseOperatorHandle('@You')).toBe('@You');
  });

  it('isOperatorHandle accepts both the sentinel and the configured handle (case-insensitive)', () => {
    process.env.ANT_OPERATOR_HANDLE = '@JWPK';
    expect(isOperatorHandle('@you')).toBe(true);
    expect(isOperatorHandle('@You')).toBe(true);
    expect(isOperatorHandle('@JWPK')).toBe(true);
    expect(isOperatorHandle('@jwpk')).toBe(true);
    expect(isOperatorHandle('@speedy')).toBe(false);
  });
});
