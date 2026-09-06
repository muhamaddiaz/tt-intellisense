import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import model from "../out/server/schema/model.js";
import dump from "../out/server/schema/dump.js";
import redact from "../out/server/schema/redact.js";
import mine from "../out/server/schema/mine.js";
import storePkg from "../out/server/schema/store.js";
const { lookup, countPaths, merge, node } = model;
const { parseAsciiDump, parseJsonDump, parseDump, parseCurated } = dump;
const { isSecretKey, safeValue, REDACTED } = redact;
const { Miner } = mine;
const { SchemaStore } = storePkg;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(root, "test", "fixtures", "stash-dump.txt");

// ---------------------------------------------------------------- redaction

test("secret-bearing key names are redacted", () => {
  for (const k of ["secret_key", "password", "api_key", "apikey", "auth_token", "PRIVATE_KEY"]) {
    assert.ok(isSecretKey(k), k);
  }
});

test("ordinary key names are not redacted", () => {
  for (const k of ["coy_id", "url_domain", "name_full", "site_key", "year", "id"]) {
    assert.equal(isSecretKey(k), false, k);
  }
});

test("redaction is decided by key, never by value", () => {
  assert.equal(safeValue("secret_key", "anything").value, REDACTED);
  // A value that looks like a credential under an innocuous key is still
  // shown: the rule is about the key, and a predictable rule beats a clever one.
  const looksSecret = "AKIAEXAMPLEEXAMPLE1234";
  assert.equal(safeValue("coy_id", looksSecret).value, looksSecret);
});

// --------------------------------------------------------------- ascii dump

test("parses the ASCII tree fixture", () => {
  const r = parseAsciiDump(readFileSync(FIXTURE, "utf8"));
  assert.equal(lookup(r, ["ir", "config", "company", "coy_id"])?.value, "1234");
  assert.equal(lookup(r, ["ir", "config", "company"])?.kind, "hash");
  assert.equal(lookup(r, ["ir", "var", "sgx_Info", "format", "NAME_FULL"])?.value,
    "EXAMPLE HOLDINGS LIMITED");
});

test("ASCII dump depth is tracked correctly", () => {
  const r = parseAsciiDump(readFileSync(FIXTURE, "utf8"));
  // eight levels deep in the fixture
  assert.ok(lookup(r, ["ir", "config", "company", "tt_root_by_host_config", "host",
    "example.invalid", "ext", "revamp", "tt_root"]));
});

test("ASCII dump recovers lists from numerically-indexed hashes", () => {
  // Perl array indices survive the ASCII format as keys `0`, `1`, `2`.
  const r = parseAsciiDump(
    "root\n`- rows\n   |- 0\n   |  `- key = a\n   `- 1\n      `- other = b\n"
  );
  const list = lookup(r, ["root", "rows"]);
  assert.equal(list?.kind, "list");
  assert.deepEqual([...list.element.children.keys()].sort(), ["key", "other"]);
});

test("a numerically-keyed hash that is not 0-based stays a hash", () => {
  // Year maps like `2025 = 1` are real hashes, not arrays.
  const r = parseAsciiDump("root\n`- by_year\n   |- 2025 = 1\n   `- 2026 = 2\n");
  const n = lookup(r, ["root", "by_year"]);
  assert.equal(n?.kind, "hash");
  assert.equal(n.children.get("2025")?.value, "1");
});

test("ASCII dump handles undef, empty branches and values containing punctuation", () => {
  const r = parseAsciiDump(readFileSync(FIXTURE, "utf8"));
  assert.equal(lookup(r, ["ir", "var", "sgx_Info", "format", "WEBSITE"])?.value, undefined,
    "undef should carry no value");
  assert.equal(lookup(r, ["ir", "form"])?.kind, "hash");
  assert.equal(lookup(r, ["ir", "form"])?.children.size, 0);
  assert.equal(lookup(r, ["ir", "config", "authen_user", "url_login"])?.value,
    "/user_login.html?r=_REFERRER_");
});

test("ASCII dump redacts secrets", () => {
  const r = parseAsciiDump(readFileSync(FIXTURE, "utf8"));
  const n = lookup(r, ["ir", "config", "company", "recaptcha_v2_keys", "secret_key"]);
  assert.equal(n?.value, REDACTED);
  assert.equal(n?.redacted, true);
});

test("a malformed line does not abort the file", () => {
  const r = parseAsciiDump("ir\n|- a = 1\n@@@ nonsense\n|- b = 2\n");
  assert.equal(lookup(r, ["ir", "a"])?.value, "1");
  assert.equal(lookup(r, ["ir", "b"])?.value, "2");
});

