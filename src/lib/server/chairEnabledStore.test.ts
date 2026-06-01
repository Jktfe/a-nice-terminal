import { beforeEach, describe, expect, it } from 'vitest';
import {
  isChairEnabled,
  setChairEnabled,
  resetChairEnabledStoreForTests
} from './chairEnabledStore';

describe('chairEnabledStore', () => {
  beforeEach(() => {
    resetChairEnabledStoreForTests();
  });

  it('defaults to true on first read (opt-out semantics)', () => {
    expect(isChairEnabled()).toBe(true);
  });

  it('set to false then read returns false', () => {
    setChairEnabled(false);
    expect(isChairEnabled()).toBe(false);
  });

  it('set to true then read returns true', () => {
    setChairEnabled(false);
    setChairEnabled(true);
    expect(isChairEnabled()).toBe(true);
  });

  it('reset returns state to default-true', () => {
    setChairEnabled(false);
    resetChairEnabledStoreForTests();
    expect(isChairEnabled()).toBe(true);
  });

  it('idempotent set keeps same value', () => {
    setChairEnabled(false);
    setChairEnabled(false);
    expect(isChairEnabled()).toBe(false);
  });
});
