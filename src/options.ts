import browser from 'webextension-polyfill';
import { Rule, createRule, validateRule, ALL_RESOURCE_TYPES, ResourceType, WhitelistEntry, createWhitelistEntry, validateWhitelistEntry } from './rule-model';
import { getRules, setRules, getDisabled, setDisabled, getWhitelist, setWhitelist, getSyncError } from './storage';
import { compile, lintRule } from './compiler';
import { parseImport } from './import';

let rules: Rule[] = [];
let dragIndex: number | null = null;
let masterDisabled = false;
let whitelist: WhitelistEntry[] = [];
let filterQuery = '';

function filterMatches(rule: Rule, q: string): boolean {
  return [rule.description, rule.includePattern, rule.excludePattern, rule.redirectUrl]
    .some((s) => s.toLowerCase().includes(q));
}
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const $i = (sel: string) => document.querySelector(sel) as HTMLInputElement;

const ruleDialog = () => document.querySelector('#rule-dialog') as HTMLDialogElement;

function openDialog(rule?: Rule) {
  resetForm();
  if (rule) {
    fillForm(rule);
    $('#dialog-title').textContent = `Edit rule — ${rule.description || 'Unnamed rule'}`;
  } else {
    $('#dialog-title').textContent = 'Add rule';
  }
  ruleDialog().showModal();
}

function closeDialog() { ruleDialog().close(); }

interface ResourceMeta { label: string; hint: string; short: string; advanced: boolean; }

const RESOURCE_TYPE_META: Record<ResourceType, ResourceMeta> = {
  main_frame:     { label: 'Page (top-level)',       hint: 'The URL in the address bar. Redirects the whole tab. Most rules only need this.', short: 'Page',    advanced: false },
  sub_frame:      { label: 'Embedded frames',        hint: 'Pages inside the page — iframes, embeds, ads.',                                   short: 'Frames',  advanced: false },
  xmlhttprequest: { label: 'API / network requests', hint: 'Background fetch & XHR calls.',                                                   short: 'API',     advanced: true },
  script:         { label: 'Scripts',                hint: 'JavaScript files.',                                                               short: 'Scripts', advanced: true },
  stylesheet:     { label: 'Stylesheets',            hint: 'CSS files.',                                                                      short: 'Styles',  advanced: true },
  image:          { label: 'Images',                 hint: 'Image files.',                                                                    short: 'Images',  advanced: true },
  media:          { label: 'Media',                  hint: 'Audio & video.',                                                                  short: 'Media',   advanced: true },
  font:           { label: 'Fonts',                  hint: 'Web font files.',                                                                 short: 'Fonts',   advanced: true },
  websocket:      { label: 'WebSockets',             hint: 'Live socket connections.',                                                        short: 'WS',      advanced: true },
  ping:           { label: 'Pings',                  hint: 'Link-click tracking beacons.',                                                    short: 'Ping',    advanced: true },
  object:         { label: 'Plugins',                hint: '<object> / <embed> content.',                                                     short: 'Plugins', advanced: true },
  other:          { label: 'Other',                  hint: 'Anything else.',                                                                  short: 'Other',   advanced: true },
};

const ICONS: Record<string, string> = {
  up:     '<path d="M8 12V4M4 8l4-4 4 4"/>',
  down:   '<path d="M8 4v8M4 8l4 4 4-4"/>',
  edit:   '<path d="M11 3l2 2-7 7-3 1 1-3z"/>',
  delete: '<path d="M3 5h10M6 5V3h4v2M5 5l1 8h4l1-8"/>',
};

function svg(name: string): string {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

function iconButton(name: string, label: string, onClick: () => void, opts: { danger?: boolean; disabled?: boolean } = {}): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'icon-btn' + (opts.danger ? ' danger' : '');
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = svg(name);
  if (opts.disabled) b.disabled = true;
  else b.addEventListener('click', onClick);
  return b;
}

function rtypeRow(t: ResourceType): HTMLLabelElement {
  const meta = RESOURCE_TYPE_META[t];
  const label = document.createElement('label');
  label.className = 'rtype';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.name = 'rtype';
  cb.value = t;
  cb.checked = t === 'main_frame';
  const text = document.createElement('span');
  const labelSpan = document.createElement('span');
  labelSpan.className = 'rtype__label';
  labelSpan.textContent = meta.label;
  const hintSpan = document.createElement('span');
  hintSpan.className = 'rtype__hint';
  hintSpan.textContent = meta.hint;
  text.append(labelSpan, hintSpan);
  label.append(cb, text);
  return label;
}

