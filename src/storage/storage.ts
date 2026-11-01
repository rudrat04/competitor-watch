/**
 * The only way the engine touches data files (PLAN.md §5).
 * Paths are relative and always use "/".
 */
export interface Storage {
  /** File contents, or null if missing. */
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  /** All files under `prefix` (recursive), as paths relative to the storage root. */
  list(prefix: string): Promise<string[]>;
}
