# Ferry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fast, private URL redirector for Chrome and Firefox using Manifest V3 and pure `declarativeNetRequest` (DNR).

**Architecture:** Four small units — `rule-model` (user rule shape + validation), `compiler` (pure `Rule[] → DNR JSON[]`), `engine` (background context that pushes compiled rules into DNR on change), and `ui` (options page + popup). The redirect path is 100% native: no JavaScript runs per request. All logic that matters is in the two pure modules, which carry the test suite.

**Tech Stack:** TypeScript, esbuild (bundling), Vitest (tests), `webextension-polyfill` (cross-browser `browser.*`). Build emits `dist/chrome/` and `dist/firefox/`.

## Global Constraints

- Manifest V3 only, both targets.
- Pure DNR. **No** capture-group transforms (base64/url-decode), **no** SPA history-state redirects. Not offered in UI.
- No network calls, no telemetry, no remote server. Local storage only (`chrome.storage.local`). Sync OFF, not offered in v1.
- Permissions: exactly `declarativeNetRequest`, `storage`, and host permission `*://*/*`. Nothing else in release builds.
- New rules default to `resourceTypes: ['main_frame']`.
- No redirect-loop counter — rely on the browser's native redirect cap.
- Name is "Ferry". No attribution/co-author lines in commits.

## File Structure

```
ferry/
  package.json              # scripts + deps
  tsconfig.json             # TS config
  vitest.config.ts          # test config
  scripts/build.mjs         # esbuild + per-browser manifest generation
  src/
    rule-model.ts           # Rule type, createRule, validateRule, ALL_RESOURCE_TYPES
    compiler.ts             # compile(): Rule[] -> DnrRule[]  (pure)
    storage.ts              # getRules/setRules/getDisabled/setDisabled (UI side)
    engine.ts               # background: storage.onChanged -> compile -> updateDynamicRules
    options.html / options.ts   # options page UI
    popup.html  / popup.ts       # popup UI
  test/
    rule-model.test.ts
    compiler.test.ts
    engine.test.ts
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `src/` and `test/` directories (implicitly, via files in later tasks)

**Interfaces:**
- Consumes: nothing.
- Produces: working `npm install`, `npm test` (passes with no tests), `npm run build` (placeholder until Task 6).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ferry",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "build": "node scripts/build.mjs"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.268",
    "esbuild": "^0.21.5",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  },
  "dependencies": {
    "webextension-polyfill": "^0.12.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2020", "DOM"],
    "strict": true,
    "noUnusedLocals": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["chrome"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Install and verify**

Run: `npm install && npm test`
Expected: install succeeds; vitest prints "No test files found" and exits 0 (due to `--passWithNoTests`).

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts package-lock.json
git commit -m "chore: project scaffold (ts, esbuild, vitest)"
```

---

### Task 2: Rule model

**Files:**
- Create: `src/rule-model.ts`
- Test: `test/rule-model.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type PatternType = 'wildcard' | 'regex'`
  - `type ResourceType = 'main_frame' | 'sub_frame' | 'stylesheet' | 'script' | 'image' | 'font' | 'object' | 'xmlhttprequest' | 'ping' | 'media' | 'websocket' | 'other'`
  - `interface Rule { id: string; description: string; patternType: PatternType; includePattern: string; excludePattern: string; redirectUrl: string; resourceTypes: ResourceType[]; disabled: boolean; example: string }`
  - `const ALL_RESOURCE_TYPES: ResourceType[]`
  - `function createRule(partial: Partial<Rule>): Rule`
  - `function validateRule(rule: Rule): string[]`

- [ ] **Step 1: Write the failing test**

