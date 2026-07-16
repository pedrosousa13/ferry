import browser from 'webextension-polyfill';
import { compile } from './compiler';
import type { Rule, WhitelistEntry } from './rule-model';

// webextension-polyfill's types don't fully cover declarativeNetRequest; cast narrowly.
const dnr = (browser as any).declarativeNetRequest;

// compile() lays out ids as: redirect/exclude rules take 1..2n (two ids per
// source rule, n = enabled.length), then whitelist allow rules take
// 2n+1.. (one id per enabled whitelist entry). Map a compiled rule's id back
// to the human-readable source it came from, without misattributing
// whitelist-derived ids to redirect rules.
function attributedName(id: number, n: number, enabled: Rule[], enabledWhitelist: WhitelistEntry[]): string | undefined {
  if (id <= 2 * n) {
    const source = enabled[Math.floor((id - 1) / 2)];
    return source ? source.description || source.includePattern : undefined;
  }
  const entry = enabledWhitelist[id - (2 * n + 1)];
  return entry ? `whitelist: ${entry.pattern}` : undefined;
}

export async function syncRules(): Promise<void> {
  const data = await browser.storage.local.get({ rules: [], disabled: false, whitelist: [] });
  const rules = data.rules as Rule[];
  const disabled = data.disabled as boolean;
  const whitelist = data.whitelist as WhitelistEntry[];
  const enabled = rules.filter((r) => !r.disabled);
  const enabledWhitelist = whitelist.filter((w) => !w.disabled);
  const desired = disabled ? [] : compile(rules, whitelist);
  const existing = await dnr.getDynamicRules();
  const removeRuleIds = existing.map((r: { id: number }) => r.id);
  try {
    await dnr.updateDynamicRules({ removeRuleIds, addRules: desired });
    await browser.storage.local.set({ syncError: null });
  } catch {
    // updateDynamicRules is atomic: one bad rule fails the whole batch. Retry
    // rule-by-rule so the good rules still load, and record what was rejected.
    await dnr.updateDynamicRules({ removeRuleIds, addRules: [] });
    const failed: string[] = [];
    for (const d of desired) {
      try {
        await dnr.updateDynamicRules({ addRules: [d] });
      } catch {
        const name = attributedName(d.id, enabled.length, enabled, enabledWhitelist);
        if (name && !failed.includes(name)) failed.push(name);
      }
    }
    const names = failed.join(', ');
    await browser.storage.local.set({
      syncError: failed.length
        ? `The browser rejected ${failed.length} rule(s): ${names}. The remaining rules are active.`
        : null,
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
  if (area === 'local' && (changes.rules || changes.disabled || changes.whitelist)) void scheduleSync();
});
