import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import parserPkg from "../out/server/parser.js";
import featuresPkg from "../out/server/features.js";
import wsPkg from "../out/server/workspace.js";
const { parse } = parserPkg;
const { toDiagnostics, toFoldingRanges, toDocumentSymbols } = featuresPkg;
const { BlockIndex } = wsPkg;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Minimal offset->position, matching what a TextDocument would give. */
function positionAtFor(text) {
  return (offset) => {
    const before = text.slice(0, offset);
    const line = before.split("\n").length - 1;
    const character = offset - (before.lastIndexOf("\n") + 1);
    return { line, character };
  };
}

// ------------------------------------------------------------- diagnostics

test("diagnostics carry severity, source and code", () => {
  const src = "[% END %]";
  const [d] = toDiagnostics(parse(src), positionAtFor(src));
  assert.equal(d.severity, 1, "structural problems are errors");
  assert.equal(d.source, "tt");
  assert.equal(d.code, "unexpected-end");
  assert.deepEqual(d.range.start, { line: 0, character: 3 });
});

// ----------------------------------------------------------------- folding

test("a multi-line block folds", () => {
  const src = "[% IF x %]\na\nb\n[% END %]";
  const ranges = toFoldingRanges(parse(src), positionAtFor(src));
  assert.ok(ranges.length >= 1);
  assert.equal(ranges[0].startLine, 0);
  assert.equal(ranges[0].endLine, 2);
});

test("a single-line block does not fold", () => {
  const src = "[% IF x %]y[% END %]";
  assert.deepEqual(toFoldingRanges(parse(src), positionAtFor(src)), []);
});

test("IF/ELSE folds per branch", () => {
  const src = "[% IF x %]\na\n[% ELSE %]\nb\n[% END %]";
  const ranges = toFoldingRanges(parse(src), positionAtFor(src));
  // whole block, plus the IF branch, plus the ELSE branch
  assert.ok(ranges.length >= 3, `expected per-branch folds, got ${ranges.length}`);
});

// ----------------------------------------------------------------- symbols

test("symbols are hierarchical and named", () => {
  const src = "[% FOREACH d IN dirs %]\n[% IF d.x %]\na\n[% END %]\n[% END %]";
  const syms = toDocumentSymbols(src, parse(src), positionAtFor(src));
  assert.equal(syms.length, 1);
  assert.match(syms[0].name, /^FOREACH d IN dirs$/);
  assert.equal(syms[0].children.length, 1);
  assert.match(syms[0].children[0].name, /^IF /);
});

test("a BLOCK symbol is named after the block", () => {
  const src = "[% BLOCK price_row %]\nx\n[% END %]";
  const [sym] = toDocumentSymbols(src, parse(src), positionAtFor(src));
  assert.equal(sym.name, "price_row");
  // The selection range must sit inside the full range.
  assert.ok(sym.selectionRange.start.line >= sym.range.start.line);
  assert.ok(sym.selectionRange.end.line <= sym.range.end.line);
});

test("long symbol labels are truncated", () => {
  const src = `[% IF ${"a.very.long.path".repeat(8)} %]\nx\n[% END %]`;
  const [sym] = toDocumentSymbols(src, parse(src), positionAtFor(src));
  assert.ok(sym.name.length <= 61, `label not truncated: ${sym.name.length}`);
});

test("real fixture produces a usable outline", () => {
  const src = readFileSync(join(root, "test-file-1.tt"), "utf8");
  const syms = toDocumentSymbols(src, parse(src), positionAtFor(src));
  assert.ok(syms.length > 0);
  const depth = (s) => 1 + Math.max(0, ...s.children.map(depth));
  assert.ok(Math.max(...syms.map(depth)) >= 3, "outline is flat; expected nesting");
});

// ------------------------------------------------------------------- index

function sandbox() {
  const d = mkdtempSync(join(tmpdir(), "tt-index-"));
  mkdirSync(join(d, "a"), { recursive: true });
  mkdirSync(join(d, "b"), { recursive: true });
  writeFileSync(join(d, "a", "header.tt"), "[% BLOCK link_create %]A[% END %]");
  writeFileSync(join(d, "b", "header.tt"), "[% BLOCK link_create %]B[% END %]");
  writeFileSync(join(d, "a", "page.tt"), "[% PROCESS link_create %]");
  return d;
}

test("index finds blocks across files", () => {
  const d = sandbox();
  const ix = new BlockIndex();
  ix.build([d]);
  assert.equal(ix.find("link_create", join(d, "a", "page.tt")).length, 2);
});

test("index prefers the nearest definition", () => {
  const d = sandbox();
  const ix = new BlockIndex();
  ix.build([d]);
  const hits = ix.find("link_create", join(d, "a", "page.tt"));
  assert.equal(hits[0].file, join(d, "a", "header.tt"), "did not prefer the sibling copy");
});

test("index lookup is case-insensitive but reports the real name", () => {
  const d = sandbox();
  const ix = new BlockIndex();
  ix.build([d]);
  assert.equal(ix.find("LINK_CREATE", join(d, "a", "page.tt"))[0].name, "link_create");
});

test("index updates when a file changes and drops removed blocks", () => {
  const d = sandbox();
  const ix = new BlockIndex();
  ix.build([d]);
  ix.setFile(join(d, "a", "header.tt"), "[% BLOCK renamed %]A[% END %]");
  const hits = ix.find("link_create", join(d, "a", "page.tt"));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].file, join(d, "b", "header.tt"));
  assert.equal(ix.find("renamed", join(d, "a", "page.tt")).length, 1);
});

test("removeFile clears a file's blocks", () => {
  const d = sandbox();
  const ix = new BlockIndex();
  ix.build([d]);
  ix.removeFile(join(d, "a", "header.tt"));
  ix.removeFile(join(d, "b", "header.tt"));
  assert.equal(ix.find("link_create", join(d, "a", "page.tt")).length, 0);
  assert.equal(ix.size, 0);
});

test("index respects the file budget", () => {
  const d = sandbox();
  const ix = new BlockIndex({ maxFiles: 1, maxFileBytes: 1_000_000 });
  ix.build([d]);
  assert.ok(ix.fileCount <= 1);
});
