/**
 * The layered schema of ambient variables.
 *
 * Three sources contribute, in increasing order of precedence: paths mined
 * from the workspace's own templates, runtime stash dumps, and a hand-authored
 * curated schema. See docs/adr/0001. No layer is authoritative and none is
 * complete, so merging unions children and lets the higher layer win only on
 * the metadata it actually supplies.
 */

export type SchemaKind = "hash" | "list" | "scalar" | "unknown";

/** Which layer contributed a piece of knowledge. Higher wins. */
export type Layer = "mined" | "dump" | "curated";

export const LAYER_RANK: Record<Layer, number> = { mined: 0, dump: 1, curated: 2 };

export interface SchemaNode {
  kind: SchemaKind;
  /** Members, for a hash. */
  children: Map<string, SchemaNode>;
  /** Shape of the items, for a list. */
  element?: SchemaNode;
  /** A sample value observed in a dump. Never set from mined paths. */
  value?: string;
  /** True when `value` was withheld because the key looks secret-bearing. */
  redacted?: boolean;
  /** Prose from the curated layer only. */
  description?: string;
  /** Declared type from the curated layer only. */
  type?: string;
  /** The highest layer that contributed to this node. */
  source: Layer;
}

export function node(kind: SchemaKind, source: Layer): SchemaNode {
  return { kind, children: new Map(), source };
}

/**
 * Merges `incoming` into `target` in place.
 *
 * Children are always unioned: a dump that never loaded a plugin should not
 * erase what mining found, and vice versa. Scalar metadata is taken from the
 * higher layer, but a lower layer still fills a gap the higher one left.
 */
export function merge(target: SchemaNode, incoming: SchemaNode): void {
  const incomingWins = LAYER_RANK[incoming.source] >= LAYER_RANK[target.source];

  if (incoming.kind !== "unknown" && (incomingWins || target.kind === "unknown")) {
    target.kind = incoming.kind;
  }
  if (incoming.value !== undefined && (incomingWins || target.value === undefined)) {
    target.value = incoming.value;
    target.redacted = incoming.redacted;
  }
  if (incoming.description !== undefined) target.description = incoming.description;
  if (incoming.type !== undefined) target.type = incoming.type;
  if (incomingWins) target.source = incoming.source;

  if (incoming.element) {
    if (target.element) merge(target.element, incoming.element);
    else target.element = incoming.element;
  }

  for (const [key, child] of incoming.children) {
    const existing = target.children.get(key);
    if (existing) merge(existing, child);
    else target.children.set(key, child);
  }
}

/** Walks a dotted path. Returns undefined at the first unknown segment. */
export function lookup(root: SchemaNode, path: readonly string[]): SchemaNode | undefined {
  let current: SchemaNode | undefined = root;
  for (const segment of path) {
    if (!current) return undefined;
    current = current.children.get(segment);
  }
  return current;
}

/**
 * Walks a path, stepping into list elements automatically.
 *
 * Template Toolkit makes `list.field` mean "the field of each item" in enough
 * places that treating a list as transparent gives better answers than
 * stopping dead at it.
 */
export function lookupThroughLists(
  root: SchemaNode,
  path: readonly string[]
): SchemaNode | undefined {
  let current: SchemaNode | undefined = root;
  for (const segment of path) {
    if (!current) return undefined;
    let next = current.children.get(segment);
    if (!next && current.kind === "list" && current.element) {
      next = current.element.children.get(segment);
    }
    current = next;
  }
  return current;
}

/** Inserts a path, creating intermediate hashes. Returns the leaf. */
export function ensurePath(
  root: SchemaNode,
  path: readonly string[],
  source: Layer
): SchemaNode {
  let current = root;
  for (const segment of path) {
    let next = current.children.get(segment);
    if (!next) {
      next = node("unknown", source);
      current.children.set(segment, next);
    }
    if (current.kind === "unknown") current.kind = "hash";
    current = next;
  }
  return current;
}

/** Total number of distinct paths, for diagnostics and reporting. */
export function countPaths(root: SchemaNode): number {
  let total = 0;
  for (const child of root.children.values()) {
    total += 1 + countPaths(child);
    if (child.element) total += countPaths(child.element);
  }
  return total;
}
