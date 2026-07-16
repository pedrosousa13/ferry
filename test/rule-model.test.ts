import { describe, it, expect } from 'vitest';
import { createRule, validateRule } from '../src/rule-model';
import { re2Incompatibility, countCaptureGroups, maxSubstitutionRef } from '../src/rule-model';

describe('createRule', () => {
  it('defaults resourceTypes to main_frame', () => {
    const r = createRule({ id: 'a', includePattern: 'x', redirectUrl: 'y' });
    expect(r.resourceTypes).toEqual(['main_frame']);
    expect(r.patternType).toBe('wildcard');
    expect(r.disabled).toBe(false);
  });

  it('keeps provided resourceTypes', () => {
    const r = createRule({ id: 'a', resourceTypes: ['script', 'image'] });
    expect(r.resourceTypes).toEqual(['script', 'image']);
  });
});

describe('validateRule', () => {
  it('requires include pattern and redirect url', () => {
    const errors = validateRule(createRule({ id: 'a' }));
    expect(errors).toContain('Include pattern is required.');
    expect(errors).toContain('Redirect URL is required.');
  });

  it('rejects an invalid regex include pattern', () => {
    const r = createRule({ id: 'a', patternType: 'regex', includePattern: '(', redirectUrl: 'z' });
    expect(validateRule(r)).toContain('Invalid regular expression in include pattern.');
  });

  it('accepts a valid rule', () => {
    const r = createRule({ id: 'a', includePattern: 'https://x/*', redirectUrl: 'https://y/$1' });
    expect(validateRule(r)).toEqual([]);
  });
});

describe('re2Incompatibility', () => {
  it('rejects lookahead', () => expect(re2Incompatibility('foo(?=bar)')).toMatch(/Lookahead/));
  it('rejects negative lookahead', () => expect(re2Incompatibility('foo(?!bar)')).toMatch(/Lookahead/));
  it('rejects lookbehind', () => expect(re2Incompatibility('(?<=a)b')).toMatch(/Lookbehind/));
  it('rejects negative lookbehind', () => expect(re2Incompatibility('(?<!a)b')).toMatch(/Lookbehind/));
  it('rejects named groups', () => expect(re2Incompatibility('(?<name>a)')).toMatch(/Named group/));
  it('rejects backreferences', () => expect(re2Incompatibility('(a)\\1')).toMatch(/Backreference/));
  it('allows escaped backslash before digit', () => expect(re2Incompatibility('a\\\\1')).toBeNull());
  it('allows non-capturing groups', () => expect(re2Incompatibility('(?:abc)+')).toBeNull());
  it('allows plain regex', () => expect(re2Incompatibility('^https://x\\.com/(.*)$')).toBeNull());
  it('ignores lookalike syntax inside character classes', () => expect(re2Incompatibility('[(?=]')).toBeNull());
});

describe('countCaptureGroups', () => {
  it('counts wildcard stars', () => expect(countCaptureGroups('https://*/x/*', 'wildcard')).toBe(2));
  it('counts regex capture groups', () => expect(countCaptureGroups('(a)(?:b)(c)', 'regex')).toBe(2));
  it('ignores escaped parens', () => expect(countCaptureGroups('\\(a\\)', 'regex')).toBe(0));
  it('ignores parens in character classes', () => expect(countCaptureGroups('[(]a[)]', 'regex')).toBe(0));
});

describe('maxSubstitutionRef', () => {
  it('finds highest $n', () => expect(maxSubstitutionRef('https://y/$2/$1')).toBe(2));
  it('is 0 with no refs', () => expect(maxSubstitutionRef('https://y/')).toBe(0));
});

describe('validateRule RE2 + capture checks', () => {
  it('rejects lookahead in regex include', () => {
    const r = createRule({ patternType: 'regex', includePattern: 'x(?=y)', redirectUrl: 'https://y/' });
    expect(validateRule(r).some((e) => /Lookahead/.test(e))).toBe(true);
  });
  it('rejects $1 when include has no capture group', () => {
    const r = createRule({ includePattern: 'https://twitter.com/', redirectUrl: 'https://nitter.net/$1' });
    expect(validateRule(r).some((e) => /\$1/.test(e))).toBe(true);
  });
  it('accepts $1 with one wildcard star', () => {
    const r = createRule({ includePattern: 'https://twitter.com/*', redirectUrl: 'https://nitter.net/$1' });
    expect(validateRule(r)).toEqual([]);
  });
});
