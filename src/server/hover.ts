/**
 * Hover for directive keywords and variable paths.
 *
 * Shows what the schema knows: the path, its shape, where the knowledge came
 * from, and a sample value when a dump supplied one. Values whose key looks
 * secret-bearing arrive already redacted from the schema layer — redaction is
 * not a display concern, so it cannot be bypassed by another consumer.
 */
import type { ParseResult } from "./parser";
import { directiveInfo } from "./directives";
import { collectConstants, readVariablePath } from "./paths";
import { resolvePath, scopeAt, type ScopeBinding } from "./complete";
import type { Layer, SchemaNode } from "./schema/model";

export interface HoverInfo {
  /** The directive keyword or full variable path under the cursor. */
  path: string[];
  /** Offsets of the path in the document. */
  start: number;
  end: number;
  markdown: string;
}

const LAYER_LABEL: Record<Layer, string> = {
  curated: "curated schema",
  dump: "stash dump",
  mined: "seen in workspace templates",
};

/** Finds the variable path under `offset`, if any. */
export function pathAt(
  text: string,
  offset: number,
  result: ParseResult
): { path: string[]; start: number; end: number } | null {
  const tag = result.tags.find(
    (t) => t.kind !== "comment" && offset >= t.bodyStart && offset <= t.bodyEnd
  );
  if (!tag) return null;

  const directive = result.directives.find(
    (d) => d.tag === tag && offset >= d.start && offset <= d.end
  );
  if (!directive) return null;

  const constants = collectConstants(result);

  for (let i = 0; i < directive.tokens.length; i++) {
    const token = directive.tokens[i]!;
    if (token.kind !== "ident" && token.kind !== "dollar") continue;
    const prev = directive.tokens[i - 1];
    if (prev && prev.kind === "punct" && prev.value === "." && prev.start === token.start - 1) {
      continue;
    }

    const read = readVariablePath(directive.tokens, i, constants);
    if (!read) continue;
    const last = directive.tokens[Math.max(i, read.next - 1)]!;
    if (offset >= token.start && offset <= last.end) {
      // `readVariablePath` already stops before a method name, so the segments
      // are the receiver path whether or not the path ended in a call.
      return { path: read.segments, start: token.start, end: last.end };
    }
    i = Math.max(i, read.next - 1);
  }

  return null;
}

function shapeOf(n: SchemaNode): string {
  switch (n.kind) {
    case "list":
      return n.element ? `list of ${n.element.children.size} fields` : "list";
    case "hash":
      return `hash · ${n.children.size} fields`;
    case "scalar":
      return "scalar";
    default:
      return "variable";
  }
}

/** Builds hover markdown for the path at an offset, or null. */
export function hoverAt(
  text: string,
  offset: number,
  result: ParseResult,
  schema: SchemaNode
): HoverInfo | null {
  for (const directive of result.directives) {
    const token = directive.keywordToken;
    if (!token || offset < token.start || offset > token.end) continue;

    const info = directiveInfo(token.value);
    if (info) {
      return {
        path: [token.value],
        start: token.start,
        end: token.end,
        markdown: ["```tt", info.syntax, "```", info.description].join("\n"),
      };
    }
  }

  const found = pathAt(text, offset, result);
  if (!found) return null;

  const scope = scopeAt(result, offset);
  const binding: ScopeBinding | undefined = scope.get(found.path[0]!);
  const node = resolvePath(found.path, schema, scope);

  const lines: string[] = [];
  lines.push("```tt", found.path.join("."), "```");

  if (binding) {
    const via = binding.source?.length ? `\`${binding.source.join(".")}\`` : "an unresolved path";
    lines.push(
      binding.isLoop
        ? `Loop variable over ${via}.`
        : `Local alias of ${via}.`
    );
  }

  if (!node) {
    lines.push(
      binding
        ? "_No shape known for the source path._"
        : "_Not found in any schema layer._ Variable knowledge is incomplete by design, so this is not necessarily a mistake."
    );
    return { ...found, markdown: lines.join("\n") };
  }

  const facts: string[] = [`**${node.type ?? shapeOf(node)}**`];
  if (node.value !== undefined) {
    facts.push(node.redacted ? `= ${node.value} _(redacted)_` : `= \`${node.value}\``);
  }
  lines.push(facts.join(" "));

  if (node.description) lines.push("", node.description);

  if (node.kind === "list" && node.element?.children.size) {
    const fields = [...node.element.children.keys()].sort().slice(0, 12);
    lines.push("", `Items carry: ${fields.map((f) => `\`${f}\``).join(", ")}`);
  } else if (node.kind === "hash" && node.children.size) {
    const fields = [...node.children.keys()].sort().slice(0, 12);
    const more = node.children.size - fields.length;
    lines.push(
      "",
      `Fields: ${fields.map((f) => `\`${f}\``).join(", ")}${more > 0 ? ` and ${more} more` : ""}`
    );
  }

  lines.push("", `_Source: ${LAYER_LABEL[node.source]}._`);
  return { ...found, markdown: lines.join("\n") };
}
