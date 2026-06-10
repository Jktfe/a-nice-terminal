import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getOperatorHandle,
  canonicaliseOperatorHandle,
  isOperatorHandle
} from './operatorHandle';
import { OPERATOR_SENTINEL } from '$lib/operatorSentinel';

describe('operatorHandle — locked operator identity', () => {
  const prior = process.env.ANT_OPERATOR_HANDLE;
  beforeEach(() => {
    delete process.env.ANT_OPERATOR_HANDLE;
  });
  afterEach(() => {
    if (prior === undefined) delete process.env.ANT_OPERATOR_HANDLE;
    else process.env.ANT_OPERATOR_HANDLE = prior;
  });

  it('defaults to the structural JWPK sentinel when ANT_OPERATOR_HANDLE is unset', () => {
    expect(getOperatorHandle()).toBe(OPERATOR_SENTINEL);
    expect(getOperatorHandle()).toBe('@JWPK');
    expect(canonicaliseOperatorHandle('@you')).toBe('@JWPK');
    expect(canonicaliseOperatorHandle('@JWPK')).toBe('@JWPK');
  });

  it('does not let ANT_OPERATOR_HANDLE change the server handle', () => {
    process.env.ANT_OPERATOR_HANDLE = '@minimaxs-codex';
    expect(getOperatorHandle()).toBe('@JWPK');
    expect(canonicaliseOperatorHandle('@you')).toBe('@JWPK');
    expect(isOperatorHandle('@minimaxs-codex')).toBe(false);
  });

  it('canonicalises legacy operator aliases to the configured handle, passes others through', () => {
    process.env.ANT_OPERATOR_HANDLE = '@JWPK';
    expect(canonicaliseOperatorHandle('@you')).toBe('@JWPK');
    expect(canonicaliseOperatorHandle('you')).toBe('@JWPK'); // adds leading @
    expect(canonicaliseOperatorHandle('@JWPK')).toBe('@JWPK');
    expect(canonicaliseOperatorHandle('@speedy')).toBe('@speedy');
    expect(canonicaliseOperatorHandle('agent')).toBe('@agent');
    expect(canonicaliseOperatorHandle('')).toBe('');
  });

  it('canonicalises operator aliases case-insensitively', () => {
    process.env.ANT_OPERATOR_HANDLE = '@JWPK';
    expect(canonicaliseOperatorHandle('@You')).toBe('@JWPK');
    expect(canonicaliseOperatorHandle('@jwpk')).toBe('@JWPK');
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
