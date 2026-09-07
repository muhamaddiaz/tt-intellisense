# TT IntelliSense

Language support for Perl [Template Toolkit](https://template-toolkit.org/docs/)
in VS Code, Cursor and other forks.

`.tt` files are usually HTML with TT woven through them. Most editors stop at the
first `[%` — the file turns one colour, nothing is clickable, and the variables
your Perl application passes in are invisible. This extension fixes that.

## Features

**Syntax highlighting** for Template Toolkit interleaved with HTML, CSS and
JavaScript, including directives inside attribute values like
`id="row-[% item.id %]"`.

**Variable completion and hover.** Type `ir.` and pick from a list. Inside a
loop, `director.` offers the fields of an item. Hover shows the shape, a sample
value, and where that knowledge came from.

**Diagnostics as you type** — unbalanced or unclosed `END`, unterminated tags,
misplaced `ELSE`/`ELSIF`/`CASE`/`CATCH`/`FINAL`, and mistyped keywords such as
`FOEACH`.

**Navigation.** Ctrl+click an `INCLUDE`, `PROCESS`, `INSERT` or `WRAPPER` target
to open it. Blocks defined in other files are found too.

**Formatting**, using the bundled
[`prettier-plugin-template-toolkit`](https://www.npmjs.com/package/@koha-community/prettier-plugin-template-toolkit).
No separate Prettier extension needed.

**Context-aware commenting.** `Ctrl+/` produces `[%# … %]` in a directive,
`<!-- … -->` in HTML and `/* … */` in CSS or JavaScript.

**HTML editing** — tag and attribute completion, Emmet, and closing tags
inserted when you type `>`.

**Folding and outline** for blocks, so a 130 KB template stays navigable.

## Getting started

Install the extension, then open any `.tt` file. The status bar should read
**Template Toolkit**.

Everything works immediately — the extension reads the templates already in your
workspace and learns the variable paths they use. Completion for `ir.*` and
`global.*` gets substantially better once you add a stash dump, described below.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `ttIntellisense.includePath` | `[]` | Extra directories for resolving `INCLUDE` targets, like Template Toolkit's `INCLUDE_PATH`. The file's own directory is always tried first. |
| `ttIntellisense.schema.dumpDirectory` | `.tt-schema` | Where stash dumps live. One path or a list. Relative paths resolve per workspace folder; absolute and `~` paths are used as given. |
| `ttIntellisense.schema.curatedFile` | `tt-schema.json` | Optional file describing variables with a `description` and `type`. |
| `ttIntellisense.diagnostics.structural` | `true` | Report structural errors. |
| `ttIntellisense.formatting.enabled` | `true` | Enable the built-in formatter. |
| `ttIntellisense.embedded.enabled` | `true` | HTML and CSS completion and hover. |
| `ttIntellisense.autoClosingTags` | `true` | Insert closing tags on `>` and `/`. |

### Better variable completion

Completion draws on three sources, combined, with later ones winning where they
overlap:

1. **Your templates.** Scanned automatically, no setup. This alone learns loop
   shapes — a `FOREACH` over a path tells the extension that the path is a list
   and what fields its items carry.
2. **Stash dumps.** A snapshot of the `ir` structure from a real page render.
   Put one in `.tt-schema/` and completion gains every path in it, plus real
   sample values in hover. JSON is preferred; the ASCII tree format that
   Template Toolkit's own tooling produces is also read.
3. **A curated file.** `tt-schema.json` in the workspace root, mapping paths to
   descriptions:

   ```json
   {
     "global.is_en": {
       "type": "boolean",
       "description": "True on the English edition of the site."
     }
   }
   ```

Dumps and templates are watched, so adding one updates completion without a
restart.

To share a single dump across every project rather than copying it into each,
point the setting at one location in your **user** settings:

```jsonc
"ttIntellisense.schema.dumpDirectory": ["~/.tt-schema", ".tt-schema"]
```

> **Keep stash dumps out of version control.** They capture real values from real
> renders and routinely contain credentials. Values under keys like `secret_key`
> or `password` are hidden in hover, and the extension warns you when a dump
> appears to hold credentials — but the file itself remains sensitive. Storing it
> under `~` means it cannot be committed by accident.

### Format on save

Formatting on save stays opt-in, per workspace:

```json
{
  "[tt]": {
    "editor.defaultFormatter": "muhamaddiaz.tt-intellisense",
    "editor.formatOnSave": true
  }
}
```

## Notes

**Unresolved includes are normal** and produce no error. A working copy holding
only the pages you are editing will not contain the header it includes.

**Unknown variables are not reported.** Variable knowledge is incomplete by
design, so an unfamiliar path is not evidence of a mistake.

**HTML diagnostics are not forwarded.** A template that branches does not form
valid HTML on its own, so they would flag correct files.

## Known issues

`[% TAGS %]`, which changes the delimiters mid-file, is not supported — anything
after it is misread.

## Contributing

Build, test and design notes are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[MIT](LICENSE)
