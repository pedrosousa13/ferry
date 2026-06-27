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
  // `$1`..`$9` is the ONLY supported capture-group substitution syntax.
  // Pre-existing backslashes are escaped first so they survive as literals,
  // then `$n` is translated to DNR's `\n` form. A literal `\1` written by the
  // user is therefore treated as text, not a backreference.
  return redirectUrl.replace(/\\/g, '\\\\').replace(/\$(\d)/g, '\\$1');
}

function toRegexFilter(rule: Rule, pattern: string): string {
  return rule.patternType === 'wildcard' ? wildcardToRegex(pattern) : pattern;
}

function countCaptureGroups(rule: Rule): number {
  if (rule.patternType === 'wildcard') return (rule.includePattern.match(/\*/g) ?? []).length;
  let count = 0;
  for (let i = 0; i < rule.includePattern.length; i++) {
    const ch = rule.includePattern[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '(' && rule.includePattern[i + 1] !== '?') count++;
  }
  return count;
}

function maxGroupRef(redirectUrl: string): number {
  let max = 0;
  const re = /\$(\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(redirectUrl)) !== null) max = Math.max(max, Number(m[1]));
  return max;
}

/**
 * Non-blocking lint warnings: rules that compile to valid DNR but are likely
 * broken. Empty / structurally invalid rules are left to `validateRule`.
 */
export function lintRule(rule: Rule): string[] {
  const warnings: string[] = [];
  if (!rule.includePattern || !rule.redirectUrl) return warnings;

  const groups = countCaptureGroups(rule);
  const ref = maxGroupRef(rule.redirectUrl);
  if (ref > groups) {
    warnings.push(
      `Redirect uses $${ref} but the match pattern has ${groups === 0 ? 'no capture groups' : `only ${groups} capture group${groups === 1 ? '' : 's'}`} — $${ref} will be replaced with nothing.`,
    );
  }

  try {
    const filter = toRegexFilter(rule, rule.includePattern);
    const probe = rule.redirectUrl.replace(/\$\d/g, 'x');
    if (new RegExp(filter).test(probe)) {
      warnings.push('The redirect target matches this rule’s own pattern, which can cause a redirect loop.');
    }
  } catch {
    /* invalid regex is reported by validateRule */
  }

  return warnings;
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
