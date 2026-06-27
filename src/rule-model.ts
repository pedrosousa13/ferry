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

export function validateRule(rule: Rule): string[] {
  const errors: string[] = [];
  if (!rule.includePattern) errors.push('Include pattern is required.');
  if (!rule.redirectUrl) errors.push('Redirect URL is required.');
  if (!rule.resourceTypes.length) errors.push('At least one resource type is required.');
  if (rule.patternType === 'regex' && rule.includePattern) {
    try { new RegExp(rule.includePattern); } catch { errors.push('Invalid regular expression in include pattern.'); }
  }
  if (rule.patternType === 'regex' && rule.excludePattern) {
    try { new RegExp(rule.excludePattern); } catch { errors.push('Invalid regular expression in exclude pattern.'); }
  }
  return errors;
}