```ts
// test/rule-model.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/rule-model.test.ts`
Expected: FAIL — cannot import from `../src/rule-model` (module not found).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/rule-model.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/rule-model.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/rule-model.ts test/rule-model.test.ts
git commit -m "feat: rule model with validation and defaults"
```

---

### Task 3: Compiler core

**Files:**
- Create: `src/compiler.ts`
- Test: `test/compiler.test.ts`

**Interfaces:**
- Consumes: `Rule`, `ResourceType` from `src/rule-model.ts`.
- Produces:
  - `interface DnrRule { id: number; priority: number; action: { type: 'redirect'; redirect: { regexSubstitution: string } } | { type: 'allow' }; condition: { regexFilter: string; resourceTypes: ResourceType[] } }`
  - `function wildcardToRegex(pattern: string): string`
  - `function translateSubstitution(redirectUrl: string): string`
  - `function compile(rules: Rule[]): DnrRule[]`

This task covers wildcard→regex, regex passthrough, `$n` substitution, resourceTypes, priority by list order, and skipping disabled rules. Exclude patterns are Task 4.

> **Note on DNR regex:** `condition.regexFilter` uses RE2 syntax, not full JS regex (no backreferences/lookaround in the *pattern*). v1 validates patterns with JS `RegExp` in `rule-model` (catches the common mistakes); the RE2 gap is a documented known edge, not handled in code.

- [ ] **Step 1: Write the failing test**

```ts
// test/compiler.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/compiler.test.ts`
Expected: FAIL — cannot import from `../src/compiler`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/compiler.ts
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
  });
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/compiler.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/compiler.ts test/compiler.test.ts
git commit -m "feat: DNR compiler core (wildcard, regex, substitution, priority)"
```

---

### Task 4: Compiler exclude patterns

**Files:**
- Modify: `src/compiler.ts` (extend `compile`)
- Test: `test/compiler.test.ts` (add cases)

**Interfaces:**
- Consumes: same as Task 3.
- Produces: `compile` additionally emits, for any rule with a non-empty `excludePattern`, an `allow` rule whose `regexFilter` is the compiled exclude pattern, at a priority higher than every redirect rule, with even id `i*2+2`. The redirect rule is pushed first, then the allow rule.

> **Precedence assumption:** in DNR, when rules match the same request, the highest-priority rule wins; `allow` outranks `redirect` at equal priority and we additionally give the allow rule a strictly higher priority. **Known limitation:** an allow rule's `regexFilter` is global, so an exclude pattern can also suppress redirects from *other* rules whose include overlaps it. Documented in the spec risks; acceptable for v1. Verify the precedence empirically during manual load-test (Task 9).

- [ ] **Step 1: Write the failing test (add to `test/compiler.test.ts`)**

```ts
import { ALL_RESOURCE_TYPES } from '../src/rule-model'; // add to existing imports if not present

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/compiler.test.ts`
Expected: FAIL — the exclude test gets only the redirect rule, no allow rule.

- [ ] **Step 3: Extend `compile` in `src/compiler.ts`**

Replace the body of the `enabled.forEach(...)` loop with:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/compiler.test.ts`
Expected: PASS (all compiler tests).

- [ ] **Step 5: Commit**

```bash
git add src/compiler.ts test/compiler.test.ts
git commit -m "feat: exclude patterns via higher-priority allow rules"
```

---

### Task 5: Background engine

**Files:**
- Create: `src/engine.ts`
- Test: `test/engine.test.ts`

**Interfaces:**
- Consumes: `compile` from `src/compiler.ts`; `Rule` from `src/rule-model.ts`; `browser` from `webextension-polyfill`.
- Produces: `async function syncRules(): Promise<void>` — reads `{ rules, disabled }` from `browser.storage.local`, computes desired DNR rules (`[]` if disabled), and replaces the entire dynamic rule set via `declarativeNetRequest.updateDynamicRules`. Registers listeners on `runtime.onInstalled`, `runtime.onStartup`, and `storage.onChanged` (local area, `rules` or `disabled` changed).

- [ ] **Step 1: Write the failing test**

