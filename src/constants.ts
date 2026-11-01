import { readFileSync } from 'node:fs';

/** Single source of truth for the package name. Keep in sync with package.json. */
export const PACKAGE_NAME = '@rudrat04/outflank';
export const BIN_NAME = 'outflank';
export const REPO_URL = 'https://github.com/rudrat04/outflank';

/** package.json sits one level above both src/ and dist/. */
function readVersion(): string {
  const url = new URL('../package.json', import.meta.url);
  const pkg = JSON.parse(readFileSync(url, 'utf8')) as { version: string };
  return pkg.version;
}

export const VERSION = readVersion();
export const USER_AGENT = `Outflank/${VERSION} (+${REPO_URL})`;

/** Exit codes (PLAN.md §8). */
export const EXIT = { OK: 0, CONFIG: 1, UNEXPECTED: 3, PUBLIC_REPO: 4 } as const;
