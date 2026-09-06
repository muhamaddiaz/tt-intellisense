/**
 * Lexer for Template Toolkit.
 *
 * Two stages. `lexTags` splits a document into raw text and directive tags;
 * `lexTokens` tokenizes the inside of one tag. Both are total: malformed input
 * produces tokens and a flag, never an exception, because an editor sees
 * half-typed documents constantly.
 */

import { DIRECTIVE_INFO } from "./directives";

export type TagKind = "block" | "outline" | "comment";

export interface Tag {
  kind: TagKind;
  /** Offset of `[%` or `%%`. */
  start: number;
  /** Offset just past `%]`, or past end of line for an outline tag. */
  end: number;
  bodyStart: number;
  bodyEnd: number;
  /** Chomp modifier immediately after the opening delimiter, if any. */
  chompStart: string;
  /** Chomp modifier immediately before the closing delimiter, if any. */
  chompEnd: string;
  /** True when the tag ran to end of document without a closing delimiter. */
  unterminated: boolean;
}

export type TokenKind =
  | "keyword"
  | "ident"
  | "number"
  | "string"
  | "operator"
  | "punct"
  | "dollar"
  | "comment"
  | "unknown";

export interface Token {
  kind: TokenKind;
  start: number;
  end: number;
  /** Source text of the token. For strings, the delimiters are included. */
  value: string;
}

/** Every keyword that may begin a directive. */
export const DIRECTIVE_KEYWORDS = new Set(Object.keys(DIRECTIVE_INFO));

/** Keywords that open a block and require a matching END. */
export const BLOCK_OPENERS = new Set([
  "IF", "UNLESS", "FOREACH", "FOR", "WHILE", "SWITCH", "TRY", "WRAPPER",
  "BLOCK", "VIEW", "FILTER", "PERL", "RAWPERL",
]);

/** Keywords valid only as a clause inside a specific block. */
export const CLAUSE_OWNERS: Record<string, ReadonlySet<string>> = {
  ELSIF: new Set(["IF", "UNLESS"]),
  ELSE: new Set(["IF", "UNLESS"]),
  CASE: new Set(["SWITCH"]),
  CATCH: new Set(["TRY"]),
  FINAL: new Set(["TRY"]),
};

/** Words that are operators rather than directives. */
export const WORD_OPERATORS = new Set([
  "IN", "AND", "OR", "NOT", "and", "or", "not", "MOD", "DIV", "div", "mod",
  "TO", "STEP", "EQ", "NE", "LT", "GT", "LE", "GE",
]);

const CHOMP = new Set(["-", "~", "+"]);

/**
 * Splits a document into tags. Text between tags is implicit: anything not
 * covered by a returned tag is literal output.
 *
 * String-aware, so a `%]` inside a quoted argument does not end the tag. That
 * does not occur in the reference corpus, but Template Toolkit permits it and
 * mis-lexing it would silently swallow the rest of the file.
 */
export function lexTags(text: string): Tag[] {
  const tags: Tag[] = [];
  const n = text.length;
  let i = 0;

  while (i < n) {
    // Outline tags: `%%` at the start of a line, terminated by the newline.
    if (text.startsWith("%%", i) && atLineStart(text, i)) {
      const nl = text.indexOf("\n", i);
      const end = nl === -1 ? n : nl + 1;
      const bodyStart = i + 2;
      const bodyEnd = nl === -1 ? n : nl;
      const isComment = text[bodyStart] === "#";
      tags.push({
        kind: isComment ? "comment" : "outline",
        start: i,
        end,
        bodyStart: isComment ? bodyStart + 1 : bodyStart,
        bodyEnd,
        chompStart: "",
        chompEnd: "",
        unterminated: false,
      });
      i = end;
      continue;
    }

    if (!text.startsWith("[%", i)) {
      i++;
      continue;
    }

    let p = i + 2;
    let chompStart = "";
    if (p < n && CHOMP.has(text[p]!)) {
      chompStart = text[p]!;
      p++;
    }

    const isComment = text[p] === "#";
    const bodyStart = isComment ? p + 1 : p;

    const close = findTagEnd(text, bodyStart);
    if (close === -1) {
      tags.push({
        kind: isComment ? "comment" : "block",
        start: i,
        end: n,
        bodyStart,
        bodyEnd: n,
        chompStart,
        chompEnd: "",
        unterminated: true,
      });
      break;
    }

    let bodyEnd = close;
    let chompEnd = "";
    if (bodyEnd > bodyStart && CHOMP.has(text[bodyEnd - 1]!)) {
      chompEnd = text[bodyEnd - 1]!;
      bodyEnd--;
    }

    tags.push({
      kind: isComment ? "comment" : "block",
      start: i,
      end: close + 2,
      bodyStart,
      bodyEnd,
      chompStart,
      chompEnd,
      unterminated: false,
    });
    i = close + 2;
  }

  return tags;
}