```ts
// test/engine.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { rules: [] as any[], disabled: false };
const updateDynamicRules = vi.fn(async () => {});
const getDynamicRules = vi.fn(async () => [{ id: 99 }]);

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      local: { get: vi.fn(async (defaults: any) => ({ ...defaults, ...state })) },
      onChanged: { addListener: vi.fn() },
    },
    declarativeNetRequest: { getDynamicRules, updateDynamicRules },
    runtime: { onInstalled: { addListener: vi.fn() }, onStartup: { addListener: vi.fn() } },
  },
}));

import { syncRules } from '../src/engine';
import { createRule } from '../src/rule-model';

beforeEach(() => {
  updateDynamicRules.mockClear();
  state.disabled = false;
  state.rules = [];
});

describe('syncRules', () => {
  it('removes existing rules and adds compiled rules', async () => {
    state.rules = [createRule({ id: 'a', includePattern: 'https://x/*', redirectUrl: 'https://y/$1' })];
    await syncRules();
    expect(updateDynamicRules).toHaveBeenCalledTimes(1);
    const arg = updateDynamicRules.mock.calls[0][0] as any;
    expect(arg.removeRuleIds).toEqual([99]);
    expect(arg.addRules).toHaveLength(1);
    expect(arg.addRules[0].action.type).toBe('redirect');
  });

  it('clears all rules when disabled', async () => {
    state.disabled = true;
    state.rules = [createRule({ id: 'a', includePattern: 'https://x/*', redirectUrl: 'https://y/$1' })];
    await syncRules();
    const arg = updateDynamicRules.mock.calls[0][0] as any;
    expect(arg.removeRuleIds).toEqual([99]);
    expect(arg.addRules).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/engine.test.ts`
Expected: FAIL — cannot import from `../src/engine`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/engine.ts
import browser from 'webextension-polyfill';
import { compile } from './compiler';
import type { Rule } from './rule-model';

// webextension-polyfill's types don't fully cover declarativeNetRequest; cast narrowly.
const dnr = (browser as any).declarativeNetRequest;

export async function syncRules(): Promise<void> {
  const data = await browser.storage.local.get({ rules: [], disabled: false });
  const rules = data.rules as Rule[];
  const disabled = data.disabled as boolean;
  const desired = disabled ? [] : compile(rules);
  const existing = await dnr.getDynamicRules();
  await dnr.updateDynamicRules({
    removeRuleIds: existing.map((r: { id: number }) => r.id),
    addRules: desired,
  });
}

browser.runtime.onInstalled.addListener(() => { void syncRules(); });
browser.runtime.onStartup.addListener(() => { void syncRules(); });
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.rules || changes.disabled)) void syncRules();
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/engine.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the whole suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass; `tsc` reports no errors.

- [ ] **Step 6: Commit**

```bash
git add src/engine.ts test/engine.test.ts
git commit -m "feat: background engine syncs compiled rules into DNR"
```

---

### Task 6: Build pipeline + manifests

**Files:**
- Create: `scripts/build.mjs`
- Create: `src/storage.ts` (needed by the UI entry points the build bundles next)
- Create: `src/options.html`, `src/options.ts`, `src/popup.html`, `src/popup.ts` as **minimal stubs** so the build has entry points (full UI in Tasks 7–8).

**Interfaces:**
- Consumes: all `src/*.ts`.
- Produces:
  - `src/storage.ts` exports `getRules(): Promise<Rule[]>`, `setRules(rules: Rule[]): Promise<void>`, `getDisabled(): Promise<boolean>`, `setDisabled(disabled: boolean): Promise<void>`.
  - `npm run build` → `dist/chrome/` and `dist/firefox/`, each containing `manifest.json`, `engine.js`, `options.js`, `options.html`, `popup.js`, `popup.html`.

- [ ] **Step 1: Create `src/storage.ts`**

```ts
import browser from 'webextension-polyfill';
import type { Rule } from './rule-model';

export async function getRules(): Promise<Rule[]> {
  const { rules } = await browser.storage.local.get({ rules: [] });
  return rules as Rule[];
}
export async function setRules(rules: Rule[]): Promise<void> {
  await browser.storage.local.set({ rules });
}
export async function getDisabled(): Promise<boolean> {
  const { disabled } = await browser.storage.local.get({ disabled: false });
  return disabled as boolean;
}
export async function setDisabled(disabled: boolean): Promise<void> {
  await browser.storage.local.set({ disabled });
}
```

