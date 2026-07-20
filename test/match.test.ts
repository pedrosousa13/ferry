import { describe, it, expect } from 'vitest';
import { ruleMatchesUrl, whitelistMatchesUrl } from '../src/match';
import { createRule, createWhitelistEntry } from '../src/rule-model';

const base = { includePattern: 'https://twitter.com/*', redirectUrl: 'https://nitter.net/$1' };

describe('ruleMatchesUrl', () => {
  it('matches a wildcard include pattern', () => {
    expect(ruleMatchesUrl(createRule(base), 'https://twitter.com/jack')).toBe(true);
  });

  it('does not match an unrelated URL', () => {
    expect(ruleMatchesUrl(createRule(base), 'https://example.com/')).toBe(false);
  });

  it('exclude pattern wins over include', () => {
    const rule = createRule({ ...base, excludePattern: 'https://twitter.com/i/*' });
    expect(ruleMatchesUrl(rule, 'https://twitter.com/i/flow')).toBe(false);
    expect(ruleMatchesUrl(rule, 'https://twitter.com/jack')).toBe(true);
  });

  it('supports regex patterns', () => {
    const rule = createRule({
      patternType: 'regex',
      includePattern: '^https://(www\\.)?reddit\\.com/',
      redirectUrl: 'https://old.reddit.com/',
    });
    expect(ruleMatchesUrl(rule, 'https://www.reddit.com/r/foo')).toBe(true);
    expect(ruleMatchesUrl(rule, 'https://notreddit.com/')).toBe(false);
  });

  it('a disabled rule never matches', () => {
    expect(ruleMatchesUrl(createRule({ ...base, disabled: true }), 'https://twitter.com/jack')).toBe(false);
  });

  it('a rule without main_frame never matches (cannot redirect the tab)', () => {
    const rule = createRule({ ...base, resourceTypes: ['script'] });
    expect(ruleMatchesUrl(rule, 'https://twitter.com/jack')).toBe(false);
  });

  it('an invalid regex returns false instead of throwing', () => {
    const rule = createRule({ patternType: 'regex', includePattern: '(', redirectUrl: 'https://x.example/' });
    expect(ruleMatchesUrl(rule, 'https://twitter.com/jack')).toBe(false);
  });

  it('an empty include pattern never matches', () => {
    const rule = createRule({ includePattern: '', redirectUrl: 'https://x.example/' });
    expect(ruleMatchesUrl(rule, 'https://twitter.com/jack')).toBe(false);
  });
});

describe('whitelistMatchesUrl', () => {
  it('matches a wildcard pattern', () => {
    const entry = createWhitelistEntry({ pattern: '*://*.github.com/*' });
    expect(whitelistMatchesUrl(entry, 'https://gist.github.com/foo')).toBe(true);
    expect(whitelistMatchesUrl(entry, 'https://gitlab.com/foo')).toBe(false);
  });

  it('a disabled entry never matches', () => {
    const entry = createWhitelistEntry({ pattern: '*://*.github.com/*', disabled: true });
    expect(whitelistMatchesUrl(entry, 'https://gist.github.com/foo')).toBe(false);
  });
});
