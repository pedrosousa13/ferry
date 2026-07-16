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
    await expect(page.locator('.rule')).toHaveCount(1);

    await page.click('.rule button:text-is("Disable")');
    await expect(page.locator('.rule.disabled')).toHaveCount(1);

    await page.click('.rule button:text-is("Edit")');
    await page.fill('#f-desc', 'my rule (edited)');
    await page.click('#save');

    await expect(page.locator('.rule')).toHaveCount(1);
    await expect(page.locator('.rule.disabled')).toHaveCount(1); // still disabled
    await expect(page.locator('.rule .desc')).toHaveText('my rule (edited)');
  } finally {
    await context.close();
  }
});