- [ ] **Step 2: Create minimal UI stubs**

```html
<!-- src/options.html -->
<!doctype html>
<html><head><meta charset="utf-8"><title>Ferry Options</title></head>
<body><div id="app">Ferry options</div><script src="options.js"></script></body></html>
```

```ts
// src/options.ts
console.log('Ferry options loaded');
```

```html
<!-- src/popup.html -->
<!doctype html>
<html><head><meta charset="utf-8"><title>Ferry</title></head>
<body><div id="app">Ferry</div><script src="popup.js"></script></body></html>
```

```ts
// src/popup.ts
console.log('Ferry popup loaded');
```

- [ ] **Step 3: Create `scripts/build.mjs`**

```js
import { build } from 'esbuild';
import { mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const VERSION = '0.1.0';
const NAME = 'Ferry';
const DESCRIPTION = 'Fast, private URL redirector. Define rules; matching URLs are redirected natively.';

function manifest(target) {
  const base = {
    manifest_version: 3,
    name: NAME,
    version: VERSION,
    description: DESCRIPTION,
    permissions: ['declarativeNetRequest', 'storage'],
    host_permissions: ['*://*/*'],
    action: { default_popup: 'popup.html', default_title: NAME },
    options_ui: { page: 'options.html', open_in_tab: true },
  };
  if (target === 'chrome') {
    return { ...base, background: { service_worker: 'engine.js' } };
  }
  return {
    ...base,
    background: { scripts: ['engine.js'] },
    browser_specific_settings: { gecko: { id: 'ferry@ferry.app', strict_min_version: '128.0' } },
  };
}

for (const target of ['chrome', 'firefox']) {
  const outdir = join('dist', target);
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });
  await build({
    entryPoints: ['src/engine.ts', 'src/options.ts', 'src/popup.ts'],
    bundle: true,
    format: 'iife',
    target: ['chrome110', 'firefox128'],
    outdir,
    logLevel: 'info',
  });
  writeFileSync(join(outdir, 'manifest.json'), JSON.stringify(manifest(target), null, 2));
  copyFileSync('src/options.html', join(outdir, 'options.html'));
  copyFileSync('src/popup.html', join(outdir, 'popup.html'));
}
console.log('Built dist/chrome and dist/firefox');
```

- [ ] **Step 4: Build and verify output**

Run: `npm run build && ls dist/chrome dist/firefox`
Expected: both directories contain `manifest.json`, `engine.js`, `options.js`, `options.html`, `popup.js`, `popup.html`.

- [ ] **Step 5: Verify manifests differ correctly**

Run: `node -e "const c=require('./dist/chrome/manifest.json'),f=require('./dist/firefox/manifest.json'); console.log(!!c.background.service_worker, Array.isArray(f.background.scripts), !!f.browser_specific_settings)"`
Expected: `true true true`

- [ ] **Step 6: Commit**

```bash
git add scripts/build.mjs src/storage.ts src/options.html src/options.ts src/popup.html src/popup.ts
git commit -m "feat: esbuild build pipeline with per-browser manifests"
```

---

### Task 7: Options page UI

**Files:**
- Modify: `src/options.html` (full markup), `src/options.ts` (full logic)

**Interfaces:**
- Consumes: `createRule`, `validateRule`, `Rule`, `ALL_RESOURCE_TYPES` from `rule-model`; `getRules`, `setRules` from `storage`; `compile` from `compiler`.
- Produces: a working options page — list rules (reorder, enable/disable, edit, delete), add/edit form with live test field, import/export JSON.

This is DOM glue, not red-green TDD; the steps are write → build → load → verify behavior in a browser.

