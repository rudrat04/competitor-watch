import { errorText, postJson, type NotifyResult } from './http.js';
import type { NotifySummary } from './index.js';

/** Discord rejects messages over 2,000 characters. */
const MAX_CONTENT = 2000;
const isUrl = (s: string): boolean => /^https?:\/\//.test(s);

export function discordContent(s: NotifySummary): string {
  const link = isUrl(s.digestUrl)
    ? `[Read the full digest](${s.digestUrl})`
    : `Digest: ${s.digestUrl}`;
  const head = `**Competitor Watch — ${s.date}**: ${s.headline}`;
  const items = s.items.map((i) => `• ${i}`);
  if (s.more > 0) items.push(`• …and ${s.more} more`);
  // Drop items from the end until it fits; the headline and the link always survive.
  while (items.length > 0 && [head, ...items, link].join('\n').length > MAX_CONTENT) items.pop();
  return [head, ...items, link].join('\n').slice(0, MAX_CONTENT);
}

export async function sendDiscord(
  webhookUrl: string,
  summary: NotifySummary,
  fetchImpl: typeof fetch,
): Promise<NotifyResult> {
  try {
    const res = await postJson(fetchImpl, webhookUrl, {
      content: discordContent(summary),
      allowed_mentions: { parse: [] }, // never ping @everyone from scraped text
    });
    await res.body?.cancel();
    return res.ok
      ? { channel: 'discord', status: 'sent' }
      : { channel: 'discord', status: 'failed', detail: `Discord returned HTTP ${res.status}` };
  } catch (err) {
    return { channel: 'discord', status: 'failed', detail: errorText(err) };
  }
}
