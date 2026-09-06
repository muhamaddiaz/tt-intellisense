import { test } from "node:test";
import assert from "node:assert/strict";
import parserPkg from "../out/server/parser.js";
import lexer from "../out/server/lexer.js";
const { parse } = parserPkg;
const { DIRECTIVE_KEYWORDS, BLOCK_OPENERS, CLAUSE_OWNERS } = lexer;

/**
 * Every directive, with arguments that make it valid.
 *
 * This exists because corpus testing can only validate the subset of Template
 * Toolkit the corpus happens to use. The reference corpus exercises 24 of these
 * and never touches the rest, which is how a missing `VIEW` — a real block
 * directive — went unnoticed while 289 files reported zero diagnostics.
 */
const BLOCK_ARGS = {
  IF: "condition",
  UNLESS: "condition",
  FOREACH: "item IN list",
  FOR: "item IN list",
  WHILE: "condition",
  SWITCH: "value",
  TRY: "",
  WRAPPER: "layout.tt",
  BLOCK: "name",
  VIEW: "name",
  FILTER: "html",
  PERL: "",
  RAWPERL: "",
};

const STATEMENT_ARGS = {
  GET: "variable",
  SET: "x = 1",
  CALL: "something",
  DEFAULT: "x = 1",
  INSERT: "notes.txt",
  INCLUDE: "header.tt",
  PROCESS: "footer.tt",
  USE: "Dumper",
  MACRO: "money(n) GET n",
  THROW: "file 'not found'",
  NEXT: "",
  LAST: "",
  BREAK: "",
  RETURN: "",
  STOP: "",
  CLEAR: "",
  TAGS: "star",
  META: "title = 'x'",
  DEBUG: "on",
};

const CLAUSE_CASES = {
  ELSIF: "[% IF a %]x[% ELSIF b %]y[% END %]",
  ELSE: "[% IF a %]x[% ELSE %]y[% END %]",
  CASE: "[% SWITCH a %][% CASE 1 %]x[% END %]",
  CATCH: "[% TRY %]x[% CATCH file %]y[% END %]",
  FINAL: "[% TRY %]x[% FINAL %]y[% END %]",
};

test("every keyword in the lexer is covered by this file", () => {
  const covered = new Set([
    ...Object.keys(BLOCK_ARGS),
    ...Object.keys(STATEMENT_ARGS),
    ...Object.keys(CLAUSE_OWNERS),
    "END",
  ]);
  const missing = [...DIRECTIVE_KEYWORDS].filter((k) => !covered.has(k));
  assert.deepEqual(missing, [], `keywords with no test: ${missing.join(", ")}`);
});

test("BLOCK_OPENERS and the block cases agree", () => {
  assert.deepEqual([...BLOCK_OPENERS].sort(), Object.keys(BLOCK_ARGS).sort());
});

for (const [kw, args] of Object.entries(BLOCK_ARGS)) {
  test(`${kw} opens a block that closes with END`, () => {
    const src = `[% ${kw}${args ? ` ${args}` : ""} %]body[% END %]`;
    const r = parse(src);
    assert.deepEqual(r.diagnostics.map((d) => d.code), [], src);
    assert.equal(r.allBlocks.length, 1, `${src} produced ${r.allBlocks.length} blocks`);
    assert.equal(r.allBlocks[0].keyword, kw);
    assert.ok(r.allBlocks[0].closer, "block was not closed");
  });

  test(`${kw} without END is reported unclosed`, () => {
    const src = `[% ${kw}${args ? ` ${args}` : ""} %]body`;
    assert.deepEqual(parse(src).diagnostics.map((d) => d.code), ["unclosed-block"], src);
  });
}

for (const [kw, args] of Object.entries(STATEMENT_ARGS)) {
  test(`${kw} is a statement and needs no END`, () => {
    const src = `[% ${kw}${args ? ` ${args}` : ""} %]`;
    const r = parse(src);
    assert.deepEqual(r.diagnostics.map((d) => d.code), [], src);
    // MACRO opens a block only in its `MACRO name BLOCK` form.
    assert.equal(r.allBlocks.length, 0, `${src} unexpectedly opened a block`);
  });
}

for (const [kw, src] of Object.entries(CLAUSE_CASES)) {
  test(`${kw} is valid inside its owning block`, () => {
    assert.deepEqual(parse(src).diagnostics.map((d) => d.code), [], src);
  });

  test(`${kw} outside its owning block is reported`, () => {
    assert.deepEqual(parse(`[% ${kw} %]`).diagnostics.map((d) => d.code), ["misplaced-clause"]);
  });
}

test("VIEW names its block, like BLOCK does", () => {
  const r = parse("[% VIEW my_view %]x[% END %]");
  assert.equal(r.allBlocks[0].name, "my_view");
  assert.ok(r.allBlocks[0].nameStart !== null, "VIEW name has no range");
});

test("a VIEW containing BLOCKs nests correctly", () => {
  const r = parse('[% VIEW box prefix="my/" %][% BLOCK item %]a[% END %][% END %]');
  assert.deepEqual(r.diagnostics, []);
  assert.equal(r.blocks.length, 1);
  assert.equal(r.blocks[0].keyword, "VIEW");
  assert.deepEqual(r.blocks[0].children.map((c) => c.name), ["item"]);
});

test("MACRO ... BLOCK opens a block, MACRO alone does not", () => {
  assert.equal(parse("[% MACRO m BLOCK %]x[% END %]").allBlocks.length, 1);
  assert.equal(parse("[% MACRO m GET x %]").allBlocks.length, 0);
});
