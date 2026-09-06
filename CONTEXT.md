# TT IntelliSense

A VS Code extension giving Perl Template Toolkit (`.tt`) files first-class editor
support: correct highlighting of TT mixed with HTML/CSS/JS, and language
intelligence over the variables a template can see.

## Language

### Template structure

**Directive**:
A single TT instruction inside a tag, such as `IF`, `FOREACH`, `INCLUDE`, or a
bare variable expression.
_Avoid_: tag, statement, command

**Tag**:
The delimiters wrapping one or more directives — `[% ... %]` inline, or `%%` at
line start for outline style.
_Avoid_: directive, block, marker

**Host Language**:
The non-TT content a template emits — HTML, CSS, or JavaScript. TT is woven
through it, including inside HTML attributes and `<script>`/`<style>` bodies.
_Avoid_: embedded language, target language

### Variables

**Variable Path**:
A dotted chain resolving a value from the stash, such as
`ir.var.ir_Directors.director.format.directors`. The unit that completion and
hover operate on.
_Avoid_: variable name, key, field, expression

**Ambient Variable**:
A variable path injected by the Perl application before rendering; nothing in the
template declares it. Roots are `ir` and `global`. Requires an external source to
be known.
_Avoid_: global variable, stash variable, external variable

**Local Variable**:
A variable path introduced by the template itself — a `FOREACH` alias, a `SET`
assignment, a `BLOCK` parameter. Always derivable from the template by static
analysis, never needs a schema.
_Avoid_: loop variable, temporary, scoped variable

### Knowledge sources

**Stash Dump**:
An ASCII-tree snapshot of the `ir` stash captured during one real page render.
Carries real values, and therefore may carry secrets. Always partial: `ir.var.*`
is populated on demand, so any single dump omits plugins other pages load.
_Avoid_: schema, schema.txt, dump file, stash file

**Mined Path**:
A variable path discovered by scanning the workspace's `.tt` files. Covers what
dumps miss, at the cost of including typos and paths from unrelated templates.
_Avoid_: inferred variable, scanned path, corpus variable

**Curated Schema**:
A hand-authored file describing variable paths with descriptions and types. The
highest-precedence knowledge source, and the only one that can document intent.
_Avoid_: schema file, manifest, types file

**Schema Layer**:
One of the three knowledge sources — Stash Dump, Mined Path, or Curated Schema —
combined by precedence to answer a completion or hover request.
_Avoid_: provider, source, resolver

### Resolution

**Alias Resolution**:
Determining what a Local Variable refers to by resolving the expression that
introduced it against the Schema Layers — so a `FOREACH` alias can offer the
fields of the list's elements.
_Avoid_: type inference, binding, lookup

**Element Shape**:
The set of fields carried by the items of a list-valued Variable Path. Only a
Stash Dump in a format that expresses lists can reveal it.
_Avoid_: item type, row type, element schema

**Redacted Value**:
A sampled value withheld from hover because its key matches a secret-bearing
pattern. Redaction is decided by key name, never by inspecting the value.
_Avoid_: masked value, hidden value, filtered value
