/**
 * Registers the context-aware comment command.
 *
 * The editor's own comment action reads a static configuration, which cannot
 * describe a file holding four languages, nor the fact that commenting a
 * Template Toolkit directive rewrites its opening delimiter. So the command is
 * bound over the usual key for `.tt` files only, and asks the server what the
 * edits should be.
 */
import { commands, Position, Range, window, type Disposable } from "vscode";

/** A position as it arrives over the wire: plain JSON, not a `vscode.Position`. */
interface WirePosition {
  line: number;
  character: number;
}

interface WireEdit {
  range: { start: WirePosition; end: WirePosition };
  newText: string;
}

export type ToggleProvider = (
  uri: string,
  selections: Array<{ start: WirePosition; end: WirePosition }>
) => Promise<WireEdit[] | null | undefined>;

export function registerCommentCommand(provider: ToggleProvider): Disposable {
  return commands.registerCommand("ttIntellisense.toggleComment", async () => {
    const editor = window.activeTextEditor;
    if (!editor || editor.document.languageId !== "tt") {
      // Not ours: fall back to the editor's own behaviour rather than doing
      // nothing, since the key is bound at the keyboard level.
      await commands.executeCommand("editor.action.commentLine");
      return;
    }

    const document = editor.document;
    const version = document.version;
    const selections = editor.selections.map((s) => ({
      start: { line: s.start.line, character: s.start.character },
      end: { line: s.end.line, character: s.end.character },
    }));

    let edits: WireEdit[] | null | undefined;
    try {
      edits = await provider(document.uri.toString(), selections);
    } catch {
      // Deliberately silent. The built-in command would fall back to the
      // static `comments` configuration, which describes TT syntax and would
      // therefore produce `[%# … %]` in the middle of HTML or CSS. Doing
      // nothing is better than doing the wrong thing.
      return;
    }

    if (!edits?.length) return;

    // The document may have moved while the request was in flight.
    if (document.version !== version) return;

    // The request was sent raw, so nothing converted the protocol's plain
    // JSON into the editor's own types. Passing those objects straight to the
    // edit API does not work; they have to be rebuilt here.
    //
    // editor.edit is used rather than a WorkspaceEdit so the change lands as a
    // single undo step on this editor and selections are adjusted for it.
    await editor.edit(
      (builder) => {
        for (const edit of edits ?? []) {
          builder.replace(
            new Range(
              new Position(edit.range.start.line, edit.range.start.character),
              new Position(edit.range.end.line, edit.range.end.character)
            ),
            edit.newText
          );
        }
      },
      { undoStopBefore: true, undoStopAfter: true }
    );
  });
}
