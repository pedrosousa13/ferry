import { test, expect } from '@playwright/test';
import { launchWithExtension, getServiceWorker, seedRules, waitForDynamicRules, serveText } from './helpers';

// Seeding storage bypasses form validation, exactly like a legacy/hand-edited
// rule set: the engine must keep the good rule working and surface the bad one.
test('a browser-rejected rule does not take down the others and is surfaced', async () => {
  const server = await serveText({ '/a': 'ORIGIN-A', '/b': 'TARGET-B' });
  const context = await launchWithExtension();
  try {
    const worker = await getServiceWorker(context);
    await seedRules(worker, [
      {
        id: 'bad', description: 'bad lookahead rule', patternType: 'regex',
        includePattern: 'nomatch(?=never)', excludePattern: '',
        redirectUrl: 'https://example.invalid/', resourceTypes: ['main_frame'], disabled: false, example: '',
      },
      {
        id: 'good', description: 'good rule', patternType: 'wildcard',
        includePattern: server.url('/a') + '*', excludePattern: '',
        redirectUrl: server.url('/b'), resourceTypes: ['main_frame'], disabled: false, example: '',
      },
    ]);
    await waitForDynamicRules(worker, 1); // only the good rule loads

    const page = await context.newPage();
    await page.goto(server.url('/a'));
    await expect(page.locator('body')).toHaveText('TARGET-B');

    const extensionId = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator('#sync-error')).toBeVisible();
    await expect(popup.locator('#sync-error')).toContainText('bad lookahead rule');
  } finally {
    await context.close();
    server.close();
  }
});
