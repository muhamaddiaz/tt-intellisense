import * as prettier from "prettier";
import * as vscode from "vscode";

import { formatTemplate, minimalReplacement } from "./formatter-core";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function activateFormatter(): vscode.Disposable {
  return vscode.languages.registerDocumentFormattingEditProvider(
    { language: "tt", scheme: "file" },
    {
      async provideDocumentFormattingEdits(document, formattingOptions, token) {
        const enabled = vscode.workspace
          .getConfiguration("ttIntellisense", document.uri)
          .get<boolean>("formatting.enabled", true);

        if (!enabled || token.isCancellationRequested) {
          return [];
        }

        try {
          const workspaceConfig = vscode.workspace.isTrusted
            ? await prettier.resolveConfig(document.uri.fsPath, { editorconfig: true })
            : null;

          if (token.isCancellationRequested) {
            return [];
          }

          const source = document.getText();
          const formatted = await formatTemplate(source, {
            config: workspaceConfig,
            filepath: document.uri.fsPath,
            tabWidth: formattingOptions.tabSize,
            useTabs: !formattingOptions.insertSpaces,
          });

          if (token.isCancellationRequested) {
            return [];
          }

          const replacement = minimalReplacement(source, formatted);
          if (!replacement) {
            return [];
          }

          return [
            vscode.TextEdit.replace(
              new vscode.Range(
                document.positionAt(replacement.start),
                document.positionAt(replacement.end)
              ),
              replacement.text
            ),
          ];
        } catch (error) {
          throw new Error(`TT IntelliSense formatting failed: ${errorMessage(error)}`);
        }
      },
    }
  );
}
