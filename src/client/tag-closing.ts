/**
 * On-type closing-tag insertion.
 *
 * LSP has no capability for this, so the behaviour lives in the client: watch
 * for `>` or `/` being typed, ask the server what should follow, and insert it.
 * This mirrors what VS Code's own HTML extension does.
 *
 * Everything here is guarded against the document moving underneath the round
 * trip. The user keeps typing while the request is in flight, and inserting a
 * stale snippet would corrupt their document rather than help.
 */
import {
  Position,
  SnippetString,
  window,
  workspace,
  type Disposable,
  type TextDocumentChangeEvent,
} from "vscode";

export type TagCompletionProvider = (
  uri: string,
  position: { line: number; character: number }
) => Promise<string | null | undefined>;

export function activateTagClosing(provider: TagCompletionProvider): Disposable {
  const disposables: Disposable[] = [];
  let inFlight = false;

  workspace.onDidChangeTextDocument(
    (event) => void onChange(event),
    null,
    disposables
  );

  async function onChange(event: TextDocumentChangeEvent): Promise<void> {
    const document = event.document;
    if (document.languageId !== "tt") return;
    if (!workspace.getConfiguration("ttIntellisense").get("autoClosingTags", true)) return;

    const editor = window.activeTextEditor;
    if (!editor || editor.document !== document) return;

    const change = event.contentChanges[event.contentChanges.length - 1];
    if (!change) return;

    // Only a single typed `>` or `/` triggers this. A paste, a multi-character
    // edit or a deletion must not.
    if (change.text !== ">" && change.text !== "/") return;
    if (change.rangeLength !== 0) return;

    // Multiple cursors would each need their own snippet; skip rather than
    // insert the same closing tag at every one of them.
    if (editor.selections.length !== 1) return;

    const position = new Position(
      change.range.start.line,
      change.range.start.character + change.text.length
    );

    if (inFlight) return;
    inFlight = true;
    const version = document.version;

    try {
      const snippet = await provider(document.uri.toString(), position);
      if (!snippet) return;

      // The document may have moved while the request was in flight.
      const active = window.activeTextEditor;
      if (!active || active.document !== document) return;
      if (document.version !== version) return;

      const selection = active.selection;
      if (!selection.isEmpty) return;
      if (!selection.active.isEqual(position)) return;

      await active.insertSnippet(new SnippetString(snippet), position);
    } catch {
      // A failed round trip is not worth surfacing: the user simply types the
      // closing tag themselves.
    } finally {
      inFlight = false;
    }
  }

  return {
    dispose(): void {
      for (const d of disposables) d.dispose();
    },
  };
}
