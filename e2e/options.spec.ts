import { test, expect } from '@playwright/test';
import { launchWithExtension, getServiceWorker } from './helpers';

test('editing a disabled rule keeps it disabled', async () => {
  const context = await launchWithExtension();
  try {
    const worker = await getServiceWorker(context);
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);

    await page.click('#add-rule');
    await page.fill('#f-desc', 'my rule');
    await page.fill('#f-include', 'https://a.example/*');
    await page.fill('#f-redirect', 'https://b.example/$1');
    await page.click('#save');
    await expect(page.locator('#rule-dialog')).toBeHidden();
    await expect(page.locator('.rule-card')).toHaveCount(1);

    await page.click('.rule-card .switch');
    await expect(page.locator('.rule-card.disabled')).toHaveCount(1);

    await page.click('.rule-card button[aria-label="Edit"]');
    await expect(page.locator('#rule-dialog')).toBeVisible();
    await expect(page.locator('#dialog-title')).toHaveText('Edit rule — my rule');
    await page.fill('#f-desc', 'my rule (edited)');
    await page.click('#save');

    await expect(page.locator('.rule-card')).toHaveCount(1);
    await expect(page.locator('.rule-card.disabled')).toHaveCount(1); // still disabled
    await expect(page.locator('.rule-card__title')).toHaveText('my rule (edited)');
  } finally {
    await context.close();
  }
});

test('cancel closes the dialog without saving', async () => {
  const context = await launchWithExtension();
  try {
    const worker = await getServiceWorker(context);
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);

    await page.click('#add-rule');
    await expect(page.locator('#dialog-title')).toHaveText('Add rule');
    await page.fill('#f-desc', 'abandoned rule');
    await page.fill('#f-include', 'https://a.example/*');
    await page.fill('#f-redirect', 'https://b.example/$1');
    await page.click('#cancel');
    await expect(page.locator('#rule-dialog')).toBeHidden();
    await expect(page.locator('.rule-card')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('dragging a rule card reorders and persists', async () => {
  const context = await launchWithExtension();
  try {
    const worker = await getServiceWorker(context);
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);

    for (const [desc, include] of [['first', 'https://a.example/*'], ['second', 'https://b.example/*']]) {
      await page.click('#add-rule');
      await page.fill('#f-desc', desc);
      await page.fill('#f-include', include);
      await page.fill('#f-redirect', 'https://c.example/$1');
      await page.click('#save');
      await expect(page.locator('#rule-dialog')).toBeHidden();
    }
    await expect(page.locator('.rule-card__title')).toHaveText(['first', 'second']);

    await page.locator('.rule-card').nth(1).dragTo(page.locator('.rule-card').nth(0));
    await expect(page.locator('.rule-card__title')).toHaveText(['second', 'first']);

    await page.reload();
    await expect(page.locator('.rule-card__title')).toHaveText(['second', 'first']); // persisted
  } finally {
    await context.close();
  }
});

test('filter narrows the rules list and disables reordering', async () => {
  const context = await launchWithExtension();
  try {
    const worker = await getServiceWorker(context);
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);

    for (const [desc, include] of [['Twitter to Nitter', 'https://twitter.com/*'], ['YouTube to Invidious', 'https://youtube.com/*']]) {
      await page.click('#add-rule');
      await page.fill('#f-desc', desc);
      await page.fill('#f-include', include);
      await page.fill('#f-redirect', 'https://c.example/$1');
      await page.click('#save');
      await expect(page.locator('#rule-dialog')).toBeHidden();
    }

    await page.fill('#filter', 'nitter');
    await expect(page.locator('.rule-card')).toHaveCount(1);
    await expect(page.locator('.rule-card__title')).toHaveText('Twitter to Nitter');
    await expect(page.locator('#filter-count')).toHaveText('1 of 2 rules');
    await expect(page.locator('.rule-card button[aria-label="Move up"]')).toHaveCount(0);
    await expect(page.locator('.rule-card[draggable="true"]')).toHaveCount(0);

    // matches pattern text too, not just descriptions
    await page.fill('#filter', 'youtube.com');
    await expect(page.locator('.rule-card__title')).toHaveText('YouTube to Invidious');

    await page.fill('#filter', '');
    await expect(page.locator('.rule-card')).toHaveCount(2);
    await expect(page.locator('#filter-count')).toBeHidden();
    await expect(page.locator('.rule-card[draggable="true"]')).toHaveCount(2);
  } finally {
    await context.close();
  }
});
