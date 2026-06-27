import { describe, it, expect } from 'vitest';
import { createRule, validateRule, createWhitelistEntry, validateWhitelistEntry } from '../src/rule-model';

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

describe('createWhitelistEntry', () => {
  it('defaults disabled to false and generates an id', () => {
    const e = createWhitelistEntry({ pattern: 'https://x/*' });
    expect(e.pattern).toBe('https://x/*');
    expect(e.disabled).toBe(false);
    expect(typeof e.id).toBe('string');
    expect(e.id.length).toBeGreaterThan(0);
  });

  it('keeps a provided id and disabled flag', () => {
    const e = createWhitelistEntry({ id: 'w1', pattern: 'a', disabled: true });
    expect(e.id).toBe('w1');
    expect(e.disabled).toBe(true);
  });
});

describe('validateWhitelistEntry', () => {
  it('requires a pattern', () => {
    expect(validateWhitelistEntry(createWhitelistEntry({ pattern: '' }))).toContain('Pattern is required.');
  });

  it('accepts a non-empty pattern', () => {
    expect(validateWhitelistEntry(createWhitelistEntry({ pattern: 'https://x/*' }))).toEqual([]);
  });
});
