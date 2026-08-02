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
  Vikunja frontend settings (never from the extension).
- **Capture current page** — add the current tab, a selection or a link as a
  task via the right-click menu ("Add to Vikunja") or the `Alt+Shift+V`
  shortcut, then refine it in a small capture window before saving.
- **Options page** — configure your instance URL, API token (with the required
  permissions documented on the page), default project, "due today" default and
  a custom filter for the task list.
- **Keyboard shortcuts** — `Alt+Shift+K` opens the popup, `Alt+Shift+V` adds
  the current website as a task.

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
node smoketests/quickadd_harness.js        # 840 Quick Add Magic parity assertions
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
zip -r vikunja.xpi manifest.json background icons lib options popup capture styles -x 'icons/icon.svg'
```
