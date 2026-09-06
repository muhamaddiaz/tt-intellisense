/**
 * Variable and directive completion.
 *
 * Resolution is scope-first: a path rooted at a loop alias is answered from the
 * shape of the list being iterated, not from a variable of that name. Roughly a
 * third of all variable references in the reference corpus are loop aliases, so
 * anything less leaves most of the file uncovered.
 */
import type { ParsedBlock, ParseResult } from "./parser";
import { DIRECTIVE_KEYWORDS } from "./lexer";
import { collectConstants, readVariablePath } from "./paths";
import { lookupThroughLists, type SchemaNode } from "./schema/model";

export interface CompletionContext {
  /** True when the cursor sits inside a directive tag. */
  inDirective: boolean;
  /** Fully-typed leading segments, e.g. `ir.config` for `ir.config.co|`. */
  base: string[];
  /** The partial final segment being typed. */
  partial: string;
  /** True when the cursor is at the head of a directive, where a keyword fits. */
  atDirectiveHead: boolean;
}

/** Local variables visible at an offset, and what they refer to. */
export interface ScopeBinding {
  name: string;
  /** The path this name aliases, if it could be determined. */
  source: string[] | null;
  isLoop: boolean;
  origin: string;
}

const IDENT = /[A-Za-z0-9_]/;

/**
 * Works out what is being completed at `offset`.
 *
 * Reads backwards over raw text rather than tokens, because the document is
 * mid-keystroke and the token stream around the cursor is not yet meaningful.
 */
export function completionContext(
  text: string,
  offset: number,
  result: ParseResult
): CompletionContext {
  // `>=` rather than `>`: with the cursor immediately after `[%` and nothing
  // typed yet, the user is inside a directive and wants directive completion,
  // not HTML.
  const tag = result.tags.find(
    (t) => t.kind !== "comment" && offset >= t.bodyStart && offset <= t.bodyEnd
  );
  if (!tag) {
    return { inDirective: false, base: [], partial: "", atDirectiveHead: false };
  }

  let i = offset;
  while (i > tag.bodyStart && IDENT.test(text[i - 1]!)) i--;
  const partial = text.slice(i, offset);

  const base: string[] = [];
  let cursor = i;
  while (cursor > tag.bodyStart && text[cursor - 1] === ".") {
    let start = cursor - 1;
    while (start > tag.bodyStart && IDENT.test(text[start - 1]!)) start--;
    const segment = text.slice(start, cursor - 1);
    if (!segment) break;
    base.unshift(segment);
    cursor = start;
  }

  // A head position is the first word of a directive: after the tag opener or
  // after a `;`, ignoring whitespace.
  let head = cursor - 1;
  while (head >= tag.bodyStart && /\s/.test(text[head]!)) head--;
  const atDirectiveHead = base.length === 0 && (head < tag.bodyStart || text[head] === ";");

  return { inDirective: true, base, partial, atDirectiveHead };
}

/** Blocks enclosing an offset, outermost first. */
export function enclosingBlocks(result: ParseResult, offset: number): ParsedBlock[] {
  const out: ParsedBlock[] = [];
  const visit = (blocks: ParsedBlock[]): void => {
    for (const block of blocks) {
      if (offset < block.start || offset > block.end) continue;
      out.push(block);
      visit(block.children);
    }
  };
  visit(result.blocks);
  return out;
}

/**
 * The innermost block containing an offset, or null at the top level.
 *
 * Walks down the tree rather than scanning every block, so this stays cheap
 * enough to call once per directive on each keystroke.
 */
function innermostBlock(blocks: ParsedBlock[], offset: number): ParsedBlock | null {
  let current: ParsedBlock | null = null;
  let level = blocks;

  for (;;) {
    const next = level.find((b) => offset >= b.start && offset <= b.end);
    if (!next) return current;
    current = next;
    level = next.children;
  }
}

/**
 * Directives that are still in scope at `offset`.
 *
 * A directive sealed inside a block that has already closed is not visible:
 * after `[% FOREACH r IN x %][% tmp = a.b %][% END %]`, `tmp` is gone. Blocks
 * nest properly, so testing the innermost block is enough — if it contains the
 * cursor then so does every ancestor.
 */
function visibleDirectives(result: ParseResult, offset: number) {
  const chain = new Set(enclosingBlocks(result, offset));
  const out = [];

  for (const directive of result.directives) {
    // Directives arrive in document order, so nothing after the cursor matters.
    if (directive.start >= offset) break;
    const owner = innermostBlock(result.blocks, directive.start);
    if (owner && !chain.has(owner)) continue;
    out.push(directive);
  }

  return out;
}

/**
 * Local bindings visible at an offset.
 *
 * Assignments are applied in document order so the most recent one wins, then
 * loop aliases are laid over them: inside a loop the alias is what the name
 * means, whatever was assigned to it earlier. Inner loops shadow outer ones.
 */
