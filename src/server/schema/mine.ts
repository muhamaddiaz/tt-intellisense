/**
 * Mines variable paths from the workspace's own templates.
 *
 * This is the layer that needs no configuration, and it covers what dumps
 * cannot. In the reference corpus a dump of one page holds `ir` but not
 * `global`, and omits every plugin that page did not load — while `global.is_en`
 * alone accounts for 1184 references. See ADR 0001.
 *
 * It also recovers list structure from usage, which matters when no dump
 * covers the path at all. When a template writes
 *
 *     [% FOREACH director = ir.var.ir_Directors.director.format.directors %]
 *       [% director.name %]
 *
 * the loop tells us that `...directors` is a list and that its items carry a
 * `name` — with no dump involved at all.
 */
import { collectConstants, readVariablePath as readPath } from "../paths";
import { parse, type ParseResult } from "../parser";
import { ensurePath, merge, node, type SchemaNode } from "./model";

/** Keywords whose first argument names a template, not a variable. */
const TEMPLATE_KEYWORDS = new Set(["INCLUDE", "PROCESS", "INSERT", "WRAPPER", "USE"]);

interface Binding {
  /** The path the alias iterates or aliases. */
  source: string[];
  /** True when the alias is a loop variable, so `source` is a list. */
  isLoop: boolean;
}

/** Accumulates mined knowledge across many files. */
export class Miner {
  private readonly raw: SchemaNode = node("hash", "mined");

  /**
   * Every name bound locally in any template: loop aliases, assignment
   * targets, block names, macro parameters.
   *
   * A name bound anywhere is treated as local everywhere. Mining the whole
   * reference corpus otherwise surfaces 150-odd roots — `x`, `loop`, `label`,
   * `l3_warrants_legal` — none of which are ambient. Being conservative costs
   * an occasional real variable and buys a completion list that is worth
   * reading.
   */
  private readonly localNames = new Set<string>();

  /** How many documents each root appears in, used to rank completions. */
  private readonly frequency = new Map<string, number>();

  addDocument(text: string, result: ParseResult = parse(text)): void {
    const constants = collectConstants(result);
    const bindings = collectBindings(result, constants);

    for (const name of bindings.keys()) this.localNames.add(name);
    for (const name of constants.keys()) this.localNames.add(name);
    // Every assignment target is local, whatever it is assigned. Collecting
    // only string constants let `[% tmp = 1 %]` through into the ambient
    // schema, where it would be offered in every template in the workspace.
    for (const name of collectAssignedNames(result)) this.localNames.add(name);
    for (const block of result.allBlocks) {
      if (block.name) this.localNames.add(block.name);
      // `MACRO name(a, b)` parameters are local to the macro body.
      if (block.opener.keyword === "MACRO" || block.opener.keyword === "BLOCK") {
        for (const t of block.opener.tokens) {
          if (t.kind === "ident") this.localNames.add(t.value);
        }
      }
    }
    for (const directive of result.directives) {
      if (directive.keyword !== "MACRO") continue;
      for (const t of directive.tokens) {
        if (t.kind === "ident") this.localNames.add(t.value);
      }
    }

    const seenRoots = new Set<string>();

    for (const directive of result.directives) {
      const tokens = directive.tokens;
      const skipFirstArg = directive.keyword ? TEMPLATE_KEYWORDS.has(directive.keyword) : false;

      let i = directive.keyword ? 1 : 0;
      if (skipFirstArg) {
        // Step over the template name so `include_header.tt` is not mined as a
        // variable path with a `tt` member.
        const skipped = readPath(tokens, i, constants);
        i = skipped ? skipped.next : i + 1;
      }

      for (; i < tokens.length; i++) {
        const token = tokens[i]!;

        // A filter name after `|` is a function, not a variable.
        if (token.kind === "operator" && token.value === "|") {
          i++;
          continue;
        }
        if (token.kind !== "ident" && token.kind !== "dollar") continue;

        const prev = tokens[i - 1];
        if (prev && prev.kind === "punct" && prev.value === ".") continue;
        if (prev && prev.kind === "keyword" && prev.value === "FILTER") continue;

        // An assignment target is a local, not an ambient variable. Mining
        // `[% board_type = 'director' %]` as a path would put `board_type` in
        // the completion list for every template in the workspace.
        const after = tokens[i + 1];
        if (after && after.kind === "operator" && after.value === "=") continue;

        const read = readPath(tokens, i, constants);
        if (!read) continue;
        i = Math.max(i, read.next - 1);

        const head = read.segments[0];
        if (head && !bindings.has(head)) seenRoots.add(head);
        this.record(read.segments, read.endedInCall, bindings);
      }
    }

    for (const root of seenRoots) {
      this.frequency.set(root, (this.frequency.get(root) ?? 0) + 1);
    }
  }

