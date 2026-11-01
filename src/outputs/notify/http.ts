export interface NotifyResult {
  channel: 'github-issue' | 'slack' | 'discord';
  status: 'sent' | 'skipped' | 'failed';
  detail?: string;
}

/** POST JSON with a timeout. Returns the response; throws only on network/timeout errors. */
export function postJson(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
}

export const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
