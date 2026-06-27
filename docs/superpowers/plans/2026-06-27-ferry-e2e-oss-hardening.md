# Ferry E2E + OSS Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Playwright E2E tests that prove a DNR redirect actually fires, a dev watch script, latest-LTS CI with an E2E job, standard open-source community/protection files, and a succinct README guide.

**Architecture:** Mirror the proven setup from the sibling `json-bonsai` extension: Playwright launches `chromium` (full build, `channel: "chromium"`) with the built extension loaded into a persistent context, against a local fixture HTTP server so tests never touch the network. E2E seeds rules into the extension's `chrome.storage.local` via its service worker, waits for the engine to apply them to `declarativeNetRequest`, then asserts the navigation lands on the redirect target. Dev watch uses `esbuild.context().watch()`.

**Tech Stack:** Playwright (`@playwright/test`), esbuild, Node (latest LTS), TypeScript. Adds dev deps `@playwright/test`, `@types/node`.

## Global Constraints

- Ferry is a Chrome+Firefox MV3 pure-`declarativeNetRequest` extension. E2E runs on Chromium only (Firefox DNR is verified manually per the design spec).
- Build emits `dist/chrome/` and `dist/firefox/`; E2E loads `dist/chrome/`.
- `npm run typecheck` covers `src` and `test` only — do NOT add `e2e/` to tsconfig `include` (Playwright transpiles e2e itself; keeping it out avoids dragging node/playwright types into the extension typecheck).
- CI Node version: `lts/*` (latest LTS). `package.json` engines: `>=20`.
- LICENSE: MIT, copyright holder "Pedro Sousa", year 2026.
- No attribution/co-author lines in commits.
- `*.zip`, `dist/`, `node_modules/`, `.superpowers/` stay git-ignored (already set).

## File Structure

```
ferry/
  scripts/build.mjs            # MODIFY: add --watch mode
  playwright.config.ts         # CREATE: testDir e2e, serial, CI-aware
  e2e/
    helpers.ts                 # CREATE: extension launch + fixture server + rule seeding
    redirect.spec.ts           # CREATE: redirect-fires + exclude-precedence tests
  package.json                 # MODIFY: scripts (dev, test:e2e), devDeps, engines
  .github/
    workflows/ci.yml           # MODIFY: node lts/*, add e2e job
    dependabot.yml             # CREATE: weekly npm + actions updates
    ISSUE_TEMPLATE/
      bug_report.md            # CREATE
      feature_request.md       # CREATE
    PULL_REQUEST_TEMPLATE.md   # CREATE
  LICENSE                      # CREATE: MIT
  SECURITY.md                  # CREATE
  CONTRIBUTING.md              # CREATE
  CODE_OF_CONDUCT.md           # CREATE: Contributor Covenant 2.1 (short form)
  README.md                    # MODIFY: succinct build/load/dev/test guide
```

---

### Task 1: Dev watch + E2E tooling

**Files:**
- Modify: `scripts/build.mjs` (add `--watch`)
- Create: `playwright.config.ts`
- Modify: `package.json` (scripts `dev`, `test:e2e`; devDeps `@playwright/test`, `@types/node`; `engines`)

**Interfaces:**
- Consumes: existing `src/*` entry points.
- Produces: `npm run dev` (watch rebuild), `npm run test:e2e` (Playwright), unchanged `npm run build` output.

- [ ] **Step 1: Replace `scripts/build.mjs`** (adds watch; behavior of the one-shot build is unchanged)

```js
import * as esbuild from 'esbuild';
import { mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const VERSION = '0.1.0';
const NAME = 'Ferry';
const DESCRIPTION = 'Fast, private URL redirector. Define rules; matching URLs are redirected natively.';

const watch = process.argv.includes('--watch');
const targets = ['chrome', 'firefox'];

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
    browser_specific_settings: { gecko: { id: 'ferry@pedrosousa.me', strict_min_version: '128.0' } },
  };
}

function buildOptions(outdir) {
  return {
    entryPoints: ['src/engine.ts', 'src/options.ts', 'src/popup.ts'],
    bundle: true,
    format: 'iife',
    target: ['chrome110', 'firefox128'],
    outdir,
    logLevel: 'info',
  };
}

function copyStatic(outdir, target) {
  writeFileSync(join(outdir, 'manifest.json'), JSON.stringify(manifest(target), null, 2));
  copyFileSync('src/options.html', join(outdir, 'options.html'));
  copyFileSync('src/popup.html', join(outdir, 'popup.html'));
}

for (const target of targets) {
  const outdir = join('dist', target);
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });
}

if (watch) {
  for (const target of targets) {
    const outdir = join('dist', target);
    const ctx = await esbuild.context(buildOptions(outdir));
    await ctx.watch();
    copyStatic(outdir, target);
  }
  console.log('esbuild: watching for changes… (manifest/html copied once; restart to re-copy)');
} else {
  for (const target of targets) {
    const outdir = join('dist', target);
    await esbuild.build(buildOptions(outdir));
    copyStatic(outdir, target);
  }
  console.log('Built dist/chrome and dist/firefox');
}
```

