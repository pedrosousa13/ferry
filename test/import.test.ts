import { describe, it, expect } from 'vitest';
import { parseImport } from '../src/import';
import { createRule } from '../src/rule-model';

describe('parseImport', () => {
  it('round-trips a Ferry export losslessly (patternType + disabled preserved)', () => {
    const original = createRule({
      description: 'regex rule',
      patternType: 'regex',
      includePattern: '^https://x\\.com/(.*)$',
      redirectUrl: 'https://y.com/$1',
      disabled: true,
    });
    const payload = JSON.parse(JSON.stringify({ createdBy: 'Ferry', redirects: [original] }));
    const result = parseImport(payload);
    expect(result.error).toBeUndefined();
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].patternType).toBe('regex');
    expect(result.rules[0].disabled).toBe(true);
    expect(result.rules[0].includePattern).toBe(original.includePattern);
  });

  it('regenerates ids so re-import never collides', () => {
    const original = createRule({ includePattern: 'https://a/*', redirectUrl: 'https://b/$1' });
    const result = parseImport({ redirects: [JSON.parse(JSON.stringify(original))] });
    expect(result.rules[0].id).not.toBe(original.id);
  });

  it('maps Redirector patternType R to regex and W to wildcard', () => {
    const result = parseImport({ redirects: [
      { includePattern: '^x(.*)$', redirectUrl: 'y$1', patternType: 'R', appliesTo: ['main_frame'] },
      { includePattern: 'x*', redirectUrl: 'y$1', patternType: 'W', appliesTo: ['main_frame'] },
    ]});
    expect(result.rules.map((r) => r.patternType)).toEqual(['regex', 'wildcard']);
  });

  it('skips Redirector transform rules and counts them', () => {
    const result = parseImport({ redirects: [
      { includePattern: 'x*', redirectUrl: 'y$1', processMatches: 'urlDecode' },
    ]});
    expect(result.rules).toHaveLength(0);
    expect(result.skippedTransforms).toBe(1);
  });

  it('skips invalid rules (fails validateRule) and counts them', () => {
    const result = parseImport({ redirects: [
      { includePattern: '', redirectUrl: 'https://y/' },
      { includePattern: 'x(?=y)', redirectUrl: 'https://y/', patternType: 'regex' },
      { includePattern: 'https://ok/*', redirectUrl: 'https://y/$1' },
    ]});
    expect(result.rules).toHaveLength(1);
    expect(result.skippedInvalid).toBe(2);
  });

  it('rejects unrecognized payload shapes without throwing', () => {
    for (const bad of [null, 42, 'x', {}, { redirects: 'nope' }, { redirects: [null, 7] }]) {
      const result = parseImport(bad);
      expect(result.rules).toEqual([]);
      if (bad && typeof bad === 'object' && Array.isArray((bad as any).redirects)) {
        expect(result.skippedInvalid).toBeGreaterThan(0);
      } else {
        expect(result.error).toBeTruthy();
      }
    }
  });
});
