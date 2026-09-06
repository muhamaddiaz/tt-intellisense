import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import p from "../out/server/parser.js";
const { parse, templateRefs } = p;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const codes = (src) => parse(src).diagnostics.map((d) => d.code);
const clean = (src) => assert.deepEqual(codes(src), [], src);

// ---------------------------------------------------------------- structure

test("pairs a simple block", () => {
  const r = parse("[% IF x %]y[% END %]");
  assert.equal(r.allBlocks.length, 1);
  assert.equal(r.allBlocks[0].keyword, "IF");
  assert.ok(r.allBlocks[0].closer);
  assert.deepEqual(r.diagnostics, []);
});

test("nests blocks", () => {
  const r = parse("[% FOREACH a IN b %][% IF c %]x[% END %][% END %]");
  assert.equal(r.blocks.length, 1);
  assert.equal(r.blocks[0].keyword, "FOREACH");
  assert.equal(r.blocks[0].children.length, 1);
  assert.equal(r.blocks[0].children[0].keyword, "IF");
});

test("collects clauses on the owning block", () => {
  const r = parse("[% IF a %]1[% ELSIF b %]2[% ELSE %]3[% END %]");
  assert.deepEqual(r.allBlocks[0].clauses.map((c) => c.keyword), ["ELSIF", "ELSE"]);
  assert.deepEqual(r.diagnostics, []);
});

test("names BLOCK and MACRO definitions", () => {
  const r = parse("[% BLOCK price_row %]x[% END %][% MACRO m BLOCK %]y[% END %]");
  assert.deepEqual(r.allBlocks.map((b) => b.name), ["price_row", "m"]);
});

test("handles an anonymous block assigned to a variable", () => {
  const r = parse("[% saved = BLOCK %]x[% END %]");
  assert.equal(r.allBlocks.length, 1);
  assert.equal(r.allBlocks[0].name, "saved");
  assert.deepEqual(r.diagnostics, []);
});

// Side-effect notation: only a leading keyword opens a block.
test("postfix IF does not open a block", () => {
  clean("[% NEXT IF row.hidden %]");
  assert.equal(parse("[% NEXT IF row.hidden %]").allBlocks.length, 0);
});

test("postfix FILTER does not open a block", () => {
  clean("[% INCLUDE header.tt FILTER html %]");
  assert.equal(parse("[% INCLUDE header.tt FILTER html %]").allBlocks.length, 0);
});

test("MACRO without BLOCK does not open a block", () => {
  clean("[% MACRO money(n) GET n | format('%.2f') %]");
  assert.equal(parse("[% MACRO money(n) GET n %]").allBlocks.length, 0);
});

test("several directives in one tag", () => {
  const r = parse("[% INCLUDE a.tt; SET x = 1; PROCESS b %]");
  assert.equal(r.directives.length, 3);
  assert.deepEqual(r.diagnostics, []);
});

// -------------------------------------------------------------- diagnostics

test("unexpected END", () => {
  assert.deepEqual(codes("[% END %]"), ["unexpected-end"]);
});

test("unclosed block", () => {
  assert.deepEqual(codes("[% IF x %]y"), ["unclosed-block"]);
});

test("unterminated tag", () => {
  assert.ok(codes("[% IF x ").includes("unterminated-tag"));
});

test("misplaced clause", () => {
  assert.deepEqual(codes("[% ELSE %]"), ["misplaced-clause"]);
  assert.deepEqual(codes("[% FOREACH a IN b %][% ELSE %][% END %]"), ["misplaced-clause"]);
  assert.deepEqual(codes("[% IF a %][% CATCH %][% END %]"), ["misplaced-clause"]);
});

test("clause after ELSE", () => {
  assert.deepEqual(codes("[% IF a %][% ELSE %][% ELSE %][% END %]"), ["clause-after-else"]);
  assert.deepEqual(codes("[% IF a %][% ELSE %][% ELSIF b %][% END %]"), ["clause-after-else"]);
});

test("CASE is valid in SWITCH and CATCH in TRY", () => {
  clean("[% SWITCH x %][% CASE 1 %]a[% CASE DEFAULT %]b[% END %]");
  clean("[% TRY %]a[% CATCH file %]b[% FINAL %]c[% END %]");
});

test("mistyped directives are caught", () => {
  assert.ok(codes("[% FOEACH x IN y %][% END %]").includes("unknown-directive"));
  assert.ok(codes("[% INCLUD h.tt %]").includes("unknown-directive"));
});

test("constant-style uppercase variables are not directives", () => {
  clean("[% DEFAULT_COMMISSION %]");
  clean("[% HISTORICAL_DATA_SHOWN %]");
  clean("[% ID %]");
  clean("[% MAX_ROWS = 10 %]");
});

