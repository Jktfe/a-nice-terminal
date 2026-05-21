import { describe, expect, it } from 'vitest';
import {
  unwrapAnyValue,
  flattenAttributes,
  getExportLogsServiceRequestType,
  getExportLogsServiceResponseType
} from './logsProto';

describe('logsProto', () => {
  describe('getExportLogsServiceRequestType', () => {
    it('returns a protobuf Type', () => {
      const t = getExportLogsServiceRequestType();
      expect(t).toBeDefined();
      expect(t.name).toBe('ExportLogsServiceRequest');
    });
  });

  describe('getExportLogsServiceResponseType', () => {
    it('returns a protobuf Type', () => {
      const t = getExportLogsServiceResponseType();
      expect(t).toBeDefined();
      expect(t.name).toBe('ExportLogsServiceResponse');
    });
  });

  describe('unwrapAnyValue', () => {
    it('returns null for null input', () => {
      expect(unwrapAnyValue(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(unwrapAnyValue(undefined)).toBeNull();
    });

    it('returns null for non-object input', () => {
      expect(unwrapAnyValue('string' as unknown as Record<string, unknown>)).toBeNull();
    });

    it('unwraps string_value', () => {
      expect(unwrapAnyValue({ string_value: 'hello' })).toBe('hello');
    });

    it('unwraps bool_value', () => {
      expect(unwrapAnyValue({ bool_value: true })).toBe(true);
      expect(unwrapAnyValue({ bool_value: false })).toBe(false);
    });

    it('unwraps int_value as number', () => {
      expect(unwrapAnyValue({ int_value: 42 })).toBe(42);
    });

    it('unwraps int_value string as number', () => {
      expect(unwrapAnyValue({ int_value: '99' })).toBe(99);
    });

    it('unwraps double_value', () => {
      expect(unwrapAnyValue({ double_value: 3.14 })).toBe(3.14);
    });

    it('unwraps array_value', () => {
      const result = unwrapAnyValue({
        array_value: {
          values: [{ string_value: 'a' }, { string_value: 'b' }]
        }
      });
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(['a', 'b']);
    });

    it('unwraps kvlist_value', () => {
      const result = unwrapAnyValue({
        kvlist_value: {
          values: [
            { key: 'k1', value: { string_value: 'v1' } },
            { key: 'k2', value: { int_value: 2 } }
          ]
        }
      });
      expect(result).toEqual({ k1: 'v1', k2: 2 });
    });

    it('unwraps bytes_value as base64', () => {
      const result = unwrapAnyValue({ bytes_value: new Uint8Array([1, 2, 3]) });
      expect(result).toBe(Buffer.from([1, 2, 3]).toString('base64'));
    });

    it('returns null when no oneof is set', () => {
      expect(unwrapAnyValue({})).toBeNull();
    });

    it('returns null for empty array_value', () => {
      const result = unwrapAnyValue({ array_value: {} });
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([]);
    });
  });

  describe('flattenAttributes', () => {
    it('returns empty object for undefined', () => {
      expect(flattenAttributes(undefined)).toEqual({});
    });

    it('returns empty object for empty array', () => {
      expect(flattenAttributes([])).toEqual({});
    });

    it('flattens key-value list', () => {
      const result = flattenAttributes([
        { key: 'service.name', value: { string_value: 'ant' } },
        { key: 'count', value: { int_value: 5 } }
      ]);
      expect(result).toEqual({ 'service.name': 'ant', count: 5 });
    });

    it('skips entries with empty key', () => {
      const result = flattenAttributes([
        { key: 'valid', value: { string_value: 'yes' } },
        { key: '', value: { string_value: 'no' } }
      ]);
      expect(result).toEqual({ valid: 'yes' });
    });

    it('skips entries with null value', () => {
      const result = flattenAttributes([
        { key: 'a', value: { string_value: 'yes' } },
        { key: 'b', value: null }
      ]);
      expect(result).toEqual({ a: 'yes', b: null });
    });
  });
});
