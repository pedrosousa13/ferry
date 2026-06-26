import type { Rule, ResourceType } from './rule-model';

export interface DnrRule {
  id: number;
  priority: number;
  action: { type: 'redirect'; redirect: { regexSubstitution: string } } | { type: 'allow' };
  condition: { regexFilter: string; resourceTypes: ResourceType[] };
}

const REGEX_META = '.+?^${}()|[]\\';

export function wildcardToRegex(pattern: string): string {
  let out = '^';
  for (const ch of pattern) {
    if (ch === '*') out += '(.*?)';
    else if (REGEX_META.includes(ch)) out += '\\' + ch;
    else out += ch;
  }
  return out + '$';
}

export function translateSubstitution(redirectUrl: string): string {
  // User writes $1..$9; DNR regexSubstitution uses \1..\9.
  // Escape pre-existing backslashes first so they survive literally.
  return redirectUrl.replace(/\\/g, '\\\\').replace(/\$(\d)/g, '\\$1');
}

function toRegexFilter(rule: Rule, pattern: string): string {
  return rule.patternType === 'wildcard' ? wildcardToRegex(pattern) : pattern;
}

export function compile(rules: Rule[]): DnrRule[] {
  const enabled = rules.filter((r) => !r.disabled);
  const n = enabled.length;
  const out: DnrRule[] = [];
  enabled.forEach((rule, i) => {
    const basePriority = n - i; // earlier rule => higher priority
    out.push({
      id: i * 2 + 1,
      priority: basePriority,
      action: { type: 'redirect', redirect: { regexSubstitution: translateSubstitution(rule.redirectUrl) } },
      condition: { regexFilter: toRegexFilter(rule, rule.includePattern), resourceTypes: rule.resourceTypes },
    });
    if (rule.excludePattern) {
      out.push({
        id: i * 2 + 2,
        priority: basePriority + n, // strictly higher than any redirect priority (max n)
        action: { type: 'allow' },
        condition: { regexFilter: toRegexFilter(rule, rule.excludePattern), resourceTypes: rule.resourceTypes },
      });
    }
  });
  return out;
}
