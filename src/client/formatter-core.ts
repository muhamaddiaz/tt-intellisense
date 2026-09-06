import * as prettier from "prettier";

const templateToolkitPlugin = require("../../vendor/template-toolkit-plugin") as prettier.Plugin & {
  parsers: NonNullable<prettier.Plugin["parsers"]>;
};

export interface FormatTemplateOptions {
  config?: prettier.Options | null;
  filepath?: string;
  tabWidth: number;
  useTabs: boolean;
}

export interface TextReplacement {
  end: number;
  start: number;
  text: string;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

const parserName = "template-toolkit";
const publishedParser = templateToolkitPlugin.parsers[parserName];

if (!publishedParser) {
  throw new Error(`The Template Toolkit Prettier plugin does not provide the ${parserName} parser.`);
}

// The upstream preprocessor converts real head/body tags into comments and does
// not restore them. We protect only genuinely unbalanced boundary tags below,
// so the same parser and printer can safely handle both layouts and documents.
const safeTemplateToolkitPlugin: prettier.Plugin = {
  ...templateToolkitPlugin,
  parsers: {
    ...templateToolkitPlugin.parsers,
    [parserName]: {
      ...publishedParser,
      preprocess: (text: string) => text,
    },
  },
};

interface ProtectedSource {
  restore(formatted: string): string;
  text: string;
}

function protectUnbalancedBoundaryTags(source: string): ProtectedSource {
  const matches = [
    ...source.matchAll(
      /\[%[\s\S]*?%\]|<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|(?<boundary><\/?(?:head|body)\b[^>]*>)/gi
    ),
  ].filter((match) => match.groups?.boundary);
  const stacks = new Map<string, number[]>([
    ["head", []],
    ["body", []],
  ]);
  const unbalanced = new Set<number>();

  for (const [index, match] of matches.entries()) {
    const tag = match[0];
    const name = /^<\/?(head|body)\b/i.exec(tag)![1]!.toLowerCase();
    const stack = stacks.get(name)!;
    if (!/^<\//.test(tag)) {
      stack.push(index);
    } else if (stack.length > 0) {
      stack.pop();
    } else {
      unbalanced.add(index);
    }
  }

  for (const stack of stacks.values()) {
    for (const index of stack) {
      unbalanced.add(index);
    }
  }

  if (unbalanced.size === 0) {
    return { text: source, restore: (formatted) => formatted };
  }

  let prefix = "tt-intellisense-boundary";
  while (source.includes(prefix)) {
    prefix += "-safe";
  }

  const replacements = new Map<string, string>();
  let text = source;
  for (const index of [...unbalanced].sort((left, right) => right - left)) {
    const match = matches[index]!;
    const placeholder = `<!--${prefix}-${index}-->`;
    replacements.set(placeholder, match[0]);
    text = text.slice(0, match.index) + placeholder + text.slice(match.index! + match[0].length);
  }

  return {
    text,
    restore(formatted) {
      let restored = formatted;
      for (const [placeholder, tag] of replacements) {
        if (!restored.includes(placeholder)) {
          throw new Error("The formatter lost a protected HTML boundary tag.");
        }
        restored = restored.replaceAll(placeholder, tag);
      }
      return restored;
    },
  };
}

export async function formatTemplate(
  source: string,
  options: FormatTemplateOptions
): Promise<string> {
  const { parser: _parser, plugins: workspacePlugins = [], filepath: _filepath, ...workspaceConfig } =
    options.config ?? {};
  const protectedSource = protectUnbalancedBoundaryTags(source);

  const formatted = await prettier.format(protectedSource.text, {
    tabWidth: options.tabWidth,
    useTabs: options.useTabs,
    ...workspaceConfig,
    ...(options.filepath ? { filepath: options.filepath } : {}),
    parser: parserName,
    plugins: [...workspacePlugins, safeTemplateToolkitPlugin],
  });

  // A failed embedded HTML parse can make the upstream TT printer fall back to
  // an empty root document. Never let that failure become a whole-file delete.
  if (source.trim().length > 0 && formatted.trim().length === 0) {
    throw new Error("The formatter produced empty output for a non-empty document.");
  }

  return protectedSource.restore(formatted);
}

export function minimalReplacement(before: string, after: string): TextReplacement | null {
  if (before === after) {
    return null;
  }

  let start = 0;
  const sharedLength = Math.min(before.length, after.length);
  while (start < sharedLength && before[start] === after[start]) {
    start += 1;
  }

  // VS Code offsets are UTF-16 offsets. Avoid placing an edit boundary between
  // the two code units of a shared astral character.
  if (
    start > 0 &&
    start < sharedLength &&
    isHighSurrogate(before.charCodeAt(start - 1))
  ) {
    start -= 1;
  }

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (
    beforeEnd > start &&
    afterEnd > start &&
    before[beforeEnd - 1] === after[afterEnd - 1]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  if (
    beforeEnd < before.length &&
    beforeEnd > start &&
    isLowSurrogate(before.charCodeAt(beforeEnd))
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  return {
    start,
    end: beforeEnd,
    text: after.slice(start, afterEnd),
  };
}
