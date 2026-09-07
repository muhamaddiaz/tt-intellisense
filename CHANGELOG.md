# Changelog

## 1.0.2

No change to how the extension behaves. This release exists to exercise the
tag-driven publishing workflow.

- Documentation split: the readme now describes the extension and its settings,
  while building, testing and design notes moved to `CONTRIBUTING.md`.
- Added a licence file, a changelog, and repository metadata to the listing.
- Publishing now runs from a GitHub Actions workflow triggered by a version tag,
  which checks the tag agrees with the manifest and runs the tests before
  publishing anything.

## 1.0.1

First published release.

### Language support

- Highlighting of Template Toolkit interleaved with HTML, CSS and JavaScript,
  including directives inside HTML attribute values.
- Structural diagnostics: unbalanced or unclosed `END`, unterminated tags,
  misplaced `ELSE`/`ELSIF`/`CASE`/`CATCH`/`FINAL`, a clause after `ELSE`, and
  mistyped directive keywords.
- Folding per block and per clause, and a hierarchical outline.

### Variables

- Completion and hover over a schema built from three sources: paths mined from
  the workspace's own templates, runtime stash dumps, and an optional curated
  file.
- Loop aliases resolve through the list being iterated, so `director.` offers
  the fields of an item.
- Sample values are shown in hover, with values under credential-like keys
  withheld.

### Navigation

- Go to definition and document links for `INCLUDE`, `PROCESS`, `INSERT` and
  `WRAPPER` targets, and for blocks defined in other files.

### Editing

- Comment toggling that follows the cursor: `[%# … %]` in a directive,
  `<!-- … -->` in HTML, `/* … */` in CSS and JavaScript.
- Closing tags inserted on `>` and `/`, never inside a directive.
- Formatting, and enter-indentation for HTML and CSS.
- Completion, hover and Emmet from the built-in HTML and CSS language services.
