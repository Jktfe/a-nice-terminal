import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { operatorDisplayHandle } from './operatorDisplayHandle';
import { OPERATOR_SENTINEL } from '$lib/operatorSentinel';

// The mapper reads ANT_OPERATOR_DISPLAY_HANDLE at call time, so each test
// sets/clears it explicitly and we restore the prior value afterwards.
const previous = process.env.ANT_OPERATOR_DISPLAY_HANDLE;

beforeEach(() => {
  delete process.env.ANT_OPERATOR_DISPLAY_HANDLE;
});

afterEach(() => {
  if (previous === undefined) delete process.env.ANT_OPERATOR_DISPLAY_HANDLE;
  else process.env.ANT_OPERATOR_DISPLAY_HANDLE = previous;
});

describe('operatorDisplayHandle', () => {
  it('is a no-op when the env var is unset (production / tests default)', () => {
    expect(operatorDisplayHandle(OPERATOR_SENTINEL)).toBe(OPERATOR_SENTINEL);
    expect(operatorDisplayHandle('@speedy')).toBe('@speedy');
  });

  it('is a no-op when the env var is set to an empty string', () => {
    process.env.ANT_OPERATOR_DISPLAY_HANDLE = '';
    expect(operatorDisplayHandle(OPERATOR_SENTINEL)).toBe(OPERATOR_SENTINEL);
  });

  it('maps the operator sentinel to the configured display handle', () => {
    process.env.ANT_OPERATOR_DISPLAY_HANDLE = '@JWPK';
    expect(operatorDisplayHandle(OPERATOR_SENTINEL)).toBe('@JWPK');
  });

  it('leaves every non-operator handle untouched even when mapping is active', () => {
    process.env.ANT_OPERATOR_DISPLAY_HANDLE = '@JWPK';
    // Other agents, system, and already-friendly display names pass through —
    // the mapping is strictly scoped to the @you sentinel.
    expect(operatorDisplayHandle('@speedy')).toBe('@speedy');
    expect(operatorDisplayHandle('@system')).toBe('@system');
    expect(operatorDisplayHandle('@JWPK')).toBe('@JWPK');
    expect(operatorDisplayHandle('James')).toBe('James');
  });
});
