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

/** Where the digest can be read: on GitHub inside Actions, else its local path. */
export function digestLocation(ctx: GithubContext, dataDirRel: string, digestPath: string): string {
  const prefix = dataDirRel === '.' ? '' : `${dataDirRel}/`;
  if (ctx.inActions && ctx.serverUrl && ctx.repository) {
    return `${ctx.serverUrl.replace(/\/+$/, '')}/${ctx.repository}/blob/HEAD/${prefix}${digestPath}`;
  }
  return `${prefix}${digestPath}`;
}

export const githubApiUrl = (env: NodeJS.ProcessEnv): string =>
  (env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, '');

export const PUBLIC_REPO_MESSAGE =
  'This repo is public, so your competitor data would be visible to everyone. ' +
  'Make the repo private, or set allow_public_repo: true';

export type GuardResult = { ok: true; warning?: string } | { ok: false; message: string };

/**
 * PLAN.md §10.3. Inside GitHub Actions, refuse to run in a public repo unless the user opted
 * in. If the visibility can't be confirmed (no token, API error, network error), the repo is
 * treated as public: fail safe.
 */
export async function visibilityGuard(opts: {
  allowPublicRepo: boolean;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<GuardResult> {
  const env = opts.env ?? process.env;
  if (env.GITHUB_ACTIONS !== 'true') return { ok: true };

  let isPrivate = false;
  let why = '';
  const repo = env.GITHUB_REPOSITORY;
  const token = env.GITHUB_TOKEN;
  if (!repo || !token) {
    why = `could not check repo visibility (${!repo ? 'GITHUB_REPOSITORY' : 'GITHUB_TOKEN'} is not set)`;
  } else {
    try {
      const res = await (opts.fetchImpl ?? fetch)(`${githubApiUrl(env)}/repos/${repo}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const body = (await res.json()) as { private?: unknown };
        isPrivate = body.private === true;
      } else {
        why = `could not check repo visibility (GitHub API returned HTTP ${res.status})`;
      }
    } catch (err) {
      why = `could not check repo visibility (${err instanceof Error ? err.message : String(err)})`;
    }
  }

  if (isPrivate) return { ok: true };
  const detail = why ? ` (${why}, so treating it as public to be safe)` : '';
  if (opts.allowPublicRepo) {
    return {
      ok: true,
      warning: `Warning: running in a public repo because allow_public_repo is true${detail}. Your competitor data is visible to everyone.`,
    };
  }
  return { ok: false, message: `${PUBLIC_REPO_MESSAGE}.${detail}` };
}
