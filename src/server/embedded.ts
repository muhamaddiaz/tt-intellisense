/**
 * Virtual documents for the embedded HTML and CSS services.
 *
 * Every projection is the same length as the original and keeps its newlines,
 * with the parts that do not belong replaced by spaces. Positions therefore map
 * one to one and no source map is needed — the usual source of off-by-one bugs
 * in this kind of forwarding simply does not arise.
 *
 * The HTML projection is deliberately imperfect. Blanking directives turns
 *
 *     [% IF a %]<div>[% ELSE %]<span>[% END %]
 *
 * into `<div><span>`, with both branches present and neither closed. Completion
 * copes with that; diagnostics would not, which is why HTML diagnostics are
 * never forwarded. See ADR 0004.
 */
import type { Tag } from "./lexer";
import type { ParseResult } from "./parser";

/** Replaces a span with spaces, preserving newlines so positions still map. */
function blankInto(chars: string[], start: number, end: number): void {
  for (let i = start; i < end && i < chars.length; i++) {
    if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
  }
}

/** The document with every TT directive blanked out. */
export function htmlProjection(text: string, result: ParseResult): string {
  const chars = [...text];
  for (const tag of result.tags) blankInto(chars, tag.start, tag.end);
  return chars.join("");
}

export interface Region {
  start: number;
  end: number;
}

const STYLE = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const SCRIPT = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;

function regionsOf(text: string, pattern: RegExp): Region[] {
  const out: Region[] = [];
  pattern.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const body = m[1] ?? "";
    const start = m.index + m[0].indexOf(body, m[0].indexOf(">"));
    out.push({ start, end: start + body.length });
  }
  return out;
}

/** `<style>` bodies, as offsets into the original document. */
export function styleRegions(text: string): Region[] {
  return regionsOf(text, STYLE);
}

/** `<script>` bodies, as offsets into the original document. */
export function scriptRegions(text: string): Region[] {
  return regionsOf(text, SCRIPT);
}

/**
 * Everything except `<style>` bodies blanked, so the CSS service sees only CSS
 * at exactly the offsets it occupies in the real document.
 */
export function cssProjection(text: string, result: ParseResult): string {
  const regions = styleRegions(text);
  const chars = [...text];

  let cursor = 0;
  for (const region of regions) {
    blankInto(chars, cursor, region.start);
    cursor = region.end;
  }
  blankInto(chars, cursor, chars.length);

  // TT inside a style block is not CSS either.
  for (const tag of result.tags) {
    if (regions.some((r) => tag.start >= r.start && tag.end <= r.end)) {
      blankInto(chars, tag.start, tag.end);
    }
  }

  return chars.join("");
}

/** Which embedded language an offset sits in, ignoring TT. */
export type EmbeddedLanguage = "html" | "css" | "javascript";

export function languageAt(text: string, offset: number): EmbeddedLanguage {
  for (const r of styleRegions(text)) {
    if (offset >= r.start && offset <= r.end) return "css";
  }
  for (const r of scriptRegions(text)) {
    if (offset >= r.start && offset <= r.end) return "javascript";
  }
  return "html";
}

/** True when the offset falls inside any TT tag. */
export function inDirective(offset: number, result: ParseResult): boolean {
  return result.tags.some((t: Tag) => offset > t.start && offset < t.end);
}
