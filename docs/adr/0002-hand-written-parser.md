# The language server uses a hand-written parser, not tree-sitter

Completion, structural diagnostics, folding and symbols all need a real syntax
tree with scope tracking. We are writing an error-tolerant scanner and recursive
descent parser in TypeScript rather than adopting tree-sitter, which would
otherwise be the default choice for new editor tooling.

## Considered Options

No tree-sitter grammar for Template Toolkit exists on npm or elsewhere, so
tree-sitter offers no head start — we would write the grammar either way, and
additionally take on a C/WASM build step and a grammar-DSL dependency. Its real
advantages, incremental reparsing and generated error recovery, are worth less
here than they look: TT's grammar is small, and our largest observed template is
133 KB, well within full-reparse budget on a keystroke debounce.

`@koha-community/prettier-plugin-template-toolkit` (MIT, maintained) was examined
and rejected as a foundation. It is regex-driven and replaces TT constructs with
opaque placeholders for Prettier to lay out. It never resolves an expression into
a variable path and models no scopes, so it cannot answer a completion request.
It remains the recommendation for formatting, which we deliberately do not do.

Regex-only was rejected because scope-aware alias resolution and reliable `END`
balancing are not achievable with it, and those are the features being bought.

Measured after the fact, the full-reparse assumption held: the 133 KB template
parses in 0.3 ms, so no incremental strategy is needed at any plausible
document size.

## Consequences

Error recovery is our responsibility and must be deliberate: an editor sees
half-typed, unbalanced input constantly, and the parser must still produce a
usable tree with correct scopes around the cursor.

The parser is plain TypeScript with no native dependencies, so it runs anywhere
Node runs and unit-tests without an editor.

The TextMate grammar remains a second, independent description of TT syntax. VS
Code offers no way to share one parser between tokenization and language
features, so the two can drift and must be tested separately.
