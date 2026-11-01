import type { Storage } from './storage.js';

/**
 * --dry-run storage: reads see the real data dir plus anything "written" during this run,
 * but nothing ever reaches the disk. This lets a dry run behave exactly like a real one
 * (e.g. battlecards are created from baseline snapshots written earlier in the same run).
 */
export function dryRunStorage(inner: Storage): Storage {
  const mem = new Map<string, string>();
  return {
    read: async (p) => mem.get(p) ?? inner.read(p),
    write: async (p, content) => {
      mem.set(p, content);
    },
    list: async (prefix) => {
      const base = prefix.replace(/\/+$/, '');
      const found = new Set(await inner.list(prefix));
      for (const k of mem.keys()) if (k.startsWith(`${base}/`)) found.add(k);
      return [...found].sort();
    },
  };
}
