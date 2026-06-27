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

// Write rules (and optionally a whitelist) into the extension's storage; the
// engine's storage.onChanged listener recompiles and pushes the result into
// declarativeNetRequest.
export async function seedRules(worker: Worker, rules: unknown[], whitelist: unknown[] = []): Promise<void> {
  await worker.evaluate(async ({ r, w }) => {
    await chrome.storage.local.set({ rules: r, disabled: false, whitelist: w });
  }, { r: rules, w: whitelist });
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
