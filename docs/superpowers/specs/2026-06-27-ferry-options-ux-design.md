# Ferry options page — UX/UI polish

Date: 2026-06-27

## Goal

Make the options page prettier and more helpful. Specifically, make the
declarativeNetRequest resource types understandable to non-experts, and let users
import rule JSON by dragging the file into the window.

## Constraints

- Mostly presentation. The only logic addition is a pure, tested `lintRule` in
  `compiler.ts` (warnings only — it never blocks or mutates). No change to
  `rule-model.ts`, `storage.ts`, `engine.ts`, or `compile()`. Stored rule values
  remain the raw resource-type enum strings.
- Keep the page self-contained: one `src/options.html` with inline CSS, bundled
  `options.ts` → `options.js`. The build (`scripts/build.mjs`) only copies the HTML.
- No CSS framework, no new runtime dependencies.

## Changes

### 1. Resource types — friendly labels + help

Each of the 12 DNR resource types gets a plain-English label and a short hint.
Stored/submitted values stay the enum strings (checkbox `value`).

| enum | label | hint |
|---|---|---|
| `main_frame` | Page (top-level) | The URL in the address bar. Redirects the whole tab. Most rules only need this. |
| `sub_frame` | Embedded frames | Pages inside the page — iframes, embeds, ads. |
| `xmlhttprequest` | API / network requests | Background fetch & XHR calls. |
| `script` | Scripts | JavaScript files. |
| `stylesheet` | Stylesheets | CSS files. |
| `image` | Images | Image files. |
| `media` | Media | Audio & video. |
| `font` | Fonts | Web font files. |
| `websocket` | WebSockets | Live socket connections. |
| `ping` | Pings | Link-click tracking beacons. |
| `object` | Plugins | `<object>` / `<embed>` content. |
| `other` | Other | Anything else. |

Layout: `Page` and `Embedded frames` shown by default (the common cases). The other
ten collapse behind a `<details>` "Advanced request types". A "Select all / Clear"
control toggles all checkboxes. Default checked stays `main_frame` only.

### 2. Visual restyle

- CSS-variable design tokens; light + dark via `prefers-color-scheme`.
- Header: "Ferry" + one-line purpose.
- Rule list redesigned as modern cards: title (description), monospace `pattern → target`,
  a pattern-type pill (Wildcard/Regex), resource-type badges (friendly short labels,
  overflow collapses to "+N"), an enable/disable toggle switch, and compact icon actions
  (move up/down, edit, delete) revealed/hovered per card. Disabled cards dimmed. Empty
  state when no rules.
- Add/edit form grouped in a card with inline field hints and example placeholders.
- Errors and test result as inline colored chips.
- Accessible: labels tied to inputs, visible focus states, sufficient contrast.

### 3. Drag-and-drop import + replace/append + dedupe

- Whole window is a drop target. Dragging a file over shows a dim overlay
  ("Drop JSON to import"). Dropping a `.json` file imports it.
- Keep the click-to-browse file input.
- Refactor the existing import handler to `importFile(file: File)`; both the input
  `change` event and the window `drop` event call it. Same skip-transforms safety.
- When rules already exist, an in-page modal (not a native dialog) asks
  **Replace** (discard current rules, use the imported set) or **Append** (add to
  current rules), with **Cancel**. With no existing rules, import directly.
- Duplicate handling: a rule's signature is
  `patternType | includePattern | excludePattern | redirectUrl | sorted(resourceTypes)`.
  Duplicates are dropped — within the imported set, and (on Append) against existing
  rules. The result message reports imported / skipped-duplicate / skipped-transform
  counts.

### 4. Enable/disable rules temporarily

- Per-rule: each rule card already has an enable/disable toggle switch (sets
  `rule.disabled`; `compile()` skips disabled rules).
- All rules at once: a master toggle in a control bar at the top of the page, reusing
  the existing `disabled` storage flag (`getDisabled`/`setDisabled`) that the popup and
  engine already use. Turning it off pauses every rule without deleting anything; the
  rules list shows a paused state. No engine change — `engine.ts` already re-syncs on
  the `disabled` storage change.

### 5. Tabbed layout

- The page is split into two tabs: **Rules** (master switch, rules list, add/edit
  form) and **Settings** (Backup import/export, Add from JSON). Default tab is Rules.
- Accessible: `role="tablist"/"tab"/"tabpanel"`, `aria-selected`, roving `tabindex`,
  Left/Right arrow-key navigation.
- Drag-and-drop import stays global; a successful import (or any import message)
  switches to the Settings tab so the result is visible.

### 6. Rule linting

- A pure `lintRule(rule): string[]` in `compiler.ts` returns non-blocking warnings for
  rules that compile to valid DNR but are likely broken:
  - Redirect references a `$n` capture group the match pattern doesn't have (wildcard
    `*` count, or regex capturing-group count, ignoring `(?:…)`).
  - Redirect target matches the rule's own pattern → likely redirect loop.
- Surfaced two ways: an amber warning chip in the form on **Test**/**Save** (save still
  proceeds — warnings never block), and a `⚠ N` badge (with the messages as a tooltip)
  on any rule card in the list. Distinct from the existing red blocking errors.

### 7. Add rule from pasted JSON

- A textarea + "Add from JSON" button in the Settings tab. Accepts a single rule
  object, an array of rules, or an exported `{ redirects: [...] }` file.
- Routes through the same `importData` path as file/drop import (normalised by
  `normalizeIncoming`), so it shares the Replace/Append prompt and dedupe.

## Out of scope

- New rule fields or matching behavior.
- Changes to the popup.
- Any network or permissions change.

## Verification

- `npm run typecheck` and `npm test` pass.
- `npm run build` succeeds; `dist/{chrome,firefox}/options.html` present.
- Screenshots (light, dark, advanced types expanded) captured for the PR.
