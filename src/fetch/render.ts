import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { USER_AGENT } from '../constants.js';

export class RenderUnavailableError extends Error {
  constructor() {
    super(
      'This page has render: true, which needs Playwright. In the folder you run from: ' +
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
          url(): string;
        }>;
      }>;
      close(): Promise<void>;
    }>;
  };
}

/**
 * Default loader: Playwright next to the engine, else in the folder the CLI runs from. The
 * second matters for `npx @rudrat04/outflank`, where the engine lives in npx's cache
 * and a plain import would never see a Playwright installed in the user's project folder.
 */
export async function importPlaywright(
  cwd: string = process.cwd(),
  primary: (name: string) => Promise<unknown> = (name) => import(name),
): Promise<unknown> {
  const name = 'playwright'; // a variable, so TypeScript doesn't require the optional package
  try {
    return await primary(name);
  } catch {
    const resolved = createRequire(join(cwd, 'noop.js')).resolve(name);
    return await import(pathToFileURL(resolved).href);
  }
}

/** Playwright is optional: loaded lazily, and only for pages with render: true. */
export async function loadPlaywright(
  importer: () => Promise<unknown> = () => importPlaywright(),
): Promise<PlaywrightLike> {
  try {
    return (await importer()) as PlaywrightLike;
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
    return { html: await page.content(), finalUrl: page.url() || url };
  } finally {
    await browser.close();
  }
}
