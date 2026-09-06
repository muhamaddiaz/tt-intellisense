/**
 * Error-tolerant parser for Template Toolkit.
 *
 * Produces a block tree, the directive list, and structural diagnostics. It
 * never throws and never gives up: unbalanced input still yields a tree, since
 * an editor asks for symbols and folding while the document is half-typed.
 *
 * The parser is deliberately shallow. It resolves block structure and directive
 * heads, which is what diagnostics, folding, symbols and scope tracking need.
 * It does not build an expression tree; variable paths are read from the token
 * stream by consumers that want them.
 */
import {
  BLOCK_OPENERS,
  CLAUSE_OWNERS,
  DIRECTIVE_KEYWORDS,
  lexTags,
  lexTokens,
  type Tag,
  type Token,
} from "./lexer";

export interface Directive {
  /** Leading keyword, uppercased, or null for a bare expression like `[% foo %]`. */
  keyword: string | null;
  keywordToken: Token | null;
  tokens: Token[];
  start: number;
  end: number;
  tag: Tag;
}

export interface ParsedBlock {
  /** The keyword that opened this block: IF, FOREACH, BLOCK, ... */
  keyword: string;
  /** Name for BLOCK and MACRO, or the assignment target of `[% x = BLOCK %]`. */
  name: string | null;
  /** Offsets of the name token, when there is one. */
  nameStart: number | null;
  nameEnd: number | null;
  opener: Directive;
  clauses: Directive[];
  closer: Directive | null;
  children: ParsedBlock[];
  /** Offset of the opening tag. */
  start: number;
  /** Offset past the closing tag, or end of document when unclosed. */
  end: number;
}

export type DiagnosticCode =
  | "unterminated-tag"
  | "unexpected-end"
  | "unclosed-block"
  | "misplaced-clause"
  | "clause-after-else"
  | "unknown-directive";

export interface ParseDiagnostic {
  code: DiagnosticCode;
  severity: "error" | "warning";
  message: string;
  start: number;
  end: number;
  /** Offsets of a related location, e.g. the block an END would have closed. */
  relatedStart?: number;
  relatedEnd?: number;
}

export interface ParseResult {
  tags: Tag[];
  directives: Directive[];
  /** Top-level blocks; nested ones hang off `children`. */
  blocks: ParsedBlock[];
  /** Every block, in document order, for cheap lookup. */
  allBlocks: ParsedBlock[];
  diagnostics: ParseDiagnostic[];
}

/** Splits a tag body into directives on `;`, respecting parens and strings. */
function splitDirectives(tokens: Token[]): Token[][] {
  const out: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;

  for (const t of tokens) {
    if (t.kind === "comment") continue;
    if (t.kind === "punct" && t.value === "(") depth++;
    else if (t.kind === "punct" && t.value === ")") depth--;
    else if (t.kind === "punct" && t.value === ";" && depth === 0) {
      if (current.length) out.push(current);
      current = [];
      continue;
    }
    current.push(t);
  }
  if (current.length) out.push(current);
  return out;
}

/**
 * Determines what a directive opens, if anything.
 *
 * Only the leading keyword can open a block. Everything after it is side-effect
 * notation: `[% NEXT IF row.hidden %]` and `[% INCLUDE h FILTER html %]` are a
 * single statement each, not the start of an IF or a FILTER block.
 */
function classify(tokens: Token[]): {
  keyword: string | null;
  keywordToken: Token | null;
  opens: string | null;
  name: string | null;
  nameToken: Token | null;
} {
  const first = tokens[0];
  if (!first) return { keyword: null, keywordToken: null, opens: null, name: null, nameToken: null };

  // `[% x = BLOCK %]` — an anonymous block captured into a variable.
  if (first.kind === "ident" && tokens[1]?.value === "=" && tokens[2]?.value === "BLOCK") {
    return {
      keyword: "BLOCK",
      keywordToken: tokens[2]!,
      opens: "BLOCK",
      name: first.value,
      nameToken: first,
    };
  }

  if (first.kind !== "keyword" || !DIRECTIVE_KEYWORDS.has(first.value)) {
    return { keyword: null, keywordToken: null, opens: null, name: null, nameToken: null };
  }

  const kw = first.value;

  // MACRO opens a block only in `[% MACRO name BLOCK %]`; the commoner
  // `[% MACRO name(a) GET a %]` is a single statement.
  if (kw === "MACRO") {
    const blockAt = tokens.findIndex((t) => t.value === "BLOCK");
    const nameToken = tokens[1]?.kind === "ident" ? tokens[1]! : null;
    return {
      keyword: kw,
      keywordToken: first,
      opens: blockAt > 0 ? "BLOCK" : null,
      name: nameToken?.value ?? null,
      nameToken,
    };
  }

  // BLOCK and VIEW both take a name that identifies them elsewhere.
  if (kw === "BLOCK" || kw === "VIEW") {
    const nameToken =
      tokens[1] && (tokens[1].kind === "ident" || tokens[1].kind === "string")
        ? tokens[1]
        : null;
    const name = nameToken ? nameToken.value.replace(/^['"]|['"]$/g, "") : null;
    return { keyword: kw, keywordToken: first, opens: kw, name, nameToken };
  }

  return {
    keyword: kw,
    keywordToken: first,
    opens: BLOCK_OPENERS.has(kw) ? kw : null,
    name: null,
    nameToken: null,
  };
}

/** Levenshtein distance, capped: we only care about "very close". */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length]!;
}

