import { test, expect } from '@playwright/test';
import { launchWithExtension, getServiceWorker, seedRules, waitForDynamicRules, serveText } from './helpers';

function rule(id: string, description: string, includePattern: string, redirectUrl: string, extra: Record<string, unknown> = {}) {
  return {
    id, description, patternType: 'wildcard', includePattern, excludePattern: '',
    redirectUrl, resourceTypes: ['main_frame'], disabled: false, example: '', ...extra,
  };
}

test('popup lists rules and per-rule toggle persists', async () => {
  const context = await launchWithExtension();
  try {
    const worker = await getServiceWorker(context);
    await seedRules(worker, [
      rule('r1', 'Twitter to Nitter', 'https://twitter.com/*', 'https://nitter.net/$1'),
      rule('r2', 'YouTube to Invidious', 'https://youtube.com/*', 'https://yewtu.be/$1'),
    ]);
    await waitForDynamicRules(worker, 2);
    const extensionId = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await expect(popup.locator('.rule')).toHaveCount(2);
    await expect(popup.locator('#count')).toHaveText('2 of 2 active');

    await popup.locator('.rule', { hasText: 'Twitter to Nitter' }).locator('.switch').click();
    await expect(popup.locator('.rule.off')).toHaveCount(1);
    await expect(popup.locator('#count')).toHaveText('1 of 2 active');

    const stored = await worker.evaluate(async () => (await chrome.storage.local.get('rules')).rules as any[]);
    expect(stored.find((r) => r.id === 'r1').disabled).toBe(true);
    expect(stored.find((r) => r.id === 'r2').disabled).toBe(false);
  } finally {
    await context.close();
  }
});

test('popup highlights the rule matching the active tab', async () => {
  const server = await serveText({ '/a': 'ORIGIN-A', '/b': 'TARGET-B' });
  const context = await launchWithExtension();
  try {
    const worker = await getServiceWorker(context);
    const page = await context.newPage();
    await page.goto(server.url('/a')); // navigate BEFORE the rule exists, so no redirect fires
    await seedRules(worker, [
      rule('r1', 'A to B', server.url('/a') + '*', server.url('/b')),
      rule('r2', 'Unrelated', 'https://twitter.com/*', 'https://nitter.net/$1'),
    ]);
    await waitForDynamicRules(worker, 2);

    const extensionId = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront(); // make the /a tab the active tab
    await popup.reload();      // popup re-queries the active tab on load

    await expect(popup.locator('.rule.matched')).toHaveCount(1);
    await expect(popup.locator('.rule.matched')).toContainText('A to B');
    await expect(popup.locator('.rule.matched .match-note')).toHaveText('↪ redirects this tab');
    // matched rule sorts to the top
    await expect(popup.locator('.rule').first()).toContainText('A to B');
  } finally {
    await context.close();
    server.close();
  }
});

test('popup shows whitelist note instead of a match on whitelisted sites', async () => {
  const server = await serveText({ '/a': 'ORIGIN-A', '/b': 'TARGET-B' });
  const context = await launchWithExtension();
  try {
    const worker = await getServiceWorker(context);
    await seedRules(
      worker,
      [rule('r1', 'A to B', server.url('/a') + '*', server.url('/b'))],
      [{ id: 'w1', pattern: server.url('/a') + '*', disabled: false }],
    );
    await waitForDynamicRules(worker, 2); // redirect rule + allow rule

    const page = await context.newPage();
    await page.goto(server.url('/a'));
    await expect(page.locator('body')).toHaveText('ORIGIN-A'); // whitelist suppressed the redirect

    const extensionId = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    await popup.reload();

    await expect(popup.locator('#wl-note')).toBeVisible();
    await expect(popup.locator('.rule.matched')).toHaveCount(0);
  } finally {
    await context.close();
    server.close();
  }
});

test('popup empty state offers rule creation', async () => {
  const context = await launchWithExtension();
  try {
    const worker = await getServiceWorker(context);
    const extensionId = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await expect(popup.locator('#empty')).toBeVisible();
    await expect(popup.locator('#create-rule')).toBeVisible();
    await expect(popup.locator('#footer')).toBeHidden();
  } finally {
    await context.close();
  }
});

test('popup paused state dims list and disables per-rule toggles', async () => {
  const context = await launchWithExtension();
  try {
    const worker = await getServiceWorker(context);
    await seedRules(worker, [rule('r1', 'Twitter to Nitter', 'https://twitter.com/*', 'https://nitter.net/$1')]);
    await worker.evaluate(async () => { await chrome.storage.local.set({ disabled: true }); });

    const extensionId = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await expect(popup.locator('#paused-label')).toBeVisible();
    await expect(popup.locator('#count')).toHaveText('All redirects paused');
    await expect(popup.locator('.rule .switch input')).toBeDisabled();

    await popup.locator('header .switch').click(); // master toggle back on
    await expect(popup.locator('#count')).toHaveText('1 of 1 active');
    const disabled = await worker.evaluate(async () => (await chrome.storage.local.get('disabled')).disabled);
    expect(disabled).toBe(false);
  } finally {
    await context.close();
  }
});