function setAllResourceTypes(checked: boolean) {
  document.querySelectorAll<HTMLInputElement>('input[name="rtype"]').forEach((el) => (el.checked = checked));
}

function renderResourceTypes() {
  const box = $('#rtypes');
  box.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'rtypes__head';
  head.innerHTML = '<span class="label">Apply to request types</span>';
  const tools = document.createElement('div');
  tools.className = 'rtypes__tools';
  const all = document.createElement('button');
  all.type = 'button'; all.className = 'linkbtn'; all.textContent = 'Select all';
  all.addEventListener('click', () => setAllResourceTypes(true));
  const clear = document.createElement('button');
  clear.type = 'button'; clear.className = 'linkbtn'; clear.textContent = 'Clear';
  clear.addEventListener('click', () => setAllResourceTypes(false));
  tools.append(all, clear);
  head.appendChild(tools);
  box.appendChild(head);

  for (const t of ALL_RESOURCE_TYPES.filter((x) => !RESOURCE_TYPE_META[x].advanced)) {
    box.appendChild(rtypeRow(t));
  }

  const details = document.createElement('details');
  details.className = 'rtypes-advanced';
  const summary = document.createElement('summary');
  summary.textContent = 'Advanced request types';
  const grid = document.createElement('div');
  grid.className = 'rtypes-advanced__grid';
  for (const t of ALL_RESOURCE_TYPES.filter((x) => RESOURCE_TYPE_META[x].advanced)) {
    grid.appendChild(rtypeRow(t));
  }
  details.append(summary, grid);
  box.appendChild(details);
}

function typeBadges(types: ResourceType[]): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'badge-group';
  wrap.style.display = 'contents';
  if (types.length === ALL_RESOURCE_TYPES.length) {
    const b = document.createElement('span');
    b.className = 'badge'; b.textContent = 'All types';
    wrap.appendChild(b);
    return wrap;
  }
  const shown = types.slice(0, 3);
  for (const t of shown) {
    const b = document.createElement('span');
    b.className = 'badge';
    b.textContent = RESOURCE_TYPE_META[t]?.short ?? t;
    wrap.appendChild(b);
  }
  if (types.length > shown.length) {
    const more = document.createElement('span');
    more.className = 'badge';
    more.textContent = `+${types.length - shown.length}`;
    wrap.appendChild(more);
  }
  return wrap;
}

function toggleSwitch(rule: Rule, i: number): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'switch';
  wrap.title = rule.disabled ? 'Disabled — click to enable' : 'Enabled — click to disable';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !rule.disabled;
  input.setAttribute('aria-label', rule.disabled ? 'Enable rule' : 'Disable rule');
  input.addEventListener('change', () => toggle(i));
  const track = document.createElement('span');
  track.className = 'track';
  wrap.append(input, track);
  return wrap;
}

