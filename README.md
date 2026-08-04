# Vikunja Browser Extension

Manage [Vikunja](https://vikunja.io) tasks from your browser toolbar. View and
search your tasks, add new ones with the full **Quick Add Magic** syntax, and
capture the current page or selected text as a task — without leaving your
browser.

> **Status:** currently only tested on **Firefox**. The manifest includes Chrome
> (minimum version 121) settings, but Firefox is the actively tested browser.

## Features

- **Toolbar popup** — a searchable task list with complete/reopen checkboxes,
  due dates, labels and project tags. The Vikunja logo opens your instance, and
  the settings gear opens the options page.
- **Quick Add Magic** — type a task like `+Home Water plants !3 *focus @alice
  tomorrow` in the popup and it is parsed exactly like the Vikunja web app:
  projects (`+`/`#`), labels (`*`/`@`), priorities (`!`), assignees
  (`@`/`+`), natural-language dates and `every X` repeats. Both the Vikunja and
  Todoist prefix modes are supported, and the active mode is read from your
  Vikunja frontend settings (never from the extension). While you type, a row
  of select-backed chips (Project, Priority, Labels, Assignee, Date, Repeat)
  appears below the input; picking a value writes the matching magic token into
  the text, so you can fill every field without remembering the syntax. Chips
  turn gray when a field is unset and color-coded once it is set. Once you
  start typing, a compact Add button appears below the chips.
- **Capture current page** — add the current tab, a selection or a link as a
  task via the right-click menu ("Add to Vikunja…") or the `Alt+Shift+V`
  shortcut, then refine it in a small capture window before saving.
- **Options page** — configure your instance URL, API token (with the required
  permissions documented on the page), default project, "due today" default, a
  custom filter for the task list, the default sort order and whether to
  remember your last sort choice.
- **Sorting** — a sort button in the popup header opens a menu to order the
  task list by Vikunja's manual position, title, created, updated, due date or
  priority, each of which can be reversed (ascending/descending). Newly added
  tasks are placed according to the active sort. Manual sorting uses Vikunja's
  per-view position and therefore needs a default project; otherwise the list
  falls back to newest first. The default sort is set in the options; with
  "remember last sort choice" enabled, the popup stores your last pick in the
  browser's local storage and it takes precedence.
- **Keyboard shortcuts** — `Alt+Shift+K` opens the popup, `Alt+Shift+V` adds
  the current website as a task.

## Language

The extension ships in **English**, **German** and **Spanish**. The language is chosen from
your browser's UI language (English is the fallback), so no in-extension setting
is needed. The Quick Add Magic syntax stays English by design: its project,
label, priority, date and repeat tokens (`+`, `*`, `!`, `@`, `tomorrow`,
`every X`, …) are parsed identically to the Vikunja web app, which only
understands English tokens. Add or edit a language by creating an entry in
[`_locales/<locale>/messages.json`](_locales/).

## Inspirations

The extension is inspired by the **Todoist extension for Chrome** (quick task
capture from the toolbar) and borrows its signature *Quick Add Magic* text
parsing, which is implemented as a plain-JavaScript port of the official
Vikunja frontend so behaviour stays in lock-step with the web app.

## Disclaimer

This extension is an **independent, unofficial project**. It is **not
affiliated with, endorsed by, or connected to** the Vikunja project
([vikunja.io](https://vikunja.io) / `go-vikunja/vikunja`) or its maintainers.
The **Vikunja name and logo** are the property of their respective owners (the
Vikunja project) and are used here only to identify the service this extension
works with.

## Development

This project was built with **heavy use of an AI coding assistant**
(opencode / "big-pickle" model): the Quick Add Magic port, the extension
refactor, and most of the code in this repository were produced with its help
and verified against the upstream Vikunja parser.

### Smoke tests

The repository ships a set of plain-Node smoke tests (no dependencies, no build
step). Run them from the repository root:

```sh
node smoketests/vikunja_lib_test.js        # API client (pagination, tasks, labels, users)
node smoketests/vikunja_popup_test.js      # popup UI + Quick Add Magic flow
node smoketests/vikunja_extra_test.js      # options + capture windows
node smoketests/vikunja_element_test.js    # background: Element instances, content-script hooks
node smoketests/vikunja_content_test.js    # Element page: injected buttons + toasts
node smoketests/quickadd_harness.js        # 879 Quick Add Magic parity assertions
```

Each suite prints a summary and exits non-zero on any failure, so the tests can
also be run together:

```sh
for f in smoketests/*.js; do node "$f" || break; done
```

The Quick Add Magic parser is validated against the official
`go-vikunja/vikunja` frontend test suite, so a green harness means the popup
parses task text identically to the web app.

## Loading the extension

- **Firefox:** `about:debugging` → *This Firefox* → *Load Temporary Add-on* →
  select `manifest.json`.
- **Chrome:** `chrome://extensions` → enable *Developer mode* → *Load unpacked*
  → select this folder.

Then open the options page, enter your Vikunja URL and an API token with the
permissions listed on the page, and you are ready to go.

## Packaging as an `.xpi`

```sh
zip -r vikunja.xpi manifest.json background capture content icons lib options popup capture styles _locales -x 'icons/icon.svg'
```
