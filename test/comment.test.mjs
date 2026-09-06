import { test } from "node:test";
import assert from "node:assert/strict";
import parserPkg from "../out/server/parser.js";
import cm from "../out/server/comment.js";
const { parse } = parserPkg;
const { toggleComment, commentContextAt } = cm;

/** Applies a toggle at the cursor marked `|`, returning the new text. */
function toggle(src, secondCursor = false) {
  const first = src.indexOf("|");
  const text = src.replace(/\|/g, "");
  const sels = [{ start: first, end: first }];
  if (secondCursor) {
    const second = src.indexOf("|", first + 1) - 1;
    sels.push({ start: second, end: second });
  }
  let out = text;
  for (const e of toggleComment(text, parse(text), sels)) {
    out = out.slice(0, e.start) + e.newText + out.slice(e.end);
  }
  return out;
}

const contextAt = (src) => {
  const i = src.indexOf("|");
  const text = src.replace("|", "");
  return commentContextAt(text, i, parse(text));
};

// ----------------------------------------------------------------- context

test("the cursor's context is detected per language", () => {
  assert.equal(contextAt("[% fo|o %]"), "directive");
  assert.equal(contextAt("<div>h|i</div>"), "html");
  assert.equal(contextAt("<style>\n.a { c|olor: red }\n</style>"), "css");
  assert.equal(contextAt("<script>\nvar a| = 1;\n</script>"), "javascript");
});

test("just outside a directive is HTML, not directive", () => {
  assert.equal(contextAt("|[% foo %]"), "html");
  assert.equal(contextAt("[% foo %]|"), "html");
});

test("TT inside an attribute is still a directive", () => {
  assert.equal(contextAt('<div id="[% x|.y %]">'), "directive");
});

// --------------------------------------------------------------- directives

test("commenting a directive rewrites its opening delimiter", () => {
  assert.equal(toggle("[% fo|o %]"), "[%# foo %]");
});

test("uncommenting a directive removes the hash", () => {
  assert.equal(toggle("[%# fo|o %]"), "[% foo %]");
});

test("chomp modifiers are preserved and keep their position", () => {
  assert.equal(toggle("[%- fo|o -%]"), "[%-# foo -%]");
  assert.equal(toggle("[%~ fo|o ~%]"), "[%~# foo ~%]");
  assert.equal(toggle("[%-# fo|o -%]"), "[%- foo -%]");
});

test("toggling a directive twice restores it exactly", () => {
  for (const src of ["[% foo %]", "[%- foo -%]", "[%foo%]", "[% IF a %]"]) {
    const i = 4;
    const once = (() => {
      let out = src;
      for (const e of toggleComment(src, parse(src), [{ start: i, end: i }])) {
        out = out.slice(0, e.start) + e.newText + out.slice(e.end);
      }
      return out;
    })();
    let back = once;
    for (const e of toggleComment(once, parse(once), [{ start: i, end: i }])) {
      back = back.slice(0, e.start) + e.newText + back.slice(e.end);
    }
    assert.equal(back, src, `round trip failed for ${src}`);
  }
});

// ------------------------------------------------------------- host languages

test("HTML uses HTML comments", () => {
  assert.equal(toggle("<div>h|i</div>"), "<!-- <div>hi</div> -->");
});

test("CSS uses CSS comments", () => {
  assert.equal(
    toggle("<style>\n.a { c|olor: red }\n</style>"),
    "<style>\n/* .a { color: red } */\n</style>"
  );
});

test("JavaScript uses block comments", () => {
  assert.equal(
    toggle("<script>\nvar a| = 1;\n</script>"),
    "<script>\n/* var a = 1; */\n</script>"
  );
});

test("indentation is preserved when commenting", () => {
  assert.equal(toggle("  <div>h|i</div>"), "  <!-- <div>hi</div> -->");
});

test("host-language comments round trip", () => {
  for (const [src, cursor] of [
    ["<div>hi</div>", 6],
    ["  <p>x</p>", 6],
    ["<style>\n.a{}\n</style>", 10],
    ["<script>\nvar a=1;\n</script>", 12],
  ]) {
    const step = (t) => {
      let out = t;
      for (const e of toggleComment(t, parse(t), [{ start: cursor, end: cursor }])) {
        out = out.slice(0, e.start) + e.newText + out.slice(e.end);
      }
      return out;
    };
    assert.equal(step(step(src)), src, `round trip failed for ${JSON.stringify(src)}`);
  }
});

// ------------------------------------------------------------- edge cases

test("a line already commented is uncommented, not double-commented", () => {
  assert.equal(toggle("<!-- <div>h|i</div> -->"), "<div>hi</div>");
});

test("two cursors on the same line comment it once", () => {
  const text = "<div>hi</div>";
  const edits = toggleComment(text, parse(text), [
    { start: 2, end: 2 },
    { start: 7, end: 7 },
  ]);
  let out = text;
  for (const e of edits) out = out.slice(0, e.start) + e.newText + out.slice(e.end);
  assert.equal(out, "<!-- <div>hi</div> -->");
});

test("cursors in different contexts each get their own syntax", () => {
  const text = "<div>a</div>\n[% foo %]";
  const edits = toggleComment(text, parse(text), [
    { start: 2, end: 2 },
    { start: text.indexOf("foo"), end: text.indexOf("foo") },
  ]);
  let out = text;
  for (const e of edits) out = out.slice(0, e.start) + e.newText + out.slice(e.end);
  assert.equal(out, "<!-- <div>a</div> -->\n[%# foo %]");
});

test("an empty document produces no edits", () => {
  assert.deepEqual(toggleComment("", parse(""), [{ start: 0, end: 0 }]), []);
});
