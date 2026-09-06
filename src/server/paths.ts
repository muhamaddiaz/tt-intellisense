/**
 * Reading variable paths out of a token stream.
 *
 * Shared by the miner and the completion engine so that both resolve a path
 * the same way. They previously had separate readers, and the completion side
 * silently lacked constant folding, which made a `$dynamic` segment truncate
 * the path and resolve loop aliases to the wrong node.
 */
import type { Token } from "./lexer";
import type { ParseResult } from "./parser";

export interface PathRead {
  segments: string[];
  /** Index just past the path. */
  next: number;
  /** True when the final segment was a method call rather than a field. */
  endedInCall: boolean;
}

/**
 * Reads a dotted path starting at `i`.
 *
 * A `$name` segment is dynamic. When the template assigned a literal to that
 * name earlier, `constants` resolves it: `[% board_type = 'director' %]`
 * followed by `ir.var.x.$board_type.format` yields a real path instead of a
 * dead end. That pattern is common enough in practice to be worth folding.
 */
export function readVariablePath(
  tokens: Token[],
  i: number,
  constants: ReadonlyMap<string, string>
): PathRead | null {
  const first = tokens[i];
  if (!first || (first.kind !== "ident" && first.kind !== "dollar")) return null;

  const nameOf = (t: Token): string | null => {
    if (t.kind === "ident") return t.value;
    const bare = t.value.replace(/^\$\{?/, "").replace(/\}$/, "");
    return constants.get(bare) ?? null;
  };

  const head = nameOf(first);
  if (head === null) return null;
  const segments = [head];

  let k = i + 1;
  let endedInCall = false;
  while (k + 1 < tokens.length) {
    const dot = tokens[k]!;
    const next = tokens[k + 1]!;
    if (!(dot.kind === "punct" && dot.value === ".")) break;
    if (dot.start !== tokens[k - 1]!.end) break;
    if (next.start !== dot.end) break;
    if (next.kind !== "ident" && next.kind !== "dollar") break;

    const after = tokens[k + 2];
    if (after && after.kind === "punct" && after.value === "(" && after.start === next.end) {
      endedInCall = true;
      k += 2;
      break;
    }

    const name = nameOf(next);
    if (name === null) {
      // An unresolvable dynamic segment ends the path: guessing past it would
      // attach members to the wrong node.
      k += 2;
      break;
    }
    segments.push(name);
    k += 2;
  }

  return { segments, next: k, endedInCall };
}

/** Literal string assignments in a document, for folding `$var` segments. */
export function collectConstants(result: ParseResult): Map<string, string> {
  const out = new Map<string, string>();
  for (const directive of result.directives) {
    const t = directive.tokens;
    const offset = directive.keyword === "SET" ? 1 : 0;
    const name = t[offset];
    const eq = t[offset + 1];
    const value = t[offset + 2];
    if (!name || !eq || !value) continue;
    if (name.kind !== "ident" || eq.value !== "=" || value.kind !== "string") continue;
    if (t[offset + 3]) continue;
    out.set(name.value, value.value.slice(1, -1));
  }
  return out;
}