export function scopeAt(result: ParseResult, offset: number): Map<string, ScopeBinding> {
  const out = new Map<string, ScopeBinding>();
  const constants = collectConstants(result);

  // Assignments, in document order, so a later one replaces an earlier one.
  for (const directive of visibleDirectives(result, offset)) {
    const t = directive.tokens;
    const index = directive.keyword === "SET" || directive.keyword === "DEFAULT" ? 1 : 0;
    const name = t[index];
    const eq = t[index + 1];
    if (!name || name.kind !== "ident" || !eq || eq.value !== "=") continue;

    const source = readVariablePath(t, index + 2, constants)?.segments ?? [];
    out.set(name.value, {
      name: name.value,
      source: source.length > 1 ? source : null,
      isLoop: false,
      origin: `${name.value} = ${source.join(".") || "…"}`,
    });
  }

  // Loop aliases last: outermost first, so a nested loop shadows an outer one.
  for (const block of enclosingBlocks(result, offset)) {
    if (block.keyword !== "FOREACH" && block.keyword !== "FOR") continue;
    const t = block.opener.tokens;
    const alias = t[1];
    const link = t[2];
    if (!alias || alias.kind !== "ident" || !link) continue;
    if (link.value !== "=" && link.value !== "IN") continue;

    const source = readVariablePath(t, 3, constants)?.segments ?? [];
    out.set(alias.value, {
      name: alias.value,
      source: source.length ? source : null,
      isLoop: true,
      origin: `FOREACH ${alias.value} ${link.value} ${source.join(".")}`,
    });
  }

  return out;
}

/**
 * Resolves a path to a schema node, honouring local bindings.
 *
 * A loop alias resolves to the *element* of the list it iterates, which is what
 * makes `director.` offer `name` and `designation`.
 */
export function resolvePath(
  path: readonly string[],
  schema: SchemaNode,
  scope: ReadonlyMap<string, ScopeBinding>
): SchemaNode | undefined {
  if (!path.length) return schema;

  const [head, ...rest] = path as [string, ...string[]];
  const binding = scope.get(head);

  if (binding) {
    if (!binding.source) return undefined;
    const target = lookupThroughLists(schema, binding.source);
    if (!target) return undefined;
    const start = binding.isLoop && target.kind === "list" && target.element
      ? target.element
      : target;
    return rest.length ? lookupThroughLists(start, rest) : start;
  }

  return lookupThroughLists(schema, path);
}

export interface Suggestion {
  label: string;
  detail: string;
  documentation?: string;
  /** Lower sorts first. */
  rank: number;
  kind: "variable" | "keyword" | "field" | "local";
}

/** Directive keywords, offered only at the head of a directive. */
export function keywordSuggestions(partial: string): Suggestion[] {
  const out: Suggestion[] = [];
  for (const kw of DIRECTIVE_KEYWORDS) {
    if (partial && !kw.startsWith(partial.toUpperCase())) continue;
    out.push({ label: kw, detail: "directive", rank: 1, kind: "keyword" });
  }
  return out;
}

function describe(n: SchemaNode): string {
  const parts: string[] = [];
  // A mined leaf has no observed type; calling it "unknown" reads as an error
  // when it only means nothing has told us more than that it exists.
  parts.push(n.type ?? (n.kind === "unknown" ? "variable" : n.kind));
  if (n.kind === "hash" && n.children.size) parts.push(`${n.children.size} fields`);
  if (n.kind === "list" && n.element) parts.push(`of ${n.element.children.size} fields`);
  if (n.value !== undefined) parts.push(`= ${truncate(n.value)}`);
  return parts.join(" · ");
}

function truncate(v: string): string {
  return v.length > 48 ? `${v.slice(0, 45)}…` : v;
}

/** Suggestions for the members of `node`. */
export function memberSuggestions(
  parent: SchemaNode,
  frequency: (root: string) => number,
  topLevel: boolean
): Suggestion[] {
  const source = parent.kind === "list" && parent.element ? parent.element : parent;
  const out: Suggestion[] = [];

  for (const [name, child] of source.children) {
    out.push({
      label: name,
      detail: describe(child),
      documentation: child.description,
      // At the top level, rank by how many templates use the root: `ir` and
      // `global` are the answer nearly every time, and the mined tail is long.
      rank: topLevel ? 1000 - Math.min(999, frequency(name)) : 0,
      kind: topLevel ? "variable" : "field",
    });
  }

  return out;
}

/** Suggestions for the local variables visible at the cursor. */
export function localSuggestions(scope: ReadonlyMap<string, ScopeBinding>): Suggestion[] {
  return [...scope.values()].map((b) => ({
    label: b.name,
    detail: b.isLoop ? "loop variable" : "local",
    documentation: b.origin,
    rank: 0,
    kind: "local" as const,
  }));
}
