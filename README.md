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
| M4 — schema layers, completion, hover | not started |

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

## Stash dumps

Completion for ambient variables (`ir.*`, `global.*`) is fed by runtime stash
dumps placed in `.tt-schema/`. That directory is gitignored: dumps capture real
values from real renders and routinely contain credentials. Never commit one.

## Formatting

Out of scope here. Use
[`@koha-community/prettier-plugin-template-toolkit`](https://www.npmjs.com/package/@koha-community/prettier-plugin-template-toolkit).
