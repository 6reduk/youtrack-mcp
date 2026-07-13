import { DomainValidationError } from "./identifiers.js";

export type ReachabilityResult =
  | { readonly status: "reachable"; readonly visited: number }
  | { readonly status: "not_reachable"; readonly visited: number }
  | { readonly status: "indeterminate"; readonly visited: number; readonly reason: "node_limit" };

export interface ReachabilityOptions {
  readonly start: string;
  readonly target: string;
  readonly getOutgoing: (node: string) => Promise<readonly string[]>;
  readonly maxVisited?: number;
}

export async function checkReachability(options: ReachabilityOptions): Promise<ReachabilityResult> {
  const maxVisited = options.maxVisited ?? 10_000;
  if (!Number.isSafeInteger(maxVisited) || maxVisited < 1) {
    throw new DomainValidationError("maxVisited must be a positive integer");
  }
  if (options.start === options.target) {
    return { status: "reachable", visited: 0 };
  }

  const visited = new Set<string>();
  const queued = new Set<string>([options.start]);
  const queue = [options.start];
  let cursor = 0;

  while (cursor < queue.length) {
    const node = queue[cursor];
    cursor += 1;
    if (node === undefined || visited.has(node)) {
      continue;
    }
    if (visited.size >= maxVisited) {
      return { status: "indeterminate", visited: visited.size, reason: "node_limit" };
    }
    visited.add(node);

    const outgoing = await options.getOutgoing(node);
    for (const next of outgoing) {
      if (next === options.target) {
        return { status: "reachable", visited: visited.size };
      }
      if (!visited.has(next) && !queued.has(next)) {
        queued.add(next);
        queue.push(next);
      }
    }
  }

  return { status: "not_reachable", visited: visited.size };
}

export async function wouldCreateCycle(
  source: string,
  target: string,
  getOutgoing: (node: string) => Promise<readonly string[]>,
  maxVisited?: number,
): Promise<ReachabilityResult> {
  return checkReachability({
    start: target,
    target: source,
    getOutgoing,
    ...(maxVisited === undefined ? {} : { maxVisited }),
  });
}
