import browser from 'webextension-polyfill';
import { getRules, setRules, getDisabled, setDisabled, getWhitelist, getSyncError } from './storage';
import { ruleMatchesUrl, whitelistMatchesUrl } from './match';
import type { Rule, WhitelistEntry } from './rule-model';

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const $i = (s: string) => document.querySelector(s) as HTMLInputElement;

let rules: Rule[] = [];
let whitelist: WhitelistEntry[] = [];
let paused = false;
let tabUrl: string | null = null;

// The tab URL is readable through the existing host permissions; on pages we
// can't read (chrome://, about:) it is simply null and nothing is highlighted.
async function activeTabUrl(): Promise<string | null> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return tab?.url ?? null;
  } catch {
    return null;
  }
}

function ruleRow(rule: Rule, index: number, matched: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'rule' + (rule.disabled ? ' off' : '') + (matched ? ' matched' : '');

  const label = document.createElement('label');
  label.className = 'switch sm';
  label.title = rule.disabled ? 'Disabled — click to enable' : 'Enabled — click to disable';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !rule.disabled;
  input.disabled = paused;
  input.setAttribute('aria-label', rule.disabled ? 'Enable rule' : 'Disable rule');
  input.addEventListener('change', async () => {
    rules[index] = { ...rules[index], disabled: !input.checked };
    await setRules(rules);
    render();
  });
  const track = document.createElement('span');
  track.className = 'track';
  label.append(input, track);

  const text = document.createElement('div');
  text.className = 'name';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = rule.description || rule.includePattern;
  text.appendChild(title);
  if (matched) {
    const note = document.createElement('span');
    note.className = 'match-note';
    note.textContent = '↪ redirects this tab';
    text.appendChild(note);
  }

  row.append(label, text);
  return row;
}

function render() {
  $i('#toggle').checked = !paused;
  document.body.classList.toggle('paused', paused);
  $('#paused-label').hidden = !paused;

  const whitelisted = !paused && tabUrl !== null && whitelist.some((w) => whitelistMatchesUrl(w, tabUrl!));
  $('#wl-note').hidden = !whitelisted;

  const empty = rules.length === 0;
  $('#empty').hidden = !empty;
  $('#footer').hidden = empty;
  const list = $('#rules');
  list.innerHTML = '';
  if (empty) return;

  const entries = rules.map((rule, index) => ({
    rule,
    index,
    matched: !paused && !whitelisted && tabUrl !== null && ruleMatchesUrl(rule, tabUrl!),
  }));
  entries.sort((a, b) => Number(b.matched) - Number(a.matched)); // stable: matched first
  for (const e of entries) list.appendChild(ruleRow(e.rule, e.index, e.matched));

  const active = rules.filter((r) => !r.disabled).length;
  $('#count').textContent = paused ? 'All redirects paused' : `${active} of ${rules.length} active`;
}

async function renderSyncError() {
  const syncError = await getSyncError();
  const box = $('#sync-error');
  box.textContent = syncError ?? '';
  box.hidden = !syncError;
}

$i('#toggle').addEventListener('change', async () => {
  paused = !$i('#toggle').checked;
  await setDisabled(paused);
  render();
});
$('#open-options').addEventListener('click', () => { void browser.runtime.openOptionsPage(); });
$('#create-rule').addEventListener('click', () => { void browser.runtime.openOptionsPage(); });

async function init() {
  [rules, paused, whitelist, tabUrl] = await Promise.all([
    getRules(), getDisabled(), getWhitelist(), activeTabUrl(),
  ]);
  render();
  void renderSyncError();
}
void init();
