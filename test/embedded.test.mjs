import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import parserPkg from "../out/server/parser.js";
import e from "../out/server/embedded.js";
import svc from "../out/server/embedded-service.js";
import { TextDocument } from "vscode-languageserver-textdocument";
const { parse } = parserPkg;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// A unique URI per document: the service caches projections by URI and version,
// and reusing one would serve a stale projection to the next case.
let seq = 0;
const doc = (text) => TextDocument.create(`file:///t${seq++}.tt`, "tt", 1, text);

/** Completion labels at the cursor marked by `|`. */
function completeAt(src) {
  const offset = src.indexOf("|");
  const text = src.slice(0, offset) + src.slice(offset + 1);
  const d = doc(text);
  return svc
    .embeddedCompletion(d, d.positionAt(offset), parse(text))
    .map((i) => i.label);
}

// -------------------------------------------------------------- projections

test("the HTML projection is the same length as the source", () => {
  const text = "<div>[% IF x %]a[% END %]</div>";
  assert.equal(e.htmlProjection(text, parse(text)).length, text.length);
});

test("projections preserve newlines so line positions still map", () => {
  const text = "<div>\n[%\n IF x\n%]\n</div>";
  const p = e.htmlProjection(text, parse(text));
  assert.equal(p.split("\n").length, text.split("\n").length);
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") assert.equal(p[i], "\n", `newline lost at ${i}`);
  }
});

test("directives are blanked but HTML survives", () => {
  const text = '<div id="modal-[% director.id %]">x</div>';
  const p = e.htmlProjection(text, parse(text));
  assert.ok(!p.includes("director"), "TT leaked into the HTML projection");
  assert.ok(p.includes('<div id="modal-'), "HTML was damaged");
  assert.ok(p.includes("</div>"));
});

test("the CSS projection keeps only style bodies", () => {
  const text = "<p>hi</p>\n<style>\n.a { color: red; }\n</style>\n<p>bye</p>";
  const p = e.cssProjection(text, parse(text));
  assert.equal(p.length, text.length);
  assert.ok(p.includes(".a { color: red; }"));
  assert.ok(!p.includes("hi"));
  assert.ok(!p.includes("<style>"));
});

test("TT inside a style block is blanked from the CSS projection", () => {
  const text = "<style>.a { color: [% c %]; }</style>";
  const p = e.cssProjection(text, parse(text));
  assert.ok(!p.includes("[%"), "TT leaked into the CSS projection");
  assert.ok(p.includes(".a { color:"));
});

test("languageAt distinguishes html, css and javascript", () => {
  const text = "<p>a</p><style>.x{}</style><script>var a;</script>";
  assert.equal(e.languageAt(text, text.indexOf("<p>") + 1), "html");
  assert.equal(e.languageAt(text, text.indexOf(".x") + 1), "css");
  assert.equal(e.languageAt(text, text.indexOf("var") + 1), "javascript");
});

test("inDirective is true only inside a tag", () => {
  const text = "a[% x %]b";
  const r = parse(text);
  assert.equal(e.inDirective(text.indexOf("x"), r), true);
  assert.equal(e.inDirective(0, r), false);
  assert.equal(e.inDirective(text.length - 1, r), false);
});

// --------------------------------------------------------------- forwarding

test("HTML tag completion is offered outside directives", () => {
  const labels = completeAt("<|");
  assert.ok(labels.includes("div"), "no HTML tags offered");
  assert.ok(labels.includes("span"));
});

test("HTML attribute completion is offered", () => {
  const labels = completeAt("<div |>");
  assert.ok(labels.some((l) => l === "class" || l === "id"), labels.slice(0, 5).join(","));
});

test("closing-tag completion works through blanked directives", () => {
  const labels = completeAt("<div>[% IF a %]text[% END %]</|");
  assert.ok(labels.some((l) => l.includes("div")), labels.slice(0, 5).join(","));
});

