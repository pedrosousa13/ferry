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