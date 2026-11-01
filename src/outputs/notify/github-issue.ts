import { githubApiUrl } from '../../github/context.js';
import { errorText, postJson, type NotifyResult } from './http.js';

export const ISSUE_LABEL = 'competitor-watch';
/** GitHub rejects issue bodies over 65,536 characters. */
const MAX_BODY = 60_000;

export function issueBody(digest: string, digestUrl: string): string {
  if (digest.length <= MAX_BODY) return digest;
  return `${digest.slice(0, MAX_BODY)}\n\n…\n\n_This digest was too long for an issue. [Read the full digest](${digestUrl})._\n`;
}

/**
 * One issue per run, labeled `competitor-watch`, body = digest (PLAN.md §7.8). Only inside
 * GitHub Actions. Never throws: issues disabled, missing permissions or API errors become a
 * "failed" result that the CLI prints as a warning.
 */
export async function createDigestIssue(opts: {
  title: string;
  digest: string;
  digestUrl: string;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
}): Promise<NotifyResult> {
  const { env } = opts;
  const channel = 'github-issue' as const;
  if (env.GITHUB_ACTIONS !== 'true') {
    return { channel, status: 'skipped', detail: 'only available inside GitHub Actions' };
  }
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY) {
    return { channel, status: 'failed', detail: 'GITHUB_TOKEN or GITHUB_REPOSITORY is not set' };
  }
  const base = `${githubApiUrl(env)}/repos/${env.GITHUB_REPOSITORY}`;
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  try {
    // Make sure the label exists (422 = it already does). Failure here is not fatal.
    const label = await postJson(
      opts.fetchImpl,
      `${base}/labels`,
      { name: ISSUE_LABEL, color: '5319e7', description: 'Competitor Watch digests' },
      headers,
    ).catch(() => null);
    await label?.body?.cancel();

    const res = await postJson(
      opts.fetchImpl,
      `${base}/issues`,
      { title: opts.title, body: issueBody(opts.digest, opts.digestUrl), labels: [ISSUE_LABEL] },
      headers,
    );
    if (res.ok) {
      const json = (await res.json()) as { html_url?: string };
      return { channel, status: 'sent', detail: json.html_url };
    }
    await res.body?.cancel();
    const hint =
      res.status === 410
        ? 'issues are disabled for this repo'
        : res.status === 403
          ? 'the workflow token lacks "issues: write" permission'
          : `GitHub API returned HTTP ${res.status}`;
    return { channel, status: 'failed', detail: hint };
  } catch (err) {
    return { channel, status: 'failed', detail: errorText(err) };
  }
}
