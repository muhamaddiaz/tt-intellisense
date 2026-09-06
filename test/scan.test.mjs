import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../out/server/scan.js";
const { scan } = pkg;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("finds a plain INCLUDE and its exact range", () => {
  const src = "x [% INCLUDE include_header.tt %] y";
  const { refs } = scan(src);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].name, "include_header.tt");
  assert.equal(refs[0].kind, "INCLUDE");
  assert.equal(src.slice(refs[0].start, refs[0].end), "include_header.tt");
});

test("handles quoted names and reports the range inside the quotes", () => {
  for (const q of ["'", '"']) {
    const src = `[% INCLUDE ${q}esg/include_header.tt${q} %]`;
    const { refs } = scan(src);
    assert.equal(refs[0].name, "esg/include_header.tt");
    assert.equal(src.slice(refs[0].start, refs[0].end), "esg/include_header.tt");
  }
});

test("ignores arguments after the name", () => {
  const { refs } = scan("[% INCLUDE price_row label = row.title value = row.amount %]");
  assert.equal(refs.length, 1);
  assert.equal(refs[0].name, "price_row");
});

test("skips dynamic targets rather than guessing", () => {
  assert.equal(scan("[% INCLUDE $template %]").refs.length, 0);
  assert.equal(scan("[% INCLUDE page_${x}.tt %]").refs.length, 0);
});

test("ignores comment tags entirely", () => {
  assert.equal(scan("[%# INCLUDE not_real.tt %]").refs.length, 0);
});

test("ignores an INCLUDE inside a trailing # comment", () => {
  assert.equal(scan("[% x = 1 # INCLUDE nope.tt %]").refs.length, 0);
});

test("does not mistake a quoted string for a directive", () => {
  assert.equal(scan("[% x = 'INCLUDE nope.tt' %]").refs.length, 0);
});

test("reads several directives from one tag", () => {
  const { refs } = scan("[% INCLUDE header.tt; SET x = 1; PROCESS footer.tt %]");
  assert.deepEqual(refs.map((r) => r.name), ["header.tt", "footer.tt"]);
  assert.deepEqual(refs.map((r) => r.kind), ["INCLUDE", "PROCESS"]);
});

test("handles multi-line tags and chomp modifiers", () => {
  const src = "[%-\n  INCLUDE\n  include_footer.tt\n-%]";
  const { refs } = scan(src);
  assert.equal(refs[0].name, "include_footer.tt");
  assert.equal(src.slice(refs[0].start, refs[0].end), "include_footer.tt");
});

test("collects all four reference kinds", () => {
  const { refs } = scan(
    "[% INCLUDE a.tt %][% PROCESS b %][% INSERT c.txt %][% WRAPPER d.tt %]"
  );
  assert.deepEqual(refs.map((r) => r.kind), ["INCLUDE", "PROCESS", "INSERT", "WRAPPER"]);
});

test("finds BLOCK definitions with correct ranges", () => {
  const src = "[% BLOCK price_row %]x[% END %]";
  const { blocks } = scan(src);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].name, "price_row");
  assert.equal(src.slice(blocks[0].nameStart, blocks[0].nameEnd), "price_row");
});

test("second fixture yields its real references and blocks", () => {
  const { refs, blocks } = scan(readFileSync(join(root, "test-file-2.tt"), "utf8"));
  assert.ok(refs.some((r) => r.name === "price_row" && r.kind === "INCLUDE"));
  assert.ok(refs.some((r) => r.name === "layout/card" && r.kind === "WRAPPER"));
  assert.ok(refs.some((r) => r.name === "optional/extra.tt"));
  assert.deepEqual(blocks.map((b) => b.name), ["price_row"]);
});

const CORPUS = process.env.TT_CORPUS;
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".git") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith(".tt")) out.push(p);
  }
  return out;
}

test("corpus: every scanned name is plausible and ranges are exact", { skip: !CORPUS }, () => {
  const files = walk(CORPUS);
  let refs = 0;
  const bad = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const r of scan(src).refs) {
      refs++;
      if (src.slice(r.start, r.end) !== r.name) bad.push(`${f}: range mismatch for ${r.name}`);
      if (/[$%\[\]]/.test(r.name)) bad.push(`${f}: implausible name ${JSON.stringify(r.name)}`);
    }
  }
  assert.deepEqual(bad.slice(0, 10), []);
  console.log(`  corpus: ${refs} references across ${files.length} files`);
});