function ruleCard(rule: Rule, i: number): HTMLElement {
  const card = document.createElement('div');
  card.className = 'rule-card' + (rule.disabled ? ' disabled' : '');

  const title = document.createElement('div');
  title.className = 'rule-card__title';
  title.textContent = rule.description || '';
  if (!rule.description) title.innerHTML = '<span class="unnamed">Unnamed rule</span>';

  const flow = document.createElement('div');
  flow.className = 'rule-card__flow';
  const inc = document.createElement('span'); inc.textContent = rule.includePattern;
  const arr = document.createElement('span'); arr.className = 'arrow'; arr.textContent = '→';
  const red = document.createElement('span'); red.textContent = rule.redirectUrl;
  flow.append(inc, arr, red);

  const badges = document.createElement('div');
  badges.className = 'rule-card__badges';
  const typePill = document.createElement('span');
  typePill.className = 'badge type-pill';
  typePill.textContent = rule.patternType === 'regex' ? 'Regex' : 'Wildcard';
  badges.append(typePill, typeBadges(rule.resourceTypes));

  const warnings = lintRule(rule);
  if (warnings.length) {
    const warn = document.createElement('span');
    warn.className = 'badge warn';
    warn.textContent = `⚠ ${warnings.length}`;
    warn.title = warnings.join('\n');
    badges.append(warn);
  }

  const filtering = filterQuery.trim().length > 0;
  card.draggable = !filtering;

  const actions = document.createElement('div');
  actions.className = 'rule-card__actions';
  if (!filtering) {
    actions.append(
      iconButton('up', 'Move up', () => move(i, -1), { disabled: i === 0 }),
      iconButton('down', 'Move down', () => move(i, 1), { disabled: i === rules.length - 1 }),
    );
  }
  actions.append(
    iconButton('edit', 'Edit', () => edit(i)),
    iconButton('delete', 'Delete', () => del(i), { danger: true }),
  );

  card.addEventListener('dragstart', (e) => {
    dragIndex = i;
    card.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(i)); // Firefox needs data for DnD to start
    }
  });
  card.addEventListener('dragend', () => {
    dragIndex = null;
    card.classList.remove('dragging');
    document.querySelectorAll('.rule-card.drop-target').forEach((el) => el.classList.remove('drop-target'));
  });
  card.addEventListener('dragover', (e) => {
    if (dragIndex === null || dragIndex === i) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    card.classList.add('drop-target');
  });
  card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
  card.addEventListener('drop', (e) => {
    if (dragIndex === null || dragIndex === i) return;
    e.preventDefault();
    const [moved] = rules.splice(dragIndex, 1);
    rules.splice(i, 0, moved);
    dragIndex = null;
    void persist();
  });

  card.append(title, toggleSwitch(rule, i), flow, badges, actions);
  return card;
}

function renderControlBar() {
  const bar = $('#control-bar');
  ($i('#master-toggle')).checked = !masterDisabled;
  const active = rules.filter((r) => !r.disabled).length;
  bar.classList.toggle('off', masterDisabled);
  $('#control-state').textContent = masterDisabled ? 'Ferry is paused' : 'Ferry is on';
  $('#control-sub').textContent = masterDisabled
    ? 'All rules are temporarily off. Nothing is being redirected.'
    : `${active} active rule${active === 1 ? '' : 's'} of ${rules.length}.`;
}