test("CSS property completion is offered inside a style block", () => {
  const labels = completeAt("<style>.a { colo| }</style>");
  assert.ok(labels.includes("color"), labels.slice(0, 8).join(","));
});

test("JavaScript is not forwarded", () => {
  assert.deepEqual(completeAt("<script>var a = doc|</script>"), []);
});

test("hover is forwarded for HTML elements", () => {
  const text = "<div>x</div>";
  const d = doc(text);
  const h = svc.embeddedHover(d, d.positionAt(2), parse(text));
  assert.ok(h, "no hover for a div");
});

// ------------------------------------------------------------------ corpus

const CORPUS = process.env.TT_CORPUS;
function walk(dir, out = []) {
  for (const x of readdirSync(dir)) {
    if (x === "node_modules" || x === ".git") continue;
    const q = join(dir, x);
    if (statSync(q).isDirectory()) walk(q, out);
    else if (x.endsWith(".tt")) out.push(q);
  }
  return out;
}

test("corpus: projections preserve length, newlines and all TT is removed", { skip: !CORPUS }, () => {
  const files = walk(CORPUS);
  const problems = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const result = parse(text);
    for (const [name, projected] of [
      ["html", e.htmlProjection(text, result)],
      ["css", e.cssProjection(text, result)],
    ]) {
      if (projected.length !== text.length) {
        problems.push(`${f}: ${name} projection changed length`);
        continue;
      }
      if (projected.split("\n").length !== text.split("\n").length) {
        problems.push(`${f}: ${name} projection lost newlines`);
      }
      if (projected.includes("[%")) problems.push(`${f}: TT leaked into ${name} projection`);
    }
  }
  assert.deepEqual(problems.slice(0, 10), []);
  console.log(`  corpus: ${files.length} projections clean`);
});

// ------------------------------------------------------- closing-tag completion

/** The snippet the server would return for a `>` or `/` typed at the cursor. */
function tagCompleteAt(src) {
  const offset = src.indexOf("|");
  const text = src.slice(0, offset) + src.slice(offset + 1);
  const d = doc(text);
  return svc.tagCompletion(d, d.positionAt(offset), parse(text));
}

test("typing > closes the element", () => {
  assert.equal(tagCompleteAt("<div>|"), "$0</div>");
  assert.equal(tagCompleteAt("<div><span>|"), "$0</span>");
});

test("void elements are not closed", () => {
  assert.equal(tagCompleteAt("<br>|"), null);
  assert.equal(tagCompleteAt('<img src="x">|'), null);
});

test("typing </ completes the closing tag", () => {
  assert.equal(tagCompleteAt("<div></|"), "div>");
});

test("closing works across a blanked directive", () => {
  assert.equal(tagCompleteAt("<div>[% IF a %]<span>|"), "$0</span>");
});

test("an element whose attribute holds TT still closes", () => {
  assert.equal(tagCompleteAt('<div id="[% director.id %]">|'), "$0</div>");
});

// The important guard: `>` is a comparison operator in TT.
test("a > inside a directive never closes a tag", () => {
  assert.equal(tagCompleteAt("[% x > |"), null);
  assert.equal(tagCompleteAt("[% IF a.count > |"), null);
  assert.equal(tagCompleteAt("[% x => |"), null);
});

test("no closing inside style or script", () => {
  assert.equal(tagCompleteAt("<style>a{}>|"), null);
  assert.equal(tagCompleteAt("<script>if (a>|"), null);
});

test("projections preserve CR as well as LF", () => {
  const text = "<div>\r\n[% IF x %]\r\na\r\n[% END %]\r\n</div>";
  const r = parse(text);
  for (const projected of [e.htmlProjection(text, r), e.cssProjection(text, r)]) {
    assert.equal(projected.length, text.length);
    assert.equal((projected.match(/\r/g) ?? []).length, (text.match(/\r/g) ?? []).length);
    assert.equal(projected.split("\n").length, text.split("\n").length);
  }
});
