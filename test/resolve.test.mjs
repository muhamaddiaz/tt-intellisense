import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import pkg from "../out/server/resolve.js";
import scanPkg from "../out/server/scan.js";
const { resolveTemplate, absoluteRoots } = pkg;
const { scan } = scanPkg;

function sandbox() {
  const d = mkdtempSync(join(tmpdir(), "tt-resolve-"));
  mkdirSync(join(d, "pages"), { recursive: true });
  mkdirSync(join(d, "shared"), { recursive: true });
  mkdirSync(join(d, "pages", "esg"), { recursive: true });
  writeFileSync(join(d, "pages", "include_header.tt"), "");
  writeFileSync(join(d, "pages", "esg", "include_header.tt"), "");
  writeFileSync(join(d, "shared", "include_footer.tt"), "");
  writeFileSync(join(d, "shared", "widget.ttml"), "");
  return d;
}

test("resolves a sibling file", () => {
  const d = sandbox();
  const got = resolveTemplate("include_header.tt", { fromDir: join(d, "pages") });
  assert.equal(got, join(d, "pages", "include_header.tt"));
});

test("sibling directory beats a configured root", () => {
  const d = sandbox();
  writeFileSync(join(d, "shared", "include_header.tt"), "");
  const got = resolveTemplate("include_header.tt", {
    fromDir: join(d, "pages"),
    roots: [join(d, "shared")],
  });
  assert.equal(got, join(d, "pages", "include_header.tt"), "root won over sibling");
});

test("falls back to a configured root", () => {
  const d = sandbox();
  const got = resolveTemplate("include_footer.tt", {
    fromDir: join(d, "pages"),
    roots: [join(d, "shared")],
  });
  assert.equal(got, join(d, "shared", "include_footer.tt"));
});

test("resolves a nested relative path", () => {
  const d = sandbox();
  const got = resolveTemplate("esg/include_header.tt", { fromDir: join(d, "pages") });
  assert.equal(got, join(d, "pages", "esg", "include_header.tt"));
});

test("appends a known extension when the reference has none", () => {
  const d = sandbox();
  assert.equal(
    resolveTemplate("include_header", { fromDir: join(d, "pages") }),
    join(d, "pages", "include_header.tt")
  );
  assert.equal(
    resolveTemplate("widget", { fromDir: join(d, "shared") }),
    join(d, "shared", "widget.ttml")
  );
});

test("does not append an extension to a name that has one", () => {
  const d = sandbox();
  assert.equal(resolveTemplate("include_header.tt.tt", { fromDir: join(d, "pages") }), undefined);
});

test("returns undefined rather than throwing for a missing file", () => {
  const d = sandbox();
  assert.equal(resolveTemplate("nope.tt", { fromDir: join(d, "pages") }), undefined);
});

test("refuses dynamic names", () => {
  const d = sandbox();
  assert.equal(resolveTemplate("page_$x.tt", { fromDir: join(d, "pages") }), undefined);
});

test("a directory is not a template", () => {
  const d = sandbox();
  assert.equal(resolveTemplate("esg", { fromDir: join(d, "pages") }), undefined);
});

test("absoluteRoots drops roots that do not exist", () => {
  const d = sandbox();
  assert.deepEqual(absoluteRoots(["shared", "missing"], [d]), [join(d, "shared")]);
});

const CORPUS = process.env.TT_CORPUS;
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".git") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith(".tt")) out.push(p);
  }
  return out;
}

test("corpus: report how many real references resolve", { skip: !CORPUS }, () => {
  const files = walk(CORPUS);
  let total = 0, viaBlock = 0, viaFile = 0;
  const unresolved = new Map();

  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const { refs, blocks } = scan(src);
    const names = new Set(blocks.map((b) => b.name));
    for (const r of refs) {
      total++;
      if (names.has(r.name)) { viaBlock++; continue; }
      if (resolveTemplate(r.name, { fromDir: dirname(f) })) { viaFile++; continue; }
      unresolved.set(r.name, (unresolved.get(r.name) ?? 0) + 1);
    }
  }

  const missed = total - viaBlock - viaFile;
  const pct = ((viaBlock + viaFile) / total * 100).toFixed(1);
  console.log(`  corpus: ${total} refs — ${viaFile} file, ${viaBlock} local block, ${missed} unresolved (${pct}% resolved)`);
  const top = [...unresolved.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [n, c] of top) console.log(`    unresolved x${c}: ${n}`);
  assert.ok(total > 0);
});
