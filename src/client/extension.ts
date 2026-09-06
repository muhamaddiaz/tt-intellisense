import * as path from "node:path";
import type { Disposable, ExtensionContext } from "vscode";
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node";

import { activateFormatter } from "./formatter";
import { activateTagClosing } from "./tag-closing";
import { registerCommentCommand } from "./comment";

let client: LanguageClient | undefined;
let tagClosing: Disposable | undefined;

export function activate(context: ExtensionContext): void {
  context.subscriptions.push(activateFormatter());

  const module = context.asAbsolutePath(path.join("out", "server", "server.js"));

  const serverOptions: ServerOptions = {
    run: { module, transport: TransportKind.ipc },
    debug: {
      module,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "tt" }],
    synchronize: { configurationSection: "ttIntellisense" },
  };

  client = new LanguageClient("ttIntellisense", "TT IntelliSense", serverOptions, clientOptions);

  void client.start().then(() => {
    const active = client;
    if (!active) return;
    tagClosing = activateTagClosing((uri, position) =>
      active.sendRequest<string | null>("tt/tagComplete", { uri, position })
    );
    context.subscriptions.push(tagClosing);

    context.subscriptions.push(
      registerCommentCommand((uri, selections) =>
        active.sendRequest("tt/toggleComment", { uri, selections })
      )
    );
  });
}

export function deactivate(): Thenable<void> | undefined {
  tagClosing?.dispose();
  tagClosing = undefined;
  return client?.stop();
}
