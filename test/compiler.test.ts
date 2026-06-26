import { describe, it, expect } from 'vitest';
import { compile, wildcardToRegex, translateSubstitution } from '../src/compiler';
import { createRule } from '../src/rule-model';

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
    expect(compile([rule]).every((r) => r.action.type === 'redirect')).toBe(true);
  });
});
