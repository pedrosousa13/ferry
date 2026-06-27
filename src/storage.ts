import browser from 'webextension-polyfill';
import type { Rule } from './rule-model';

export async function getRules(): Promise<Rule[]> {
  const { rules } = await browser.storage.local.get({ rules: [] });
  return rules as Rule[];
}
export async function setRules(rules: Rule[]): Promise<void> {
  await browser.storage.local.set({ rules });
}
export async function getDisabled(): Promise<boolean> {
  const { disabled } = await browser.storage.local.get({ disabled: false });
  return disabled as boolean;
}
export async function setDisabled(disabled: boolean): Promise<void> {
  await browser.storage.local.set({ disabled });
}
