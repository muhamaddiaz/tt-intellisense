/**
 * Combines the three schema layers into one tree.
 *
 * Precedence is curated over dump over mined, but merging unions children at
 * every level: no layer is complete, so none may erase another. See ADR 0001.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { parseCurated, parseDump } from "./dump";
import { Miner } from "./mine";
import { merge, node, type SchemaNode } from "./model";
import { isSecretKey } from "./redact";

export interface StoreOptions {
  /**
   * Where stash dumps live. One location or several.
   *
   * A relative path is resolved against each workspace folder. An absolute path
   * or one starting `~` is used as given, which is how a single dump can be
   * shared by every project instead of copied into each one — worth doing, since
   * a dump kept outside any repository cannot be committed by accident.
   */
  dumpDirectory: string | string[];
  /** Curated schema file, resolved the same way as `dumpDirectory`. */
  curatedFile: string | string[];
  maxFiles: number;
  maxFileBytes: number;
}

export const DEFAULT_STORE_OPTIONS: StoreOptions = {
  dumpDirectory: ".tt-schema",
  curatedFile: "tt-schema.json",
  maxFiles: 5000,
  maxFileBytes: 20_000_000,
};

export interface StoreReport {
  dumpFiles: number;
  dumpPaths: number;
  minedFiles: number;
  curated: boolean;
  /** Dump files whose content looked like it carried credentials. */
  dumpsWithSecrets: string[];
}

const TEMPLATE_EXTENSIONS = [".tt", ".ttml", ".tt2"];
const SKIP_DIRECTORIES = new Set(["node_modules", ".git", "out", "dist", ".vscode-test"]);

export class SchemaStore {
  private options: StoreOptions;
  private miner = new Miner();
  /**
   * Mined contributions from currently-open documents, keyed by URI and
   * replaced wholesale on every edit.
   *
   * The persistent miner must not see live edits. It accumulates and never
   * forgets, so mining each keystroke would make every half-typed path — `ir.co`
   * on the way to `ir.config` — a permanent completion for the whole workspace.
   */
  private liveLayers = new Map<string, SchemaNode>();
  private dumpLayer: SchemaNode = node("hash", "dump");
  private curatedLayer: SchemaNode = node("hash", "curated");
  private combined: SchemaNode = node("hash", "mined");
  private lastReport: StoreReport = {
    dumpFiles: 0,
    dumpPaths: 0,
    minedFiles: 0,
    curated: false,
    dumpsWithSecrets: [],
  };

  constructor(options: StoreOptions = DEFAULT_STORE_OPTIONS) {
    this.options = options;
  }

  /**
   * Applies new options. Returns true when they differ from the current ones,
   * so the caller knows whether a rebuild is actually needed.
   */
  configure(options: Partial<StoreOptions>): boolean {
    const next = { ...this.options, ...options };
    const changed = (Object.keys(next) as Array<keyof StoreOptions>).some(
      (k) => JSON.stringify(next[k]) !== JSON.stringify(this.options[k])
    );
    this.options = next;
    return changed;
  }

  /** The dump locations, as configured, for messages to the user. */
  get dumpDirectory(): string {
    return toList(this.options.dumpDirectory).join(", ");
  }

  get schema(): SchemaNode {
    return this.combined;
  }

  get report(): StoreReport {
    return this.lastReport;
  }

  documentFrequency(root: string): number {
    return this.miner.documentFrequency(root);
  }