- [ ] **Step 2: Create `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Each spec launches its own persistent context with the extension loaded;
  // serial keeps CI memory predictable.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
});
```

- [ ] **Step 3: Edit `package.json` scripts** — add `dev` and `test:e2e`

Add these two entries to the `"scripts"` object (alongside the existing `build`, `package`, `source`):
```json
    "dev": "node scripts/build.mjs --watch",
    "test:e2e": "playwright test"
```

- [ ] **Step 4: Edit `package.json` devDependencies + engines**

Add to `"devDependencies"`:
```json
    "@playwright/test": "^1.49.0",
    "@types/node": "^22.10.0"
```
Add a top-level `"engines"` block (after `"dependencies"`):
```json
  "engines": {
    "node": ">=20"
  }
```

- [ ] **Step 5: Install and verify build + watch wiring**

Run: `npm install && npm run build`
Expected: install succeeds; build prints "Built dist/chrome and dist/firefox"; `dist/chrome/manifest.json` and `dist/firefox/manifest.json` exist.

Run: `npm test && npm run typecheck`
Expected: 15 tests pass; typecheck clean (e2e not yet present, so nothing new to check).

- [ ] **Step 6: Commit**

```bash
git add scripts/build.mjs playwright.config.ts package.json package-lock.json
git commit -m "build: add dev watch mode and playwright e2e tooling"
```

---

### Task 2: E2E suite (redirect fires + exclude precedence)

**Files:**
- Create: `e2e/helpers.ts`
- Create: `e2e/redirect.spec.ts`

**Interfaces:**
- Consumes: `dist/chrome` (built extension), the extension's `chrome.storage.local` rule shape (`{ id, description, patternType, includePattern, excludePattern, redirectUrl, resourceTypes, disabled, example }`), and `chrome.declarativeNetRequest`.
- Produces: `e2e/helpers.ts` exporting `launchWithExtension(): Promise<BrowserContext>`, `getServiceWorker(context): Promise<Worker>`, `serveText(bodies: Record<string,string>): Promise<FixtureServer>` (with `{ port, url(path), close() }`), `seedRules(worker, rules: unknown[]): Promise<void>`, `waitForDynamicRules(worker, count: number): Promise<void>`.

- [ ] **Step 1: Create `e2e/helpers.ts`**

```ts
// Shared E2E setup: Chromium with the built Ferry extension loaded, plus a
// local fixture server so tests never depend on the network. Rules are seeded
// straight into the extension via its service worker, mirroring how the real
// options page writes them.
import { chromium, type BrowserContext, type Worker } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const distChrome = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'chrome');

// Extensions need the full Chromium build ("chromium" channel) to load in
// headless mode; the default headless shell silently ignores --load-extension.
export async function launchWithExtension(): Promise<BrowserContext> {
  return chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ferry-e2e-')), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${distChrome}`, `--load-extension=${distChrome}`],
  });
}

// The extension's MV3 service worker. It registers on install; wait if needed.
export async function getServiceWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
}

export interface FixtureServer {
  port: number;
  url: (path: string) => string;
  close: () => void;
}

// Serves a distinct plain-text body per path, so redirect targets are
// distinguishable by page content as well as URL.
export async function serveText(bodies: Record<string, string>): Promise<FixtureServer> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const body = bodies[path];
    if (body === undefined) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><title>${body}</title><body>${body}</body>`);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return { port, url: (p) => `http://127.0.0.1:${port}${p}`, close: () => server.close() };
}

// Write rules into the extension's storage; the engine's storage.onChanged
// listener recompiles and pushes them into declarativeNetRequest.
export async function seedRules(worker: Worker, rules: unknown[]): Promise<void> {
  await worker.evaluate(async (r) => {
    await chrome.storage.local.set({ rules: r, disabled: false });
  }, rules);
}

