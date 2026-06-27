import browser from 'webextension-polyfill';
import { getRules, getDisabled, setDisabled } from './storage';

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const toggle = () => document.querySelector('#toggle') as HTMLInputElement;

async function render() {
  const [rules, disabled] = await Promise.all([getRules(), getDisabled()]);
  const active = rules.filter((r) => !r.disabled).length;
  toggle().checked = !disabled;
  $('#status').textContent = disabled
    ? 'Ferry is off'
    : `Ferry is on — ${active} active rule${active === 1 ? '' : 's'}`;
}

toggle().addEventListener('change', async () => {
  await setDisabled(!toggle().checked);
  await render();
});
$('#open-options').addEventListener('click', () => { void browser.runtime.openOptionsPage(); });

void render();
