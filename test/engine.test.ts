import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { rules: [] as any[], disabled: false, whitelist: [] as any[] };
const { updateDynamicRules, getDynamicRules, storageSet } = vi.hoisted(() => ({
  updateDynamicRules: vi.fn(async (_arg?: any) => {}),
  getDynamicRules: vi.fn(async () => [{ id: 99 }]),
  storageSet: vi.fn(async () => {}),
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      local: { get: vi.fn(async (defaults: any) => ({ ...defaults, ...state })), set: storageSet },
      onChanged: { addListener: vi.fn() },
    },
    declarativeNetRequest: { getDynamicRules, updateDynamicRules },
    runtime: { onInstalled: { addListener: vi.fn() }, onStartup: { addListener: vi.fn() } },
  },
}));

import { syncRules, scheduleSync } from '../src/engine';
import { createRule, createWhitelistEntry } from '../src/rule-model';

beforeEach(() => {
  updateDynamicRules.mockClear();
  storageSet.mockClear();
  updateDynamicRules.mockImplementation(async () => {});
  state.disabled = false;
  state.rules = [];
  state.whitelist = [];
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

  it('adds a whitelist allow rule alongside redirects', async () => {
    state.rules = [createRule({ id: 'a', includePattern: 'https://x/*', redirectUrl: 'https://y/$1' })];
    state.whitelist = [createWhitelistEntry({ id: 'w', pattern: 'https://x/safe/*' })];
    await syncRules();
    const arg = (updateDynamicRules.mock.calls as any)[0][0];
    expect(arg.addRules).toHaveLength(2);
    expect(arg.addRules.some((r: any) => r.action.type === 'allow')).toBe(true);
  });
});

describe('syncRules error isolation', () => {
  it('clears syncError on success', async () => {
    state.rules = [createRule({ id: 'a', includePattern: 'https://x/*', redirectUrl: 'https://y/$1' })];
    await syncRules();
    expect(storageSet).toHaveBeenCalledWith({ syncError: null });
  });

  it('falls back to per-rule adds and records which rule failed', async () => {
    state.rules = [
      createRule({ id: 'good', description: 'good', includePattern: 'https://x/*', redirectUrl: 'https://y/$1' }),
      createRule({ id: 'bad', description: 'bad rule', patternType: 'regex', includePattern: 'x(?=y)', redirectUrl: 'https://y/' }),
    ];
    updateDynamicRules.mockImplementation(async (arg: any) => {
      // Reject any call that adds the bad rule's compiled regex.
      if (arg.addRules?.some((r: any) => r.condition.regexFilter.includes('(?='))) {
        throw new Error('Rule with id 3 is invalid');
      }
    });
    await syncRules();
    // batch attempt + cleanup remove + one add per compiled rule
    expect(updateDynamicRules.mock.calls.length).toBeGreaterThanOrEqual(3);
    const errCall = storageSet.mock.calls.find((c: any[]) => typeof c[0].syncError === 'string');
    expect(errCall).toBeTruthy();
    expect((errCall as any)[0].syncError).toContain('bad rule');
  });

  it('attributes a failing whitelist-derived rule to the whitelist entry, not a redirect rule', async () => {
    state.rules = [
      createRule({ id: 'good', description: 'good redirect', includePattern: 'https://x/*', redirectUrl: 'https://y/$1' }),
    ];
    state.whitelist = [createWhitelistEntry({ id: 'w', pattern: 'https://blocked/*' })];
    updateDynamicRules.mockImplementation(async (arg: any) => {
      // Reject only the whitelist allow rule.
      if (arg.addRules?.some((r: any) => r.action.type === 'allow')) {
        throw new Error('Rule with id 3 is invalid');
      }
    });
    await syncRules();
    const errCall = storageSet.mock.calls.find((c: any[]) => typeof c[0].syncError === 'string');
    expect(errCall).toBeTruthy();
    expect((errCall as any)[0].syncError).toContain('whitelist: https://blocked/*');
    expect((errCall as any)[0].syncError).not.toContain('good redirect');
  });

  it('clears syncError when the batch fails transiently but every per-rule add succeeds', async () => {
    state.rules = [createRule({ id: 'a', includePattern: 'https://x/*', redirectUrl: 'https://y/$1' })];
    let firstBatch = true;
    updateDynamicRules.mockImplementation(async (arg: any) => {
      // Fail the initial batch (non-empty addRules) once, as a transient error;
      // every subsequent per-rule add succeeds.
      if (firstBatch && arg.addRules?.length) {
        firstBatch = false;
        throw new Error('transient failure');
      }
    });
    await syncRules();
    const calls = storageSet.mock.calls as any[];
    expect(calls[calls.length - 1][0]).toEqual({ syncError: null });
  });
});

describe('scheduleSync', () => {
  it('serializes overlapping syncs', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    updateDynamicRules.mockImplementation(async () => {
      order.push('start');
      await gate; // resolved for all calls once released; only the first call actually blocks
      order.push('end');
    });
    const first = scheduleSync();
    const second = scheduleSync();
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['start']); // second sync must not start while the first is blocked
    release();
    await first;
    await second;
    // Both syncs ran, strictly one after the other: start/end pairs never interleave.
    expect(order.filter((x) => x === 'start')).toHaveLength(order.filter((x) => x === 'end').length);
    for (let i = 0; i < order.length; i += 2) {
      expect(order[i]).toBe('start');
      expect(order[i + 1]).toBe('end');
    }
  });
});
