#!/usr/bin/env node
import { Command } from 'commander';
import { config as loadDotenv } from 'dotenv';
import {
  ConfigError,
  NOT_CONFIGURED_MESSAGE,
  loadConfig,
  notConfiguredReason,
  type Config,
} from './config.js';
import { checkPages, needsBrowser } from './check.js';
import { createFetcher } from './fetch/fetcher.js';
import { BIN_NAME, EXIT, VERSION } from './constants.js';

const CONFIG_PATH = 'competitors.yaml';

/** Exit code for commands whose implementation lands in a later milestone. */
function notImplemented(name: string): never {
  console.error(`"${name}" is not implemented yet.`);
  process.exit(EXIT.UNEXPECTED);
}

/**
 * Load config, or exit. Returns null (after printing) when the config is still the
 * placeholder, so callers can exit 0 and do nothing else (PLAN.md §6).
 */
async function loadOrExit(): Promise<Config | null> {
  try {
    const config = await loadConfig(CONFIG_PATH);
    if (notConfiguredReason(config)) {
      console.log(NOT_CONFIGURED_MESSAGE);
      return null;
    }
    return config;
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(EXIT.CONFIG);
    }
    throw err;
  }
}

const program = new Command();
program
  .name(BIN_NAME)
  .description('Watch competitor pages, explain what changed, keep battlecards current.')
  .version(VERSION);

program
  .command('init')
  .description('create competitors.yaml and .env in the current folder')
  .action(() => notImplemented('init'));

program
  .command('check')
  .description('validate config and test-fetch every page (no LLM, no writes)')
  .action(async () => {
    const config = await loadOrExit();
    if (!config) return;
    const lines = await checkPages(config, { fetcher: createFetcher() });
    for (const l of lines) {
      console.log(
        `${l.ok ? 'ok   ' : 'FAIL '} ${l.competitor} / ${l.pageId}  ${l.url}\n       ${l.detail}`,
      );
    }
    const bad = lines.filter((l) => !l.ok).length;
    console.log(
      bad === 0
        ? `\nAll ${lines.length} pages reachable.`
        : `\n${bad} of ${lines.length} pages need attention.`,
    );
  });

program
  .command('run')
  .description('run the full pipeline')
  .option('--dry-run', 'write nothing to the data directory; print the digest')
  .option('--only <slug>', 'only this competitor')
  .option('--max-cost <usd>', 'override settings.max_cost_usd', parseFloat)
  .option('--data-dir <path>', 'data directory', './data')
  .option('--no-notify', 'disable all notifications')
  .option('--verbose', 'verbose logging')
  .action(async () => {
    if (!(await loadOrExit())) return;
    notImplemented('run');
  });

program
  .command('battlecard <slug>')
  .description('manage a competitor battlecard')
  .option('--rebuild', 'rebuild from current snapshots')
  .action(async () => {
    if (!(await loadOrExit())) return;
    notImplemented('battlecard');
  });

program
  .command('info')
  .description('print facts about the config')
  .option('--needs-browser', 'print "true" if any page has render: true, else "false"')
  .action(async (opts: { needsBrowser?: boolean }) => {
    if (!opts.needsBrowser) {
      console.error('Specify what to print, e.g. --needs-browser');
      process.exit(EXIT.CONFIG);
    }
    // No placeholder gate: this must print a clean "true"/"false" for scripts.
    try {
      console.log(needsBrowser(await loadConfig(CONFIG_PATH)) ? 'true' : 'false');
    } catch (err) {
      if (err instanceof ConfigError) {
        console.error(err.message);
        process.exit(EXIT.CONFIG);
      }
      throw err;
    }
  });

loadDotenv({ quiet: true });
program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(EXIT.UNEXPECTED);
});
