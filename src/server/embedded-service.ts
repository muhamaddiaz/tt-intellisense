/**
 * Forwards completion, hover and folding to the HTML and CSS language services.
 *
 * Diagnostics and formatting are not forwarded: the HTML projection of a
 * branching template is not well-formed —
 * `[% IF a %]<div>[% ELSE %]<span>[% END %]` projects to `<div><span>` — so any
 * feature that reports document validity would be confidently wrong. Folding
 * is safe because it only describes ranges the host services can positively
 * match; incomplete branches simply produce no host range. See ADR 0004.
 */
import {
  getLanguageService as getHtmlService,
  type HTMLDocument,
} from "vscode-html-languageservice";
import { getCSSLanguageService } from "vscode-css-languageservice";
import { TextDocument } from "vscode-languageserver-textdocument";
import type {
  CompletionItem,
  FoldingRange,
  Hover,
  Position,
} from "vscode-languageserver/node";

import { cssProjection, htmlProjection, inDirective, languageAt } from "./embedded";
import type { ParseResult } from "./parser";

const html = getHtmlService();
const css = getCSSLanguageService();

/** Projections are rebuilt when the document version or its length changes. */
interface Projection {
  version: number;
  /**
   * Guards against a client that edits without bumping the version. LSP says
   * it always does, but serving a stale projection silently returns answers
   * for the wrong document, which is a bad failure to debug.
   */
  length: number;
  htmlDoc: TextDocument;
  htmlParsed: HTMLDocument;
  cssDoc: TextDocument;
}

const cache = new Map<string, Projection>();

function projectionFor(doc: TextDocument, result: ParseResult): Projection {
  const text = doc.getText();
  const hit = cache.get(doc.uri);
  if (hit && hit.version === doc.version && hit.length === text.length) return hit;

  const htmlDoc = TextDocument.create(doc.uri, "html", doc.version, htmlProjection(text, result));
  const built: Projection = {
    version: doc.version,
    length: text.length,
    htmlDoc,
    htmlParsed: html.parseHTMLDocument(htmlDoc),
    cssDoc: TextDocument.create(doc.uri, "css", doc.version, cssProjection(text, result)),
  };
  cache.set(doc.uri, built);
  return built;
}

export function forgetProjection(uri: string): void {
  cache.delete(uri);
}

/** Completions from whichever embedded language the cursor is in. */
export function embeddedCompletion(
  doc: TextDocument,
  position: Position,
  result: ParseResult
): CompletionItem[] {
  const text = doc.getText();
  const offset = doc.offsetAt(position);
  const projection = projectionFor(doc, result);

  if (languageAt(text, offset) === "css") {
    return css.doComplete(projection.cssDoc, position, css.parseStylesheet(projection.cssDoc)).items;
  }

  // JavaScript is deliberately not forwarded: a TS virtual document over a
  // branching template costs far more than it returns for templates whose
  // script blocks are mostly src attributes and small snippets.
  if (languageAt(text, offset) === "javascript") return [];

  return html.doComplete(projection.htmlDoc, position, projection.htmlParsed).items;
}

/**
 * The closing tag to insert after the user typed `>` or `/`, as a snippet, or
 * null when nothing should be inserted.
 *
 * Returns a snippet string like `$0</div>`. The client places it; there is no
 * LSP capability for on-type tag closing, so this travels as a custom request.
 */
export function tagCompletion(
  doc: TextDocument,
  position: Position,
  result: ParseResult
): string | null {
  const text = doc.getText();
  const offset = doc.offsetAt(position);

  // A `>` inside a directive belongs to TT — a comparison, or the end of an
  // arrow — and closing an HTML tag there would be nonsense.
  if (inDirective(offset, result)) return null;
  if (languageAt(text, offset) !== "html") return null;

  const projection = projectionFor(doc, result);
  return html.doTagComplete(projection.htmlDoc, position, projection.htmlParsed);
}

/** Foldable HTML elements and CSS blocks, mapped one-to-one to the TT document. */
export function embeddedFoldingRanges(
  doc: TextDocument,
  result: ParseResult
): FoldingRange[] {
  const projection = projectionFor(doc, result);
  return [
    ...html.getFoldingRanges(projection.htmlDoc),
    ...css.getFoldingRanges(projection.cssDoc),
  ];
}

/** Hover from whichever embedded language the cursor is in. */
export function embeddedHover(
  doc: TextDocument,
  position: Position,
  result: ParseResult
): Hover | null {
  const text = doc.getText();
  const offset = doc.offsetAt(position);
  const projection = projectionFor(doc, result);

  if (languageAt(text, offset) === "css") {
    return css.doHover(projection.cssDoc, position, css.parseStylesheet(projection.cssDoc));
  }
  if (languageAt(text, offset) === "javascript") return null;

  return html.doHover(projection.htmlDoc, position, projection.htmlParsed);
}
