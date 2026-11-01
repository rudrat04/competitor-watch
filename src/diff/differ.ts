import { structuredPatch } from 'diff';

export interface Hunk {
  oldStart: number;
  newStart: number;
  /** Lines prefixed with " " (context), "+" (added) or "-" (removed). */
  lines: string[];
}

export interface SnapshotDiff {
  hunks: Hunk[];
  addedChars: number;
  removedChars: number;
  /** Total length of added + removed lines (PLAN.md §7.3). */
  changedChars: number;
}

/** Line-level diff with a few lines of context. The LLM only ever sees these hunks. */
export function diffSnapshots(oldText: string, newText: string, context = 3): SnapshotDiff {
  const patch = structuredPatch('old', 'new', oldText, newText, '', '', { context });
  const hunks: Hunk[] = patch.hunks.map((h) => ({
    oldStart: h.oldStart,
    newStart: h.newStart,
    lines: h.lines.filter((l) => !l.startsWith('\\')), // drop "\ No newline at end of file"
  }));
  let addedChars = 0;
  let removedChars = 0;
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.startsWith('+')) addedChars += l.length - 1;
      else if (l.startsWith('-')) removedChars += l.length - 1;
    }
  }
  return { hunks, addedChars, removedChars, changedChars: addedChars + removedChars };
}

/** Unified-diff-style text for prompts and reports. */
export function formatHunks(diff: SnapshotDiff): string {
  return diff.hunks
    .map((h) => [`@@ -${h.oldStart} +${h.newStart} @@`, ...h.lines].join('\n'))
    .join('\n');
}
