# Contributing to TT IntelliSense

How to build, test and publish the extension, and why it is put together the way
it is. For what it does and how to configure it, see [README.md](README.md).

## Getting set up

Node.js 18 or newer is the only prerequisite.

```bash
npm install
npm test          # 284 tests
npm run build     # compile only
npm run package   # build the .vsix
```

The same commands work on Windows, macOS and Linux. On Windows, if PowerShell
blocks `npm.ps1` with a script-execution error, run
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` or use Command Prompt.

To try a build, install the `.vsix` with `Ctrl+Shift+P` → **Extensions: Install
from VSIX…**, or `cursor --install-extension tt-intellisense-<version>.vsix`.
Reinstalling the same version number often needs an uninstall first, so bump
`version` in `package.json` while iterating.

## How the code is laid out

```
src/server/     the language server: lexer, parser, features, schema
src/client/     the editor-facing half: activation, commands, on-type behaviour
syntaxes/       TextMate grammars
test/           tests, fixtures and the vscode mock
docs/adr/       why the architecture is what it is
```

The server holds everything that needs to understand a template. The client is
deliberately thin: it forwards requests and applies what comes back.

## Testing

Nothing here needs an editor.

Grammar correctness is asserted headlessly with `vscode-textmate`. Upstream
HTML, CSS and JavaScript grammars are fetched into `test/fixtures/grammars/` on
first run and are not committed.

The client half runs against a strict `vscode` mock in `test/mocks/`, which
rejects a plain object where the real API requires one of its own types. That is
not pedantry: the client once handed the protocol's plain JSON straight to the
edit API, and comment toggling did not work at all while every server test
passed.

To run the parser and grammar over a real tree of templates:

```bash
# macOS and Linux
TT_CORPUS=/path/to/templates npm test
```

```powershell
# Windows PowerShell
$env:TT_CORPUS="C:\path\to\templates"; npm test
```

Two habits are worth keeping:

**Do not argue correctness from the corpus alone.** Against a 289-file reference
corpus the parser reports zero diagnostics, which sounds conclusive but is not:
that corpus exercises only 24 of Template Toolkit's directives. A gap there hid
a missing `VIEW` directive, so every directive now has explicit cases and a test
asserts that no keyword lacks one.

**Do not assert the contents of `test-file-*.tt`.** Those are scratch templates
at the repo root, edited freely while working. Stable fixtures live in
`test/fixtures/`.

### What is not covered

Nothing proves the extension activates, that keybindings reach their commands,
or that the language server starts. Those are process-level and would need
`@vscode/test-electron`.

## Publishing

Published to [Open VSX](https://open-vsx.org) as `muhamaddiaz.tt-intellisense`,
which is where Cursor and other VS Code forks install from.

```bash
npm run package
npx ovsx publish tt-intellisense-<version>.vsix -p <token>
```

Tokens come from your Open VSX profile. Bump `version` in `package.json` first —
a version that already exists is rejected.

`muhamaddiaz.tt` is a **different** extension in the same namespace, published
from another repository. Publishing this one does not affect it.

## Design notes

Decisions and their reasoning are in [`docs/adr/`](docs/adr/); domain vocabulary
is in [`CONTEXT.md`](CONTEXT.md). Read those before changing architecture —
several choices look wrong without context.

| | |
|---|---|
| [ADR 0001](docs/adr/0001-layered-schema-model.md) | why three schema sources instead of parsing Perl |
| [ADR 0002](docs/adr/0002-hand-written-parser.md) | why a hand-written parser, not tree-sitter |
| [ADR 0003](docs/adr/0003-two-grammars.md) | why highlighting needs two grammars |
| [ADR 0004](docs/adr/0004-embedded-language-forwarding.md) | why HTML gets completion but never diagnostics |

A few consequences worth knowing before changing things:

- **Highlighting uses two grammars.** A single grammar cannot colour TT inside
  HTML attribute values, and in the reference corpus that accounts for 1177 tags
  against 65 inside `<script>`. The scope name `text.html.tt` is load-bearing:
  themes and third-party injections match on it.
- **No layer of the variable schema is complete.** Merging unions children so
  none can erase another, which is also why an unknown variable is never
  reported as an error.
- **Only a directive's leading keyword opens a block.** Everything after it is
  side-effect notation, so `[% NEXT IF x %]` is one statement, not an `IF`.
- **Structural diagnostics must stay free of false positives** on known-good
  templates. That is the property they exist for, and it is why HTML diagnostics
  are not forwarded from the embedded services.

## Formatting

Out of the extension's own scope as a feature to build: it delegates to
[`@koha-community/prettier-plugin-template-toolkit`](https://www.npmjs.com/package/@koha-community/prettier-plugin-template-toolkit),
which is bundled.
