// Opt-in regression over a real corpus of .tt files. Point TT_CORPUS at a
// directory; skipped when unset so CI and fresh clones stay green.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tokenize } from "./tokenize.mjs";

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

test("corpus: every [% is recognised and every block tag closes", { skip: !CORPUS }, async () => {
  const files = walk(CORPUS);
  assert.ok(files.length > 0, `no .tt files under ${CORPUS}`);

  const problems = [];
  for (const f of files) {
    const toks = await tokenize(readFileSync(f, "utf8"));

    const unscoped = toks.filter(
      (t) =>
        t.text === "[%" &&
        !t.scopes.some((s) =>
          /punctuation\.(section\.embedded|definition\.comment)\.begin\.tt/.test(s)
        )
    );
    if (unscoped.length) problems.push(`${f}: ${unscoped.length} unscoped [%`);

    // Outline tags open with `%%` and close at end of line, so match on `[%`.
    const opens = toks.filter(
      (t) =>
        t.text === "[%" &&
        t.scopes.some((s) => /punctuation\.section\.embedded\.begin\.tt/.test(s))
    ).length;
    const closes = toks.filter((t) =>
      t.scopes.some((s) => /punctuation\.section\.embedded\.end\.tt/.test(s))
    ).length;
    if (opens !== closes) {
      problems.push(`${f}: ${opens} block tags opened, ${closes} closed`);
    }
  }

  assert.deepEqual(problems.slice(0, 20), [], `\n${problems.slice(0, 20).join("\n")}`);
  console.log(`  corpus: ${files.length} files clean`);
});
