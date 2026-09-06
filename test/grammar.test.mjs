import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tokenize, scopesOf, hasScope } from "./tokenize.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TT = /\.tt$/;

test("HTML still colors normally", async () => {
  assert.ok(await hasScope("<div class=\"x\">hi</div>", "div", /entity\.name\.tag/));
});

test("TT tag delimiters are scoped", async () => {
  const s = await scopesOf("[% foo %]", "[%");
  assert.ok(s.some((x) => /punctuation\.section\.embedded\.begin\.tt/.test(x)), s.join(" "));
});

test("directive keywords are keywords", async () => {
  assert.ok(await hasScope("[% IF foo %]", "IF", /keyword\.control\.block\.tt/));
  assert.ok(await hasScope("[% END %]", "END", /keyword\.control\.end\.tt/));
  assert.ok(await hasScope("[% INCLUDE h.tt %]", "INCLUDE", /keyword\.control\.import\.tt/));
});

// The 1177-occurrence case. This is why the injection grammar exists.
test("TT inside an HTML attribute value is scoped as TT, not as string", async () => {
  const src = '<div id="modal-[% director.director_id %]"></div>';
  assert.ok(await hasScope(src, "[%", /punctuation\.section\.embedded\.begin\.tt/),
    "opening delimiter not recognised inside attribute value");
  assert.ok(await hasScope(src, "director", /variable\.other\.tt/),
    "variable not recognised inside attribute value");
  assert.ok(await hasScope(src, "director_id", /variable\.other\.member\.tt/),
    "member not recognised inside attribute value");
});

test("TT keyword inside an HTML attribute value is a keyword", async () => {
  const src = '<button aria-selected="[% IF x %]true[% ELSE %]false[% END %]">';
  assert.ok(await hasScope(src, "IF", /keyword\.control\.block\.tt/));
  assert.ok(await hasScope(src, "ELSE", /keyword\.control\.block\.tt/));
  assert.ok(await hasScope(src, "END", /keyword\.control\.end\.tt/));
});

test("TT inside a <script> body is scoped as TT", async () => {
  const src = '<script>var u = "[% ir.config.company.url_domain %]";</script>';
  assert.ok(await hasScope(src, "[%", /punctuation\.section\.embedded\.begin\.tt/));
  assert.ok(await hasScope(src, "url_domain", /variable\.other\.member\.tt/));
});

test("comment tag is a comment end to end", async () => {
  const toks = await tokenize("[%# Version 0.5 %]");
  assert.ok(toks.every((t) => t.scopes.some((s) => /comment\.block\.tt/.test(s))),
    JSON.stringify(toks, null, 1));
});

test("inline # comment inside a directive is a comment and does not eat %]", async () => {
  const src = "[% theta = 20 # rest is comment %]";
  const toks = await tokenize(src);
  assert.ok(await hasScope(src, "theta", /variable\.other\.tt/));

  const comment = toks.find((t) => t.scopes.some((s) => /comment\.line/.test(s)));
  assert.ok(comment, "no comment token");
  assert.ok(!comment.text.includes("%]"), `comment swallowed the terminator: ${comment.text}`);

  // The tag must still close, or every following line stays inside the directive.
  assert.ok(await hasScope(src, "%]", /punctuation\.section\.embedded\.end\.tt/),
    "tag terminator not recognised after an inline comment");
});

test("an inline comment does not leak the directive onto the next line", async () => {
  const toks = await tokenize("[% x = 1 # note %]\n<div>plain</div>");
  const div = toks.find((t) => t.text === "div");
  assert.ok(div, "next line did not tokenize");
  assert.ok(!div.scopes.some((s) => /meta\.embedded\.block\.tt/.test(s)),
    "next line is still inside the TT directive");
});

test("chomp modifiers are scoped and do not break the tag", async () => {
  assert.ok(await hasScope("[%- FOREACH x IN y -%]", "-", /keyword\.operator\.chomp\.tt/));
  assert.ok(await hasScope("[%~ IF a ~%]", "~", /keyword\.operator\.chomp\.tt/));
  assert.ok(await hasScope("[%- FOREACH x IN y -%]", "FOREACH", /keyword\.control\.block\.tt/));
});