/**
 * Finds the directive keyword a mistyped head was probably meant to be.
 *
 * Only near-misses count. An earlier version flagged any bare uppercase head,
 * which fired on legitimate constant-style variables in the reference corpus —
 * `[% DEFAULT_COMMISSION %]`, `[% HISTORICAL_DATA_SHOWN %]`. Requiring a small
 * edit distance keeps `FOEACH` and `ENDD` while leaving those alone.
 *
 * Heads shorter than four characters are never flagged: `ID` is one edit from
 * `IF`, and a variable called `ID` is far likelier than that typo.
 */
function didYouMean(tokens: Token[]): string | null {
  const first = tokens[0];
  if (!first || first.kind !== "ident") return null;
  if (!/^[A-Z][A-Z0-9_]{3,}$/.test(first.value)) return null;

  // An uppercase head used as a variable is legitimate: assigned to, indexed,
  // called, or a member access. Only a bare head is suspicious.
  const next = tokens[1];
  if (next && (next.kind === "operator" || (next.kind === "punct" && ".([".includes(next.value)))) {
    return null;
  }

  let best: string | null = null;
  let bestDistance = 3;
  for (const kw of DIRECTIVE_KEYWORDS) {
    const d = editDistance(first.value, kw, 2);
    if (d < bestDistance) {
      bestDistance = d;
      best = kw;
    }
  }
  return best;
}

