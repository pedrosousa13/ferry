import { wildcardToRegex } from './compiler';
import type { PatternType, Rule, WhitelistEntry } from './rule-model';

function patternMatches(pattern: string, type: PatternType, url: string): boolean {
  const source = type === 'wildcard' ? wildcardToRegex(pattern) : pattern;
  try {
    return new RegExp(source).test(url);
  } catch {
    return false;
  }
}

// Mirrors how the compiled DNR rule treats a top-level navigation to `url`:
// the include pattern must match and the exclude pattern (if any) must not.
// Only rules that target main_frame can redirect the tab itself.
export function ruleMatchesUrl(rule: Rule, url: string): boolean {
  if (rule.disabled) return false;
  if (!rule.resourceTypes.includes('main_frame')) return false;
  if (!rule.includePattern || !patternMatches(rule.includePattern, rule.patternType, url)) return false;
  if (rule.excludePattern && patternMatches(rule.excludePattern, rule.patternType, url)) return false;
  return true;
}

export function whitelistMatchesUrl(entry: WhitelistEntry, url: string): boolean {
  if (entry.disabled || !entry.pattern) return false;
  return patternMatches(entry.pattern, 'wildcard', url);
}
