/**
 * TT IntelliSense language server.
 *
 * M2 brought navigation, M3 adds the parser and everything that hangs off it:
 * structural diagnostics, folding, an outline, and cross-file block lookup.
 * Completion and hover arrive with M4.
 */
import {
  CompletionItemKind,
  DidChangeConfigurationNotification,
  DocumentLink,
  Location,
  MarkupKind,
  ProposedFeatures,
  Range,
  TextDocumentSyncKind,
  TextDocuments,
  createConnection,
  type CompletionItem,
  type DocumentSymbol,
  type FoldingRange,
  type Hover,
  type InitializeParams,
  type InitializeResult,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";

import { parse, templateRefs, type ParseResult } from "./parser";
import { toDiagnostics, toDocumentSymbols, toFoldingRanges } from "./features";
import { absoluteRoots, resolveTemplate } from "./resolve";
import { BlockIndex } from "./workspace";
import {
  completionContext,
  keywordSuggestions,
  localSuggestions,
  memberSuggestions,
  resolvePath,
  scopeAt,
  type Suggestion,
} from "./complete";
import { hoverAt } from "./hover";
import { DEFAULT_STORE_OPTIONS, SchemaStore } from "./schema/store";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const index = new BlockIndex();
const schema = new SchemaStore();

let workspaceDirs: string[] = [];
let configuredRoots: string[] = [];
let structuralDiagnostics = true;
let supportsConfiguration = false;

/** Parses are cached per document version; every feature request would reparse otherwise. */
const cache = new Map<string, { version: number; result: ParseResult }>();

function parsed(doc: TextDocument): ParseResult {
  const hit = cache.get(doc.uri);
  if (hit && hit.version === doc.version) return hit.result;
  const result = parse(doc.getText());
  cache.set(doc.uri, { version: doc.version, result });
  return result;
}

function docPath(doc: TextDocument): string | undefined {
  try {
    return fileURLToPath(doc.uri);
  } catch {
    return undefined;
  }
}

function rangeOf(doc: TextDocument, start: number, end: number): Range {
  return { start: doc.positionAt(start), end: doc.positionAt(end) };
}

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
      foldingRangeProvider: true,
      documentSymbolProvider: true,
      hoverProvider: true,
      completionProvider: { triggerCharacters: [".", "%", " "], resolveProvider: false },
    },
  };
});

connection.onInitialized(() => {
  if (supportsConfiguration) {
    void connection.client.register(DidChangeConfigurationNotification.type, undefined);
    void refreshConfiguration();
  }
  // Deferred: indexing a large tree takes seconds and must not delay startup.
  setTimeout(() => {
    index.build(workspaceDirs);
    connection.console.info(
      `TT: indexed ${index.size} block names across ${index.fileCount} files`
    );

    schema.build(workspaceDirs);
    const r = schema.report;
    connection.console.info(
      `TT: schema from ${r.dumpFiles} dump(s) (${r.dumpPaths} paths), ` +
        `${r.minedFiles} mined template(s)` +
        (r.curated ? ", curated overrides loaded" : "")
    );

    // A dump captured from a real render can carry credentials. Values are
    // redacted on display regardless, but a file like this must not be
    // committed, and its author may not know what ended up in it.
    if (r.dumpsWithSecrets.length) {
      const names = r.dumpsWithSecrets.join(", ");
      connection.window.showWarningMessage(
        `TT IntelliSense: ${names} appears to contain credentials. ` +
          `Values are hidden in hover, but keep ${DEFAULT_STORE_OPTIONS.dumpDirectory}/ out of version control.`
      );
    }
  }, 0);
});

async function refreshConfiguration(): Promise<void> {
  if (!supportsConfiguration) return;
  try {
    const cfg = await connection.workspace.getConfiguration("ttIntellisense");
    const raw = Array.isArray(cfg?.includePath) ? cfg.includePath : [];
    configuredRoots = raw.filter((r: unknown): r is string => typeof r === "string");
    structuralDiagnostics = cfg?.diagnostics?.structural !== false;
  } catch {
    configuredRoots = [];
    structuralDiagnostics = true;
  }
  for (const doc of documents.all()) publishDiagnostics(doc);
}

connection.onDidChangeConfiguration(() => {
  void refreshConfiguration();
});

function rootsFor(): string[] {
  return absoluteRoots(configuredRoots, workspaceDirs);
}

function publishDiagnostics(doc: TextDocument): void {
  const diagnostics = structuralDiagnostics
    ? toDiagnostics(parsed(doc), (o) => doc.positionAt(o))
    : [];
  void connection.sendDiagnostics({ uri: doc.uri, diagnostics });
}

documents.onDidChangeContent((e) => {
  publishDiagnostics(e.document);
  const path = docPath(e.document);
  // Keep the index current for the file being edited, so a block just renamed
  // is findable from other files without a save.
  if (path) index.setFile(path, e.document.getText());
  schema.updateDocument(e.document.uri, e.document.getText());
});

