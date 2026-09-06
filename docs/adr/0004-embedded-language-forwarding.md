# Embedded HTML and CSS get completion and hover, but never diagnostics

`.tt` files are mostly HTML, so the built-in HTML and CSS language services are
forwarded to whenever the cursor sits outside a Template Toolkit directive. They
are given whitespace projections of the document — every character that is not
theirs replaced by a space, newlines kept — so positions map one to one and no
source map is involved.

Only completion and hover are forwarded. Diagnostics, formatting, folding and
symbols are not.

## Considered Options

The projection of a branching template is not well-formed HTML and cannot be
made so. Blanking directives turns

    [% IF a %]<div>[% ELSE %]<span>[% END %]

into `<div><span>`: both branches present, neither closed. No projection fixes
this, because the document genuinely describes two different documents and only
one exists at render time.

Completion tolerates that. It asks a local question — what may follow this
character — and answers it correctly even when the surrounding document does not
balance. Diagnostics ask a global question about validity, and would report
unclosed-tag errors on templates that are perfectly correct. Since M3
deliberately ships structural diagnostics with zero false positives on the
reference corpus, importing a source of guaranteed false positives would undo
the most valuable property the diagnostics have.

Choosing one branch to project was rejected: it makes the other branch invisible
to completion, and there is no principled way to pick.

JavaScript is not forwarded at all. A TypeScript virtual document over a
branching template is a large amount of machinery, and the reference corpus has
65 TT tags inside `<script>` against 1177 inside HTML attributes — mostly `src`
attributes and small snippets rather than application code. The cost is not
matched by the return.

## Consequences

Emmet works, because the extension maps `tt` to `html` in
`configurationDefaults`, and Emmet is a completion-time feature.

HTML formatting is unavailable, which is consistent with the decision not to
ship a formatter at all.

Auto-closing tags travel as a custom request rather than an LSP capability,
because the protocol has none for on-type behaviour. The client watches for `>`
and `/`, asks the server, and inserts the returned snippet. The server refuses
inside a directive, where `>` is a comparison operator rather than the end of a
tag.

The two completion sources never mix. They are disjoint by cursor position:
inside a directive the schema answers, outside it the embedded services do.
Merging them would bury both.
