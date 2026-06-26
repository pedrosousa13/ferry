import { describe, it, expect } from 'vitest';
import { createRule, validateRule } from '../src/rule-model';

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
