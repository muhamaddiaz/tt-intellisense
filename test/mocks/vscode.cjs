/**
 * A stand-in for the `vscode` module, for testing client code headlessly.
 *
 * It is deliberately strict about types. The real API validates that a range
 * is a `Range` instance and rejects a plain object with the same shape, and a
 * permissive mock would have accepted the bug this file exists to catch: the
 * client was handing the protocol's plain JSON straight to the edit API.
 */
class Position {
  constructor(line, character) {
    if (typeof line !== "number" || typeof character !== "number") {
      throw new TypeError("Position requires numbers");
    }
    this.line = line;
    this.character = character;
  }
  isEqual(other) {
    return other instanceof Position && other.line === this.line && other.character === this.character;
  }
}

class Range {
  constructor(start, end) {
    if (!(start instanceof Position) || !(end instanceof Position)) {
      throw new TypeError("Range requires Position instances");
    }
    this.start = start;
    this.end = end;
  }
}

class Selection extends Range {
  get active() {
    return this.end;
  }
  get isEmpty() {
    return this.start.line === this.end.line && this.start.character === this.end.character;
  }
}

class SnippetString {
  constructor(value) {
    if (typeof value !== "string") throw new TypeError("SnippetString requires a string");
    this.value = value;
  }
}

class WorkspaceEdit {
  constructor() {
    this.edits = [];
  }
  replace(uri, range, newText) {
    if (!(range instanceof Range)) {
      throw new TypeError("WorkspaceEdit.replace requires a Range instance");
    }
    this.edits.push({ uri, range, newText });
  }
}

/** Records what an editor.edit callback asked for, validating as it goes. */
class EditBuilder {
  constructor() {
    this.operations = [];
  }
  replace(location, value) {
    if (!(location instanceof Range) && !(location instanceof Position)) {
      throw new TypeError("TextEditorEdit.replace requires a Range or Position instance");
    }
    if (typeof value !== "string") throw new TypeError("replace requires a string");
    this.operations.push({ location, value });
  }
  insert(position, value) {
    if (!(position instanceof Position)) {
      throw new TypeError("TextEditorEdit.insert requires a Position instance");
    }
    this.operations.push({ location: position, value });
  }
}

const state = {
  activeTextEditor: undefined,
  configuration: {},
  registeredCommands: new Map(),
  executedCommands: [],
  changeHandlers: [],
};

const commands = {
  registerCommand(name, handler) {
    state.registeredCommands.set(name, handler);
    return { dispose() { state.registeredCommands.delete(name); } };
  },
  async executeCommand(name, ...args) {
    state.executedCommands.push(name);
    const handler = state.registeredCommands.get(name);
    if (handler) return handler(...args);
    return undefined;
  },
};

const window = {
  get activeTextEditor() {
    return state.activeTextEditor;
  },
};

const workspace = {
  onDidChangeTextDocument(handler, _thisArg, disposables) {
    state.changeHandlers.push(handler);
    const d = { dispose() {} };
    if (disposables) disposables.push(d);
    return d;
  },
  getConfiguration(section) {
    const values = state.configuration[section] ?? {};
    return { get: (key, fallback) => (key in values ? values[key] : fallback) };
  },
  async applyEdit(edit) {
    state.appliedWorkspaceEdit = edit;
    return true;
  },
};

module.exports = {
  Position,
  Range,
  Selection,
  SnippetString,
  WorkspaceEdit,
  EditBuilder,
  commands,
  window,
  workspace,
  __state: state,
  __reset() {
    state.activeTextEditor = undefined;
    state.configuration = {};
    state.registeredCommands.clear();
    state.executedCommands = [];
    state.changeHandlers = [];
    state.appliedWorkspaceEdit = undefined;
  },
};
