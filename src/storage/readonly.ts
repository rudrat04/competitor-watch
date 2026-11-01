import type { Storage } from './storage.js';

/** Reads pass through; writes are discarded. Used by --dry-run (nothing hits the data dir). */
export function readOnlyStorage(inner: Storage): Storage {
  return {
    read: (p) => inner.read(p),
    list: (p) => inner.list(p),
    write: async () => {},
  };
}