documents.onDidClose((e) => {
  cache.delete(e.document.uri);
  schema.closeDocument(e.document.uri);
  void connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});

connection.onDocumentLinks((params): DocumentLink[] => {
  const doc = documents.get(params.textDocument.uri);
  const path = doc && docPath(doc);
  if (!doc || !path) return [];

  const result = parsed(doc);
  const localBlocks = new Set(
    result.allBlocks.filter((b) => b.keyword === "BLOCK" && b.name).map((b) => b.name!)
  );
  const fromDir = dirname(path);
  const roots = rootsFor();

  const links: DocumentLink[] = [];
  for (const ref of templateRefs(result)) {
    // A block in this document wins over a file, matching TT. There is no other
    // file to open, so it is not a link.
    if (localBlocks.has(ref.name)) continue;

    const target =
      resolveTemplate(ref.name, { fromDir, roots }) ?? index.find(ref.name, path)[0]?.file;
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
  const result = parsed(doc);

  const ref = templateRefs(result).find((r) => offset >= r.start && offset <= r.end);
  if (!ref) return [];

  const local = result.allBlocks.find((b) => b.keyword === "BLOCK" && b.name === ref.name);
  if (local && local.nameStart !== null && local.nameEnd !== null) {
    return [{ uri: doc.uri, range: rangeOf(doc, local.nameStart, local.nameEnd) }];
  }

  const file = resolveTemplate(ref.name, { fromDir: dirname(path), roots: rootsFor() });
  if (file) {
    const zero = { line: 0, character: 0 };
    return [{ uri: pathToFileURL(file).toString(), range: { start: zero, end: zero } }];
  }

  // Nothing on disk: the name may be a block defined elsewhere in the workspace.
  return index.find(ref.name, path).slice(0, 8).map((loc) => ({
    uri: pathToFileURL(loc.file).toString(),
    range: offsetsToRange(loc.file, loc.nameStart, loc.nameEnd),
  }));
});

connection.onFoldingRanges((params): FoldingRange[] => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  return toFoldingRanges(parsed(doc), (o) => doc.positionAt(o));
});

connection.onDocumentSymbol((params): DocumentSymbol[] => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  return toDocumentSymbols(doc.getText(), parsed(doc), (o) => doc.positionAt(o));
});

/**
 * Converts offsets in a file that may not be open. Reading it is acceptable
 * here: this runs only when the user asked to jump to that exact location.
 */
function offsetsToRange(file: string, start: number, end: number): Range {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const text = require("node:fs").readFileSync(file, "utf8") as string;
    const doc = TextDocument.create(pathToFileURL(file).toString(), "tt", 0, text);
    return { start: doc.positionAt(start), end: doc.positionAt(end) };
  } catch {
    const zero = { line: 0, character: 0 };
    return { start: zero, end: zero };
  }
}

const SUGGESTION_KIND: Record<Suggestion["kind"], CompletionItemKind> = {
  variable: CompletionItemKind.Variable,
  field: CompletionItemKind.Field,
  local: CompletionItemKind.Variable,
  keyword: CompletionItemKind.Keyword,
};

connection.onCompletion((params): CompletionItem[] => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const text = doc.getText();
  const offset = doc.offsetAt(params.position);
  const result = parsed(doc);

  const context = completionContext(text, offset, result);
  if (!context.inDirective) return [];

  const scope = scopeAt(result, offset);
  let suggestions: Suggestion[];

  if (context.base.length === 0) {
    suggestions = [
      ...localSuggestions(scope),
      ...memberSuggestions(schema.schema, (r) => schema.documentFrequency(r), true),
    ];
    if (context.atDirectiveHead) {
      suggestions = [...keywordSuggestions(context.partial), ...suggestions];
    }
  } else {
    const parent = resolvePath(context.base, schema.schema, scope);
    suggestions = parent ? memberSuggestions(parent, () => 0, false) : [];
  }

  return suggestions.map((s, i) => ({
    label: s.label,
    kind: SUGGESTION_KIND[s.kind],
    detail: s.detail,
    documentation: s.documentation,
    // Rank is carried in sortText so the client keeps our ordering: `ir` and
    // `global` first, the long mined tail last but still reachable.
    sortText: `${String(s.rank).padStart(5, "0")}${String(i).padStart(5, "0")}`,
  }));
});

connection.onHover((params): Hover | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const info = hoverAt(doc.getText(), doc.offsetAt(params.position), parsed(doc), schema.schema);
  if (!info) return null;

  return {
    contents: { kind: MarkupKind.Markdown, value: info.markdown },
    range: rangeOf(doc, info.start, info.end),
  };
});

documents.listen(connection);
connection.listen();
