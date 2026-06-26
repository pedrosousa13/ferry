import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { rules: [] as any[], disabled: false };
const { updateDynamicRules, getDynamicRules } = vi.hoisted(() => ({
  updateDynamicRules: vi.fn(async () => {}),
  getDynamicRules: vi.fn(async () => [{ id: 99 }]),
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      local: { get: vi.fn(async (defaults: any) => ({ ...defaults, ...state })) },
      onChanged: { addListener: vi.fn() },
    },
    declarativeNetRequest: { getDynamicRules, updateDynamicRules },
    runtime: { onInstalled: { addListener: vi.fn() }, onStartup: { addListener: vi.fn() } },
  },
}));

import { syncRules } from '../src/engine';
import { createRule } from '../src/rule-model';

beforeEach(() => {
  updateDynamicRules.mockClear();
  state.disabled = false;
  state.rules = [];
});

describe('syncRules', () => {
  it('removes existing rules and adds compiled rules', async () => {
    state.rules = [createRule({ id: 'a', includePattern: 'https://x/*', redirectUrl: 'https://y/$1' })];
    await syncRules();
    expect(updateDynamicRules).toHaveBeenCalledTimes(1);
    const arg = (updateDynamicRules.mock.calls as any)[0][0];
    expect(arg.removeRuleIds).toEqual([99]);
    expect(arg.addRules).toHaveLength(1);
    expect(arg.addRules[0].action.type).toBe('redirect');
  });

  it('clears all rules when disabled', async () => {
    state.disabled = true;
    state.rules = [createRule({ id: 'a', includePattern: 'https://x/*', redirectUrl: 'https://y/$1' })];
    await syncRules();
    const arg = (updateDynamicRules.mock.calls as any)[0][0];
    expect(arg.removeRuleIds).toEqual([99]);
    expect(arg.addRules).toEqual([]);
  });
});
