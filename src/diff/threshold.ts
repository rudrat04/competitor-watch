import type { SnapshotDiff } from './differ.js';

/** Diffs smaller than `min_change_chars` are skipped before any LLM call. */
export function isTrivial(diff: SnapshotDiff, minChangeChars: number): boolean {
  return diff.changedChars < minChangeChars;
}