function atLineStart(text: string, i: number): boolean {
  for (let k = i - 1; k >= 0; k--) {
    const c = text[k]!;
    if (c === "\n") return true;
    if (c !== " " && c !== "\t") return false;
  }
  return true;
}

/** Offset of the `%]` that closes a tag body, or -1. Skips quoted strings. */
function findTagEnd(text: string, from: number): number {
  const n = text.length;
  let quote: string | null = null;
  for (let k = from; k < n; k++) {
    const c = text[k]!;
    if (quote) {
      if (c === "\\") k++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === "%" && text[k + 1] === "]") return k;
  }
  return -1;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;

/** Multi-character operators, longest first so greedy matching is correct. */
const OPERATORS = ["==", "!=", "<=", ">=", "&&", "||", "=>", "||=", "//"]
  .sort((a, b) => b.length - a.length);

/** Tokenizes a tag body. Never throws. */
export function lexTokens(text: string, bodyStart: number, bodyEnd: number): Token[] {
  const out: Token[] = [];
  let i = bodyStart;

  const push = (kind: TokenKind, start: number, end: number): void => {
    out.push({ kind, start, end, value: text.slice(start, end) });
  };

  while (i < bodyEnd) {
    const c = text[i]!;

    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }

    // A `#` comment runs to end of line, within the tag.
    if (c === "#") {
      let k = i;
      while (k < bodyEnd && text[k] !== "\n") k++;
      push("comment", i, k);
      i = k;
      continue;
    }

    if (c === "'" || c === '"') {
      let k = i + 1;
      while (k < bodyEnd) {
        if (text[k] === "\\") k += 2;
        else if (text[k] === c) { k++; break; }
        else k++;
      }
      push("string", i, Math.min(k, bodyEnd));
      i = Math.min(k, bodyEnd);
      continue;
    }

    if (c === "$") {
      let k = i + 1;
      if (text[k] === "{") {
        while (k < bodyEnd && text[k] !== "}") k++;
        k = Math.min(k + 1, bodyEnd);
      } else {
        // Stops at `.`: in a directive `$board_type.format` is a dynamic path
        // segment followed by a field access, not one long name. Interpolation
        // inside strings is handled by the string token itself.
        while (k < bodyEnd && IDENT_PART.test(text[k]!)) k++;
      }
      push("dollar", i, k);
      i = k;
      continue;
    }

    if (c >= "0" && c <= "9") {
      let k = i;
      while (k < bodyEnd && /[0-9]/.test(text[k]!)) k++;
      if (text[k] === "." && /[0-9]/.test(text[k + 1] ?? "")) {
        k++;
        while (k < bodyEnd && /[0-9]/.test(text[k]!)) k++;
      }
      push("number", i, k);
      i = k;
      continue;
    }

    if (IDENT_START.test(c)) {
      let k = i;
      while (k < bodyEnd && IDENT_PART.test(text[k]!)) k++;
      const word = text.slice(i, k);
      const kind: TokenKind =
        DIRECTIVE_KEYWORDS.has(word) || WORD_OPERATORS.has(word) ? "keyword" : "ident";
      push(kind, i, k);
      i = k;
      continue;
    }

    const two = text.slice(i, i + 2);
    if (OPERATORS.includes(two)) {
      push("operator", i, i + 2);
      i += 2;
      continue;
    }

    if ("=<>!+-*/%?:|".includes(c)) {
      push("operator", i, i + 1);
      i++;
      continue;
    }

    if ("().,;[]{}".includes(c)) {
      push("punct", i, i + 1);
      i++;
      continue;
    }

    push("unknown", i, i + 1);
    i++;
  }

  return out;
}
