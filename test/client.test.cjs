/**
 * Tests for the client half of the extension.
 *
 * This code was previously untested: everything else in the suite exercises the
 * server, and the client is the glue that talks to the editor API. A defect
 * there stopped comment toggling working entirely while all server tests passed,
 * because the client handed the protocol's plain JSON to an API that requires
 * the editor's own types.
 *
 * The `vscode` mock is strict about exactly that, so the same mistake fails here
 * rather than at the user's keyboard.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");

const vscode = require("./mocks/loader.cjs");
const { registerCommentCommand } = require("../out/client/comment.js");
const { activateTagClosing } = require("../out/client/tag-closing.js");

const { Position, Range, Selection, EditBuilder, __state: state } = vscode;

/** A document and editor pair good enough for the client to work against. */
function makeEditor({ languageId = "tt", version = 1, selections } = {}) {
  const applied = [];
  const document = {
    languageId,
    version,
    uri: { toString: () => "file:///doc.tt" },
  };
  const editor = {
    document,
    selections: selections ?? [new Selection(new Position(0, 0), new Position(0, 0))],
    get selection() {
      return this.selections[0];
    },
    async edit(callback) {
      const builder = new EditBuilder();
      callback(builder);
      applied.push(...builder.operations);
      return true;
    },
    async insertSnippet(snippet, position) {
      applied.push({ snippet: snippet.value, position });
      return true;
    },
  };
  return { document, editor, applied };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function reset() {
  vscode.__reset();
}

// ------------------------------------------------------------ comment command

test("comment: converts wire ranges into editor types before editing", async () => {
  reset();
  const { editor, applied } = makeEditor();
  state.activeTextEditor = editor;

  registerCommentCommand(async () => [
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: "#" },
  ]);
  await vscode.commands.executeCommand("ttIntellisense.toggleComment");

  assert.equal(applied.length, 1);
  // The strict mock would have thrown on a plain object; assert the type too.
  assert.ok(applied[0].location instanceof Range, "edit did not receive a Range instance");
  assert.equal(applied[0].location.start.line, 0);
  assert.equal(applied[0].value, "#");
});

test("comment: applies every edit it is given", async () => {
  reset();
  const { editor, applied } = makeEditor();
  state.activeTextEditor = editor;
  registerCommentCommand(async () => [
    { range: { start: { line: 1, character: 4 }, end: { line: 1, character: 4 } }, newText: "<!-- " },
    { range: { start: { line: 1, character: 9 }, end: { line: 1, character: 9 } }, newText: " -->" },
  ]);
  await vscode.commands.executeCommand("ttIntellisense.toggleComment");
  assert.deepEqual(applied.map((a) => a.value), ["<!-- ", " -->"]);
});

test("comment: does nothing when the server returns no edits", async () => {
  reset();
  const { editor, applied } = makeEditor();
  state.activeTextEditor = editor;
  registerCommentCommand(async () => []);
  await vscode.commands.executeCommand("ttIntellisense.toggleComment");
  assert.equal(applied.length, 0);
});

test("comment: abandons the edit if the document changed while waiting", async () => {
  reset();
  const { document, editor, applied } = makeEditor();
  state.activeTextEditor = editor;
  registerCommentCommand(async () => {
    document.version = 99; // the user kept typing
    return [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: "#" },
    ];
  });
  await vscode.commands.executeCommand("ttIntellisense.toggleComment");
  assert.equal(applied.length, 0, "a stale edit was applied");
});

test("comment: a server error edits nothing and does not fall back", async () => {
  reset();
  const { editor, applied } = makeEditor();
  state.activeTextEditor = editor;
  registerCommentCommand(async () => {
    throw new Error("server down");
  });
  await vscode.commands.executeCommand("ttIntellisense.toggleComment");
  assert.equal(applied.length, 0);
  // The built-in command reads TT's static comment config, so falling back to
  // it would insert `[%# … %]` into HTML or CSS.
  assert.ok(!state.executedCommands.includes("editor.action.commentLine"));
});

test("comment: a non-tt document falls through to the built-in command", async () => {
  reset();
  const { editor, applied } = makeEditor({ languageId: "html" });
  state.activeTextEditor = editor;
  let called = false;
  registerCommentCommand(async () => {
    called = true;
    return [];
  });
  await vscode.commands.executeCommand("ttIntellisense.toggleComment");
  assert.equal(called, false, "the server was asked about a non-tt document");
  assert.ok(state.executedCommands.includes("editor.action.commentLine"));
  assert.equal(applied.length, 0);
});

