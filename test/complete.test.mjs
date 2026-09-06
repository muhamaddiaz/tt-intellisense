import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import parserPkg from "../out/server/parser.js";
import c from "../out/server/complete.js";
import h from "../out/server/hover.js";
import dumpPkg from "../out/server/schema/dump.js";
import modelPkg from "../out/server/schema/model.js";
import minePkg from "../out/server/schema/mine.js";
const { parse } = parserPkg;
const { parseJsonDump } = dumpPkg;
const { merge, node } = modelPkg;
const { Miner } = minePkg;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A schema with a dump layer and a mined layer, as the store would build.
 *
 * `mineSelf` mirrors the store's live layer, which mines the open document.
 * Turn it off when the assertion is about a path the document itself mentions,
 * since mining it would make the schema know it trivially.
 */
function schemaFor(text, json = {}, mineSelf = true) {
  const s = node("hash", "mined");
  if (mineSelf) {
    const miner = new Miner();
    miner.addDocument(text);
    merge(s, miner.merged());
  }
  merge(s, parseJsonDump(JSON.stringify(json)));
  return s;
}

/** Labels offered at the cursor, marked in `src` by `|`. */
function completeAt(src, extraJson = {}, mineSelf = true) {
  const offset = src.indexOf("|");
  assert.notEqual(offset, -1, "no cursor marker");
  const text = src.slice(0, offset) + src.slice(offset + 1);
  const result = parse(text);
  const schema = schemaFor(text, extraJson, mineSelf);
  const ctx = c.completionContext(text, offset, result);
  if (!ctx.inDirective) return { ctx, labels: null };

  const scope = c.scopeAt(result, offset);
  let items;
  if (ctx.base.length === 0) {
    items = [...c.localSuggestions(scope), ...c.memberSuggestions(schema, () => 1, true)];
    if (ctx.atDirectiveHead) items = [...c.keywordSuggestions(ctx.partial), ...items];
  } else {
    const parent = c.resolvePath(ctx.base, schema, scope);
    items = parent ? c.memberSuggestions(parent, () => 0, false) : [];
  }
  const labels = items
    .filter((i) => i.label.toLowerCase().startsWith(ctx.partial.toLowerCase()))
    .map((i) => i.label);
  return { ctx, labels };
}

// ------------------------------------------------------------------ context

test("no completion outside a directive", () => {
  assert.equal(completeAt("<div>|</div>").labels, null);
});

test("no completion inside a comment tag", () => {
  assert.equal(completeAt("[%# foo.|bar %]").labels, null);
});

test("splits a dotted path into base and partial", () => {
  const { ctx } = completeAt("[% ir.config.co| %]");
  assert.deepEqual(ctx.base, ["ir", "config"]);
  assert.equal(ctx.partial, "co");
});

test("recognises a directive head", () => {
  assert.equal(completeAt("[% | %]").ctx.atDirectiveHead, true);
  assert.equal(completeAt("[% IN| %]").ctx.atDirectiveHead, true);
  assert.equal(completeAt("[% foo bar| %]").ctx.atDirectiveHead, false);
  assert.equal(completeAt("[% a; | %]").ctx.atDirectiveHead, true);
});

// --------------------------------------------------------------- keywords

test("directive keywords are offered at a head", () => {
  const { labels } = completeAt("[% FOR| %]");
  assert.ok(labels.includes("FOREACH"));
  assert.ok(labels.includes("FOR"));
});

test("every directive completion includes syntax and a description", () => {
  const suggestions = c.keywordSuggestions("");
  assert.ok(suggestions.length > 0);
  for (const suggestion of suggestions) {
    assert.match(suggestion.detail, /^\[% .* %\]/, `${suggestion.label} has no syntax`);
    assert.ok(suggestion.documentation, `${suggestion.label} has no description`);
  }
});

test("keywords are not offered mid-path", () => {
  const { labels } = completeAt("[% ir.F| %]");
  assert.ok(!labels.includes("FOREACH"));
});

// -------------------------------------------------------------- members

test("completes members from a dump", () => {
  const { labels } = completeAt("[% ir.| %]", { ir: { config: { a: 1 }, var: {} } });
  assert.deepEqual(labels.sort(), ["config", "var"]);
});

test("filters members by the partial segment", () => {
  const { labels } = completeAt("[% ir.co| %]", { ir: { config: 1, var: 2, corp: 3 } }, false);
  assert.deepEqual(labels.sort(), ["config", "corp"]);
});

// --------------------------------------------------- loop alias resolution

test("a loop alias completes to the element fields of the list", () => {
  const src = "[% FOREACH d = ir.rows %][% d.| %][% END %]";
  const { labels } = completeAt(src, { ir: { rows: [{ name: 1, title: 2 }] } });
  assert.deepEqual(labels.sort(), ["name", "title"]);
});

test("a loop alias resolves through a constant-folded dynamic segment", () => {
  const src =
    "[% kind = 'director' %][% FOREACH d = ir.var.$kind.rows %][% d.| %][% END %]";
  const { labels } = completeAt(src, { ir: { var: { director: { rows: [{ name: 1 }] } } } });
  assert.deepEqual(labels, ["name"]);
});

test("a nested loop shadows the outer alias", () => {
  const src =
    "[% FOREACH d = ir.a %][% FOREACH d = ir.b %][% d.| %][% END %][% END %]";
  const { labels } = completeAt(src, { ir: { a: [{ outer: 1 }], b: [{ inner: 2 }] } });
  assert.deepEqual(labels, ["inner"]);
});

