/**
 * Registers the context-aware comment command.
 *
 * The editor's own comment action reads a static configuration, which cannot
 * describe a file holding four languages, nor the fact that commenting a
 * Template Toolkit directive rewrites its opening delimiter. So the command is
 * bound over the usual key for `.tt` files only, and asks the server what the
 * edits should be.
 */
import { commands, window, workspace, WorkspaceEdit, type Disposable, type Range } from "vscode";

export type ToggleProvider = (
  uri: string,
  selections: Array<{ start: { line: number; character: number }; end: { line: number; character: number } }>
) => Promise<Array<{ range: Range; newText: string }> | null | undefined>;

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

    let edits: Array<{ range: Range; newText: string }> | null | undefined;
    try {
      edits = await provider(document.uri.toString(), selections);
    } catch {
      await commands.executeCommand("editor.action.commentLine");
      return;
    }

    if (!edits?.length) return;

    // The document may have moved while the request was in flight.
    if (document.version !== version) return;

    const workspaceEdit = new WorkspaceEdit();
    for (const edit of edits) {
      workspaceEdit.replace(document.uri, edit.range, edit.newText);
    }
    await workspace.applyEdit(workspaceEdit);
  });
}
