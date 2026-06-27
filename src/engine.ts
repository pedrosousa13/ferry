import browser from 'webextension-polyfill';
import { compile } from './compiler';
import type { Rule } from './rule-model';

// webextension-polyfill's types don't fully cover declarativeNetRequest; cast narrowly.
const dnr = (browser as any).declarativeNetRequest;

export async function syncRules(): Promise<void> {
  const data = await browser.storage.local.get({ rules: [], disabled: false });
  const rules = data.rules as Rule[];
  const disabled = data.disabled as boolean;
  const desired = disabled ? [] : compile(rules);
  const existing = await dnr.getDynamicRules();
  await dnr.updateDynamicRules({
    removeRuleIds: existing.map((r: { id: number }) => r.id),
    addRules: desired,
  });
}

browser.runtime.onInstalled.addListener(() => { void syncRules(); });
browser.runtime.onStartup.addListener(() => { void syncRules(); });
browser.storage.onChanged.addListener((changes: any, area: string) => {
  if (area === 'local' && (changes.rules || changes.disabled)) void syncRules();
});
