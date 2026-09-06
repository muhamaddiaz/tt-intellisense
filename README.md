# TT IntelliSense

Editor support for Perl [Template Toolkit](https://template-toolkit.org/docs/)
`.tt` files: highlighting of TT interleaved with HTML/CSS/JS, navigation,
structural diagnostics, and completion over the variables a template can see.

Targets VS Code and forks (Cursor, VSCodium). Distributed as a `.vsix`.

## Status

| Milestone | State |
|---|---|
| M1 — language registration + grammar | done |
| M2 — INCLUDE / BLOCK navigation | done |
| M3 — parser, structural diagnostics, folding, symbols | done |
| M4 — schema layers, completion, hover | done |
| M5 — embedded HTML/CSS IntelliSense | done |

## Navigation coverage

Template references resolve against the referencing file's own directory first,
then `ttIntellisense.includePath`. A block defined in the same document wins
over a file, matching Template Toolkit.

Unresolvable references are normal and produce no diagnostic — a partial
working copy that holds only the pages being edited will not contain the header
and footer it includes. On complete template trees in the reference corpus
resolution reaches 91–100%; across the whole corpus, which is mostly partial
checkouts, it is 54%.

Blocks defined in a different file resolve through a workspace index, ranked by
directory proximity — these trees hold many sibling copies of the same template,
so the nearest definition is almost always the intended one.

## HTML and CSS

Outside a directive, completion and hover are forwarded to the built-in HTML and
CSS language services, so tag and attribute completion, CSS property completion
and Emmet all work inside `.tt` files. The services see whitespace projections
of the document with everything that is not theirs blanked out, which keeps
positions identical and needs no source map.

Diagnostics are never forwarded, and JavaScript is not forwarded at all — see
[ADR 0004](docs/adr/0004-embedded-language-forwarding.md). A branching template
does not project to well-formed HTML, so HTML diagnostics would be reliably
wrong on correct templates.

Typing `>` or `/` inserts the matching closing tag. It never fires inside a
directive, where `>` is a comparison operator. Turn it off with
`ttIntellisense.autoClosingTags`, and forwarding as a whole with
`ttIntellisense.embedded.enabled`.

## Diagnostics

Structural problems are reported as errors: unbalanced `END`, unclosed blocks,
unterminated tags, misplaced `ELSE`/`ELSIF`/`CASE`/`CATCH`/`FINAL`, a clause
after `ELSE`, and mistyped directive keywords. Turn them off with
`ttIntellisense.diagnostics.structural`.

A mistyped keyword is only reported when it is within two edits of a real one,
so `FOEACH` is caught while constant-style variables like
`[% DEFAULT_COMMISSION %]` are left alone.

Unknown variables are deliberately *not* reported. Variable knowledge is
incomplete by construction — see ADR 0001 — so an unknown path is not evidence
of a mistake.

Across the 289-file reference corpus the parser reports zero diagnostics, which
is the expected result: those templates are known good.

That corpus exercises only 24 of Template Toolkit's directives, so it cannot on
its own show the parser is right. Every directive is therefore also tested
explicitly, and the test asserts that no keyword in the lexer lacks a case — a
gap that previously hid a missing `VIEW`.

## Design

Decisions and their reasoning live in [`docs/adr/`](docs/adr/). Domain
vocabulary lives in [`CONTEXT.md`](CONTEXT.md). Read those before changing
architecture — several choices here are deliberate and look wrong without
context, particularly the two-grammar split and the layered schema model.

## Development

```bash
npm install
npm test
```

Grammar correctness is asserted headlessly with `vscode-textmate`, so no editor
is needed to run the suite. Upstream HTML/CSS/JS grammars are fetched into
`test/fixtures/grammars/` on `pretest` and are not vendored.

To run the grammar against a real corpus of templates:

```bash
TT_CORPUS=/path/to/templates npm test
```

## Variable completion

Completion and hover for ambient variables (`ir.*`, `global.*`) are answered
from three layers, in increasing precedence — see
[ADR 0001](docs/adr/0001-layered-schema-model.md):

1. **Mined** from the workspace's own templates. Needs no configuration and
   covers what dumps miss.
2. **Stash dumps** in `.tt-schema/`, unioned across files. JSON is preferred;
   the ASCII tree format the Perl side produces is also parsed, including
   recovering arrays from consecutive numeric keys.
3. **Curated** `tt-schema.json`, mapping dotted paths to `description` and
   `type`.

Both locations are configurable — `ttIntellisense.schema.dumpDirectory` and
`ttIntellisense.schema.curatedFile`. Templates, dumps and the curated file are
watched, so adding a dump or pulling new templates updates completion without
restarting the server.

Paths rooted at a loop alias resolve through the list being iterated, so inside

```tt
[% FOREACH director = ir.var.ir_Directors.$board_type.format.directors %]
```

typing `director.` offers the fields of an item. A literal assigned earlier is
folded into a `$dynamic` segment, which is how the path above resolves at all.

Mining alone recovers list shapes from usage. In the reference corpus it finds
24 lists with learned element shapes, plus `global.*`, `ir.path.*` and several
`ir.var.*` plugins that the available dump does not contain.

## Stash dumps and secrets

`.tt-schema/` is gitignored, and it must stay that way. Dumps capture real
values from real renders and routinely contain credentials — the dump this
project was built against carried live reCAPTCHA secrets.

Values whose key looks secret-bearing are redacted before they reach the schema,
so no consumer can display them. Redaction is decided by key name, never by
inspecting the value. The server also warns on startup when a dump appears to
hold credentials.

## Formatting

Out of scope here. Use
[`@koha-community/prettier-plugin-template-toolkit`](https://www.npmjs.com/package/@koha-community/prettier-plugin-template-toolkit).