export function parse(text: string): ParseResult {
  const tags = lexTags(text);
  const directives: Directive[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  const allBlocks: ParsedBlock[] = [];
  const roots: ParsedBlock[] = [];
  const stack: ParsedBlock[] = [];

  const currentChildren = (): ParsedBlock[] =>
    stack.length ? stack[stack.length - 1]!.children : roots;

  for (const tag of tags) {
    if (tag.unterminated) {
      diagnostics.push({
        code: "unterminated-tag",
        severity: "error",
        message: "Unterminated directive: expected `%]`.",
        start: tag.start,
        end: Math.min(tag.start + 2, text.length),
      });
    }
    if (tag.kind === "comment") continue;

    const tokens = lexTokens(text, tag.bodyStart, tag.bodyEnd);

    for (const group of splitDirectives(tokens)) {
      const info = classify(group);
      const directive: Directive = {
        keyword: info.keyword,
        keywordToken: info.keywordToken,
        tokens: group,
        start: group[0]!.start,
        end: group[group.length - 1]!.end,
        tag,
      };
      directives.push(directive);

      if (!info.keyword) {
        const suggestion = didYouMean(group);
        if (suggestion) {
          const t = group[0]!;
          diagnostics.push({
            code: "unknown-directive",
            severity: "error",
            message: `Unknown directive \`${t.value}\`. Did you mean \`${suggestion}\`?`,
            start: t.start,
            end: t.end,
          });
          continue;
        }
      }

      const kw = info.keyword;

      if (kw === "END") {
        const open = stack.pop();
        if (!open) {
          diagnostics.push({
            code: "unexpected-end",
            severity: "error",
            message: "`END` with no matching block.",
            start: directive.start,
            end: directive.end,
          });
          continue;
        }
        open.closer = directive;
        open.end = tag.end;
        continue;
      }

      const owners = kw ? CLAUSE_OWNERS[kw] : undefined;
      if (owners) {
        const open = stack[stack.length - 1];
        if (!open || !owners.has(open.keyword)) {
          diagnostics.push({
            code: "misplaced-clause",
            severity: "error",
            message: `\`${kw}\` is only valid inside ${[...owners].join(" or ")}.`,
            start: directive.start,
            end: directive.end,
          });
          continue;
        }
        if (open.clauses.some((c) => c.keyword === "ELSE")) {
          diagnostics.push({
            code: "clause-after-else",
            severity: "error",
            message: `\`${kw}\` cannot follow \`ELSE\`.`,
            start: directive.start,
            end: directive.end,
          });
          continue;
        }
        open.clauses.push(directive);
        continue;
      }

      if (info.opens) {
        const block: ParsedBlock = {
          keyword: info.opens,
          name: info.name,
          nameStart: info.nameToken?.start ?? null,
          nameEnd: info.nameToken?.end ?? null,
          opener: directive,
          clauses: [],
          closer: null,
          children: [],
          start: tag.start,
          end: text.length,
        };
        currentChildren().push(block);
        allBlocks.push(block);
        stack.push(block);
      }
    }
  }

  for (const open of stack) {
    diagnostics.push({
      code: "unclosed-block",
      severity: "error",
      message: `\`${open.keyword}\` is never closed: expected \`[% END %]\`.`,
      start: open.opener.start,
      end: open.opener.end,
    });
  }

  diagnostics.sort((a, b) => a.start - b.start);
  return { tags, directives, blocks: roots, allBlocks, diagnostics };
}

/** A directive naming another template or block. */
export interface TemplateRef {
  name: string;
  kind: "INCLUDE" | "PROCESS" | "INSERT" | "WRAPPER";
  start: number;
  end: number;
}

const REF_KEYWORDS = new Set(["INCLUDE", "PROCESS", "INSERT", "WRAPPER"]);

/**
 * Reassembles a bare template name from adjacent tokens.
 *
 * The lexer splits `esg/include_header.tt` into five tokens, so the name is
 * rebuilt by walking tokens that touch each other with no whitespace between.
 * The gap is what separates the name from a following argument, which is why
 * `[% INCLUDE row.tt label = x %]` yields `row.tt` and not `row.tt label`.
 */
function joinName(tokens: Token[], from: number): { name: string; start: number; end: number } | null {
  const first = tokens[from];
  if (!first) return null;

  if (first.kind === "string") {
    const quoted = first.value;
    const name = quoted.slice(1, quoted.endsWith(quoted[0]!) && quoted.length > 1 ? -1 : undefined);
    return { name, start: first.start + 1, end: first.start + 1 + name.length };
  }

  if (first.kind !== "ident") return null;

  let end = from;
  for (let i = from + 1; i < tokens.length; i++) {
    const t = tokens[i]!;
    const prev = tokens[i - 1]!;
    if (t.start !== prev.end) break;
    const joinable =
      t.kind === "ident" ||
      t.kind === "number" ||
      (t.kind === "punct" && t.value === ".") ||
      (t.kind === "operator" && (t.value === "/" || t.value === "-"));
    if (!joinable) break;
    end = i;
  }

  const last = tokens[end]!;
  // A trailing separator is punctuation, not part of the name.
  if (last.kind !== "ident" && last.kind !== "number") {
    if (end === from) return null;
    end--;
  }

  const stop = tokens[end]!.end;

  // A name butting straight up against interpolation is dynamic. Without this
  // `page_${x}.tt` reads as the literal `page_` and jumps somewhere plausible
  // but wrong, which is worse than not jumping at all.
  const next = tokens[end + 1];
  if (next && next.start === stop && (next.kind === "dollar" || next.value === "{")) return null;

  return { name: tokensText(tokens, from, end), start: first.start, end: stop };
}

function tokensText(tokens: Token[], from: number, to: number): string {
  let out = "";
  for (let i = from; i <= to; i++) out += tokens[i]!.value;
  return out;
}

/** Every resolvable template reference in a parsed document. */
export function templateRefs(result: ParseResult): TemplateRef[] {
  const refs: TemplateRef[] = [];

  for (const directive of result.directives) {
    if (!directive.keyword || !REF_KEYWORDS.has(directive.keyword)) continue;

    const joined = joinName(directive.tokens, 1);
    if (!joined) continue;

    // Dynamic targets cannot be resolved without evaluating the stash, and a
    // wrong jump is worse than none.
    if (joined.name.includes("$") || directive.tokens[1]?.kind === "dollar") continue;

    refs.push({
      name: joined.name,
      kind: directive.keyword as TemplateRef["kind"],
      start: joined.start,
      end: joined.end,
    });
  }

  return refs;
}
