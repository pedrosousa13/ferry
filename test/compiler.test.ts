import { describe, it, expect } from 'vitest';
import { compile, wildcardToRegex, translateSubstitution, lintRule } from '../src/compiler';
import { createRule, createWhitelistEntry, ALL_RESOURCE_TYPES } from '../src/rule-model';

describe('wildcardToRegex', () => {
  it('escapes metachars and turns * into a capture group, anchored', () => {
    expect(wildcardToRegex('https://twitter.com/*')).toBe('^https://twitter\\.com/(.*?)$');
  });
});

describe('translateSubstitution', () => {
  it('turns $1 into \\1', () => {
    expect(translateSubstitution('https://nitter.net/$1')).toBe('https://nitter.net/\\1');
  });
});

describe('compile', () => {
  it('compiles a single wildcard redirect rule', () => {
    const rule = createRule({
      id: 'a',
      patternType: 'wildcard',
      includePattern: 'https://twitter.com/*',
      redirectUrl: 'https://nitter.net/$1',
      resourceTypes: ['main_frame'],
    });
    expect(compile([rule])).toEqual([
      {
        id: 1,
        priority: 1,
        action: { type: 'redirect', redirect: { regexSubstitution: 'https://nitter.net/\\1' } },
        condition: { regexFilter: '^https://twitter\\.com/(.*?)$', resourceTypes: ['main_frame'] },
      },
    ]);
  });

  it('passes a regex pattern through unchanged', () => {
    const rule = createRule({
      id: 'a',
      patternType: 'regex',
      includePattern: '^https://www\\.reddit\\.com(/.*)?$',
      redirectUrl: 'https://old.reddit.com$1',
      resourceTypes: ['main_frame'],
    });
    expect(compile([rule])[0].condition.regexFilter).toBe('^https://www\\.reddit\\.com(/.*)?$');
    expect((compile([rule])[0].action as any).redirect.regexSubstitution).toBe('https://old.reddit.com\\1');
  });

  it('orders priority by list position (earlier = higher) and assigns odd ids', () => {
    const a = createRule({ id: 'a', includePattern: 'a/*', redirectUrl: 'A/$1' });
    const b = createRule({ id: 'b', includePattern: 'b/*', redirectUrl: 'B/$1' });
    const out = compile([a, b]);
    expect(out.map((r) => [r.id, r.priority])).toEqual([[1, 2], [3, 1]]);
  });

  it('skips disabled rules and reindexes', () => {
    const a = createRule({ id: 'a', includePattern: 'a/*', redirectUrl: 'A/$1', disabled: true });
    const b = createRule({ id: 'b', includePattern: 'b/*', redirectUrl: 'B/$1' });
    const out = compile([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].condition.regexFilter).toBe('^b/(.*?)$');
    expect(out[0].priority).toBe(1);
  });
});

describe('compile with exclude', () => {
  it('emits a higher-priority allow rule for the exclude pattern', () => {
    const rule = createRule({
      id: 'a',
      patternType: 'wildcard',
      includePattern: 'https://example.com/*',
      excludePattern: 'https://example.com/keep/*',
      redirectUrl: 'https://dest.com/$1',
      resourceTypes: ['main_frame'],
    });
    expect(compile([rule])).toEqual([
      {
        id: 1,
        priority: 1,
        action: { type: 'redirect', redirect: { regexSubstitution: 'https://dest.com/\\1' } },
        condition: { regexFilter: '^https://example\\.com/(.*?)$', resourceTypes: ['main_frame'] },
      },
      {
        id: 2,
        priority: 2,
        action: { type: 'allow' },
        condition: { regexFilter: '^https://example\\.com/keep/(.*?)$', resourceTypes: ['main_frame'] },
      },
    ]);
  });

  it('does not emit an allow rule when excludePattern is empty', () => {
    const rule = createRule({ id: 'a', includePattern: 'a/*', redirectUrl: 'A/$1' });
    const out = compile([rule]);
    expect(out).toHaveLength(1);
    expect(out[0].action.type).toBe('redirect');
  });
});

