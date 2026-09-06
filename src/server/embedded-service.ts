/**
 * Forwards completion and hover to the HTML and CSS language services.
 *
 * Only completion and hover are forwarded. Diagnostics, formatting and folding
 * are not: the HTML projection of a branching template is not well-formed —
 * `[% IF a %]<div>[% ELSE %]<span>[% END %]` projects to `<div><span>` — so any
 * feature that reasons about document validity would be confidently wrong. See
 * ADR 0004.
 */
import {
  getLanguageService as getHtmlService,
  type HTMLDocument,
} from "vscode-html-languageservice";
import { getCSSLanguageService } from "vscode-css-languageservice";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { CompletionItem, Hover, Position } from "vscode-languageserver/node";

import { cssProjection, htmlProjection, languageAt } from "./embedded";
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
