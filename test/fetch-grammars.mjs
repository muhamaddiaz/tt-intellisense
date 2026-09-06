// Fetches the upstream grammars our base grammar composes with, so the
// tokenizer tests can run without an editor installed. Not vendored: these
// are Microsoft's files and we only borrow them at test time.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "fixtures", "grammars");
const BASE = "https://raw.githubusercontent.com/microsoft/vscode/main/extensions";

const GRAMMARS = {
  "html.tmLanguage.json": `${BASE}/html/syntaxes/html.tmLanguage.json`,
  "html-derivative.tmLanguage.json": `${BASE}/html/syntaxes/html-derivative.tmLanguage.json`,
  "css.tmLanguage.json": `${BASE}/css/syntaxes/css.tmLanguage.json`,
  "JavaScript.tmLanguage.json": `${BASE}/javascript/syntaxes/JavaScript.tmLanguage.json`,
};

mkdirSync(out, { recursive: true });
for (const [name, url] of Object.entries(GRAMMARS)) {
  const dest = join(out, name);
  if (existsSync(dest) && !process.env.FORCE) {
    console.log(`have  ${name}`);
    continue;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  writeFileSync(dest, await res.text());
  console.log(`fetch ${name}`);
}