test("comment: no active editor is harmless", async () => {
  reset();
  state.activeTextEditor = undefined;
  registerCommentCommand(async () => {
    throw new Error("should not be called");
  });
  await vscode.commands.executeCommand("ttIntellisense.toggleComment");
});

// --------------------------------------------------------------- tag closing

/**
 * Fires a document-change event at the registered handler.
 *
 * The cursor is moved to sit just after the typed text, because that is what a
 * real editor does and the client checks it before inserting anything.
 */
async function typeCharacter(document, text, { line = 0, character = 0, rangeLength = 0, moveCursor = true } = {}) {
  if (moveCursor && state.activeTextEditor) {
    const after = new Position(line, character + text.length);
    state.activeTextEditor.selections = [new Selection(after, after)];
  }
  for (const handler of state.changeHandlers) {
    handler({
      document,
      contentChanges: [
        { text, rangeLength, range: { start: { line, character }, end: { line, character } } },
      ],
    });
  }
  await flush();
  await flush();
}

function setupTagClosing({ languageId = "tt", enabled = true, snippet = "$0</div>" } = {}) {
  reset();
  state.configuration.ttIntellisense = { autoClosingTags: enabled };
  const made = makeEditor({ languageId });
  state.activeTextEditor = made.editor;
  const calls = [];
  activateTagClosing(async (uri, position) => {
    calls.push({ uri, position });
    return snippet;
  });
  return { ...made, calls };
}

test("tag closing: typing > asks the server and inserts the snippet", async () => {
  const { document, applied, calls } = setupTagClosing();
  await typeCharacter(document, ">", { line: 2, character: 4 });
  assert.equal(calls.length, 1, "server was not asked");
  assert.equal(calls[0].position.character, 5, "position should be after the typed character");
  assert.equal(applied.length, 1);
  assert.equal(applied[0].snippet, "$0</div>");
});

test("tag closing: typing / also asks", async () => {
  const { document, calls } = setupTagClosing();
  await typeCharacter(document, "/");
  assert.equal(calls.length, 1);
});

test("tag closing: an ordinary character is ignored", async () => {
  const { document, calls } = setupTagClosing();
  await typeCharacter(document, "a");
  assert.equal(calls.length, 0);
});

test("tag closing: a paste is ignored", async () => {
  const { document, calls } = setupTagClosing();
  await typeCharacter(document, "<div>");
  assert.equal(calls.length, 0);
});

test("tag closing: a deletion is ignored", async () => {
  const { document, calls } = setupTagClosing();
  await typeCharacter(document, ">", { rangeLength: 3 });
  assert.equal(calls.length, 0, "a replacement was treated as typing");
});

test("tag closing: multiple cursors are skipped", async () => {
  const { document, editor, calls } = setupTagClosing();
  // Two cursors before anything is typed: the same closing tag cannot serve
  // both, so the server should not even be asked.
  editor.selections = [
    new Selection(new Position(0, 1), new Position(0, 1)),
    new Selection(new Position(1, 1), new Position(1, 1)),
  ];
  await typeCharacter(document, ">", { moveCursor: false });
  assert.equal(calls.length, 0, "the same closing tag would go to every cursor");
});

test("tag closing: nothing is inserted if the cursor moved away", async () => {
  const { document, editor, applied } = setupTagClosing();
  await typeCharacter(document, ">", { line: 2, character: 4, moveCursor: false });
  editor.selections = [new Selection(new Position(0, 0), new Position(0, 0))];
  assert.equal(applied.length, 0, "a snippet landed where the cursor no longer is");
});

test("tag closing: a non-tt document is ignored", async () => {
  const { document, calls } = setupTagClosing({ languageId: "html" });
  await typeCharacter(document, ">");
  assert.equal(calls.length, 0);
});

test("tag closing: the setting turns it off", async () => {
  const { document, calls } = setupTagClosing({ enabled: false });
  await typeCharacter(document, ">");
  assert.equal(calls.length, 0);
});

test("tag closing: nothing is inserted when the server declines", async () => {
  const { document, applied } = setupTagClosing({ snippet: null });
  await typeCharacter(document, ">");
  assert.equal(applied.length, 0);
});

test("tag closing: a stale reply is not inserted", async () => {
  reset();
  state.configuration.ttIntellisense = { autoClosingTags: true };
  const { document, editor, applied } = makeEditor();
  state.activeTextEditor = editor;
  activateTagClosing(async () => {
    document.version = 99; // the user kept typing while we waited
    return "$0</div>";
  });
  await typeCharacter(document, ">");
  assert.equal(applied.length, 0, "a stale snippet was inserted");
});
