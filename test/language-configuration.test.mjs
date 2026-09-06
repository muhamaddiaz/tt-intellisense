import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const configuration = JSON.parse(
  readFileSync(new URL("../language-configuration.json", import.meta.url), "utf8"),
);

function regexp(definition) {
  if (typeof definition === "string") return new RegExp(definition);
  return new RegExp(definition.pattern, definition.flags);
}

test("Enter indents between and after HTML tags", () => {
  const [betweenTags, afterOpeningTag] = configuration.onEnterRules;

  assert.match('<div class="container">', regexp(betweenTags.beforeText));
  assert.match("</div>", regexp(betweenTags.afterText));
  assert.equal(betweenTags.action.indent, "indentOutdent");

  assert.match('<button type="button">', regexp(afterOpeningTag.beforeText));
  assert.equal(afterOpeningTag.action.indent, "indent");
  assert.doesNotMatch("<img>", regexp(afterOpeningTag.beforeText));
  assert.doesNotMatch("<div />", regexp(afterOpeningTag.beforeText));
});

test("indentation rules cover HTML, CSS, and Template Toolkit blocks", () => {
  const increase = regexp(configuration.indentationRules.increaseIndentPattern);
  const decrease = regexp(configuration.indentationRules.decreaseIndentPattern);

  assert.match('<ul class="nav nav-tabs">', increase);
  assert.match(".card {", increase);
  assert.match("[% IF user.active %]", increase);
  assert.doesNotMatch("<input>", increase);
  assert.doesNotMatch("<span>text</span>", increase);

  assert.match("</ul>", decrease);
  assert.match("}", decrease);
  assert.match("[% END %]", decrease);
});