function render() {
  renderControlBar();
  const list = $('#rules');
  list.classList.toggle('paused', masterDisabled);
  list.innerHTML = '';
  const q = filterQuery.trim().toLowerCase();
  const visible = rules.map((rule, i) => ({ rule, i })).filter(({ rule }) => !q || filterMatches(rule, q));
  const count = $('#filter-count');
  count.hidden = !q;
  if (q) count.textContent = `${visible.length} of ${rules.length} rules`;
  if (rules.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<strong>No redirect rules yet</strong>Add your first rule with the button above.';
    list.appendChild(empty);
    return;
  }
  visible.forEach(({ rule, i }) => list.appendChild(ruleCard(rule, i)));
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

function edit(i: number) { openDialog(rules[i]); }

function setChip(sel: string, text: string, kind: 'ok' | 'bad' | 'warn') {
  const el = $(sel);
  el.textContent = text;
  el.className = 'chip show ' + kind;
}
function clearChip(sel: string) { const el = $(sel); el.textContent = ''; el.className = 'chip'; }

function resetForm() {
  $i('#rule-id').value = '';
  ['#f-desc', '#f-include', '#f-exclude', '#f-redirect', '#f-example'].forEach((s) => ($i(s).value = ''));
  ($i('#f-type') as unknown as HTMLSelectElement).value = 'wildcard';
  document.querySelectorAll<HTMLInputElement>('input[name="rtype"]').forEach((el) => (el.checked = el.value === 'main_frame'));
  clearChip('#test-result');
  clearChip('#form-warnings');
  $('#form-errors').textContent = '';
}

function save() {
  const rule = readForm();
  const errors = validateRule(rule);
  if (errors.length) { $('#form-errors').textContent = errors.join(' '); return; }
  $('#form-errors').textContent = '';
  const warnings = lintRule(rule);
  const idx = rules.findIndex((r) => r.id === rule.id);
  if (idx >= 0) rules[idx] = { ...rule, disabled: rules[idx].disabled }; else rules.push(rule);
  void persist();
  if (warnings.length) {
    setChip('#form-warnings', 'Saved, but: ' + warnings.join(' '), 'warn');
  } else {
    resetForm();
    closeDialog();
  }
}

function test() {
  const rule = readForm();
  const errors = validateRule(rule);
  if (errors.length) { setChip('#test-result', errors.join(' '), 'bad'); clearChip('#form-warnings'); return; }
  const warnings = lintRule(rule);
  if (warnings.length) setChip('#form-warnings', warnings.join(' '), 'warn'); else clearChip('#form-warnings');
  const example = $i('#f-example').value;
  if (!example) { setChip('#test-result', 'Enter an example URL to test.', 'bad'); return; }
  const dnr = compile([rule]).find((r) => r.action.type === 'redirect');
  if (!dnr) { setChip('#test-result', 'No redirect produced.', 'bad'); return; }
  if (!dnr.condition.regexFilter) { setChip('#test-result', 'No pattern to test.', 'bad'); return; }
  try {
    const m = example.match(new RegExp(dnr.condition.regexFilter));
    if (!m) { setChip('#test-result', 'No match for the example URL.', 'bad'); return; }
    const sub = (dnr.action as { redirect: { regexSubstitution: string } }).redirect.regexSubstitution;
    const result = sub.replace(/\\(\d)/g, (_, d: string) => m[Number(d)] ?? '');
    setChip('#test-result', '→ ' + result, 'ok');
  } catch {
    setChip('#test-result', 'Invalid pattern.', 'bad');
  }
}

function exportRules() {
  const blob = new Blob([JSON.stringify({ createdBy: 'Ferry', redirects: rules, whitelist }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ferry-rules.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function setImportMsg(text: string, bad = false) {
  const el = $('#import-msg');
  el.textContent = text;
  el.className = bad ? 'bad' : '';
}

function ruleSignature(r: Rule): string {
  return [r.patternType, r.includePattern, r.excludePattern, r.redirectUrl, [...r.resourceTypes].sort().join(',')].join('|');
}

interface Choice { label: string; value: string; primary?: boolean; }

function askModal(title: string, body: string, choices: Choice[]): Promise<string> {
  return new Promise((resolve) => {
    const modal = $('#modal');
    $('#modal-title').textContent = title;
    $('#modal-body').textContent = body;
    const actions = $('#modal-actions');
    actions.innerHTML = '';
    let done = false;
    const close = (val: string) => {
      if (done) return;
      done = true;
      modal.classList.remove('show');
      document.removeEventListener('keydown', onKey);
      modal.removeEventListener('click', onBackdrop);
      resolve(val);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close('cancel'); };
    const onBackdrop = (e: MouseEvent) => { if (e.target === modal) close('cancel'); };
    for (const c of choices) {
      const b = document.createElement('button');
      b.className = 'btn' + (c.primary ? ' btn-primary' : '');
      b.textContent = c.label;
      b.addEventListener('click', () => close(c.value));
      actions.appendChild(b);
    }
    document.addEventListener('keydown', onKey);
    modal.addEventListener('click', onBackdrop);
    modal.classList.add('show');
    (actions.querySelector('.btn-primary') as HTMLElement | null)?.focus();
  });
}

function normalizeIncoming(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    if (Array.isArray(data.redirects)) return data.redirects;
    if (Array.isArray(data.rules)) return data.rules;
    if (data.includePattern || data.redirectUrl) return [data];
  }
  return [];
}

async function importData(data: any) {
  activateTab('tab-settings');
  // parseImport owns format detection (Ferry / Redirector), per-rule validation,
  // transform-skipping and id regeneration. normalizeIncoming still handles the
  // paste conveniences (a bare array or a single rule object) before handing off.
  const result = parseImport({ redirects: normalizeIncoming(data) });

  const skippedTransform = result.skippedTransforms;
  let dupInFile = 0;
  const candidates: Rule[] = [];
  const seen = new Set<string>();
  for (const rule of result.rules) {
    const sig = ruleSignature(rule);
    if (seen.has(sig)) { dupInFile++; continue; }
    seen.add(sig);
    candidates.push(rule);
  }

  const wlCandidates: WhitelistEntry[] = Array.isArray(data?.whitelist)
    ? (data.whitelist as any[])
        .map((w) => createWhitelistEntry({ pattern: typeof w === 'string' ? w : w?.pattern, disabled: w?.disabled }))
        .filter((w) => w.pattern)
    : [];

  const transformNote = skippedTransform
    ? ` Skipped ${skippedTransform} rule(s) that need transforms (base64 / URL decode), which Ferry can't perform.`
    : '';
  const invalidNote = result.skippedInvalid
    ? ` Skipped ${result.skippedInvalid} invalid rule(s).`
    : '';

  if (candidates.length === 0 && wlCandidates.length === 0) {
    setImportMsg('No importable rules found in this file.' + transformNote + invalidNote, true);
    return;
  }

  let mode: 'replace' | 'append' = 'replace';
  if (rules.length > 0 || whitelist.length > 0) {
    const wlNote = wlCandidates.length
      ? ` and ${wlCandidates.length} whitelist entr${wlCandidates.length === 1 ? 'y' : 'ies'}`
      : '';
    const choice = await askModal(
      'Import',
      `Found ${candidates.length} rule(s)${wlNote}. Append to what you already have, or replace everything?`,
      [
        { label: 'Append', value: 'append', primary: true },
        { label: 'Replace', value: 'replace' },
        { label: 'Cancel', value: 'cancel' },
      ],
    );
    if (choice === 'cancel') { setImportMsg('Import cancelled.'); return; }
    mode = choice as 'replace' | 'append';
  }

  let dupExisting = 0;
  if (candidates.length) {
    if (mode === 'replace') {
      rules = candidates;
    } else {
      const existing = new Set(rules.map(ruleSignature));
      for (const c of candidates) {
        if (existing.has(ruleSignature(c))) { dupExisting++; continue; }
        rules.push(c);
      }
    }
    await persist();
  }

  if (wlCandidates.length) {
    if (mode === 'replace') {
      whitelist = wlCandidates;
    } else {
      const have = new Set(whitelist.map((w) => w.pattern));
      for (const w of wlCandidates) if (!have.has(w.pattern)) whitelist.push(w);
    }
    await persistWhitelist();
  }

  const importedCount = candidates.length - dupExisting;
  const dupTotal = dupInFile + dupExisting;
  const wlDone = wlCandidates.length
    ? ` and ${wlCandidates.length} whitelist entr${wlCandidates.length === 1 ? 'y' : 'ies'}`
    : '';
  const parts = [`Imported ${importedCount} rule(s)${wlDone}${mode === 'replace' ? ' (replaced all)' : ''}.`];
  if (dupTotal) parts.push(`Skipped ${dupTotal} duplicate(s).`);
  if (skippedTransform) parts.push(transformNote.trim());
  if (result.skippedInvalid) parts.push(invalidNote.trim());
  setImportMsg(parts.join(' '));
}

async function importFile(file: File) {
  activateTab('tab-settings');
  let data: any;
  try { data = JSON.parse(await file.text()); } catch { setImportMsg('Invalid JSON.', true); return; }
  await importData(data);
}

async function importText(text: string) {
  activateTab('tab-settings');
  if (!text.trim()) { setImportMsg('Paste some JSON first.', true); return; }
  let data: any;
  try { data = JSON.parse(text); } catch { setImportMsg('Invalid JSON.', true); return; }
  await importData(data);
}

function onImportInput(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (file) void importFile(file);
}

function addFromPaste() {
  const ta = $('#paste-json') as HTMLTextAreaElement;
  void importText(ta.value).then(() => { ta.value = ''; });
}

function setupDragDrop() {
  let depth = 0;
  const hasFiles = (ev: DragEvent) => Array.from(ev.dataTransfer?.types ?? []).includes('Files');
  window.addEventListener('dragenter', (ev) => {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    depth++;
    document.body.classList.add('drag-active');
  });
  window.addEventListener('dragover', (ev) => { if (hasFiles(ev)) ev.preventDefault(); });
  window.addEventListener('dragleave', (ev) => {
    if (!hasFiles(ev)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) document.body.classList.remove('drag-active');
  });
  window.addEventListener('drop', (ev) => {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    depth = 0;
    document.body.classList.remove('drag-active');
    const file = ev.dataTransfer?.files?.[0];
    if (file) void importFile(file);
  });
}

function wlToggle(entry: WhitelistEntry, i: number): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'switch';
  wrap.title = entry.disabled ? 'Disabled — click to enable' : 'Enabled — click to disable';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !entry.disabled;
  input.setAttribute('aria-label', entry.disabled ? 'Enable entry' : 'Disable entry');
  input.addEventListener('change', () => wlToggleAt(i));
  const track = document.createElement('span');
  track.className = 'track';
  wrap.append(input, track);
  return wrap;
}

function wlItem(entry: WhitelistEntry, i: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'wl-item' + (entry.disabled ? ' disabled' : '');
  const pattern = document.createElement('span');
  pattern.className = 'pattern';
  pattern.textContent = entry.pattern;
  row.append(pattern, wlToggle(entry, i), iconButton('delete', 'Delete', () => wlDel(i), { danger: true }));
  return row;
}

function renderWhitelist() {
  const list = $('#whitelist');
  list.innerHTML = '';
  if (whitelist.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<strong>No whitelist entries</strong>Add a URL pattern above to protect it from all redirects.';
    list.appendChild(empty);
    return;
  }
  whitelist.forEach((entry, i) => list.appendChild(wlItem(entry, i)));
}

async function persistWhitelist() { await setWhitelist(whitelist); renderWhitelist(); }
function wlToggleAt(i: number) { whitelist[i] = { ...whitelist[i], disabled: !whitelist[i].disabled }; void persistWhitelist(); }
function wlDel(i: number) { whitelist.splice(i, 1); void persistWhitelist(); }

function wlAdd() {
  const input = $i('#wl-input');
  const entry = createWhitelistEntry({ pattern: input.value.trim() });
  const errors = validateWhitelistEntry(entry);
  const err = $('#wl-error');
  if (errors.length) { err.textContent = errors.join(' '); return; }
  err.textContent = '';
  whitelist.push(entry);
  input.value = '';
  void persistWhitelist();
}

function activateTab(id: string) {
  document.querySelectorAll<HTMLElement>('[role="tab"]').forEach((t) => {
    const selected = t.id === id;
    t.setAttribute('aria-selected', String(selected));
    t.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(t.getAttribute('aria-controls') || '');
    if (panel) panel.hidden = !selected;
  });
}

function setupTabs() {
  const tabs = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'));
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => activateTab(t.id));
    t.addEventListener('keydown', (e) => {
      let next = -1;
      if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
      if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
      if (next < 0) return;
      e.preventDefault();
      activateTab(tabs[next].id);
      tabs[next].focus();
    });
  });
}

