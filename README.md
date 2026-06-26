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
