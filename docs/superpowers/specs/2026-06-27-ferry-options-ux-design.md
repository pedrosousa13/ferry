# Ferry options page — UX/UI polish

Date: 2026-06-27

## Goal

Make the options page prettier and more helpful. Specifically, make the
declarativeNetRequest resource types understandable to non-experts, and let users
import rule JSON by dragging the file into the window.

## Constraints

- Presentation only. No change to `rule-model.ts`, `storage.ts`, `compiler.ts`, or
  `engine.ts`. Stored rule values remain the raw resource-type enum strings.
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

### 3. Drag-and-drop import

- Whole window is a drop target. Dragging a file over shows a dim overlay
  ("Drop JSON to import"). Dropping a `.json` file imports it.
- Keep the click-to-browse file input.
- Refactor the existing import handler to `importFile(file: File)`; both the input
  `change` event and the window `drop` event call it. Same skip-transforms safety and
  result message as today.

## Out of scope

- New rule fields or matching behavior.
- Changes to the popup.
- Any network or permissions change.

## Verification

- `npm run typecheck` and `npm test` pass.
- `npm run build` succeeds; `dist/{chrome,firefox}/options.html` present.
- Screenshots (light, dark, advanced types expanded) captured for the PR.
