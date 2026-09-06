# TT IntelliSense

Editor support for Perl [Template Toolkit](https://template-toolkit.org/docs/)
`.tt` files: highlighting of TT interleaved with HTML/CSS/JS, navigation,
structural diagnostics, and completion over the variables a template can see.

Targets VS Code and forks (Cursor, VSCodium). Distributed as a `.vsix`.

## Status

| Milestone | State |
|---|---|
| M1 — language registration + grammar | done |
| M2 — INCLUDE / BLOCK navigation | not started |
| M3 — parser, structural diagnostics, folding, symbols | not started |
| M4 — schema layers, completion, hover | not started |

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
