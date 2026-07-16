import { test, expect } from '@playwright/test';
import { launchWithExtension, getServiceWorker } from './helpers';

test('editing a disabled rule keeps it disabled', async () => {
  const context = await launchWithExtension();
  try {
    const worker = await getServiceWorker(context);
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);

    await page.fill('#f-desc', 'my rule');
    await page.fill('#f-include', 'https://a.example/*');
    await page.fill('#f-redirect', 'https://b.example/$1');
    await page.click('#save');
    await expect(page.locator('.rule-card')).toHaveCount(1);

    await page.click('.rule-card .switch');
    await expect(page.locator('.rule-card.disabled')).toHaveCount(1);

    await page.click('.rule-card button[aria-label="Edit"]');
    await page.fill('#f-desc', 'my rule (edited)');
    await page.click('#save');

    await expect(page.locator('.rule-card')).toHaveCount(1);
    await expect(page.locator('.rule-card.disabled')).toHaveCount(1); // still disabled
    await expect(page.locator('.rule-card__title')).toHaveText('my rule (edited)');
  } finally {
    await context.close();
  }
});
