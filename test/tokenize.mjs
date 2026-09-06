// Headless TextMate tokenizer. Loads our grammars plus the upstream ones they
// compose with, wires the injection the same way VS Code's `injectTo` does,
// and returns tokens with their full scope stacks.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import oniguruma from "vscode-oniguruma";
import vsctm from "vscode-textmate";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const files = [
  join(root, "syntaxes", "tt.tmLanguage.json"),
  join(root, "syntaxes", "tt-injection.tmLanguage.json"),
  ...readdirSync(join(here, "fixtures", "grammars")).map((f) =>
    join(here, "fixtures", "grammars", f)
  ),
];

// Map scopeName -> file, read from each grammar rather than assumed.
const byScope = new Map();
for (const f of files) {
  const g = JSON.parse(readFileSync(f, "utf8"));
  byScope.set(g.scopeName, g);
}

const wasm = readFileSync(
  join(root, "node_modules", "vscode-oniguruma", "release", "onig.wasm")
);
const onigLib = oniguruma.loadWASM(wasm.buffer).then(() => ({
  createOnigScanner: (s) => new oniguruma.OnigScanner(s),
  createOnigString: (s) => new oniguruma.OnigString(s),
}));

const registry = new vsctm.Registry({
  onigLib,
  loadGrammar: async (scopeName) => byScope.get(scopeName) ?? null,
  // Mirrors package.json contributes.grammars[].injectTo
  getInjections: (scopeName) =>
    scopeName === "text.html.tt" ? ["text.html.tt.injection"] : undefined,
});

let cached;
export async function grammar() {
  cached ??= await registry.loadGrammar("text.html.tt");
  if (!cached) throw new Error("failed to load text.html.tt");
  return cached;
}

/** Tokenize text into [{line, text, scopes}] across all lines. */
export async function tokenize(text) {
  const g = await grammar();
  const out = [];
  let stack = vsctm.INITIAL;
  text.split("\n").forEach((line, i) => {
    const r = g.tokenizeLine(line, stack);
    for (const t of r.tokens) {
      const slice = line.substring(t.startIndex, t.endIndex);
      if (slice.trim() === "") continue;
      out.push({ line: i, text: slice, scopes: t.scopes });
    }
    stack = r.ruleStack;
  });
  return out;
}

/** Scope stack for the first token whose text equals `needle`. */
export async function scopesOf(text, needle) {
  const toks = await tokenize(text);
  const hit = toks.find((t) => t.text === needle);
  if (!hit) {
    throw new Error(
      `token ${JSON.stringify(needle)} not found. got: ` +
        JSON.stringify(toks.map((t) => t.text))
    );
  }
  return hit.scopes;
}

/** True if any token equal to `needle` carries a scope matching `re`. */
export async function hasScope(text, needle, re) {
  const toks = await tokenize(text);
  return toks.some((t) => t.text === needle && t.scopes.some((s) => re.test(s)));
}
