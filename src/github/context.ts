import { posix, relative, resolve, sep } from 'node:path';

export interface GithubContext {
  inActions: boolean;
  /** e.g. https://github.com */
  serverUrl?: string;
  /** e.g. owner/name */
  repository?: string;
}

export function detectGithub(env: NodeJS.ProcessEnv = process.env): GithubContext {
  const inActions = env.GITHUB_ACTIONS === 'true';
  return { inActions, serverUrl: env.GITHUB_SERVER_URL, repository: env.GITHUB_REPOSITORY };
}

/** Links from a digest to the files it talks about (PLAN.md §7.7). */
export interface LinkBuilder {
  /** Commit history of one snapshot: shows exactly what changed and when. */
  snapshotHistory(slug: string, pageId: string): string;
  battlecard(slug: string): string;
}

/** Relative file paths, valid from `digests/<file>.md`. Used locally. */
export const localLinks: LinkBuilder = {
  snapshotHistory: (slug, pageId) => `../snapshots/${slug}/${pageId}.md`,
  battlecard: (slug) => `../battlecards/${slug}.md`,
};

/** Data dir as a repo-root-relative posix path (e.g. "data"), for building GitHub URLs. */
export function repoRelativeDataDir(dataDir: string, env: NodeJS.ProcessEnv = process.env): string {
  const root = env.GITHUB_WORKSPACE ?? process.cwd();
  const rel = relative(root, resolve(dataDir)).split(sep).join(posix.sep);
  return rel === '' ? '.' : rel;
}

/**
 * Inside GitHub Actions, link to the file's commit history / page on GitHub; elsewhere use
 * relative paths. Falls back to local links if the server or repository is unknown.
 */
export function createLinks(ctx: GithubContext, dataDirRel: string): LinkBuilder {
  if (!ctx.inActions || !ctx.serverUrl || !ctx.repository) return localLinks;
  const base = `${ctx.serverUrl.replace(/\/+$/, '')}/${ctx.repository}`;
  const prefix = dataDirRel === '.' ? '' : `${dataDirRel}/`;
  return {
    snapshotHistory: (slug, pageId) =>
      `${base}/commits/HEAD/${prefix}snapshots/${slug}/${pageId}.md`,
    battlecard: (slug) => `${base}/blob/HEAD/${prefix}battlecards/${slug}.md`,
  };
}
