# Highlighting uses a base grammar plus a separate injection grammar

`.tt` files are registered under a `text.html.tt` base grammar that includes VS
Code's built-in `text.html.basic`, giving correct HTML, CSS and JavaScript
coloring for free. A second injection grammar, selected on `L:text.html.tt`,
paints Template Toolkit syntax on top. Two grammars for one language is
surprising, so the reason is recorded here.

## Considered Options

A single self-contained grammar cannot color TT inside HTML attribute values. The
HTML grammar's `string.quoted.double.html` rule consumes an attribute value
whole, so `id="modal-[% director.director_id %]"` renders as an undifferentiated
string. Injection grammars are the only mechanism that applies rules *inside*
another grammar's matches.

This is not an edge case in our corpus: 1177 TT tags appear inside HTML attribute
values, against 65 inside `<script>` bodies and 0 inside `<style>`. Attribute
embedding is the dominant way TT and HTML mix here, so a grammar that gets it
wrong fails at the most common case rather than a rare one.

Reusing the `html` language id with an injection was rejected separately: it
would deliver Emmet immediately, but the language server could not cleanly own
`.tt` files, and TT-specific settings and diagnostics ownership become ambiguous.

## Consequences

HTML, CSS and JavaScript coloring tracks VS Code upstream at no cost, and is not
ours to maintain.

The scope name `text.html.tt` is load-bearing, not cosmetic. Theme rules match on
scope prefixes, third-party injections target `text.html`, and `embeddedLanguages`
keys off these scopes for comment toggling and bracket matching. Renaming it to
`source.tt` would silently degrade all three.

Grammar correctness is asserted headlessly with `vscode-textmate` and
`vscode-oniguruma`, since no editor is installed on the build machine.
