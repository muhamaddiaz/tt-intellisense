/**
 * Workspace index of BLOCK definitions, so `[% PROCESS link_create %]` can find
 * a block defined in another file.
 *
 * Candidates are ranked by directory proximity rather than returned as a flat
 * list. These trees hold many sibling copies of the same template — one per
 * company, plus backup/ directories — so a block name is rarely unique and the
 * nearest definition is almost always the intended one.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { parse } from "./parser";

export interface BlockLocation {
  file: string;
  name: string;
  nameStart: number;
  nameEnd: number;
}

export interface IndexLimits {
  /** Stop after this many files, so a huge workspace cannot stall the server. */
  maxFiles: number;
  /** Skip files larger than this; they are not hand-written templates. */
  maxFileBytes: number;
}

export const DEFAULT_LIMITS: IndexLimits = { maxFiles: 5000, maxFileBytes: 2_000_000 };

const TEMPLATE_EXTENSIONS = [".tt", ".ttml", ".tt2"];
const SKIP_DIRECTORIES = new Set(["node_modules", ".git", "out", "dist", ".vscode-test"]);

export class BlockIndex {
  /** Lowercased block name to every definition of it. */
  private byName = new Map<string, BlockLocation[]>();
  private byFile = new Map<string, BlockLocation[]>();
  private limits: IndexLimits;

  constructor(limits: IndexLimits = DEFAULT_LIMITS) {
    this.limits = limits;
  }

  get size(): number {
    return this.byName.size;
  }

  get fileCount(): number {
    return this.byFile.size;
  }

  /** Indexes every template under the given roots. Safe to call repeatedly. */
  build(roots: string[]): void {
    this.byName.clear();
    this.byFile.clear();

    let budget = this.limits.maxFiles;
    for (const root of roots) {
      for (const file of walk(root, this.limits.maxFileBytes)) {
        if (budget-- <= 0) return;
        try {
          this.setFile(file, readFileSync(file, "utf8"));
        } catch {
          // An unreadable file is not worth failing the whole index over.
        }
      }
    }
  }

  /** Re-indexes one file, e.g. after an edit. */
  setFile(file: string, text: string): void {
    this.removeFile(file);

    const found: BlockLocation[] = [];
    for (const block of parse(text).allBlocks) {
      if (block.keyword !== "BLOCK" || !block.name) continue;
      if (block.nameStart === null || block.nameEnd === null) continue;
      found.push({ file, name: block.name, nameStart: block.nameStart, nameEnd: block.nameEnd });
    }

    if (!found.length) return;
    this.byFile.set(file, found);
    for (const loc of found) {
      const key = loc.name.toLowerCase();
      const list = this.byName.get(key);
      if (list) list.push(loc);
      else this.byName.set(key, [loc]);
    }
  }

  removeFile(file: string): void {
    const existing = this.byFile.get(file);
    if (!existing) return;
    this.byFile.delete(file);
    for (const loc of existing) {
      const key = loc.name.toLowerCase();
      const list = this.byName.get(key);
      if (!list) continue;
      const rest = list.filter((l) => l.file !== file);
      if (rest.length) this.byName.set(key, rest);
      else this.byName.delete(key);
    }
  }

  /** Definitions of `name`, nearest to `fromFile` first. */
  find(name: string, fromFile: string): BlockLocation[] {
    const list = this.byName.get(name.toLowerCase());
    if (!list) return [];
    const fromDir = dirname(fromFile);
    return [...list].sort((a, b) => distance(fromDir, a.file) - distance(fromDir, b.file));
  }
}

/** How far apart two locations are, in directory hops. Lower is nearer. */
function distance(fromDir: string, file: string): number {
  const dir = dirname(file);
  if (dir === fromDir) return 0;
  const rel = relative(fromDir, dir);
  if (!rel) return 0;
  return rel.split(sep).length;
}

function* walk(root: string, maxFileBytes: number): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.startsWith(".") && entry !== ".") continue;
    if (SKIP_DIRECTORIES.has(entry)) continue;

    const path = join(root, entry);
    let stats;
    try {
      stats = statSync(path);
    } catch {
      continue;
    }

    if (stats.isDirectory()) {
      yield* walk(path, maxFileBytes);
    } else if (
      TEMPLATE_EXTENSIONS.some((e) => entry.endsWith(e)) &&
      stats.size <= maxFileBytes
    ) {
      yield path;
    }
  }
}
