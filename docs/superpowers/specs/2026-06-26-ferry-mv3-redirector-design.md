# Ferry — Design Spec

**Date:** 2026-06-26
**Status:** Approved (design), pending implementation plan

Fast, private URL redirector for Chrome and Firefox. Manifest V3, pure
`declarativeNetRequest` (DNR). A from-scratch alternative to MV2 redirect
extensions, trading two niche features for a 100% native redirect path.

---

## 1. Goals

- Redirect URLs based on user-defined rules, on Chrome and Firefox, under MV3.
- **Redirect path is 100% native** — zero JavaScript runs per request. The
  background context sleeps unless rules are being edited.
- **Private by construction** — the extension code never observes browsing.
  No network calls, no telemetry, no remote server.
- Supported rule power:
  - Wildcard patterns (`*` segments) and regex patterns.
  - Capture-group substitution in the redirect target (`$1`, `$2`, …).
  - Exclude patterns.
  - Per-resource-type filtering (main frame, sub frame, script, image, …).
  - Enable / disable individual rules.
  - Reorder / priority between rules.

## 2. Non-Goals (the pure-DNR tradeoff)

These are **deliberately not supported** and are **not offered in the UI** —
no silent half-support, no disabled-looking controls that imply a roadmap:

- **Capture-group transforms** — base64 decode, URL decode/encode, double URL
  decode on matched groups. DNR substitution is verbatim string only.
- **SPA history-state redirects** — redirects triggered by in-page `pushState`
  navigation (e.g. soft navigation inside Twitter/X, Facebook, YouTube). DNR
  only matches real network requests. A hard load / new tab / typed URL is
  still redirected; only in-app soft navigation is missed.

If these are ever needed, they require a service-worker / `webRequest`
fallback (Chrome: hacky reload-after-the-fact; Firefox: clean, since Firefox
retains blocking `webRequest` under MV3). Out of scope for v1.

## 3. Architecture

Four small units, each with one purpose, each testable in isolation.

```
storage (chrome.storage.local)
        │  rules: Rule[]
        ▼
   ┌─────────┐   compile()    ┌──────────┐  updateDynamicRules()  ┌─────────┐
   │ rule-   │ ─────────────► │ compiler │ ─────────────────────► │  DNR    │
   │ model   │                │ (pure)   │                        │ engine  │
   └─────────┘                └──────────┘                        └─────────┘
        ▲                                                              ▲
        │ CRUD / validate / test                                      │ onChanged
        │                                                       ┌──────────────┐
        └────────────────────────────────────────────────────► │   engine     │
                                                                │ (SW / event) │
   ui (options page + popup)  ◄──────────────────────────────► └──────────────┘
```

- **`rule-model`** — the user-facing rule shape, construction, and validation.
  Pure TypeScript, no browser APIs. Validates regex compiles, required fields,
  at least one resource type, etc. Exposes a stable serialized form for
  storage and import/export.

- **`compiler`** — pure function `Rule[] → DNR rule JSON[]`. The core of the
  product and the focus of the test suite. Maps wildcard/regex patterns to DNR
  conditions, redirect targets (incl. `$n` → `\n` substitution) to DNR
  actions, resource types, exclude patterns, and assigns rule priority from
  list order. Deterministic: same input → same output.

- **`engine`** — the background context. Chrome: `background.service_worker`.
  Firefox: non-persistent event page (`background.scripts`). On
  `storage.onChanged` (and on install/startup): read rules → `compile()` →
  `declarativeNetRequest.updateDynamicRules({ addRules, removeRuleIds })`.
  Holds no long-lived state; idempotent.

- **`ui`** — two surfaces:
  - **Options page**: rule list (reorder, enable/disable, edit, delete),
    add/edit form with a live **test field** (enter a sample URL → show the
    resulting redirect or "no match"), and import/export.
  - **Popup**: master on/off toggle, count of active rules, link to options.

### Master on/off

A `disabled` flag in storage. When disabled, the engine clears all dynamic
rules (`updateDynamicRules` removing everything); when re-enabled it
recompiles from stored rules. No rules in the DNR set = no redirects, cleanly.

## 4. Rule model

Stored shape (one rule):

```ts
type PatternType = 'wildcard' | 'regex';
type ResourceType =
  | 'main_frame' | 'sub_frame' | 'stylesheet' | 'script' | 'image'
  | 'font' | 'object' | 'xmlhttprequest' | 'ping' | 'media'
  | 'websocket' | 'other';

interface Rule {
  id: string;            // stable, generated on create
  description: string;
  patternType: PatternType;
  includePattern: string;
  excludePattern: string; // optional, '' = none
  redirectUrl: string;    // may contain $1..$9
  resourceTypes: ResourceType[]; // default: ['main_frame']
  disabled: boolean;
  example: string;        // optional sample URL for the test field
}
```