test("comment tags never produce diagnostics", () => {
  clean("[%# IF this were real it would be unclosed %]");
  clean("[% x = 1 # END %]");
});

test("a quoted string is not parsed as a directive", () => {
  clean("[% x = 'END' %]");
  clean("[% msg = 'IF you see this' %]");
});

test("chomp modifiers and multi-line tags parse", () => {
  clean("[%- IF x -%]\ny\n[%~ END ~%]");
  clean("[%\n  FOREACH item IN list\n%]a[%\n  END\n%]");
});

// ----------------------------------------------------------- template refs

test("template refs, with exact ranges", () => {
  const cases = [
    ["[% INCLUDE include_header.tt %]", "include_header.tt", "INCLUDE"],
    ["[% INCLUDE 'esg/include_header.tt' %]", "esg/include_header.tt", "INCLUDE"],
    ['[% INCLUDE "h.tt" %]', "h.tt", "INCLUDE"],
    ["[% INCLUDE esg/include_header.tt %]", "esg/include_header.tt", "INCLUDE"],
    ["[% INCLUDE price_row label = row.title %]", "price_row", "INCLUDE"],
    ["[% WRAPPER layout/card title = 'x' %]", "layout/card", "WRAPPER"],
    ["[% INSERT notes.txt %]", "notes.txt", "INSERT"],
    ["[%-\n  INCLUDE\n  include_footer.tt\n-%]", "include_footer.tt", "INCLUDE"],
  ];
  for (const [src, name, kind] of cases) {
    const refs = templateRefs(parse(src));
    assert.equal(refs.length, 1, src);
    assert.equal(refs[0].name, name, src);
    assert.equal(refs[0].kind, kind, src);
    assert.equal(src.slice(refs[0].start, refs[0].end), name, `range for ${src}`);
  }
});

test("dynamic targets are skipped, not guessed", () => {
  assert.equal(templateRefs(parse("[% INCLUDE $page %]")).length, 0);
  assert.equal(templateRefs(parse("[% INCLUDE page_${x}.tt %]")).length, 0);
});

test("refs are not found in comments or strings", () => {
  assert.equal(templateRefs(parse("[%# INCLUDE nope.tt %]")).length, 0);
  assert.equal(templateRefs(parse("[% x = 'INCLUDE nope.tt' %]")).length, 0);
  assert.equal(templateRefs(parse("[% x = 1 # INCLUDE nope.tt %]")).length, 0);
});

// ---------------------------------------------------------------- fixtures

test("both fixtures parse without diagnostics", () => {
  for (const f of ["test-file-1.tt", "test-file-2.tt"]) {
    const r = parse(readFileSync(join(root, f), "utf8"));
    assert.deepEqual(r.diagnostics.map((d) => `${d.code}: ${d.message}`), [], f);
  }
});

test("second fixture yields the expected blocks and refs", () => {
  const r = parse(readFileSync(join(root, "test-file-2.tt"), "utf8"));
  const names = r.allBlocks.filter((b) => b.keyword === "BLOCK").map((b) => b.name);
  assert.ok(names.includes("price_row"));
  // `MACRO money(n) GET ...` has no BLOCK keyword, so it is a statement, not a
  // block. Only `MACRO name BLOCK` opens one.
  assert.ok(!names.includes("money"), "MACRO without BLOCK wrongly opened a block");
  const kinds = new Set(r.allBlocks.map((b) => b.keyword));
  for (const k of ["IF", "FOREACH", "SWITCH", "TRY", "WRAPPER", "FILTER", "BLOCK"]) {
    assert.ok(kinds.has(k), `no ${k} block found`);
  }
  const refs = templateRefs(r).map((x) => x.name);
  assert.ok(refs.includes("price_row"));
  assert.ok(refs.includes("layout/card"));
  assert.ok(refs.includes("optional/extra.tt"));
});

// ------------------------------------------------------------------ corpus

const CORPUS = process.env.TT_CORPUS;
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".git") continue;
    const q = join(dir, e);
    if (statSync(q).isDirectory()) walk(q, out);
    else if (e.endsWith(".tt")) out.push(q);
  }
  return out;
}

test("corpus: known-good templates produce no diagnostics", { skip: !CORPUS }, () => {
  const files = walk(CORPUS);
  const problems = [];
  let directives = 0, blocks = 0;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const r = parse(src);
    directives += r.directives.length;
    blocks += r.allBlocks.length;
    for (const d of r.diagnostics) {
      const line = src.slice(0, d.start).split("\n").length;
      problems.push(`${f}:${line} [${d.code}] ${d.message}`);
    }
  }
  console.log(`  corpus: ${files.length} files, ${directives} directives, ${blocks} blocks`);
  assert.deepEqual(problems.slice(0, 15), []);
});