- [ ] **Step 1: Replace `src/options.html`**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Ferry Options</title>
  <style>
    body { font: 14px system-ui, sans-serif; max-width: 820px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.3rem; }
    .rule { display: flex; gap: .5rem; align-items: center; padding: .4rem 0; border-bottom: 1px solid #eee; }
    .rule.disabled { opacity: .5; }
    .rule .desc { font-weight: 600; min-width: 8rem; }
    .rule code { flex: 1; color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    button { cursor: pointer; }
    fieldset { margin: 1rem 0; }
    label { display: block; margin: .35rem 0; }
    input[type=text] { width: 100%; box-sizing: border-box; }
    .rtypes label { display: inline-block; margin-right: .8rem; }
    .msg { color: #060; } .err { color: #b00; }
  </style>
</head>
<body>
  <h1>Ferry — redirect rules</h1>
  <div id="rules"></div>

  <fieldset id="form">
    <legend>Add / edit rule</legend>
    <input type="hidden" id="rule-id">
    <label>Description <input type="text" id="f-desc"></label>
    <label>Pattern type
      <select id="f-type"><option value="wildcard">Wildcard</option><option value="regex">Regex</option></select>
    </label>
    <label>Include pattern <input type="text" id="f-include" placeholder="https://twitter.com/*"></label>
    <label>Exclude pattern (optional) <input type="text" id="f-exclude"></label>
    <label>Redirect to <input type="text" id="f-redirect" placeholder="https://nitter.net/$1"></label>
    <div class="rtypes" id="rtypes"></div>
    <label>Example URL (for testing) <input type="text" id="f-example"></label>
    <div id="test-result"></div>
    <div id="form-errors" class="err"></div>
    <button id="save">Save rule</button>
    <button id="test">Test</button>
    <button id="reset">Clear form</button>
  </fieldset>

  <fieldset>
    <legend>Backup</legend>
    <button id="export">Export JSON</button>
    <label>Import JSON <input type="file" id="import" accept="application/json"></label>
    <div id="import-msg" class="msg"></div>
  </fieldset>

  <script src="options.js"></script>
</body>
</html>
```

- [ ] **Step 2: Replace `src/options.ts`**

```ts
import { Rule, createRule, validateRule, ALL_RESOURCE_TYPES, ResourceType } from './rule-model';
import { getRules, setRules } from './storage';
import { compile } from './compiler';

let rules: Rule[] = [];
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const $i = (sel: string) => document.querySelector(sel) as HTMLInputElement;

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function renderResourceTypes() {
  const box = $('#rtypes');
  box.innerHTML = '';
  for (const t of ALL_RESOURCE_TYPES) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.name = 'rtype';
    cb.value = t;
    cb.checked = t === 'main_frame';
    label.append(cb, document.createTextNode(' ' + t));
    box.appendChild(label);
  }
}

function render() {
  const list = $('#rules');
  list.innerHTML = '';
  rules.forEach((rule, i) => {
    const row = document.createElement('div');
    row.className = 'rule' + (rule.disabled ? ' disabled' : '');
    const desc = document.createElement('span');
    desc.className = 'desc';
    desc.textContent = rule.description || '(unnamed)';
    const code = document.createElement('code');
    code.textContent = `${rule.includePattern} → ${rule.redirectUrl}`;
    row.append(
      desc, code,
      button('↑', () => move(i, -1)),
      button('↓', () => move(i, 1)),
      button(rule.disabled ? 'Enable' : 'Disable', () => toggle(i)),
      button('Edit', () => edit(i)),
      button('Delete', () => del(i)),
    );
    list.appendChild(row);
  });
}

async function persist() { await setRules(rules); render(); }
function move(i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= rules.length) return;
  [rules[i], rules[j]] = [rules[j], rules[i]];
  void persist();
}
function toggle(i: number) { rules[i] = { ...rules[i], disabled: !rules[i].disabled }; void persist(); }
function del(i: number) { rules.splice(i, 1); void persist(); }

function checkedResourceTypes(): ResourceType[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[name="rtype"]:checked'))
    .map((el) => el.value as ResourceType);
}

function readForm(): Rule {
  return createRule({
    id: $i('#rule-id').value || undefined,
    description: $i('#f-desc').value,
    patternType: ($i('#f-type') as unknown as HTMLSelectElement).value as Rule['patternType'],
    includePattern: $i('#f-include').value,
    excludePattern: $i('#f-exclude').value,
    redirectUrl: $i('#f-redirect').value,
    resourceTypes: checkedResourceTypes(),
    example: $i('#f-example').value,
  });
}

function fillForm(rule: Rule) {
  $i('#rule-id').value = rule.id;
  $i('#f-desc').value = rule.description;
  ($i('#f-type') as unknown as HTMLSelectElement).value = rule.patternType;
  $i('#f-include').value = rule.includePattern;
  $i('#f-exclude').value = rule.excludePattern;
  $i('#f-redirect').value = rule.redirectUrl;
  $i('#f-example').value = rule.example;
  document.querySelectorAll<HTMLInputElement>('input[name="rtype"]').forEach((el) => {
    el.checked = rule.resourceTypes.includes(el.value as ResourceType);
  });
}

function edit(i: number) { fillForm(rules[i]); $('#form').scrollIntoView(); }

function resetForm() {
  $i('#rule-id').value = '';
  ['#f-desc', '#f-include', '#f-exclude', '#f-redirect', '#f-example'].forEach((s) => ($i(s).value = ''));
  ($i('#f-type') as unknown as HTMLSelectElement).value = 'wildcard';
  document.querySelectorAll<HTMLInputElement>('input[name="rtype"]').forEach((el) => (el.checked = el.value === 'main_frame'));
  $('#test-result').textContent = '';
  $('#form-errors').textContent = '';
}

function save() {
  const rule = readForm();
  const errors = validateRule(rule);
  if (errors.length) { $('#form-errors').textContent = errors.join(' '); return; }
  $('#form-errors').textContent = '';
  const idx = rules.findIndex((r) => r.id === rule.id);
  if (idx >= 0) rules[idx] = rule; else rules.push(rule);
  void persist();
  resetForm();
}

function test() {
  const rule = readForm();
  const errors = validateRule(rule);
  if (errors.length) { $('#test-result').textContent = errors.join(' '); return; }
  const example = $i('#f-example').value;
  if (!example) { $('#test-result').textContent = 'Enter an example URL to test.'; return; }
  const dnr = compile([rule]).find((r) => r.action.type === 'redirect');
  if (!dnr) { $('#test-result').textContent = 'No redirect produced.'; return; }
  try {
    const m = example.match(new RegExp(dnr.condition.regexFilter));
    if (!m) { $('#test-result').textContent = 'No match for the example URL.'; return; }
    const sub = (dnr.action as { redirect: { regexSubstitution: string } }).redirect.regexSubstitution;
    const result = sub.replace(/\\(\d)/g, (_, d: string) => m[Number(d)] ?? '');
    $('#test-result').textContent = '→ ' + result;
  } catch {
    $('#test-result').textContent = 'Invalid pattern.';
  }
}

function exportRules() {
  const blob = new Blob([JSON.stringify({ createdBy: 'Ferry', redirects: rules }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ferry-rules.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importRules(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  let data: any;
  try { data = JSON.parse(await file.text()); } catch { $('#import-msg').textContent = 'Invalid JSON.'; return; }
  const incoming: any[] = data.redirects ?? data.rules ?? [];
  let dropped = 0;
  for (const r of incoming) {
    const usesTransform = r.processMatches && r.processMatches !== 'noProcessing';
    const types = (r.resourceTypes ?? r.appliesTo ?? []) as string[];
    const usesHistory = types.includes('history');
    if (usesTransform || usesHistory) dropped++;
    rules.push(createRule({
      description: r.description,
      patternType: r.patternType === 'R' ? 'regex' : 'wildcard',
      includePattern: r.includePattern,
      excludePattern: r.excludePattern,
      redirectUrl: r.redirectUrl,
      resourceTypes: types.filter((t) => (ALL_RESOURCE_TYPES as string[]).includes(t)) as ResourceType[],
      example: r.exampleUrl ?? r.example,
    }));
  }
  await persist();
  $('#import-msg').textContent =
    `Imported ${incoming.length} rule(s).` +
    (dropped ? ` ${dropped} used unsupported features (transforms / history) — those were dropped.` : '');
}

function init() {
  renderResourceTypes();
  $('#save').addEventListener('click', save);
  $('#test').addEventListener('click', test);
  $('#reset').addEventListener('click', resetForm);
  $('#export').addEventListener('click', exportRules);
  $i('#import').addEventListener('change', importRules);
  void getRules().then((r) => { rules = r; render(); });
}

init();
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: builds with no errors.

- [ ] **Step 4: Load in Chrome and verify**

1. `chrome://extensions` → enable Developer mode → Load unpacked → select `dist/chrome`.
2. Open the extension's options page.
3. Add a rule: Include `https://twitter.com/*`, Redirect `https://nitter.net/$1`, type Wildcard, main_frame checked. Set Example `https://twitter.com/jack` → click Test → expect `→ https://nitter.net/jack`.
4. Save. Visit `https://twitter.com/jack` in a new tab → expect redirect to `https://nitter.net/jack`.
5. Export → confirm a JSON file downloads. Re-import it → confirm rule count message.

Expected: all behaviors as described.

- [ ] **Step 5: Commit**

```bash
git add src/options.html src/options.ts
git commit -m "feat: options page (rule CRUD, test field, import/export)"
```

---

### Task 8: Popup UI

**Files:**
- Modify: `src/popup.html` (full markup), `src/popup.ts` (full logic)

**Interfaces:**
- Consumes: `getRules`, `getDisabled`, `setDisabled` from `storage`; `browser` from `webextension-polyfill`.
- Produces: a popup with a master on/off toggle and an active-rule count, plus a link to open the options page.

- [ ] **Step 1: Replace `src/popup.html`**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Ferry</title>
  <style>
    body { font: 14px system-ui, sans-serif; width: 240px; padding: .8rem; }
    h1 { font-size: 1rem; margin: 0 0 .6rem; }
    .row { display: flex; align-items: center; gap: .5rem; margin: .5rem 0; }
    #status { color: #555; }
  </style>
</head>
<body>
  <h1>Ferry</h1>
  <div class="row">
    <label><input type="checkbox" id="toggle"> Enabled</label>
  </div>
  <div id="status"></div>
  <div class="row"><button id="open-options">Manage rules</button></div>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Replace `src/popup.ts`**

```ts
import browser from 'webextension-polyfill';
import { getRules, getDisabled, setDisabled } from './storage';

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const toggle = () => document.querySelector('#toggle') as HTMLInputElement;

async function render() {
  const [rules, disabled] = await Promise.all([getRules(), getDisabled()]);
  const active = rules.filter((r) => !r.disabled).length;
  toggle().checked = !disabled;
  $('#status').textContent = disabled
    ? 'Ferry is off'
    : `Ferry is on — ${active} active rule${active === 1 ? '' : 's'}`;
}

toggle().addEventListener('change', async () => {
  await setDisabled(!toggle().checked);
  await render();
});
$('#open-options').addEventListener('click', () => { void browser.runtime.openOptionsPage(); });

void render();
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Then reload the unpacked extension in `chrome://extensions` and click the toolbar icon.
Expected: popup shows "Ferry is on — N active rules"; unchecking Enabled flips it to "Ferry is off" and stops redirects (verify a previously-redirecting URL now loads normally); re-checking restores them. "Manage rules" opens the options page.

- [ ] **Step 4: Commit**

```bash
git add src/popup.html src/popup.ts
git commit -m "feat: popup with master on/off and active rule count"
```

---

### Task 9: Cross-browser verification + docs

**Files:**
- Create: `PRIVACY.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: the built `dist/firefox` output.
- Produces: a verified Firefox load + project docs.

- [ ] **Step 1: Load in Firefox and verify**

1. `about:debugging` → This Firefox → Load Temporary Add-on → select `dist/firefox/manifest.json`.
2. Repeat the Task 7 Step 4 redirect test (`https://twitter.com/*` → `https://nitter.net/$1`) on a hard navigation.
3. Add a rule **with an exclude pattern** (Include `https://example.com/*`, Exclude `https://example.com/keep/*`, Redirect `https://dest.example/$1`) and confirm `https://example.com/keep/x` is **not** redirected while `https://example.com/other` **is**. This validates the exclude-via-allow precedence (spec risk #2).

Expected: redirects fire on both browsers; exclude precedence behaves as intended. If Firefox DNR diverges, record the difference in `README.md` under a "Known differences" heading.

- [ ] **Step 2: Write `PRIVACY.md`**

```markdown
# Ferry Privacy Policy

Ferry collects no data. It makes no network requests and contains no
analytics or telemetry. Your redirect rules are stored only on your device
via the browser's local extension storage and are never transmitted anywhere.

Redirects are performed natively by the browser's `declarativeNetRequest`
engine; Ferry's own code never observes the URLs you visit.
```

- [ ] **Step 3: Update `README.md`**

```markdown
# Ferry

Fast, private URL redirector for Chrome and Firefox (Manifest V3,
`declarativeNetRequest`).

## Why
- Redirects run natively — no JavaScript in the request path, low memory.
- Private by construction — the extension never observes your browsing; no
  network calls, no telemetry. See `PRIVACY.md`.

## Develop
```bash
npm install
npm test          # unit tests (rule-model, compiler, engine)
npm run build     # -> dist/chrome and dist/firefox
```

Load unpacked: Chrome `chrome://extensions` (Load unpacked → `dist/chrome`);
Firefox `about:debugging` (Load Temporary Add-on → `dist/firefox/manifest.json`).

## Not supported (pure-DNR tradeoff)
- Capture-group transforms (base64 / URL decode).
- SPA history-state redirects (in-app soft navigation). Hard loads still redirect.
```

- [ ] **Step 4: Final full verification**

Run: `npm test && npm run typecheck && npm run build`
Expected: tests pass, no type errors, both `dist/` targets built.

- [ ] **Step 5: Commit**

```bash
git add README.md PRIVACY.md
git commit -m "docs: privacy policy, readme, cross-browser notes"
```

---

## Self-Review

**Spec coverage:**
- Goals (native redirect, private, rule power) → Tasks 3–5, 7.
- Non-goals (no transforms/history, not in UI) → enforced by `rule-model` shape (no such fields); import drops them (Task 7).
- Architecture 4 units → Tasks 2 (rule-model), 3–4 (compiler), 5 (engine), 7–8 (ui).
- Rule model fields → Task 2.
- Pattern→DNR mapping (wildcard, regex, substitution, exclude, resourceTypes, priority) → Tasks 3–4.
- Storage local-only, sync off → `storage.ts` (Task 6); no sync code anywhere.
- Import/export → Task 7.
- Better defaults (main_frame default, validate-before-save, no loop counter, local/no-telemetry) → Tasks 2, 7, and by omission.
- Permissions exact set → Task 6 manifest.
- Stack + dual build → Tasks 1, 6.
- Testing (compiler/rule-model/engine + manual cross-browser) → Tasks 2–5, 7–9.
- Risks (Firefox parity, exclude precedence, import compat) → verified in Task 9; import compat in Task 7.

**Placeholder scan:** none — every code step contains full content.

**Type consistency:** `Rule`, `ResourceType`, `DnrRule`, `compile`, `createRule`, `validateRule`, `syncRules`, `getRules/setRules/getDisabled/setDisabled` used identically across tasks. UI test-field substitution mirrors `translateSubstitution`'s `\n` output.
