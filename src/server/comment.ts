/**
 * Context-aware comment toggling.
 *
 * A `.tt` file holds four languages at once, each with its own comment syntax,
 * and VS Code's static `comments` configuration can only describe one. Worse,
 * commenting a Template Toolkit directive is not wrapping it in delimiters at
 * all — it is rewriting `[%` into `[%#`. No comment configuration can express
 * that, so the whole operation is computed here, where the parser is, and the
 * client just applies the edits it is handed.
 *
 * The context is taken from the start of each selection, so a selection that
 * straddles a boundary is treated as belonging to where it began — the same
 * choice VS Code makes for its own embedded languages.
 */
import type { ParseResult } from "./parser";
import { languageAt, styleRegions, scriptRegions } from "./embedded";

export interface Edit {
  start: number;
  end: number;
  newText: string;
}

export type CommentContext = "directive" | "html" | "css" | "javascript";

/** Where a position sits, for comment purposes. */
export function commentContextAt(
  text: string,
  offset: number,
  result: ParseResult
): CommentContext {
  // Inside the delimiters of a directive, TT's own comment form applies.
  const tag = result.tags.find((t) => offset > t.start && offset < t.end);
  if (tag) return "directive";

  const lang = languageAt(text, offset);
  return lang === "css" ? "css" : lang === "javascript" ? "javascript" : "html";
}

function lineBoundsAt(text: string, offset: number): { start: number; end: number } {
  const start = text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  let end = text.indexOf("\n", offset);
  if (end === -1) end = text.length;
  return { start, end };
}

/** The whole-line span covering a selection, so toggling is line-based. */
function lineSpan(text: string, from: number, to: number): { start: number; end: number } {
  const first = lineBoundsAt(text, from);
  const last = lineBoundsAt(text, Math.max(from, to === from ? to : to - 1));
  return { start: first.start, end: last.end };
}

/**
 * Toggles a directive comment by adding or removing the `#` after `[%`.
 *
 * `[% foo %]` becomes `[%# foo %]`, and back. Chomp modifiers sit between the
 * delimiter and the `#`, so `[%- foo %]` becomes `[%-# foo %]` and keeps its
 * whitespace behaviour.
 */
function toggleDirective(text: string, offset: number, result: ParseResult): Edit[] {
  const tag = result.tags.find((t) => offset > t.start && offset < t.end);
  if (!tag) return [];

  // Position just past `[%` and any chomp modifier.
  const afterDelimiter = tag.start + 2 + tag.chompStart.length;

  // Exactly one character is added or removed, so toggling twice restores the
  // original text. Inserting a space on the way in and guessing whether to
  // strip it on the way out does not round-trip.
  if (tag.kind === "comment") {
    return [{ start: afterDelimiter, end: afterDelimiter + 1, newText: "" }];
  }
  return [{ start: afterDelimiter, end: afterDelimiter, newText: "#" }];
}

interface BlockDelimiters {
  open: string;
  close: string;
}

const BLOCK: Record<Exclude<CommentContext, "directive">, BlockDelimiters> = {
  html: { open: "<!--", close: "-->" },
  css: { open: "/*", close: "*/" },
  javascript: { open: "/*", close: "*/" },
};

/**
 * Toggles a block comment around whole lines.
 *
 * Line-based rather than character-based because that is what pressing the
 * comment key with no selection means to a reader, and it keeps the result
 * stable when the same lines are toggled twice.
 */
function toggleBlock(
  text: string,
  from: number,
  to: number,
  kind: Exclude<CommentContext, "directive">
): Edit[] {
  const { open, close } = BLOCK[kind];
  const span = lineSpan(text, from, to);
  const body = text.slice(span.start, span.end);
  const trimmed = body.trim();

  // Commenting nothing produces an empty comment, which is never what was
  // meant and leaves the document dirtier than it was.
  if (trimmed === "") return [];

  if (trimmed.startsWith(open) && trimmed.endsWith(close) && trimmed.length >= open.length + close.length) {
    // Uncomment: strip the delimiters and one adjacent space each side.
    const leading = body.length - body.trimStart().length;
    let inner = trimmed.slice(open.length, trimmed.length - close.length);
    if (inner.startsWith(" ")) inner = inner.slice(1);
    if (inner.endsWith(" ")) inner = inner.slice(0, -1);
    return [
      {
        start: span.start + leading,
        end: span.start + leading + trimmed.length,
        newText: inner,
      },
    ];
  }

  const leading = body.length - body.trimStart().length;
  const trailing = body.length - body.trimEnd().length;
  return [
    { start: span.start + leading, end: span.start + leading, newText: `${open} ` },
    { start: span.end - trailing, end: span.end - trailing, newText: ` ${close}` },
  ];
}

/**
 * Edits that toggle comments for a set of selections.
 *
 * At most one edit is produced per line. Two cursors inside one directive would
 * otherwise each insert a `#`, and a cursor in a directive alongside one in the
 * surrounding HTML would comment the same line twice, in two syntaxes. When
 * selections on a line disagree about context the first in document order wins,
 * which is arbitrary but predictable and never produces overlapping edits.
 */
export function toggleComment(
  text: string,
  result: ParseResult,
  selections: Array<{ start: number; end: number }>
): Edit[] {
  const ordered = [...selections].sort((a, b) => a.start - b.start);
  const edits: Edit[] = [];
  const claimedLines = new Set<number>();

  for (const selection of ordered) {
    const span = lineSpan(text, selection.start, selection.end);

    // Every line the selection touches, so a multi-line selection cannot be
    // commented again by a later cursor sitting inside it.
    const lines: number[] = [];
    let cursor = span.start;
    while (cursor <= span.end) {
      lines.push(cursor);
      const nextBreak = text.indexOf("\n", cursor);
      if (nextBreak === -1 || nextBreak >= span.end) break;
      cursor = nextBreak + 1;
    }
    if (lines.some((l) => claimedLines.has(l))) continue;
    for (const l of lines) claimedLines.add(l);

    const context = commentContextAt(text, selection.start, result);
    if (context === "directive") {
      edits.push(...toggleDirective(text, selection.start, result));
      continue;
    }
    edits.push(...toggleBlock(text, selection.start, selection.end, context));
  }

  // Applied back to front so earlier offsets stay valid.
  return edits.sort((a, b) => b.start - a.start);
}

export { styleRegions, scriptRegions };
