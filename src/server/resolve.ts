/**
 * Resolves a template reference to a file on disk.
 *
 * Order is the current file's own directory first, then each configured root
 * in turn. That is not what Template Toolkit itself does — a real INCLUDE_PATH
 * has no notion of "next to the including file" — but it matches how these
 * template trees are actually laid out, where an include sits beside the page
 * that includes it, and it means navigation works with no configuration at
 * all. Configured roots exist for projects that do have a real INCLUDE_PATH.
 *
 * Blocks defined in the current document take precedence over files, matching
 * TT. That check happens before this module is consulted.
 */
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, resolve as resolvePath } from "node:path";

/** Extensions tried when the reference has none, in order. */
const IMPLICIT_EXTENSIONS = ["", ".tt", ".ttml", ".tt2"];

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function candidatesFor(dir: string, name: string): string[] {
  const base = normalize(join(dir, name));
  // A name that already ends in a known extension should not also be tried
  // with one appended; `header.tt.tt` is never what anyone meant.
  const hasExt = /\.[A-Za-z0-9]+$/.test(name);
  return (hasExt ? [""] : IMPLICIT_EXTENSIONS).map((e) => base + e);
}

export interface ResolveOptions {
  /** Directory of the file containing the reference. */
  fromDir: string;
  /** Additional search roots, absolute, in priority order. */
  roots?: string[];
}

/**
 * Returns the absolute path of the first existing candidate, or undefined.
 * Never throws: an unresolvable reference is a normal state, not an error.
 */
export function resolveTemplate(name: string, opts: ResolveOptions): string | undefined {
  if (!name || name.includes("$")) return undefined;

  // An absolute reference is taken at face value.
  if (isAbsolute(name)) {
    for (const c of candidatesFor("", name)) if (isFile(c)) return c;
    return undefined;
  }

  const dirs = [opts.fromDir, ...(opts.roots ?? [])];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const c of candidatesFor(dir, name)) {
      if (isFile(c)) return c;
    }
  }
  return undefined;
}

/** Turns configured roots into absolute paths against the workspace folders. */
export function absoluteRoots(roots: string[], workspaceDirs: string[]): string[] {
  const out: string[] = [];
  for (const r of roots) {
    if (isAbsolute(r)) {
      if (existsSync(r)) out.push(r);
      continue;
    }
    for (const w of workspaceDirs) {
      const p = resolvePath(w, r);
      if (existsSync(p)) out.push(p);
    }
  }
  return out;
}
