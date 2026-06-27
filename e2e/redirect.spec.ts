import { test, expect } from '@playwright/test';
import {
  launchWithExtension,
  getServiceWorker,
  serveText,
  seedRules,
  waitForDynamicRules,
} from './helpers';

function rule(partial: Record<string, unknown>) {
  return {
    id: 'e2e',
    description: '',
    patternType: 'wildcard',
    includePattern: '',
    excludePattern: '',
    redirectUrl: '',
    resourceTypes: ['main_frame'],
    disabled: false,
    example: '',
    ...partial,
  };
}

test('redirects a matching main_frame navigation', async () => {
  const context = await launchWithExtension();
  const server = await serveText({ '/from': 'FROM', '/to': 'TO' });
  try {
    const worker = await getServiceWorker(context);
    await seedRules(worker, [
      rule({ id: 'r1', includePattern: server.url('/from'), redirectUrl: server.url('/to') }),
    ]);
    await waitForDynamicRules(worker, 1);

    const page = await context.newPage();
    await page.goto(server.url('/from'));

    expect(page.url()).toBe(server.url('/to'));
    await expect(page.locator('body')).toHaveText('TO');
  } finally {
    server.close();
    await context.close();
  }
});

test('exclude pattern prevents redirect while siblings still redirect', async () => {
  const context = await launchWithExtension();
  const server = await serveText({ '/page/keep': 'KEEP', '/page/other': 'OTHER', '/dest': 'DEST' });
  try {
    const worker = await getServiceWorker(context);
    await seedRules(worker, [
      rule({
        id: 'r1',
        includePattern: server.url('/page/*'),
        excludePattern: server.url('/page/keep*'),
        redirectUrl: server.url('/dest'),
      }),
    ]);
    // One user rule with an exclude compiles to two DNR rules (redirect + allow).
    await waitForDynamicRules(worker, 2);

    const kept = await context.newPage();
    await kept.goto(server.url('/page/keep'));
    expect(kept.url()).toBe(server.url('/page/keep'));
    await expect(kept.locator('body')).toHaveText('KEEP');

    const other = await context.newPage();
    await other.goto(server.url('/page/other'));
    expect(other.url()).toBe(server.url('/dest'));
    await expect(other.locator('body')).toHaveText('DEST');
  } finally {
    server.close();
    await context.close();
  }
});
