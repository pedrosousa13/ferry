export type PatternType = 'wildcard' | 'regex';

export type ResourceType =
  | 'main_frame' | 'sub_frame' | 'stylesheet' | 'script' | 'image'
  | 'font' | 'object' | 'xmlhttprequest' | 'ping' | 'media'
  | 'websocket' | 'other';

export const ALL_RESOURCE_TYPES: ResourceType[] = [
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image',
  'font', 'object', 'xmlhttprequest', 'ping', 'media', 'websocket', 'other',
];

export interface Rule {
  id: string;
  description: string;
  patternType: PatternType;
  includePattern: string;
  excludePattern: string;
  redirectUrl: string;
  resourceTypes: ResourceType[];
  disabled: boolean;
  example: string;
}

export function createRule(partial: Partial<Rule>): Rule {
  return {
    id: partial.id ?? (globalThis.crypto?.randomUUID?.() ?? String(Date.now())),
    description: partial.description ?? '',
    patternType: partial.patternType ?? 'wildcard',
    includePattern: partial.includePattern ?? '',
    excludePattern: partial.excludePattern ?? '',
    redirectUrl: partial.redirectUrl ?? '',
    resourceTypes: partial.resourceTypes?.length ? partial.resourceTypes : ['main_frame'],
    disabled: partial.disabled ?? false,
    example: partial.example ?? '',
  };
}

// DNR compiles patterns with RE2, which is stricter than JS RegExp. Reject
// the common JS-only constructs up front so a rule that validates also loads.
export function re2Incompatibility(pattern: string): string | null {
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      const next = pattern[i + 1] ?? '';
      if (!inClass && next >= '1' && next <= '9') {
        return 'Backreferences (\\1–\\9) are not supported by the browser regex engine.';
      }
      i++;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (!inClass && ch === '(' && pattern[i + 1] === '?') {
      const rest = pattern.slice(i + 2);
      if (rest.startsWith('=') || rest.startsWith('!')) {
        return 'Lookaheads are not supported by the browser regex engine.';
      }
      if (rest.startsWith('<=') || rest.startsWith('<!')) {
        return 'Lookbehinds are not supported by the browser regex engine.';
      }
      if (rest.startsWith('<')) {
        return 'Named groups are not supported by the browser regex engine.';
      }
    }
  }
  return null;
}

export function countCaptureGroups(pattern: string, type: PatternType): number {
  if (type === 'wildcard') return [...pattern].filter((c) => c === '*').length;
  let count = 0;
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (!inClass && ch === '(' && pattern[i + 1] !== '?') count++;
  }
  return count;
}

export function maxSubstitutionRef(redirectUrl: string): number {
  let max = 0;
  for (const m of redirectUrl.matchAll(/\$(\d)/g)) max = Math.max(max, Number(m[1]));
  return max;
}

export function validateRule(rule: Rule): string[] {
  const errors: string[] = [];
  if (!rule.includePattern) errors.push('Include pattern is required.');
  if (!rule.redirectUrl) errors.push('Redirect URL is required.');
  if (!rule.resourceTypes.length) errors.push('At least one resource type is required.');
  for (const [label, pattern] of [['include', rule.includePattern], ['exclude', rule.excludePattern]] as const) {
    if (rule.patternType !== 'regex' || !pattern) continue;
    try { new RegExp(pattern); } catch { errors.push(`Invalid regular expression in ${label} pattern.`); continue; }
    const incompat = re2Incompatibility(pattern);
    if (incompat) errors.push(`${label === 'include' ? 'Include' : 'Exclude'} pattern: ${incompat}`);
  }
  if (rule.includePattern && rule.redirectUrl) {
    const refs = maxSubstitutionRef(rule.redirectUrl);
    const groups = countCaptureGroups(rule.includePattern, rule.patternType);
    if (refs > groups) {
      errors.push(`Redirect URL references $${refs} but the include pattern has only ${groups} capture group(s).`);
    }
  }
  return errors;
}
