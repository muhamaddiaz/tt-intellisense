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

// ------------------------------------------------- one edit per line
// Regressions from review. Directive edits used to bypass the per-line
// bookkeeping, so several cursors on one line each produced an edit.

function toggleMulti(text, offsets) {
  let out = text;
  for (const e of toggleComment(text, parse(text), offsets.map((o) => ({ start: o, end: o })))) {
    out = out.slice(0, e.start) + e.newText + out.slice(e.end);
  }
  return out;
}

test("two cursors inside one directive comment it once", () => {
  assert.equal(toggleMulti("[% foo bar %]", [4, 8]), "[%# foo bar %]");
});

test("a cursor in a directive and one in the same line's HTML comment it once", () => {
  assert.equal(toggleMulti("<p>[% x %]</p>", [1, 6]), "<!-- <p>[% x %]</p> -->");
});

test("cursors on different lines are independent", () => {
  assert.equal(
    toggleMulti("<p>a</p>\n[% x %]", [1, 12]),
    "<!-- <p>a</p> -->\n[%# x %]"
  );
});

test("a cursor inside a multi-line selection does not comment it twice", () => {
  const text = "<p>a</p>\n<p>b</p>";
  let out = text;
  for (const e of toggleComment(text, parse(text), [
    { start: 0, end: 17 },
    { start: 10, end: 10 },
  ])) {
    out = out.slice(0, e.start) + e.newText + out.slice(e.end);
  }
  assert.equal(out, "<!-- <p>a</p>\n<p>b</p> -->");
});

test("edits never overlap, whatever the selections", () => {
  const docs = [
    "<div>[% IF a %]x[% ELSE %]y[% END %]</div>",
    "<style>.a{}</style>\n[% x %]\n<p>t</p>",
    "[% a %][% b %]\n<script>var x=1;</script>",
    "  <p>[% v %]</p>\n\n[%- c -%]\n",
  ];
  let seed = 3;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);

  for (let i = 0; i < 2000; i++) {
    const text = docs[rnd(docs.length)];
    const selections = [];
    for (let k = 0, n = 1 + rnd(4); k < n; k++) {
      const a = rnd(text.length + 1);
      const b = rnd(text.length + 1);
      selections.push({ start: Math.min(a, b), end: Math.max(a, b) });
    }
    const edits = [...toggleComment(text, parse(text), selections)].sort(
      (x, y) => x.start - y.start
    );
    for (let k = 1; k < edits.length; k++) {
      assert.ok(
        edits[k].start >= edits[k - 1].end,
        `overlapping edits for ${JSON.stringify(text)} at ${JSON.stringify(selections)}`
      );
    }
  }
});

test("a multi-line directive comments at its opening delimiter", () => {
  assert.equal(toggleMulti("[% IF a\n   && b\n%]x[% END %]", [10]), "[%# IF a\n   && b\n%]x[% END %]");
});

test("an unterminated directive still comments", () => {
  assert.equal(toggleMulti("[% foo", [4]), "[%# foo");
});
