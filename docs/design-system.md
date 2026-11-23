# PPMS shared design system

The administration workspace, personnel PWA, form document, dialogs, sign-in,
setup/register and HTML error pages share one restrained red visual system.
White/neutral surfaces, readable type, fine borders and a consistent spacing scale
keep production records prominent. Success, warning and error states retain their
semantic colors and visible text labels.

## Design reference

This implementation applies the core, design-system token, web/mobile and UI-audit
guidance from [Eldergenix/Codex-Design](https://github.com/Eldergenix/Codex-Design),
reviewed at commit `99b4b08ff62b8dd3a7a112438c1460fd6a02d09c`.
The existing PHP/JavaScript application architecture and icon family are retained.
The reference is an instruction bundle, not a production runtime dependency.

## Theme ownership

| File | Responsibility |
|---|---|
| `public/assets/ppms/theme.css` | Authoritative semantic colors, type, spacing, radii, focus and elevation tokens |
| `public/assets/ppms/theme.js` | System/light/dark display preference and browser theme metadata |
| `public/assets/ppms/styles.css` | Common stylesheet entry point |
| `base.css` / `controls.css` | Shared buttons, fields, feedback, search and searchable choices |
| `workspace.css` / `admin.css` | Navigation, lists and administration layouts |
| `builder.css` | Visual form palette, layout canvas, field inspector and preview |
| `auth.css` / `system.css` | Authentication, setup and error states |
| `document.css` / `responsive.css` | Interactive forms, print, mobile and reduced-motion layouts |
| `scripts/sync_theme_assets.py` | Generate PWA icons and manifest colors from the theme |

Use semantic tokens such as `--primary`, `--primary-hover`, `--primary-soft`,
`--on-primary`, `--canvas`, `--surface`, `--ink`, `--muted`, `--line`,
`--focus-ring`, `--success`, `--warning` and `--danger`. Do not add screen-local
color literals. The same semantic roles have light and dark values. Printed
documents use the light palette.

Appearance defaults to the device setting. **Your account → Theme** lets every
role choose System, Light or Dark. This preference is stored locally, separately
from accounts, credentials, form data and offline-vault storage. Changing
appearance preserves the current record and viewport.

### Document appearance and mouse navigation

The form is always white, with dark text and light native input controls. This
applies to embedded records, builder previews, history/conflict viewers and
fullscreen, even when the surrounding application uses Dark appearance.

Fullscreen uses a dark canvas and dark toolbar regardless of the application's
appearance preference. Both native fullscreen and its in-page fallback use this
presentation. Exiting fullscreen restores the surrounding appearance without
changing the saved preference. These exceptions are scoped through the same
central theme tokens; individual forms must not provide their own colors.

| Interaction | Behavior |
|---|---|
| Mouse wheel over fullscreen paper/canvas | Zoom in or out around the pointer |
| Ctrl/Cmd + mouse wheel | Zoom in embedded or fullscreen view |
| Left-button drag on noninteractive paper/canvas | Pan horizontally and vertically |
| Middle-button drag | Pan without activating a form field |
| Shift + left drag | Preserve native text selection |
| Click an input or dropdown | Focus and edit normally |
| Two-finger pinch | Zoom while preserving native one-finger field interaction |
| Zoom buttons / Fit | Adjust the document scale or fit its width |
| Fullscreen button / Escape | Exit fullscreen; Escape also exits the fallback |

Unmodified wheel input over an editable control remains native. Horizontal wheel
input and Shift-wheel remain scrolling gestures. Zoom level is retained on
fullscreen entry/exit; scrolling is constrained to the available document bounds.

### Touch fullscreen and keyboard entry

Touch-capable devices use the same dark fullscreen presentation inside the page,
so the browser can keep native inputs and its on-screen keyboard available.
Desktop devices retain native fullscreen when supported. Tapping a writable
input, textarea or dropdown keeps the browser's normal focus action; navigation
must not cancel a one-finger tap or move focus asynchronously.

The touch fullscreen container follows `visualViewport` size and offsets when
the keyboard changes the visible area. Its toolbar and scroller use a flexible
layout, allowing even a bottom-row field to scroll above the keyboard. Viewport
changes preserve document scale, entered values, focus and text selection. Only
the scroll needed to reveal the active field changes. Adding a table row focuses
its first visible writable control inside the Add row gesture, including a
textarea, while scrolling is scheduled separately.

Browser acceptance exercises native tap focus and typing, synchronous new-row
focus, and a simulated keyboard-sized visual viewport without shrinking the
layout viewport. It also keeps the existing desktop mouse and native/fullscreen
fallback checks. Physical Android/iOS keyboard display remains a device check;
headless browser automation does not display an operating-system keyboard.

After changing brand tokens, run:

```sh
python scripts/sync_theme_assets.py
python tests/design_system.py
```

The first command updates generated PWA branding. The second checks that it is
current and that all application styles/modules remain available offline.

## Shared component APIs

Import presentation primitives from `public/assets/ppms/ui.js`:

```js
import { field, searchInput, searchableSelect, button } from './ui.js';

const query = searchInput('', {
  'aria-label': 'Search records',
  placeholder: 'Search records…',
});
query.addEventListener('input', () => loadRecords({ q: query.value }));

const formFilter = searchableSelect([
  { value: '', label: 'All forms' },
  ...forms.map(form => ({ value: form.id, label: `${form.ppmCode} · ${form.title}` })),
], '', { 'aria-label': 'Filter by form' });
formFilter.addEventListener('change', () => loadRecords({ ppmFormId: formFilter.value }));

const area = searchableSelect(areas, currentAreaId, { name: 'areaId', required: true });
container.append(field('Production area', area));
```

Both search components return a DOM wrapper exposing `.control`, `.value`,
`.disabled`, `.required`, `.name`, `.focus()` and validity helpers. Use `field()`
for a visible label or provide a descriptive `aria-label` for a toolbar control.
The field helper labels the actual input rather than its wrapper.

`searchInput()` provides the shared icon, clear action, native search input and
input/change events. Clearing returns focus to the input and triggers filtering.

`searchableSelect()` keeps the committed identifier separate from its typed
query. Typing only narrows the list; selecting an option commits its value and
emits input/change. Escape or leaving the control restores the selected label.
Arrows, Home/End and Enter support keyboard selection, while disabled choices and
unmatched text cannot become selected values. Named controls contribute the
selected identifier to native form submission. `setOptions()` updates the choices.

Dropdowns use the browser popover layer when available, remain associated with
their originating dialog, and reposition within the visible viewport. The first
Escape closes an open dropdown; a subsequent Escape can close the dialog.
Mobile controls have at least 44px targets and 16px input text.

Use searchable choices for filters and longer form/person/area/device/type lists.
Use the existing shared native `select()` for small status/action lists. Dynamic
form cells and trace selectors inside the zoomable document retain native
controls, preserving the existing focus, keyboard, pinch and edit behavior.

## Visual form builder

The builder uses one definition and the production renderer for every template.
Its three fixed sections remain Header, Main content and Summary; administrators
configure their contents without writing JSON or application code.
The design canvas shares the white-paper palette with form documents, while the
palette, settings panel and surrounding workspace follow the application theme.

The field palette, layout canvas and selected-field settings provide the main
editing workflow. Drag a palette field into a section or a table's columns, then
select it to edit its label, options, help text or required state. Drag handles
reorder existing items. Add buttons and move controls provide equivalent keyboard
and touch-friendly actions. The live preview uses the same `FormRenderer` and
`DocumentViewport` as saved records, including white paper and dark fullscreen.

Structural operations live in `builder-model.js`; `builder.js` owns presentation,
selection, bounded undo/redo history and the save lifecycle. Field keys are
generated automatically and existing keys/types remain stable. Moving a field
between scopes or deleting a referenced field can break calculations or
conditions, so the builder rejects those operations. Top-level section moves
preserve the data path; column reordering preserves the parent table and key.
The server remains authoritative for complete schema validation.

The inspector preserves the focused input during typing. Preview updates are
scheduled independently of the saved template, and preview values never create
records. Undo is scoped to builder actions; normal text input keeps native undo.
Leaving a dirty builder requires acknowledgement, and closing the browser tab
uses its unsaved-changes warning. All preview observers/listeners and pending
updates are disposed when the workspace changes screens.

Saving uses the complete template `editHash`; successful saves preserve the
current editor instead of remounting it. A stale save retains the local draft and
shows a clear conflict. Saving a separate draft is an explicit recovery action,
not an automatic overwrite. This recovery copies the local layout and document
details into a separate draft; administrators review its trace outputs before
publishing. It does not copy another session's unseen rules. Publication checks
that active relationships still have their target fields and source outputs.
Publishing is a deliberate, version-checked action;
published versions can only be duplicated for further editing. Trace-output
configuration uses the same version check and advances the token only after the
administrator's own rule changes have committed.

## Screen coverage

| Surface | Shared controls |
|---|---|
| Form library | Search input and common cards/actions |
| Records | Search, searchable form/review-state filters, shared pagination/status |
| People & access | Search, fields, role/status controls and assignments |
| Synchronization | Searchable batch-status filter, common notices and recovery actions |
| Traceability | Search, result rows and tree presentation |
| Trace-source dialog | Shared source search and result actions |
| Form builder | Shared field palette controls, field inspector, searchable advanced calculation and condition options |
| Record/create/assignment dialogs | Searchable form, area, person and device choices |
| Settings/account | Shared fields, actions, dialogs and appearance preference |
| Login/offline unlock/setup/errors | Common tokens, text, controls and feedback surfaces |

Loading, empty, error, disabled, focus and selected states use the same component
styles. Do not create page-specific copies of the search or dropdown markup.
New visual modules must be included in the service worker shell. Shell updates
continue to wait for existing tabs to close, preserving active form editors.

## Verification

`tests/design_system.py` guards centralized colors, stylesheet imports, defined
tokens, generated PWA branding, offline module coverage and JavaScript syntax.
It is part of `tests/run_all.py`.

`tests/design_browser.mjs` extends the real API/browser suite with all six admin
routes in light/dark appearance, text contrast, live record filtering, empty
states, keyboard/label/form-value behavior, dialog Escape handling, mobile touch
targets, and appearance persistence. The existing offline reload, document
pinch/focus, conflict and calculation scenarios remain in place. Browser results
and screenshots are published by the PR workflow; they do not establish physical
Android/iOS keyboard acceptance.

`tests/viewport_browser.mjs` verifies the production renderer with real mouse
wheel and pointer actions, white-paper/dark-fullscreen invariants, pointer-centered
zoom, panning, field editing after navigation, and native/fallback fullscreen exit.