describe('lintRule', () => {
  it('returns no warnings for a sound rule', () => {
    const rule = createRule({
      patternType: 'wildcard',
      includePattern: 'https://twitter.com/*',
      redirectUrl: 'https://nitter.net/$1',
    });
    expect(lintRule(rule)).toEqual([]);
  });

  it('warns when the redirect references more groups than the wildcard pattern has', () => {
    const rule = createRule({
      patternType: 'wildcard',
      includePattern: 'https://twitter.com/*',
      redirectUrl: 'https://nitter.net/$2',
    });
    expect(lintRule(rule).some((w) => w.includes('$2'))).toBe(true);
  });

  it('warns when a wildcard redirect uses $1 but the pattern has no wildcard', () => {
    const rule = createRule({
      patternType: 'wildcard',
      includePattern: 'https://twitter.com/home',
      redirectUrl: 'https://nitter.net/$1',
    });
    expect(lintRule(rule).some((w) => w.includes('no capture groups'))).toBe(true);
  });

  it('counts regex capturing groups, ignoring non-capturing groups', () => {
    const ok = createRule({
      patternType: 'regex',
      includePattern: '^https://(?:www\\.)?example\\.com/(.*)$',
      redirectUrl: 'https://dest.com/$1',
    });
    expect(lintRule(ok)).toEqual([]);
    const bad = createRule({
      patternType: 'regex',
      includePattern: '^https://(?:www\\.)?example\\.com/(.*)$',
      redirectUrl: 'https://dest.com/$2',
    });
    expect(lintRule(bad).some((w) => w.includes('only 1 capture group'))).toBe(true);
  });

  it('warns about a redirect loop when the target matches the rule’s own pattern', () => {
    const rule = createRule({
      patternType: 'wildcard',
      includePattern: 'https://reddit.com/*',
      redirectUrl: 'https://reddit.com/old/$1',
    });
    expect(lintRule(rule).some((w) => w.toLowerCase().includes('loop'))).toBe(true);
  });

  it('does not warn about a loop when the redirect host differs', () => {
    const rule = createRule({
      patternType: 'wildcard',
      includePattern: 'https://www.reddit.com/*',
      redirectUrl: 'https://old.reddit.com/$1',
    });
    expect(lintRule(rule)).toEqual([]);
  });
});

describe("compile with whitelist", () => {
  it("emits an allow rule per enabled entry, above all redirects", () => {
    const r = createRule({ id: "a", includePattern: "https://example.com/*", redirectUrl: "https://dest.com/$1" });
    const w = createWhitelistEntry({ id: "w", pattern: "https://example.com/safe/*" });
    expect(compile([r], [w])).toEqual([
      {
        id: 1,
        priority: 1,
        action: { type: "redirect", redirect: { regexSubstitution: "https://dest.com/\\1" } },
        condition: { regexFilter: "^https://example\\.com/(.*?)$", resourceTypes: ["main_frame"] },
      },
      {
        id: 3,
        priority: 3,
        action: { type: "allow" },
        condition: { regexFilter: "^https://example\\.com/safe/(.*?)$", resourceTypes: ALL_RESOURCE_TYPES },
      },
    ]);
  });

  it("works with no rules (priority 1, ids from 1)", () => {
    const w = createWhitelistEntry({ id: "w", pattern: "https://a.com/*" });
    expect(compile([], [w])).toEqual([
      {
        id: 1,
        priority: 1,
        action: { type: "allow" },
        condition: { regexFilter: "^https://a\\.com/(.*?)$", resourceTypes: ALL_RESOURCE_TYPES },
      },
    ]);
  });

  it("assigns unique ids to multiple entries at the same priority", () => {
    const a = createWhitelistEntry({ id: "a", pattern: "https://a.com/*" });
    const b = createWhitelistEntry({ id: "b", pattern: "https://b.com/*" });
    expect(compile([], [a, b]).map((r) => [r.id, r.priority])).toEqual([[1, 1], [2, 1]]);
  });

  it("skips disabled whitelist entries", () => {
    const w = createWhitelistEntry({ id: "w", pattern: "https://a.com/*", disabled: true });
    expect(compile([], [w])).toEqual([]);
  });

  it("defaults whitelist to empty (back-compat call)", () => {
    const r = createRule({ id: "a", includePattern: "a/*", redirectUrl: "A/$1" });
    expect(compile([r])).toHaveLength(1);
  });
});
