/**
 * Makes `require("vscode")` resolve to the mock, so compiled client code can be
 * loaded outside the editor.
 */
const Module = require("node:module");
const mock = require("./vscode.cjs");

const original = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "vscode") return mock;
  return original.call(this, request, parent, isMain);
};

module.exports = mock;
