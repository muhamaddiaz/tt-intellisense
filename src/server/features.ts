/**
 * Editor features derived from a parse: diagnostics, folding and symbols.
 *
 * Offset-to-position conversion is injected so this module stays free of any
 * document implementation and can be tested without one.
 */
import {
  DiagnosticSeverity,
  SymbolKind,
  type Diagnostic,
  type DocumentSymbol,
  type FoldingRange,
  type Position,
} from "vscode-languageserver/node";
import type { ParsedBlock, ParseResult } from "./parser";
import type { Token } from "./lexer";

export type PositionAt = (offset: number) => Position;

const SOURCE = "tt";

export function toDiagnostics(result: ParseResult, positionAt: PositionAt): Diagnostic[] {
  return result.diagnostics.map((d) => ({
    severity: d.severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
    range: { start: positionAt(d.start), end: positionAt(d.end) },
    message: d.message,
    source: SOURCE,
    code: d.code,
  }));
}

/**
 * One folding range per block, plus one per clause segment so an IF/ELSE can
 * be collapsed a branch at a time.
 *
 * A range is only emitted when it spans more than one line; collapsing a
 * single-line `[% IF x %]y[% END %]` would hide the whole thing.
 */
export function toFoldingRanges(result: ParseResult, positionAt: PositionAt): FoldingRange[] {
  const ranges: FoldingRange[] = [];

  const add = (startOffset: number, endOffset: number): void => {
    const startLine = positionAt(startOffset).line;
    const endLine = positionAt(endOffset).line;
    if (endLine > startLine) ranges.push({ startLine, endLine: endLine - 1 });
  };

  for (const block of result.allBlocks) {
    add(block.opener.tag.end, block.closer ? block.closer.tag.start : block.end);

    let segmentStart = block.opener.tag.end;
    for (const clause of block.clauses) {
      add(segmentStart, clause.tag.start);
      segmentStart = clause.tag.end;
    }
    if (block.clauses.length) {
      add(segmentStart, block.closer ? block.closer.tag.start : block.end);
    }
  }

  return ranges;
}

/** A short, readable label for a block, for the outline view. */
function labelFor(block: ParsedBlock): string {
  if (block.name) return block.name;

  const args = block.opener.tokens
    .slice(1)
    .filter((t: Token) => t.kind !== "comment")
    .map((t: Token) => t.value)
    .join(" ")
    .replace(/\s+([.(),])/g, "$1")
    .replace(/([.(])\s+/g, "$1")
    .trim();

  const label = args ? `${block.keyword} ${args}` : block.keyword;
  return label.length > 60 ? `${label.slice(0, 57)}…` : label;
}

function kindFor(block: ParsedBlock): SymbolKind {
  switch (block.keyword) {
    case "BLOCK":
      return SymbolKind.Function;
    case "VIEW":
      return SymbolKind.Class;
    case "FOREACH":
    case "FOR":
    case "WHILE":
      return SymbolKind.Array;
    case "IF":
    case "UNLESS":
    case "SWITCH":
      return SymbolKind.Boolean;
    case "TRY":
      return SymbolKind.Event;
    case "WRAPPER":
    case "FILTER":
      return SymbolKind.Namespace;
    default:
      return SymbolKind.Key;
  }
}

/**
 * Blocks as a hierarchical outline. Templates here nest deeply and run to
 * 130 KB, so structure navigation is worth more than a flat list of names.
 */
export function toDocumentSymbols(
  result: ParseResult,
  positionAt: PositionAt
): DocumentSymbol[] {
  const build = (block: ParsedBlock): DocumentSymbol => {
    const range = { start: positionAt(block.start), end: positionAt(block.end) };
    const selection =
      block.nameStart !== null && block.nameEnd !== null
        ? { start: positionAt(block.nameStart), end: positionAt(block.nameEnd) }
        : { start: positionAt(block.opener.start), end: positionAt(block.opener.end) };

    return {
      name: labelFor(block),
      kind: kindFor(block),
      range,
      // The selection range must sit inside the full range or clients complain.
      selectionRange: selection,
      children: block.children.map(build),
    };
  };

  return result.blocks.map(build);
}
