import browser from 'webextension-polyfill';
import { compile } from './compiler';
import type { Rule } from './rule-model';

// webextension-polyfill's types don't fully cover declarativeNetRequest; cast narrowly.
const dnr = (browser as any).declarativeNetRequest;

export async function syncRules(): Promise<void> {
  const data = await browser.storage.local.get({ rules: [], disabled: false });
  const rules = data.rules as Rule[];
  const disabled = data.disabled as boolean;
  const enabled = rules.filter((r) => !r.disabled);
  const desired = disabled ? [] : compile(rules);
  const existing = await dnr.getDynamicRules();
  const removeRuleIds = existing.map((r: { id: number }) => r.id);
  try {
    await dnr.updateDynamicRules({ removeRuleIds, addRules: desired });
    await browser.storage.local.set({ syncError: null });
  } catch {
    // updateDynamicRules is atomic: one bad rule fails the whole batch. Retry
    // rule-by-rule so the good rules still load, and record what was rejected.
    await dnr.updateDynamicRules({ removeRuleIds, addRules: [] });
    const failed: Rule[] = [];
    for (const d of desired) {
      try {
        await dnr.updateDynamicRules({ addRules: [d] });
      } catch {
        const source = enabled[Math.floor((d.id - 1) / 2)];
        if (source && !failed.includes(source)) failed.push(source);
      }
    }
    const names = failed.map((r) => r.description || r.includePattern).join(', ');
    await browser.storage.local.set({
      syncError: `The browser rejected ${failed.length} rule(s): ${names}. The remaining rules are active.`,
    });
  }
}

// storage.onChanged can fire in quick succession (popup toggle + options save);
// concurrent syncs would both read the same DNR snapshot and collide on ids.
let queue: Promise<void> = Promise.resolve();
export function scheduleSync(): Promise<void> {
  queue = queue.then(() => syncRules()).catch(() => {});
  return queue;
}

browser.runtime.onInstalled.addListener(() => { void scheduleSync(); });
browser.runtime.onStartup.addListener(() => { void scheduleSync(); });
browser.storage.onChanged.addListener((changes: any, area: string) => {
  if (area === 'local' && (changes.rules || changes.disabled)) void scheduleSync();
});