async function renderSyncError() {
  const syncError = await getSyncError();
  const box = $('#sync-error');
  box.textContent = syncError ?? '';
  box.hidden = !syncError;
}

function init() {
  renderResourceTypes();
  setupTabs();
  $('#save').addEventListener('click', save);
  $('#test').addEventListener('click', test);
  $('#add-rule').addEventListener('click', () => openDialog());
  $i('#filter').addEventListener('input', () => { filterQuery = $i('#filter').value; render(); });
  $('#cancel').addEventListener('click', closeDialog);
  ruleDialog().addEventListener('click', (e) => { if (e.target === ruleDialog()) closeDialog(); });
  $('#export').addEventListener('click', exportRules);
  $i('#import').addEventListener('change', onImportInput);
  $('#paste-add').addEventListener('click', addFromPaste);
  $('#wl-add').addEventListener('click', wlAdd);
  $i('#wl-input').addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') wlAdd(); });
  $i('#master-toggle').addEventListener('change', async () => {
    masterDisabled = !$i('#master-toggle').checked;
    await setDisabled(masterDisabled);
    render();
  });
  setupDragDrop();
  void Promise.all([getRules(), getDisabled(), getWhitelist()]).then(([r, d, w]) => {
    rules = r;
    masterDisabled = d;
    whitelist = w;
    render();
    renderWhitelist();
  });
  void renderSyncError();
  browser.storage.onChanged.addListener((changes: any, area: string) => {
    if (area === 'local' && changes.syncError) void renderSyncError();
  });
  // Enable transitions only after the first frame has painted; adding the
  // class in the same task as render() would still animate the initial state.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.body.classList.add('ready');
  }));
}

init();