test("a loop alias is offered as a local at the head", () => {
  const { labels } = completeAt("[% FOREACH director = ir.rows %][% d| %][% END %]");
  assert.ok(labels.includes("director"));
});

test("an alias outside its loop does not resolve", () => {
  const src = "[% FOREACH d = ir.rows %]x[% END %][% d.| %]";
  const { labels } = completeAt(src, { ir: { rows: [{ name: 1 }] } });
  assert.deepEqual(labels, []);
});

test("real fixture: director. offers the mined element fields", () => {
  const text = readFileSync(join(root, "test-file-1.tt"), "utf8");
  const marker = '<p class="boc-bod-name">[% director.';
  const offset = text.indexOf(marker) + marker.length;
  const result = parse(text);
  const schema = schemaFor(text);
  const ctx = c.completionContext(text, offset, result);
  const parent = c.resolvePath(ctx.base, schema, c.scopeAt(result, offset));
  const labels = c.memberSuggestions(parent, () => 0, false).map((i) => i.label).sort();
  for (const f of ["designation", "director_id", "name", "url_image"]) {
    assert.ok(labels.includes(f), `${f} missing from ${labels.join(",")}`);
  }
});

// ------------------------------------------------------------------- hover

function hoverAt(src, json = {}, mineSelf = true) {
  const offset = src.indexOf("|");
  const text = src.slice(0, offset) + src.slice(offset + 1);
  return h.hoverAt(text, offset, parse(text), schemaFor(text, json, mineSelf));
}

test("hover reports a dump value and its source layer", () => {
  const info = hoverAt("[% ir.co|y_id %]", { ir: { coy_id: 4736 } });
  assert.match(info.markdown, /ir\.coy_id/);
  assert.match(info.markdown, /4736/);
  assert.match(info.markdown, /stash dump/);
});

test("hover redacts a secret-bearing value", () => {
  const info = hoverAt("[% cfg.secr|et_key %]", { cfg: { secret_key: "hunter2" } });
  assert.ok(!info.markdown.includes("hunter2"), "secret leaked into hover");
  assert.match(info.markdown, /redacted/);
});

test("hover explains a loop variable and names its source", () => {
  const info = hoverAt("[% FOREACH d = ir.rows %][% d.na|me %][% END %]",
    { ir: { rows: [{ name: "x" }] } });
  assert.match(info.markdown, /Loop variable over/);
  assert.match(info.markdown, /ir\.rows/);
});

test("hover lists the fields of a hash", () => {
  const info = hoverAt("[% ir.con|fig %]", { ir: { config: { a: 1, b: 2 } } });
  assert.match(info.markdown, /Fields:/);
  assert.match(info.markdown, /`a`/);
});

test("hover says an unknown path is not necessarily a mistake", () => {
  const info = hoverAt("[% nothing.he|re %]", {}, false);
  assert.match(info.markdown, /not necessarily a mistake/i);
});

test("hover describes directive syntax", () => {
  const info = hoverAt("[% I|F ready %]");
  assert.deepEqual(info.path, ["IF"]);
  assert.match(info.markdown, /\[% IF condition %\]/);
  assert.match(info.markdown, /condition evaluates true/);
});

test("hover returns nothing outside a directive", () => {
  assert.equal(hoverAt("<div cl|ass='x'></div>"), null);
});

// ------------------------------------------------------- scope correctness
// Regressions for defects found in review.

test("a later assignment shadows an earlier one", () => {
  const text = "[% x = ir.first %][% x = ir.second %][% x.y %]";
  const scope = c.scopeAt(parse(text), text.length - 6);
  assert.deepEqual(scope.get("x")?.source, ["ir", "second"]);
});

test("an assignment sealed in a closed block is not visible after it", () => {
  const text = "[% FOREACH r IN ir.rows %][% tmp = ir.deep %][% END %][% tmp.y %]";
  assert.equal(c.scopeAt(parse(text), text.length - 4).has("tmp"), false);
});

test("an assignment is still visible inside its own block", () => {
  const text = "[% FOREACH r IN ir.rows %][% tmp = ir.deep %][% tmp.y %][% END %]";
  assert.equal(c.scopeAt(parse(text), text.indexOf("tmp.y") + 1).has("tmp"), true);
});

test("a loop alias beats an assignment of the same name", () => {
  const text = "[% x = ir.one %][% FOREACH x IN ir.rows %][% x.y %][% END %]";
  assert.equal(c.scopeAt(parse(text), text.indexOf("x.y") + 1).get("x")?.isLoop, true);
});

test("a nested loop shadows the outer alias in scopeAt", () => {
  const text = "[% FOREACH d IN ir.a %][% FOREACH d IN ir.b %][% d.x %][% END %][% END %]";
  const scope = c.scopeAt(parse(text), text.indexOf("d.x") + 1);
  assert.deepEqual(scope.get("d")?.source, ["ir", "b"]);
});

test("the cursor immediately after [% is inside the directive", () => {
  const text = "[%";
  assert.equal(c.completionContext(text, 2, parse(text)).inDirective, true);
});

test("the cursor before [% is still outside it", () => {
  const text = "x[% a %]";
  assert.equal(c.completionContext(text, 0, parse(text)).inDirective, false);
  assert.equal(c.completionContext(text, 1, parse(text)).inDirective, false);
});
