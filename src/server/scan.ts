/**
 * Light structural scan of a Template Toolkit document.
 *
 * Deliberately not a parser. M2 needs only template references and block
 * definitions, both of which are unambiguous at the tag level, and shipping
 * navigation early is worth more than waiting for the real parser. The parser
 * arrives in M3 and this module retires into it — see docs/adr/0002.
 *
 * What it does handle, because getting these wrong produces wrong jumps:
 * comment tags, quoted names, multiple directives in one tag, multi-line tags,
 * and chomp modifiers.
 */

/** A directive that names another template or block. */
export interface TemplateRef {
  /** The referenced name, exactly as written, minus any quotes. */
  name: string;
  kind: "INCLUDE" | "PROCESS" | "INSERT" | "WRAPPER";
  /** Offsets of the name itself, for links and go-to-definition. */
  start: number;
  end: number;
}

/** A `[% BLOCK name %]` definition in this document. */
export interface BlockDef {
  name: string;
  /** Offsets of the name in the BLOCK directive. */
  nameStart: number;
  nameEnd: number;
}

export interface ScanResult {
  refs: TemplateRef[];
  blocks: BlockDef[];
}

const TAG = /\[%(?!#)([\s\S]*?)%\]/g;

const REF_KINDS = new Set(["INCLUDE", "PROCESS", "INSERT", "WRAPPER"]);

/**
 * A directive's name argument: a bare path, or a quoted string. Names holding
 * a `$` are dynamic and deliberately skipped — we cannot resolve them without
 * evaluating the stash, and a wrong jump is worse than none.
 */
const NAME = /^\s*(?:'([^']*)'|"([^"]*)"|([A-Za-z_][\w./-]*))/;

/** Split a tag body on `;`, keeping each piece's offset within the body. */
function directives(body: string): Array<{ text: string; offset: number }> {
  const out: Array<{ text: string; offset: number }> = [];
  let depth = 0;
  let start = 0;
  let quote: string | null = null;

  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ";" && depth === 0) {
      out.push({ text: body.slice(start, i), offset: start });
      start = i + 1;
    }
  }
  out.push({ text: body.slice(start), offset: start });
  return out;
}

/** Strip a trailing `#` line comment, which runs to end of line within a tag. */
function stripComment(text: string): string {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === "#") return text.slice(0, i);
  }
  return text;
}

export function scan(text: string): ScanResult {
  const refs: TemplateRef[] = [];
  const blocks: BlockDef[] = [];

  TAG.lastIndex = 0;
  let tag: RegExpExecArray | null;
  while ((tag = TAG.exec(text)) !== null) {
    const body = tag[1] ?? "";
    const bodyStart = tag.index + 2;

    for (const d of directives(body)) {
      const src = stripComment(d.text);
      // Chomp modifiers sit at the tag edges, not before a keyword, but a
      // leading `-` survives into the first directive's text.
      const kw = /^[\s\-~+]*([A-Za-z_]+)\b/.exec(src);
      if (!kw) continue;

      const keyword = kw[1]!;
      const afterKeyword = src.slice(kw[0].length);
      const argStart = bodyStart + d.offset + kw[0].length;

      const m = NAME.exec(afterKeyword);
      if (!m) continue;

      const raw = m[1] ?? m[2] ?? m[3];
      if (raw === undefined || raw.includes("$")) continue;

      // A bare name stops at `$`, so `page_${x}.tt` would otherwise be read as
      // the literal `page_`. Anything butting up against interpolation is
      // dynamic, and a wrong jump is worse than no jump.
      if (m[3] !== undefined) {
        const next = afterKeyword[m[0].length];
        if (next === "$" || next === "{") continue;
      }

      // Offset of the name within the match, skipping leading space and quote.
      const lead = m[0].length - raw.length - (m[3] === undefined ? 1 : 0);
      const start = argStart + lead;

      if (REF_KINDS.has(keyword)) {
        refs.push({
          name: raw,
          kind: keyword as TemplateRef["kind"],
          start,
          end: start + raw.length,
        });
      } else if (keyword === "BLOCK") {
        blocks.push({ name: raw, nameStart: start, nameEnd: start + raw.length });
      }
    }
  }

  return { refs, blocks };
}
