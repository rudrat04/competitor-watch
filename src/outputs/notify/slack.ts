import { errorText, postJson, type NotifyResult } from './http.js';
import type { NotifySummary } from './index.js';

const isUrl = (s: string): boolean => /^https?:\/\//.test(s);

/**
 * Slack's required escaping for message text. Without it, scraped text such as "<!channel>"
 * would ping the whole channel, or "<https://evil|innocent>" would disguise a link.
 */
export function escapeSlack(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function slackText(s: NotifySummary): string {
  const lines = [`*Outflank — ${s.date}*: ${escapeSlack(s.headline)}`];
  for (const item of s.items) lines.push(`• ${escapeSlack(item)}`);
  if (s.more > 0) lines.push(`• …and ${s.more} more`);
  lines.push(
    isUrl(s.digestUrl) ? `<${s.digestUrl}|Read the full digest>` : `Digest: ${s.digestUrl}`,
  );
  return lines.join('\n');
}

/** Short summary + link to the digest. The webhook URL is a secret: never logged. */
export async function sendSlack(
  webhookUrl: string,
  summary: NotifySummary,
  fetchImpl: typeof fetch,
): Promise<NotifyResult> {
  try {
    const res = await postJson(fetchImpl, webhookUrl, { text: slackText(summary) });
    await res.body?.cancel();
    return res.ok
      ? { channel: 'slack', status: 'sent' }
      : { channel: 'slack', status: 'failed', detail: `Slack returned HTTP ${res.status}` };
  } catch (err) {
    return { channel: 'slack', status: 'failed', detail: errorText(err) };
  }
}