// ---------------------------------------------------------------- json dump

test("JSON dump expresses lists, which the ASCII format cannot", () => {
  const r = parseJsonDump(JSON.stringify({
    ir: { var: { directors: [{ name: "A", role: "x" }, { name: "B", age: 3 }] } },
  }));
  const list = lookup(r, ["ir", "var", "directors"]);
  assert.equal(list?.kind, "list");
  // union of both items' shapes, since real data is ragged
  assert.deepEqual([...list.element.children.keys()].sort(), ["age", "name", "role"]);
});

test("JSON dump redacts secrets too", () => {
  const r = parseJsonDump(JSON.stringify({ cfg: { secret_key: "abc", site_key: "def" } }));
  assert.equal(lookup(r, ["cfg", "secret_key"])?.value, REDACTED);
  assert.equal(lookup(r, ["cfg", "site_key"])?.value, "def");
});

test("parseDump picks the format by content", () => {
  assert.ok(lookup(parseDump('{"a":{"b":1}}'), ["a", "b"]));
  assert.ok(lookup(parseDump("root\n`- b = 1"), ["root", "b"]));
});

test("invalid JSON yields an empty schema rather than throwing", () => {
  assert.equal(countPaths(parseJsonDump("{not json")), 0);
});

// ----------------------------------------------------------------- curated

test("curated entries supply description and type", () => {
  const r = parseCurated(JSON.stringify({
    "global.is_en": { type: "boolean", description: "English edition." },
  }));
  const n = lookup(r, ["global", "is_en"]);
  assert.equal(n?.description, "English edition.");
  assert.equal(n?.type, "boolean");
  assert.equal(n?.source, "curated");
});

// ------------------------------------------------------------------- merge

test("merging unions children across layers", () => {
  const a = node("hash", "mined");
  merge(a, parseJsonDump(JSON.stringify({ ir: { mined_only: 1 } })));
  merge(a, parseJsonDump(JSON.stringify({ ir: { dump_only: 2 } })));
  assert.deepEqual([...lookup(a, ["ir"]).children.keys()].sort(), ["dump_only", "mined_only"]);
});

test("a higher layer wins on metadata but does not erase children", () => {
  const combined = node("hash", "mined");
  merge(combined, parseJsonDump(JSON.stringify({ global: { is_en: 1, is_id: 0 } })));
  merge(combined, parseCurated(JSON.stringify({ "global.is_en": { description: "Doc." } })));
  assert.equal(lookup(combined, ["global", "is_en"])?.description, "Doc.");
  assert.ok(lookup(combined, ["global", "is_id"]), "curated layer erased a dump child");
});

// ------------------------------------------------------------------ mining

test("mining learns list shape from a FOREACH", () => {
  const m = new Miner();
  m.addDocument(`
    [% FOREACH d = ir.var.plugin.format.rows %]
      [% d.name %][% d.title %]
    [% END %]
  `);
  const n = lookup(m.merged(), ["ir", "var", "plugin", "format", "rows"]);
  assert.equal(n?.kind, "list");
  assert.deepEqual([...n.element.children.keys()].sort(), ["name", "title"]);
});

test("mining folds a literal constant into a dynamic path segment", () => {
  const m = new Miner();
  m.addDocument(`
    [% kind = 'director' %]
    [% FOREACH d = ir.var.x.$kind.format.rows %][% d.name %][% END %]
  `);
  assert.ok(lookup(m.merged(), ["ir", "var", "x", "director", "format", "rows"]),
    "dynamic segment was not folded");
});

test("mining excludes locally-bound names", () => {
  const m = new Miner();
  m.addDocument("[% FOREACH row IN ir.rows %][% row.a %][% END %][% tmp = 1 %][% tmp %]");
  const roots = [...m.merged().children.keys()];
  assert.ok(roots.includes("ir"));
  assert.ok(!roots.includes("row"), "loop alias leaked into the ambient schema");
  assert.ok(!roots.includes("tmp"), "assignment target leaked into the ambient schema");
});

test("mining does not treat a template name as a variable", () => {
  const m = new Miner();
  m.addDocument("[% INCLUDE include_header.tt %]");
  assert.ok(!m.merged().children.has("include_header"));
});

test("mining does not treat a vmethod as a field", () => {
  const m = new Miner();
  m.addDocument("[% ir.config.url.replace('a','b') %]");
  assert.ok(lookup(m.merged(), ["ir", "config", "url"]));
  assert.ok(!lookup(m.merged(), ["ir", "config", "url", "replace"]));
});

