import { Rule, createRule, validateRule, ALL_RESOURCE_TYPES, ResourceType } from './rule-model';
import { getRules, setRules } from './storage';
import { compile } from './compiler';
import { parseImport } from './import';

let rules: Rule[] = [];
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const $i = (sel: string) => document.querySelector(sel) as HTMLInputElement;

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function renderResourceTypes() {
  const box = $('#rtypes');
  box.innerHTML = '';
  for (const t of ALL_RESOURCE_TYPES) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.name = 'rtype';
    cb.value = t;
    cb.checked = t === 'main_frame';
    label.append(cb, document.createTextNode(' ' + t));
    box.appendChild(label);
  }
}

function render() {
  const list = $('#rules');
  list.innerHTML = '';
  rules.forEach((rule, i) => {
    const row = document.createElement('div');
    row.className = 'rule' + (rule.disabled ? ' disabled' : '');
    const desc = document.createElement('span');
    desc.className = 'desc';
    desc.textContent = rule.description || '(unnamed)';
    const code = document.createElement('code');
    code.textContent = `${rule.includePattern} → ${rule.redirectUrl}`;
    row.append(
      desc, code,
      button('↑', () => move(i, -1)),
      button('↓', () => move(i, 1)),
      button(rule.disabled ? 'Enable' : 'Disable', () => toggle(i)),
      button('Edit', () => edit(i)),
      button('Delete', () => del(i)),
    );
    list.appendChild(row);
  });
}

async function persist() { await setRules(rules); render(); }
function move(i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= rules.length) return;
  [rules[i], rules[j]] = [rules[j], rules[i]];
  void persist();
}
function toggle(i: number) { rules[i] = { ...rules[i], disabled: !rules[i].disabled }; void persist(); }
function del(i: number) { rules.splice(i, 1); void persist(); }

function checkedResourceTypes(): ResourceType[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[name="rtype"]:checked'))
    .map((el) => el.value as ResourceType);
}

function readForm(): Rule {
  return createRule({
    id: $i('#rule-id').value || undefined,
    description: $i('#f-desc').value,
    patternType: ($i('#f-type') as unknown as HTMLSelectElement).value as Rule['patternType'],
    includePattern: $i('#f-include').value,
    excludePattern: $i('#f-exclude').value,
    redirectUrl: $i('#f-redirect').value,
    resourceTypes: checkedResourceTypes(),
    example: $i('#f-example').value,
  });
}

function fillForm(rule: Rule) {
  $i('#rule-id').value = rule.id;
  $i('#f-desc').value = rule.description;
  ($i('#f-type') as unknown as HTMLSelectElement).value = rule.patternType;
  $i('#f-include').value = rule.includePattern;
  $i('#f-exclude').value = rule.excludePattern;
  $i('#f-redirect').value = rule.redirectUrl;
  $i('#f-example').value = rule.example;
  document.querySelectorAll<HTMLInputElement>('input[name="rtype"]').forEach((el) => {
    el.checked = rule.resourceTypes.includes(el.value as ResourceType);
  });
}

function edit(i: number) { fillForm(rules[i]); $('#form').scrollIntoView(); }

function resetForm() {
  $i('#rule-id').value = '';
  ['#f-desc', '#f-include', '#f-exclude', '#f-redirect', '#f-example'].forEach((s) => ($i(s).value = ''));
  ($i('#f-type') as unknown as HTMLSelectElement).value = 'wildcard';
  document.querySelectorAll<HTMLInputElement>('input[name="rtype"]').forEach((el) => (el.checked = el.value === 'main_frame'));
  $('#test-result').textContent = '';
  $('#form-errors').textContent = '';
}

function save() {
  const rule = readForm();
  const errors = validateRule(rule);
  if (errors.length) { $('#form-errors').textContent = errors.join(' '); return; }
  $('#form-errors').textContent = '';
  const idx = rules.findIndex((r) => r.id === rule.id);
  if (idx >= 0) rules[idx] = rule; else rules.push(rule);
  void persist();
  resetForm();
}

function test() {
  const rule = readForm();
  const errors = validateRule(rule);
  if (errors.length) { $('#test-result').textContent = errors.join(' '); return; }
  const example = $i('#f-example').value;
  if (!example) { $('#test-result').textContent = 'Enter an example URL to test.'; return; }
  const dnr = compile([rule]).find((r) => r.action.type === 'redirect');
  if (!dnr) { $('#test-result').textContent = 'No redirect produced.'; return; }
  if (!dnr.condition.regexFilter) { $('#test-result').textContent = 'No pattern to test.'; return; }
  try {
    const m = example.match(new RegExp(dnr.condition.regexFilter));
    if (!m) { $('#test-result').textContent = 'No match for the example URL.'; return; }
    const sub = (dnr.action as { redirect: { regexSubstitution: string } }).redirect.regexSubstitution;
    const result = sub.replace(/\\(\d)/g, (_, d: string) => m[Number(d)] ?? '');
    $('#test-result').textContent = '→ ' + result;
  } catch {
    $('#test-result').textContent = 'Invalid pattern.';
  }
}

function exportRules() {
  const blob = new Blob([JSON.stringify({ createdBy: 'Ferry', redirects: rules }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ferry-rules.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importRules(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  let data: unknown;
  try { data = JSON.parse(await file.text()); } catch { $('#import-msg').textContent = 'Invalid JSON.'; return; }
  const result = parseImport(data);
  input.value = ''; // allow re-importing the same file
  if (result.error) { $('#import-msg').textContent = result.error; return; }
  rules.push(...result.rules);
  await persist();
  const parts = [`Imported ${result.rules.length} rule(s).`];
  if (result.skippedTransforms) {
    parts.push(`Skipped ${result.skippedTransforms} rule(s) that need transforms (base64 / URL decode), which Ferry can't perform.`);
  }
  if (result.skippedInvalid) parts.push(`Skipped ${result.skippedInvalid} invalid rule(s).`);
  $('#import-msg').textContent = parts.join(' ');
}

function init() {
  renderResourceTypes();
  $('#save').addEventListener('click', save);
  $('#test').addEventListener('click', test);
  $('#reset').addEventListener('click', resetForm);
  $('#export').addEventListener('click', exportRules);
  $i('#import').addEventListener('change', importRules);
  void getRules().then((r) => { rules = r; render(); });
}

init();