Order in the stored array defines priority (earlier = higher priority).

## 5. Pattern → DNR mapping

- **Wildcard** → converted to a regex (`*` → `(.*?)`, other regex
  metacharacters escaped), then emitted as `condition.regexFilter`. This keeps
  one code path and preserves capture-group substitution for wildcards too,
  matching the old extension's behavior.
- **Regex** → emitted directly as `condition.regexFilter`.
- **Redirect target** → `action.redirect.regexSubstitution`, translating user
  `$1..$9` to DNR `\1..\9`.
- **Exclude pattern** → DNR has no per-rule "exclude regex" on the same
  condition. Implemented as a **higher-priority `allow` rule** carrying the
  exclude `regexFilter`, so an excluded URL is allowed through before the
  redirect rule can match. (Verify exact DNR `allow` precedence semantics
  during implementation; fall back to documenting the limitation if DNR cannot
  express it cleanly.)
- **Resource types** → `condition.resourceTypes`.
- **Priority** → derived from list order.

### Cross-browser note

Firefox DNR is not byte-identical to Chrome DNR (historical gaps in dynamic
rule limits and `regexSubstitution` edge cases). The compiler targets the
**common subset**; behavior is verified against current Firefox DNR docs
during implementation. This is the single biggest implementation risk and is
called out in the plan.

## 6. Storage & sync

- **`chrome.storage.local` only. Sync is OFF and not offered in v1.** Avoids
  the legacy quota-juggling complexity and keeps rules on-device (privacy).
- **Import / export**: a JSON file via the page, format-compatible in spirit
  with the popular MV2 extensions so users can migrate existing rule sets
  (transform/history fields, if present in an imported file, are ignored with
  a visible notice).

## 7. Better defaults

- New rule defaults to **`main_frame` only** — avoids accidentally redirecting
  every sub-resource.
- Regex is validated before a rule can be saved; the test field shows the live
  result so a rule is verified before it goes active.
- **Redirect-loop protection is free** — the browser natively caps redirects
  per request. The legacy manual loop-counter is deleted entirely; we rely on
  the platform.
- **No telemetry, no network, local-only.** The privacy policy is true by
  construction, not by promise.

## 8. Permissions

- `declarativeNetRequest`
- `storage`
- Host permissions: `*://*/*` (broad). **Required** — DNR `redirect` actions
  need host access for the requests they rewrite; there is no way to redirect
  arbitrary sites without it. The extension code still never reads URLs.
- `declarativeNetRequestFeedback` may be added in dev builds only, to debug
  which rule matched. Not shipped in release builds.

Granular / optional per-site host permissions are a deliberate **post-v1**
enhancement, not part of this spec.

## 9. Tech stack & build

- **TypeScript** throughout.
- **esbuild** for bundling (light, fast, sufficient for an extension).
- **`webextension-polyfill`** for promise-based `browser.*` across both
  browsers.
- One manifest source → build step generates per-browser manifests:
  - Chrome: `background.service_worker`.
  - Firefox: `background.scripts` (event page) + `browser_specific_settings.gecko.id`.
- `npm run build` → `dist/chrome/` and `dist/firefox/`, each loadable
  unpacked and zippable for store submission.

## 10. Testing

- **Vitest unit tests** on:
  - `compiler` — golden tests: a rule (or rule set) in → exact DNR rule JSON
    out, covering wildcard, regex, capture substitution, exclude, resource
    types, priority ordering, and the disabled/master-off cases.
  - `rule-model` — validation: bad regex rejected, empty include rejected,
    resource-type defaulting, round-trip serialize/deserialize.
- **Manual load-test** in Chrome and Firefox for v1 (load unpacked, verify a
  handful of real redirects fire on hard navigation).
- **Automated browser E2E** (e.g. Playwright with the extension loaded) is
  deferred beyond v1.

## 11. Risks

1. **Firefox DNR parity** — biggest risk. Mitigation: target the common
   subset, verify against current docs, keep manual load-test on both.
2. **Exclude-pattern semantics** — DNR `allow`-rule precedence must actually
   produce the intended "exclude wins over redirect" behavior. Mitigation:
   prototype this mapping early in implementation; document the limitation if
   it can't be expressed cleanly.
3. **Import compatibility** — legacy files may carry unsupported
   transform/history fields. Mitigation: import ignores them with a visible
   notice rather than failing.
