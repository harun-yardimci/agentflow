import { describe, it, expect } from 'vitest';
import { evaluateCondition, parseCondition } from '../server/services/condition-evaluator.js';

describe('evaluateCondition', () => {
  describe('null condition (unconditional)', () => {
    it('returns true for null condition', () => {
      expect(evaluateCondition(null, 'any output', 'completed')).toBe(true);
    });
  });

  describe('contains', () => {
    it('returns true when output contains value (case-insensitive)', () => {
      expect(evaluateCondition(
        { type: 'contains', value: 'success' },
        'All tests passed. SUCCESS!',
        'completed',
      )).toBe(true);
    });

    it('returns false when output does not contain value', () => {
      expect(evaluateCondition(
        { type: 'contains', value: 'success' },
        'Build failed with errors',
        'completed',
      )).toBe(false);
    });

    it('handles null output', () => {
      expect(evaluateCondition(
        { type: 'contains', value: 'test' },
        null,
        'completed',
      )).toBe(false);
    });
  });

  describe('not_contains', () => {
    it('returns true when output does not contain value', () => {
      expect(evaluateCondition(
        { type: 'not_contains', value: 'error' },
        'All tests passed successfully',
        'completed',
      )).toBe(true);
    });

    it('returns false when output contains value', () => {
      expect(evaluateCondition(
        { type: 'not_contains', value: 'error' },
        'Build failed with error code 1',
        'completed',
      )).toBe(false);
    });

    it('returns true for null output (no content to match)', () => {
      expect(evaluateCondition(
        { type: 'not_contains', value: 'error' },
        null,
        'completed',
      )).toBe(true);
    });
  });

  describe('regex', () => {
    it('returns true when output matches regex', () => {
      expect(evaluateCondition(
        { type: 'regex', value: '\\d+ tests? passed' },
        '42 tests passed, 0 failed',
        'completed',
      )).toBe(true);
    });

    it('returns false when output does not match regex', () => {
      expect(evaluateCondition(
        { type: 'regex', value: '^DEPLOY_READY$' },
        'Still building...',
        'completed',
      )).toBe(false);
    });

    it('returns false for invalid regex (graceful failure)', () => {
      expect(evaluateCondition(
        { type: 'regex', value: '[invalid(' },
        'any output',
        'completed',
      )).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(evaluateCondition(
        { type: 'regex', value: 'pass' },
        'PASS',
        'completed',
      )).toBe(true);
    });
  });

  describe('status', () => {
    it('returns true when status matches', () => {
      expect(evaluateCondition(
        { type: 'status', value: 'completed' },
        'some output',
        'completed',
      )).toBe(true);
    });

    it('returns false when status does not match', () => {
      expect(evaluateCondition(
        { type: 'status', value: 'completed' },
        'some output',
        'failed',
      )).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(evaluateCondition(
        { type: 'status', value: 'COMPLETED' },
        'some output',
        'completed',
      )).toBe(true);
    });
  });

  describe('unknown type', () => {
    it('returns true for unknown condition type (safe default)', () => {
      expect(evaluateCondition(
        { type: 'future_type' as any, value: 'x' },
        'output',
        'completed',
      )).toBe(true);
    });
  });
});

describe('parseCondition', () => {
  it('returns null for null input', () => {
    expect(parseCondition(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseCondition('')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseCondition('not json')).toBeNull();
  });

  it('returns null for JSON missing required fields', () => {
    expect(parseCondition('{"type":"contains"}')).toBeNull();
    expect(parseCondition('{"value":"test"}')).toBeNull();
  });

  it('parses valid condition JSON', () => {
    const result = parseCondition('{"type":"contains","value":"success"}');
    expect(result).toEqual({ type: 'contains', value: 'success' });
  });

  it('parses regex condition', () => {
    const result = parseCondition('{"type":"regex","value":"\\\\d+"}');
    expect(result).toEqual({ type: 'regex', value: '\\d+' });
  });
});
