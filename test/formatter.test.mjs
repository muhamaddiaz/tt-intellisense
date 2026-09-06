import { test } from "node:test";
import assert from "node:assert/strict";

const prettierDebugBeforeImport = process.env.PRETTIER_DEBUG;
const { default: formatterPkg } = await import("../out/client/formatter-core.js");

const { formatTemplate, minimalReplacement } = formatterPkg;

test("loading the formatter does not enable process-wide Prettier debugging", () => {
  assert.equal(process.env.PRETTIER_DEBUG, prettierDebugBeforeImport);
});

test("formats an HTML fragment with the Template Toolkit parser", async () => {
  const formatted = await formatTemplate("<div><p>Hello</p><p>World</p></div>", {
    tabWidth: 2,
    useTabs: false,
  });

  assert.equal(formatted, "<div>\n  <p>Hello</p>\n  <p>World</p>\n</div>\n");
});

test("preserves Template Toolkit directives while formatting", async () => {
  const formatted = await formatTemplate(
    "[% IF user %]<strong>[% user.name %]</strong>[% END %]",
    { tabWidth: 2, useTabs: false }
  );

  assert.equal(formatted, "[% IF user %]<strong>[% user.name %]</strong>[% END %]\n");
});

test("formats complete HTML documents without changing structural tags", async () => {
  const formatted = await formatTemplate(
    "<html><head><title>X</title></head><body><p>Hello</p></body></html>",
    { tabWidth: 2, useTabs: false }
  );

  assert.equal(
    formatted,
    "<html>\n  <head>\n    <title>X</title>\n  </head>\n  <body>\n    <p>Hello</p>\n  </body>\n</html>\n"
  );
  assert.doesNotMatch(formatted, /<!--<\/?(?:head|body)/);
});

test("preserves unbalanced HTML boundary tags in partial layouts", async () => {
  const formatted = await formatTemplate("</head>\n<body>Hi</body>", {
    tabWidth: 2,
    useTabs: false,
  });

  assert.equal(formatted, "</head>\n<body>\n  Hi\n</body>\n");
  assert.doesNotMatch(formatted, /tt-intellisense-boundary|<!--<\/?(?:head|body)/);
});

test("does not mistake boundary-tag text in attributes or comments for real tags", async () => {
  const source = '<!-- partial closes </head> --><body class="header">Hi</body>';
  const formatted = await formatTemplate(source, { tabWidth: 2, useTabs: false });

  assert.equal(
    formatted,
    '<!-- partial closes </head> -->\n<body class="header">\n  Hi\n</body>\n'
  );
});

test("formats every previously unsupported TT block form", async () => {
  const templates = [
    "[% TRY %]x[% CATCH %]y[% FINAL %]z[% END %]",
    "[% PERL %]print q(x);[% END %]",
    "[% RAWPERL %]print q(x);[% END %]",
    "[% VIEW foo %]x[% END %]",
  ];

  for (const template of templates) {
    const formatted = await formatTemplate(template, { tabWidth: 2, useTabs: false });
    assert.equal(formatted, `${template}\n`);
  }
});

test("never replaces malformed non-empty HTML with an empty document", async () => {
  await assert.rejects(
    formatTemplate("<p>Hello<ul><li>World</li></ul></p>", {
      tabWidth: 2,
      useTabs: false,
    }),
    /formatter produced empty output for a non-empty document/
  );
});

test("minimalReplacement limits an edit to the changed text", () => {
  assert.deepEqual(minimalReplacement("hello world", "hello brave world"), {
    start: 6,
    end: 6,
    text: "brave ",
  });
  assert.equal(minimalReplacement("unchanged", "unchanged"), null);
});

test("minimalReplacement does not split a UTF-16 surrogate pair", () => {
  assert.deepEqual(minimalReplacement("a😀z", "a😁z"), {
    start: 1,
    end: 3,
    text: "😁",
  });
});
