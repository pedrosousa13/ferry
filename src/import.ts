import { Rule, createRule, validateRule, ALL_RESOURCE_TYPES, ResourceType, PatternType } from './rule-model';

export interface ImportResult {
  rules: Rule[];
  skippedTransforms: number;
  skippedInvalid: number;
  error?: string;
}

// Accepts Ferry's own export format ({createdBy:'Ferry', redirects:[Rule]})
// and Redirector exports ({redirects:[{patternType:'R'|'W', appliesTo, ...}]}).
// Ids are always regenerated so importing a file twice cannot collide.
export function parseImport(data: unknown): ImportResult {
  const none = { rules: [], skippedTransforms: 0, skippedInvalid: 0 };
  if (data === null || typeof data !== 'object') return { ...none, error: 'Unrecognized file format.' };
  const raw = (data as { redirects?: unknown; rules?: unknown }).redirects
    ?? (data as { rules?: unknown }).rules;
  if (!Array.isArray(raw)) return { ...none, error: 'Unrecognized file format.' };

  const rules: Rule[] = [];
  let skippedTransforms = 0;
  let skippedInvalid = 0;
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') { skippedInvalid++; continue; }
    const r = entry as Record<string, unknown>;
    if (r.processMatches && r.processMatches !== 'noProcessing') { skippedTransforms++; continue; }
    const types = (Array.isArray(r.resourceTypes) ? r.resourceTypes : Array.isArray(r.appliesTo) ? r.appliesTo : []) as string[];
    const patternType: PatternType =
      r.patternType === 'R' || r.patternType === 'regex' ? 'regex' : 'wildcard';
    const rule = createRule({
      description: typeof r.description === 'string' ? r.description : '',
      patternType,
      includePattern: typeof r.includePattern === 'string' ? r.includePattern : '',
      excludePattern: typeof r.excludePattern === 'string' ? r.excludePattern : '',
      redirectUrl: typeof r.redirectUrl === 'string' ? r.redirectUrl : '',
      resourceTypes: types.filter((t) => (ALL_RESOURCE_TYPES as string[]).includes(t)) as ResourceType[],
      disabled: r.disabled === true,
      example: typeof r.exampleUrl === 'string' ? r.exampleUrl : typeof r.example === 'string' ? r.example : '',
    });
    if (validateRule(rule).length) { skippedInvalid++; continue; }
    rules.push(rule);
  }
  return { rules, skippedTransforms, skippedInvalid };
}
