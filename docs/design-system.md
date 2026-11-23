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
| `workspace.css` / `admin.css` | Navigation, lists, administration and builder layouts |
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

## Screen coverage

| Surface | Shared controls |
|---|---|
| Form library | Search input and common cards/actions |
| Records | Search, searchable form/review-state filters, shared pagination/status |
| People & access | Search, fields, role/status controls and assignments |
| Synchronization | Searchable batch-status filter, common notices and recovery actions |
| Traceability | Search, result rows and tree presentation |
| Trace-source dialog | Shared source search and result actions |
| Form builder | Searchable field type, calculation and condition options |
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
