import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Storage } from './storage.js';

export class FilesystemStorage implements Storage {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  /** Resolve a storage path, refusing anything that escapes the root. */
  private resolvePath(path: string): string {
    const full = resolve(this.root, ...path.split('/'));
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`Storage path escapes the data directory: ${path}`);
    }
    if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
      throw new Error(`Storage paths must be relative: ${path}`);
    }
    return full;
  }

  async read(path: string): Promise<string | null> {
    try {
      return await readFile(this.resolvePath(path), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async write(path: string, content: string): Promise<void> {
    const full = this.resolvePath(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  async list(prefix: string): Promise<string[]> {
    const base = this.resolvePath(prefix.replace(/\/+$/, ''));
    const out: string[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw err;
      }
      for (const e of entries) {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(join(dir, e.name), childRel);
        else out.push(childRel);
      }
    };
    const cleanPrefix = prefix.replace(/\/+$/, '');
    await walk(base, cleanPrefix);
    return out.sort();
  }
}
