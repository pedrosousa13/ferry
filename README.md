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
