# Ambient variable knowledge comes from three layered sources

Templates reference ambient variables (`ir.*`, `global.*`) that nothing in the
template declares, so completion needs an external description of them. The Perl
application that builds the stash is not available to this project, ruling out
introspection. We therefore combine three Schema Layers — Stash Dumps parsed from
`.tt-schema/`, Mined Paths scanned from the workspace's own `.tt` files, and an
optional hand-authored Curated Schema — resolved in that order of increasing
precedence.

## Considered Options

Parsing the Perl backend was rejected because the source is not available here,
and a solution that only works for one company's codebase is not worth building.

Dumps alone were rejected on evidence: the dump we have covers `ir` but not
`global`, despite `global.is_en` being the single most-used variable in the
corpus (1184 of ~3500 variable references). Its `ir.var` subtree holds seven
plugins while the corpus uses at least four more — `ir_Directors`,
`ir_QuotesIDX`, `sgx_Fundamentals`, `sgx_HistoricalPrice`. `ir.var` is populated
on demand per page, so no single dump can ever be complete.

Mining alone was rejected because a mined path can carry no type, no description,
and no distinction between a real path and a typo.

## Note on the ASCII dump format

The ASCII tree format was initially assumed to be unable to express lists,
which was one argument for preferring JSON dumps. That turned out to be wrong.
Perl's array indices survive the format as the keys `0`, `1`, `2`, so an array
arrives looking like a hash with consecutive numeric keys and can be recovered.
The parser does this.

The recovery is a heuristic and cannot be otherwise: a hash whose keys genuinely
are `0`, `1`, `2` is indistinguishable from an array in that format. The test
used is "keys are exactly 0..n-1", which correctly leaves the year-keyed maps in
the reference dump as hashes. JSON dumps remain preferred because they state
list-ness rather than implying it, but the ASCII format is a good deal more
capable than this decision first assumed.

## Consequences

Every layer is optional. With no configuration at all, mining still yields useful
completion, so the extension is never dead on arrival. Coverage improves as more
pages are dumped rather than requiring one authoritative act of documentation.

The layers disagree, and that is expected rather than an error. Precedence
resolves it silently; we do not surface conflicts as diagnostics.

Because knowledge is incomplete by construction, "this variable is unknown" can
never be a trustworthy error. This is what forces unknown-variable diagnostics to
ship disabled, and to flag only unknown roots when enabled.