// Poll the live DNR rule set until it reaches the expected count (or time out).
export async function waitForDynamicRules(worker: Worker, count: number): Promise<void> {
  await worker.evaluate(async (expected) => {
    const deadline = Date.now() + 5000;
    for (;;) {
      const dynamic = await chrome.declarativeNetRequest.getDynamicRules();
      if (dynamic.length >= expected) return;
      if (Date.now() > deadline) {
        throw new Error(`DNR rules not applied: have ${dynamic.length}, want ${expected}`);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }, count);
}
```

- [ ] **Step 2: Create `e2e/redirect.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import {
  launchWithExtension,
  getServiceWorker,
  serveText,
  seedRules,
  waitForDynamicRules,
} from './helpers';

function rule(partial: Record<string, unknown>) {
  return {
    id: 'e2e',
    description: '',
    patternType: 'wildcard',
    includePattern: '',
    excludePattern: '',
    redirectUrl: '',
    resourceTypes: ['main_frame'],
    disabled: false,
    example: '',
    ...partial,
  };
}

test('redirects a matching main_frame navigation', async () => {
  const context = await launchWithExtension();
  const server = await serveText({ '/from': 'FROM', '/to': 'TO' });
  try {
    const worker = await getServiceWorker(context);
    await seedRules(worker, [
      rule({ id: 'r1', includePattern: server.url('/from'), redirectUrl: server.url('/to') }),
    ]);
    await waitForDynamicRules(worker, 1);

    const page = await context.newPage();
    await page.goto(server.url('/from'));

    expect(page.url()).toBe(server.url('/to'));
    await expect(page.locator('body')).toHaveText('TO');
  } finally {
    server.close();
    await context.close();
  }
});

test('exclude pattern prevents redirect while siblings still redirect', async () => {
  const context = await launchWithExtension();
  const server = await serveText({ '/page/keep': 'KEEP', '/page/other': 'OTHER', '/dest': 'DEST' });
  try {
    const worker = await getServiceWorker(context);
    await seedRules(worker, [
      rule({
        id: 'r1',
        includePattern: server.url('/page/*'),
        excludePattern: server.url('/page/keep*'),
        redirectUrl: server.url('/dest'),
      }),
    ]);
    // One user rule with an exclude compiles to two DNR rules (redirect + allow).
    await waitForDynamicRules(worker, 2);

    const kept = await context.newPage();
    await kept.goto(server.url('/page/keep'));
    expect(kept.url()).toBe(server.url('/page/keep'));
    await expect(kept.locator('body')).toHaveText('KEEP');

    const other = await context.newPage();
    await other.goto(server.url('/page/other'));
    expect(other.url()).toBe(server.url('/dest'));
    await expect(other.locator('body')).toHaveText('DEST');
  } finally {
    server.close();
    await context.close();
  }
});
```

- [ ] **Step 3: Install the Chromium browser for Playwright**

Run: `npx playwright install --with-deps chromium`
Expected: downloads the full Chromium build (needed for `channel: "chromium"`). On a dev machine without `--with-deps` privileges, `npx playwright install chromium` is sufficient.

- [ ] **Step 4: Build, then run the E2E suite**

Run: `npm run build && npm run test:e2e`
Expected: both tests pass — "2 passed". If the suite cannot launch Chromium in this environment (sandbox/display limits), record the exact error in the report and mark DONE_WITH_CONCERNS so the controller can confirm the suite passes in CI; do NOT weaken the assertions to force a pass.

- [ ] **Step 5: Commit**

```bash
git add e2e/helpers.ts e2e/redirect.spec.ts
git commit -m "test: e2e — assert DNR redirect fires and exclude precedence holds"
```

---

### Task 3: CI on latest LTS + dependabot

**Files:**
- Modify: `.github/workflows/ci.yml` (Node `lts/*`, add `e2e` job)
- Create: `.github/dependabot.yml`

**Interfaces:**
- Consumes: `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` (from Tasks 1–2).
- Produces: a green CI matrix on PRs/pushes.

- [ ] **Step 1: Replace `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "lts/*"
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "lts/*"
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run build
      - run: npm run test:e2e
```

- [ ] **Step 2: Create `.github/dependabot.yml`**

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

- [ ] **Step 3: Validate YAML locally**

Run: `node -e "const fs=require('fs');for(const f of ['.github/workflows/ci.yml','.github/dependabot.yml'])fs.readFileSync(f,'utf8');console.log('files present')"`
Expected: prints "files present" (basic existence/readability; GitHub validates schema on push).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml .github/dependabot.yml
git commit -m "ci: run on latest LTS node, add e2e job and dependabot"
```

---

### Task 4: Open-source community + protection files

**Files:**
- Create: `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/ISSUE_TEMPLATE/feature_request.md`, `.github/PULL_REQUEST_TEMPLATE.md`

**Interfaces:**
- Consumes: nothing.
- Produces: standard GitHub community-health files.

- [ ] **Step 1: Create `LICENSE` (MIT)**

```
MIT License

Copyright (c) 2026 Pedro Sousa

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Create `SECURITY.md`**

```markdown
# Security Policy

## Reporting a vulnerability

Ferry is a browser extension with broad host access (it can rewrite any URL
you navigate to), so security reports are taken seriously.

**Please do not open a public issue for security problems.** Instead, use
GitHub's private vulnerability reporting:
**Security → Report a vulnerability** on this repository
(https://github.com/pedrosousa13/ferry/security/advisories/new).

Include: what the issue is, steps to reproduce, and the impact. You'll get an
acknowledgement within a few days.

## Scope

In scope: the extension code in this repository (rule compilation, the
background engine, the options/popup pages). Out of scope: vulnerabilities in
Chrome/Firefox themselves or in third-party sites you redirect to.

## Supported versions

Only the latest released version receives fixes.
```

- [ ] **Step 3: Create `CONTRIBUTING.md`**

```markdown
# Contributing to Ferry

Thanks for your interest! Ferry is a small, focused MV3 URL redirector built on
pure `declarativeNetRequest`.

## Getting started

```bash
npm install
npm run dev        # watch build
npm test           # unit tests
npm run test:e2e   # browser tests (needs: npx playwright install chromium)
```

Load `dist/chrome` (Chrome) or `dist/firefox/manifest.json` (Firefox) unpacked —
see the README for step-by-step instructions.

## Pull requests

- Branch off `main`, keep PRs focused.
- Run `npm run typecheck && npm test && npm run build` before pushing; CI runs
  these plus the E2E suite.
- Add or update tests for behavior changes. The rule compiler (`src/compiler.ts`)
  is the core — golden unit tests live in `test/compiler.test.ts`.

## Scope

Ferry is intentionally pure-DNR. Features that require running JavaScript per
request — capture-group transforms (base64/URL decode) or SPA history-state
redirects — are out of scope by design. See the design spec in
`docs/superpowers/specs/`.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
```

- [ ] **Step 4: Create `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1, short form)**

```markdown
# Contributor Covenant Code of Conduct

## Our Pledge

We as members, contributors, and leaders pledge to make participation in our
community a harassment-free experience for everyone, regardless of age, body
size, visible or invisible disability, ethnicity, sex characteristics, gender
identity and expression, level of experience, education, socio-economic status,
nationality, personal appearance, race, religion, or sexual identity and
orientation.

## Our Standards

Examples of behavior that contributes to a positive environment: demonstrating
empathy and kindness, being respectful of differing opinions, giving and
gracefully accepting constructive feedback, and focusing on what is best for
the community.

Unacceptable behavior includes: sexualized language or imagery, trolling or
insulting comments, public or private harassment, publishing others' private
information without permission, and other conduct which could reasonably be
considered inappropriate.

## Enforcement

Instances of abusive, harassing, or otherwise unacceptable behavior may be
reported to the project maintainer via GitHub. All complaints will be reviewed
and investigated promptly and fairly.

This Code of Conduct is adapted from the [Contributor Covenant](https://www.contributor-covenant.org),
version 2.1.
```

- [ ] **Step 5: Create `.github/ISSUE_TEMPLATE/bug_report.md`**

```markdown
---
name: Bug report
about: Report something not working
title: ''
labels: bug
assignees: ''
---

**What happened**
A clear description of the bug.

**Rule involved**
The redirect rule (include pattern, redirect URL, pattern type, resource types).

**Steps to reproduce**
1. …
2. …

**Expected vs actual**
What you expected, and what happened instead.

**Environment**
- Browser + version:
- Ferry version:
- Loaded from store or unpacked:
```

- [ ] **Step 6: Create `.github/ISSUE_TEMPLATE/feature_request.md`**

```markdown
---
name: Feature request
about: Suggest an idea
title: ''
labels: enhancement
assignees: ''
---

**Problem**
What are you trying to do that Ferry doesn't support?

**Proposed solution**
What you'd like to happen.

**Note on scope**
Ferry is pure-`declarativeNetRequest`. Capture-group transforms and SPA
history-state redirects are out of scope by design (see CONTRIBUTING.md).
```

- [ ] **Step 7: Create `.github/PULL_REQUEST_TEMPLATE.md`**

```markdown
## What

Brief description of the change.

## Why

The motivation / issue it addresses (link issues with `Fixes #N`).

## Checklist
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] Added/updated tests for behavior changes
- [ ] Change stays within Ferry's pure-DNR scope
```

- [ ] **Step 8: Commit**

```bash
git add LICENSE SECURITY.md CONTRIBUTING.md CODE_OF_CONDUCT.md .github/ISSUE_TEMPLATE .github/PULL_REQUEST_TEMPLATE.md
git commit -m "docs: add license and open-source community health files"
```

---

### Task 5: README guide

**Files:**
- Modify: `README.md` (replace with a succinct build/load/dev/test guide)

**Interfaces:**
- Consumes: the scripts from Tasks 1–3.
- Produces: a README a newcomer can follow end to end.

- [ ] **Step 1: Replace `README.md`**

````markdown
# Ferry

Fast, private URL redirector for Chrome and Firefox. Manifest V3, pure
`declarativeNetRequest` — redirects run natively (no JavaScript in the request
path), and the extension never observes the URLs you visit. No telemetry, no
network calls. See [PRIVACY.md](PRIVACY.md).

## Install from source

`dist/` is not committed — build it:

```bash
npm install
npm run build      # -> dist/chrome and dist/firefox
```

### Load unpacked — Chrome
1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. **Load unpacked** → select the `dist/chrome` folder.

### Load unpacked — Firefox
1. Open `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on…** → select `dist/firefox/manifest.json`.
   (Temporary add-ons are removed when Firefox restarts.)

## Try it
1. Open the extension's options page (right-click the icon → **Options**).
2. Add a rule — type **Wildcard**, include `https://twitter.com/*`, redirect
   `https://nitter.net/$1`, with `main_frame` checked. Set an Example URL and
   click **Test** to preview the result, then **Save**.
3. Visit a matching URL — you're redirected natively. Rules apply instantly; no
   reload needed. Toggle the extension off from the popup to pause all redirects.

## Develop

```bash
npm run dev        # watch mode — rebuilds on file changes
npm run build      # production build (dist/chrome + dist/firefox)
npm run typecheck  # TypeScript, no emit
npm test           # unit tests (vitest)
npm run test:e2e   # browser tests (Playwright; run `npx playwright install chromium` once)
npm run package    # build + create ferry-chrome.zip and ferry-firefox.zip
npm run source     # create ferry-source.zip (Firefox AMO source upload)
```

After changing code, reload the extension in your browser. CI runs typecheck,
unit tests, build, and the E2E suite on every PR.

## Not supported (pure-DNR tradeoff)
- Capture-group transforms (base64 / URL decode).
- SPA history-state redirects (in-app soft navigation). Hard loads still redirect.

Importing rules from other extensions skips any that need transforms, with a
notice.

## License

[MIT](LICENSE).
````

- [ ] **Step 2: Verify the README renders (no broken fences)**

Run: `node -e "const s=require('fs').readFileSync('README.md','utf8');const f=(s.match(/```/g)||[]).length;if(f%2)throw new Error('odd code fence count: '+f);console.log('fences balanced:',f)"`
Expected: prints an even fence count (e.g. "fences balanced: 14"), no error.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: succinct build, load, and development guide in README"
```

---

## Self-Review

**Spec coverage:**
- E2E that proves a redirect fires → Task 2 (`redirect.spec.ts` test 1) + the launch/fixture/seed helpers.
- Exclude-precedence on Chromium → Task 2 test 2.
- Dev watch script → Task 1 (`build.mjs --watch`, `npm run dev`).
- README succinct guide (json-bonsai style: install/load/dev script table) → Task 5.
- Node latest/stable in CI → Task 3 (`lts/*`), engines in Task 1.
- OSS protections → Task 4 (LICENSE, SECURITY, CONTRIBUTING, CoC, issue/PR templates) + Task 3 (dependabot).

**Placeholder scan:** none — every file's full content is inline.

**Type/name consistency:** helper exports (`launchWithExtension`, `getServiceWorker`, `serveText`, `seedRules`, `waitForDynamicRules`, `FixtureServer`) are defined in Task 2 Step 1 and consumed identically in Step 2. The seeded rule object matches the extension's `Rule` shape (id/description/patternType/includePattern/excludePattern/redirectUrl/resourceTypes/disabled/example). `npm run test:e2e` and `npm run dev` are defined in Task 1 and referenced by CI (Task 3) and README (Task 5).

**Note for executor:** E2E (Task 2 Step 4) may not run in a restricted sandbox (no Chromium/display). That's an accepted DONE_WITH_CONCERNS — CI (Task 3) is the authoritative E2E gate. Never weaken assertions to force a local pass.
```