test("multi-line tags stay inside the directive", async () => {
  const src = "[% IF global.is_en\n   %]yes[% END\n%]";
  assert.ok(await hasScope(src, "is_en", /variable\.other\.member\.tt/));
  assert.ok(await hasScope(src, "END", /keyword\.control\.end\.tt/));
});

test("strings are strings and their contents are not parsed as directives", async () => {
  assert.ok(await hasScope("[% x = 'END IF' %]", "'", /punctuation\.definition\.string/));
  assert.ok(!(await hasScope("[% x = 'END IF' %]", "END IF", /keyword\.control/)));
});

test("double-quoted interpolation is scoped", async () => {
  assert.ok(await hasScope('[% x = "hi $name" %]', "$name", /variable\.other\.interpolated\.tt/));
});

test("dynamic hash key $var is scoped", async () => {
  assert.ok(await hasScope("[% ir.var.x.$board_type.format %]", "$board_type", /variable\.other/));
});

test("vmethod calls are functions, plain members are variables", async () => {
  const src = "[% ir.config.company.url_domain.replace('http:', '') %]";
  assert.ok(await hasScope(src, "replace", /support\.function\.vmethod\.tt/));
  assert.ok(await hasScope(src, "url_domain", /variable\.other\.member\.tt/));
});

test("filter pipe names the filter", async () => {
  assert.ok(await hasScope("[% content | html %]", "|", /keyword\.operator\.filter\.tt/));
  assert.ok(await hasScope("[% content | html %]", "html", /support\.function\.filter\.tt/));
});

test("outline %% tags are recognised", async () => {
  assert.ok(await hasScope("%% IF some.list.size\n", "IF", /keyword\.control\.block\.tt/));
});

test("real fixture tokenizes with no unscoped TT delimiters", async () => {
  const src = readFileSync(join(root, "test-file-1.tt"), "utf8");
  const toks = await tokenize(src);
  const opens = toks.filter((t) => t.text === "[%");
  assert.ok(opens.length > 50, `expected many TT tags, saw ${opens.length}`);
  const bad = opens.filter(
    (t) => !t.scopes.some((s) => /punctuation\.(section\.embedded|definition\.comment)\.begin\.tt/.test(s))
  );
  assert.equal(bad.length, 0, `${bad.length} unscoped [% delimiters`);
});

test("second fixture: broader constructs tokenize cleanly", async () => {
  const src = readFileSync(join(root, "test-file-2.tt"), "utf8");
  const toks = await tokenize(src);

  const opens = toks.filter(
    (t) => t.text === "[%" && t.scopes.some((s) => /section\.embedded\.begin\.tt/.test(s))
  ).length;
  const closes = toks.filter((t) =>
    t.scopes.some((s) => /section\.embedded\.end\.tt/.test(s))
  ).length;
  assert.equal(opens, closes, `${opens} block tags opened, ${closes} closed`);

  const kw = (w, re) =>
    assert.ok(
      toks.some((t) => t.text === w && t.scopes.some((s) => re.test(s))),
      `${w} not scoped as expected`
    );

  kw("USE", /keyword\.control\.import\.tt/);
  kw("MACRO", /keyword\.control\.block\.tt/);
  kw("WRAPPER", /keyword\.control\.block\.tt/);
  kw("SWITCH", /keyword\.control\.block\.tt/);
  kw("CASE", /keyword\.control\.block\.tt/);
  kw("TRY", /keyword\.control\.block\.tt/);
  kw("CATCH", /keyword\.control\.block\.tt/);
  kw("FINAL", /keyword\.control\.block\.tt/);
  kw("FILTER", /keyword\.control\.block\.tt/);
  kw("NEXT", /keyword\.control\.flow\.tt/);
  kw("LAST", /keyword\.control\.flow\.tt/);
  kw("META", /keyword\.other\.meta\.tt/);
  kw("DEFAULT", /keyword\.other\.tt/);
  kw("IN", /keyword\.operator\.word\.tt/);
  kw("html_para", /support\.function\.filter\.tt/);
  kw("truncate", /support\.function\.filter\.tt/);
  kw("replace", /support\.function\.vmethod\.tt/);
});
