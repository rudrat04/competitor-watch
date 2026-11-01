import { USER_AGENT } from '../constants.js';

export class RenderUnavailableError extends Error {
  constructor() {
    super(
      'This page has render: true, which needs Playwright. Install it with ' +
        '"npm install playwright && npx playwright install chromium" (see the README).',
    );
    this.name = 'RenderUnavailableError';
  }
}

interface PlaywrightLike {
  chromium: {
    launch(): Promise<{
      newContext(o: { userAgent: string }): Promise<{
        newPage(): Promise<{
          goto(url: string, o: { waitUntil: string; timeout: number }): Promise<unknown>;
          content(): Promise<string>;
        }>;
      }>;
      close(): Promise<void>;
    }>;
  };
}

/** Playwright is optional: loaded lazily, and only for pages with render: true. */
export async function loadPlaywright(
  importer: (name: string) => Promise<unknown> = (name) => import(name),
): Promise<PlaywrightLike> {
  try {
    return (await importer('playwright')) as PlaywrightLike;
  } catch {
    throw new RenderUnavailableError();
  }
}

/** Fetch the rendered DOM. No cookies or logins: each call uses a fresh browser context. */
export async function renderHtml(
  url: string,
  load: () => Promise<PlaywrightLike> = loadPlaywright,
): Promise<{ html: string; finalUrl: string }> {
  const { chromium } = await load();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    return { html: await page.content(), finalUrl: url };
  } finally {
    await browser.close();
  }
}