test("mining tracks document frequency", () => {
  const m = new Miner();
  m.addDocument("[% ir.a %]");
  m.addDocument("[% ir.b %][% other.c %]");
  assert.equal(m.documentFrequency("ir"), 2);
  assert.equal(m.documentFrequency("other"), 1);
});

// ------------------------------------------------------------------- store

function sandbox() {
  const d = mkdtempSync(join(tmpdir(), "tt-store-"));
  mkdirSync(join(d, ".tt-schema"), { recursive: true });
  writeFileSync(join(d, ".tt-schema", "dump.txt"),
    "ir\n|- config\n|  `- coy_id = 99\n`- secretish\n   `- secret_key = hunter2\n");
  writeFileSync(join(d, "page.tt"),
    "[% FOREACH r = ir.var.rows.format.list %][% r.title %][% END %][% global.is_en %]");
  writeFileSync(join(d, "tt-schema.json"),
    JSON.stringify({ "global.is_en": { type: "boolean", description: "English edition." } }));
  return d;
}

test("store combines all three layers", () => {
  const s = new SchemaStore();
  s.build([sandbox()]);
  // dump
  assert.equal(lookup(s.schema, ["ir", "config", "coy_id"])?.value, "99");
  // mined, including the list shape a dump could not express
  const list = lookup(s.schema, ["ir", "var", "rows", "format", "list"]);
  assert.equal(list?.kind, "list");
  assert.deepEqual([...list.element.children.keys()], ["title"]);
  // curated
  assert.equal(lookup(s.schema, ["global", "is_en"])?.description, "English edition.");
});

test("store reports a dump that appears to hold credentials", () => {
  const s = new SchemaStore();
  s.build([sandbox()]);
  assert.deepEqual(s.report.dumpsWithSecrets, ["dump.txt"]);
  assert.equal(lookup(s.schema, ["ir", "secretish", "secret_key"])?.value, REDACTED);
});

test("store survives a workspace with nothing in it", () => {
  const s = new SchemaStore();
  const empty = mkdtempSync(join(tmpdir(), "tt-empty-"));
  s.build([empty]);
  assert.equal(s.report.dumpFiles, 0);
  assert.equal(s.report.curated, false);
});

test("the real dump is parsed when present, and its secrets stay hidden", { skip: !existsSync(join(root, ".tt-schema", "schema.txt")) }, () => {
  const r = parseAsciiDump(readFileSync(join(root, ".tt-schema", "schema.txt"), "utf8"));
  assert.ok(countPaths(r) > 1000, `only ${countPaths(r)} paths`);
  for (const keys of [["ir","config","company","recaptcha_v2_keys","secret_key"],
                      ["ir","config","company","recaptcha_invisible_keys","secret_key"]]) {
    assert.equal(lookup(r, keys)?.value, REDACTED, keys.join("."));
  }
});

// ----------------------------------------------------- store configuration
// Regression: these settings were declared but never applied.

test("configure reports whether options actually changed", () => {
  const s = new SchemaStore();
  assert.equal(s.configure({ dumpDirectory: ".tt-schema" }), false, "no-op reported as a change");
  assert.equal(s.configure({ dumpDirectory: "dumps" }), true);
  assert.equal(s.dumpDirectory, "dumps");
});

test("a configured dump directory is the one actually read", () => {
  const d = mkdtempSync(join(tmpdir(), "tt-cfg-"));
  mkdirSync(join(d, "dumps"), { recursive: true });
  writeFileSync(join(d, "dumps", "a.txt"), "ir\n`- configured = yes\n");
  mkdirSync(join(d, ".tt-schema"), { recursive: true });
  writeFileSync(join(d, ".tt-schema", "b.txt"), "ir\n`- default = yes\n");

  const s = new SchemaStore();
  s.configure({ dumpDirectory: "dumps" });
  s.build([d]);

  assert.ok(lookup(s.schema, ["ir", "configured"]), "configured directory was not read");
  assert.ok(!lookup(s.schema, ["ir", "default"]), "default directory was read despite config");
});

test("a configured curated file is the one actually read", () => {
  const d = mkdtempSync(join(tmpdir(), "tt-cfg2-"));
  writeFileSync(join(d, "custom.json"), JSON.stringify({ "a.b": { description: "From custom." } }));
  const s = new SchemaStore();
  s.configure({ curatedFile: "custom.json" });
  s.build([d]);
  assert.equal(lookup(s.schema, ["a", "b"])?.description, "From custom.");
});