  build(workspaceDirs: string[]): void {
    this.miner = new Miner();
    this.dumpLayer = node("hash", "dump");
    this.curatedLayer = node("hash", "curated");

    const report: StoreReport = {
      dumpFiles: 0,
      dumpPaths: 0,
      minedFiles: 0,
      curated: false,
      dumpsWithSecrets: [],
    };

    // Locations outside any workspace are read once, not once per folder.
    const seen = new Set<string>();

    for (const curatedPath of expand(this.options.curatedFile, workspaceDirs)) {
      if (seen.has(curatedPath)) continue;
      seen.add(curatedPath);
      const curatedText = readIfFile(curatedPath, this.options.maxFileBytes);
      if (curatedText === undefined) continue;
      merge(this.curatedLayer, parseCurated(curatedText));
      report.curated = true;
    }

    for (const dumpDir of expand(this.options.dumpDirectory, workspaceDirs)) {
      for (const file of listFiles(dumpDir)) {
        if (seen.has(file)) continue;
        seen.add(file);
        const text = readIfFile(file, this.options.maxFileBytes);
        if (text === undefined) continue;
        merge(this.dumpLayer, parseDump(text));
        report.dumpFiles++;
        if (looksLikeItHoldsSecrets(text)) report.dumpsWithSecrets.push(basename(file));
      }
    }

    for (const dir of workspaceDirs) {
      // Mined layer.
      let budget = this.options.maxFiles;
      for (const file of walkTemplates(dir, this.options.maxFileBytes)) {
        if (budget-- <= 0) break;
        const text = readIfFile(file, this.options.maxFileBytes);
        if (text === undefined) continue;
        this.miner.addDocument(text);
        report.minedFiles++;
      }
    }

    this.recombine();
    report.dumpPaths = countChildren(this.dumpLayer);
    this.lastReport = report;
  }

  /** Replaces the mined contribution of one open document. */
  updateDocument(uri: string, text: string): void {
    const miner = new Miner();
    miner.addDocument(text);
    this.liveLayers.set(uri, miner.merged());
    this.recombine();
  }

  /** Drops a closed document's live contribution. */
  closeDocument(uri: string): void {
    if (this.liveLayers.delete(uri)) this.recombine();
  }

  private recombine(): void {
    const combined = node("hash", "mined");
    merge(combined, this.miner.merged());
    for (const layer of this.liveLayers.values()) merge(combined, layer);
    merge(combined, this.dumpLayer);
    merge(combined, this.curatedLayer);
    this.combined = combined;
  }
}

function toList(value: string | string[]): string[] {
  return (Array.isArray(value) ? value : [value]).filter((v) => v.trim() !== "");
}

/** Expands `~`, keeps absolute paths, resolves relative ones per workspace. */
function expand(value: string | string[], workspaceDirs: string[]): string[] {
  const out: string[] = [];

  for (const entry of toList(value)) {
    if (entry === "~" || entry.startsWith("~/")) {
      out.push(resolve(homedir(), entry.slice(2)));
      continue;
    }
    if (isAbsolute(entry)) {
      out.push(entry);
      continue;
    }
    for (const dir of workspaceDirs) out.push(join(dir, entry));
  }

  return out;
}

function countChildren(n: SchemaNode): number {
  let total = 0;
  for (const child of n.children.values()) total += 1 + countChildren(child);
  return total;
}

function readIfFile(path: string, maxBytes: number): string | undefined {
  try {
    const stats = statSync(path);
    if (!stats.isFile() || stats.size > maxBytes) return undefined;
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((e) => !e.startsWith("."))
      .map((e) => join(dir, e))
      .filter((p) => {
        try {
          return statSync(p).isFile();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function* walkTemplates(root: string, maxFileBytes: number): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const path = join(root, entry);
    let stats;
    try {
      stats = statSync(path);
    } catch {
      continue;
    }
    if (stats.isDirectory()) yield* walkTemplates(path, maxFileBytes);
    else if (TEMPLATE_EXTENSIONS.some((e) => entry.endsWith(e)) && stats.size <= maxFileBytes) {
      yield path;
    }
  }
}

/**
 * Whether a dump appears to carry credentials, so the server can say so.
 *
 * Values are still redacted at display time regardless; this only drives a
 * warning, because a dump with secrets in it is a file that should not be
 * committed and the author may not realise it.
 */
function looksLikeItHoldsSecrets(text: string): boolean {
  for (const line of text.split("\n", 20000)) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).replace(/^[ |`\-]*/, "").trim();
    const value = line.slice(eq + 1).trim();
    if (key && value && value !== "undef" && isSecretKey(key)) return true;
  }
  return false;
}