  /** How many documents referenced this root. */
  documentFrequency(root: string): number {
    return this.frequency.get(root) ?? 0;
  }

  private record(
    segments: string[],
    endedInCall: boolean,
    bindings: ReadonlyMap<string, Binding>
  ): void {
    if (!segments.length) return;

    const [head, ...rest] = segments as [string, ...string[]];
    const binding = bindings.get(head);

    if (binding) {
      // A path rooted at a loop alias describes the *items* of the source list,
      // not a variable of its own.
      if (!rest.length) {
        const target = ensurePath(this.raw, binding.source, "mined");
        if (binding.isLoop) {
          target.kind = "list";
          target.element ??= node("hash", "mined");
        }
        return;
      }
      const target = ensurePath(this.raw, binding.source, "mined");
      if (binding.isLoop) {
        target.kind = "list";
        target.element ??= node("hash", "mined");
        ensurePath(target.element, rest, "mined");
      } else {
        ensurePath(target, rest, "mined");
      }
      return;
    }

    // The reader already stops before a method name, so `segments` is the
    // receiver path. Slicing again here would drop a real field.
    void endedInCall;
    ensurePath(this.raw, segments, "mined");
  }

  /** The mined schema with locally-bound roots removed. */
  merged(): SchemaNode {
    const out = node("hash", "mined");
    for (const [name, child] of this.raw.children) {
      if (this.localNames.has(name)) continue;
      out.children.set(name, child);
    }
    return out;
  }
}

/** Every name that appears as an assignment target anywhere in a document. */
function collectAssignedNames(result: ParseResult): Set<string> {
  const out = new Set<string>();
  for (const directive of result.directives) {
    const t = directive.tokens;
    const offset = directive.keyword === "SET" || directive.keyword === "DEFAULT" ? 1 : 0;
    for (let i = offset; i < t.length; i++) {
      const name = t[i]!;
      const eq = t[i + 1];
      if (name.kind !== "ident" || !eq || eq.kind !== "operator" || eq.value !== "=") continue;
      // Only a bare name is a target; `a.b = 1` assigns into a structure.
      const prev = t[i - 1];
      if (prev && prev.kind === "punct" && prev.value === ".") continue;
      out.add(name.value);
    }
  }
  return out;
}

/** Loop and alias bindings, so paths rooted at them attach to their source. */
function collectBindings(
  result: ParseResult,
  constants: ReadonlyMap<string, string>
): Map<string, Binding> {
  const out = new Map<string, Binding>();

  for (const directive of result.directives) {
    const t = directive.tokens;
    const kw = directive.keyword;

    if (kw === "FOREACH" || kw === "FOR") {
      // `FOREACH alias = path` and `FOREACH alias IN path`
      const alias = t[1];
      const link = t[2];
      if (!alias || alias.kind !== "ident" || !link) continue;
      const isLink = link.value === "=" || link.value === "IN";
      const read = readPath(t, isLink ? 3 : 2, constants);
      if (!read || !read.segments.length) continue;
      if (!isLink) {
        // `FOREACH path` with no alias imports the item's fields directly.
        continue;
      }
      out.set(alias.value, { source: read.segments, isLoop: true });
      continue;
    }

    // `[% alias = some.path %]` aliases a subtree.
    const offset = kw === "SET" ? 1 : 0;
    const name = t[offset];
    const eq = t[offset + 1];
    if (!name || name.kind !== "ident" || !eq || eq.value !== "=") continue;
    const read = readPath(t, offset + 2, constants);
    if (!read || read.segments.length < 2) continue;
    out.set(name.value, { source: read.segments, isLoop: false });
  }

  return out;
}

/** Convenience: mine a set of documents into one schema. */
export function mineAll(texts: Iterable<string>): SchemaNode {
  const miner = new Miner();
  for (const text of texts) miner.addDocument(text);
  return miner.merged();
}

export { merge as mergeSchema };
