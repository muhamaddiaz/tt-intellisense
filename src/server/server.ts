/**
 * TT IntelliSense language server.
 *
 * M2 scope: navigation only. Template references become clickable links, and
 * go-to-definition resolves them to a file or to a block defined in the same
 * document. Diagnostics and completion arrive in later milestones.
 */
import {
  createConnection,
  DidChangeConfigurationNotification,
  DocumentLink,
  Location,
  ProposedFeatures,
  Range,
  TextDocumentSyncKind,
  TextDocuments,
  type InitializeParams,
  type InitializeResult,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";

import { scan, type BlockDef } from "./scan";
import { absoluteRoots, resolveTemplate } from "./resolve";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let workspaceDirs: string[] = [];
let configuredRoots: string[] = [];
let supportsConfiguration = false;

connection.onInitialize((params: InitializeParams): InitializeResult => {
  supportsConfiguration = Boolean(params.capabilities.workspace?.configuration);

  workspaceDirs = (params.workspaceFolders ?? [])
    .map((f) => {
      try {
        return fileURLToPath(f.uri);
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      documentLinkProvider: { resolveProvider: false },
      definitionProvider: true,
    },
  };
});

connection.onInitialized(() => {
  if (supportsConfiguration) {
    void connection.client.register(DidChangeConfigurationNotification.type, undefined);
    void refreshConfiguration();
  }
});

async function refreshConfiguration(): Promise<void> {
  if (!supportsConfiguration) return;
  try {
    const cfg = await connection.workspace.getConfiguration("ttIntellisense");
    const raw = Array.isArray(cfg?.includePath) ? cfg.includePath : [];
    configuredRoots = raw.filter((r: unknown): r is string => typeof r === "string");
  } catch {
    configuredRoots = [];
  }
}

connection.onDidChangeConfiguration(() => {
  void refreshConfiguration();
});

function docPath(doc: TextDocument): string | undefined {
  try {
    return fileURLToPath(doc.uri);
  } catch {
    return undefined;
  }
}

function rootsFor(): string[] {
  return absoluteRoots(configuredRoots, workspaceDirs);
}

function rangeOf(doc: TextDocument, start: number, end: number): Range {
  return { start: doc.positionAt(start), end: doc.positionAt(end) };
}

connection.onDocumentLinks((params): DocumentLink[] => {
  const doc = documents.get(params.textDocument.uri);
  const path = doc && docPath(doc);
  if (!doc || !path) return [];

  const { refs, blocks } = scan(doc.getText());
  const blockNames = new Set(blocks.map((b) => b.name));
  const fromDir = dirname(path);
  const roots = rootsFor();

  const links: DocumentLink[] = [];
  for (const ref of refs) {
    // A block in this document wins over a file, matching TT. It is not a
    // document link, though — there is no other file to open.
    if (blockNames.has(ref.name)) continue;

    const target = resolveTemplate(ref.name, { fromDir, roots });
    if (!target) continue;

    links.push({
      range: rangeOf(doc, ref.start, ref.end),
      target: pathToFileURL(target).toString(),
    });
  }
  return links;
});

connection.onDefinition((params): Location[] => {
  const doc = documents.get(params.textDocument.uri);
  const path = doc && docPath(doc);
  if (!doc || !path) return [];

  const offset = doc.offsetAt(params.position);
  const { refs, blocks } = scan(doc.getText());

  const ref = refs.find((r) => offset >= r.start && offset <= r.end);
  if (!ref) return [];

  const block: BlockDef | undefined = blocks.find((b) => b.name === ref.name);
  if (block) {
    return [{ uri: doc.uri, range: rangeOf(doc, block.nameStart, block.nameEnd) }];
  }

  const target = resolveTemplate(ref.name, { fromDir: dirname(path), roots: rootsFor() });
  if (!target) return [];

  const zero = { line: 0, character: 0 };
  return [{ uri: pathToFileURL(target).toString(), range: { start: zero, end: zero } }];
});

documents.listen(connection);
connection.listen();
