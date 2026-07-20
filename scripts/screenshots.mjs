// Generates Chrome Web Store screenshots from the built extension.
// Usage: npm run build && node scripts/screenshots.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const distChrome = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'chrome');
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'store-assets');
mkdirSync(outDir, { recursive: true });

const demoRules = [
  { description: 'Twitter → Nitter', patternType: 'wildcard', includePattern: 'https://twitter.com/*', excludePattern: '', redirectUrl: 'https://nitter.net/$1', resourceTypes: ['main_frame'], disabled: false, example: 'https://twitter.com/jack', id: 'demo-1' },
  { description: 'Reddit → old.reddit', patternType: 'wildcard', includePattern: 'https://www.reddit.com/*', excludePattern: 'https://www.reddit.com/gallery*', redirectUrl: 'https://old.reddit.com/$1', resourceTypes: ['main_frame'], disabled: false, example: 'https://www.reddit.com/r/programming', id: 'demo-2' },
  { description: 'YouTube Shorts → normal player', patternType: 'regex', includePattern: '^https://www\\.youtube\\.com/shorts/(.*)$', excludePattern: '', redirectUrl: 'https://www.youtube.com/watch?v=$1', resourceTypes: ['main_frame'], disabled: false, example: '', id: 'demo-3' },
  { description: 'Force HTTPS on example.org', patternType: 'wildcard', includePattern: 'http://example.org/*', excludePattern: '', redirectUrl: 'https://example.org/$1', resourceTypes: ['main_frame'], disabled: true, example: '', id: 'demo-4' },
];

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ferry-shots-')), {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${distChrome}`, `--load-extension=${distChrome}`],
});
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
await worker.evaluate(async (rules) => {
  await chrome.storage.local.set({ rules, disabled: false });
}, demoRules);
const extensionId = new URL(worker.url()).host;

const options = await context.newPage();
await options.setViewportSize({ width: 1280, height: 800 });
await options.goto(`chrome-extension://${extensionId}/options.html`);
await options.waitForSelector('.rule-card');
await options.screenshot({ path: join(outDir, '1-options.png') });

const popup = await context.newPage();
await popup.setViewportSize({ width: 640, height: 400 });
await popup.goto(`chrome-extension://${extensionId}/popup.html`);
await popup.waitForSelector('#count:not(:empty)');
await popup.screenshot({ path: join(outDir, '2-popup.png') });

await context.close();
console.log(`Wrote ${join(outDir, '1-options.png')} (1280x800) and ${join(outDir, '2-popup.png')} (640x400)`);
