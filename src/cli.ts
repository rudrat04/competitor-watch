#!/usr/bin/env node
import { Command } from 'commander';
import { config as loadDotenv } from 'dotenv';
import {
  ConfigError,
  NOT_CONFIGURED_MESSAGE,
  apiKeyProblem,
  loadConfig,
  notConfiguredReason,
  type Config,
} from './config.js';
import Anthropic from '@anthropic-ai/sdk';
import { CostTracker, formatCost, resolveModelsAndPrices } from './cost.js';
import { createLlm } from './llm/client.js';
import { createClassifier } from './llm/classify.js';
import { appendFileSync } from 'node:fs';
import {
  createLinks,
  detectGithub,
  digestLocation,
  repoRelativeDataDir,
  visibilityGuard,
} from './github/context.js';
import { shortSummary } from './outputs/digest.js';
import { notifyAll } from './outputs/notify/index.js';
import { battlecardPath, rebuildBattlecard } from './outputs/battlecards.js';
import { slugify } from './config.js';
import { initProject, NEXT_STEPS } from './init.js';
import { checkPages, needsBrowser } from './check.js';
import { createFetcher } from './fetch/fetcher.js';
import { runPipeline, formatReport } from './run.js';
import { FilesystemStorage } from './storage/filesystem.js';
import { BIN_NAME, EXIT, VERSION } from './constants.js';

const CONFIG_PATH = 'competitors.yaml';

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

/** Print an error; inside GitHub Actions also as an annotation so it shows in the run UI. */
function fail(message: string, code: number): never {
  console.error(process.env.GITHUB_ACTIONS === 'true' ? `::error::${message}` : message);
  process.exit(code);
}

/** PLAN.md §10.3: refuse to write anything from a public repo (exit 4). */
async function guardOrExit(config: Config): Promise<void> {
  const guard = await visibilityGuard({ allowPublicRepo: config.settings.allow_public_repo });
  if (!guard.ok) fail(guard.message, EXIT.PUBLIC_REPO);
  if (guard.warning) console.warn(guard.warning);
}

function requireApiKey(): void {
  const problem = apiKeyProblem(process.env.ANTHROPIC_API_KEY);
  if (problem) fail(problem, EXIT.CONFIG);
}

const program = new Command();
program
  .name(BIN_NAME)
  .description('Watch competitor pages, explain what changed, keep battlecards current.')
  .version(VERSION);

program
  .command('init')
  .description('create competitors.yaml and .env in the current folder')
  .action(() => {
    const r = initProject(process.cwd());
    for (const f of r.created) console.log(`Created ${f}`);
    for (const f of r.skipped) console.log(`Kept existing ${f} (not overwritten)`);
    console.log(`\n${NEXT_STEPS}`);
  });

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
  .action(
    async (opts: {
      dryRun?: boolean;
      only?: string;
      dataDir: string;
      maxCost?: number;
      verbose?: boolean;
      notify: boolean;
    }) => {
      const config = await loadOrExit();
      if (!config) return;
      if (opts.maxCost !== undefined) {
        if (!(opts.maxCost > 0)) {
          console.error('--max-cost must be a positive number');
          process.exit(EXIT.CONFIG);
        }
        config.settings.max_cost_usd = opts.maxCost;
      }
      await guardOrExit(config);
      requireApiKey();
      try {
        const { models, prices } = resolveModelsAndPrices(config);
        const cost = new CostTracker(config.settings.max_cost_usd, prices);
        const llm = createLlm({ api: new Anthropic().messages, tracker: cost, models });
        const storage = new FilesystemStorage(opts.dataDir);
        const classify = createClassifier({
          llm,
          company: config.company,
          getBattlecard: async (slug) => storage.read(battlecardPath(slug)),
        });
        const gh = detectGithub();
        const dataDirRel = repoRelativeDataDir(opts.dataDir);
        const result = await runPipeline(
          config,
          {
            fetcher: createFetcher(),
            storage,
            classify,
            cost,
            llm,
            links: createLinks(gh, dataDirRel),
          },
          { dryRun: opts.dryRun, only: opts.only },
        );
        if (opts.dryRun) console.log('DRY RUN — nothing was written. The digest would be:\n');
        console.log(result.digest);
        if (opts.verbose) console.log(`\n--- page report ---\n${formatReport(result)}`);
        if (opts.dryRun) return;
        console.log(`Digest written to ${opts.dataDir}/${result.digestPath}`);

        const date = result.digestPath.replace(/^digests\/|\.md$/g, '').slice(0, 10);
        if (opts.notify) {
          const sent = await notifyAll({
            result,
            config,
            date,
            digestUrl: digestLocation(gh, dataDirRel, result.digestPath),
          });
          for (const n of sent) {
            if (n.status === 'sent')
              console.log(`Notified ${n.channel}${n.detail ? `: ${n.detail}` : ''}`);
            else if (n.status === 'failed')
              console.warn(`Warning: ${n.channel} notification failed: ${n.detail}`);
            else if (opts.verbose) console.log(`Skipped ${n.channel}: ${n.detail}`);
          }
        }
        // Inside Actions: a summary for the commit message, and the digest on the run page.
        if (process.env.GITHUB_OUTPUT) {
          appendFileSync(
            process.env.GITHUB_OUTPUT,
            `summary=${shortSummary(result.outcomes)} (${date})\n`,
          );
        }
        if (process.env.GITHUB_STEP_SUMMARY) {
          appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.digest);
        }
      } catch (err) {
        if (err instanceof ConfigError) {
          console.error(err.message);
          process.exit(EXIT.CONFIG);
        }
        throw err;
      }
    },
  );

program
  .command('battlecard <slug>')
  .description('show a competitor battlecard, or regenerate it with --rebuild')
  .option('--rebuild', 'regenerate from current snapshots (keeps the Recent changes log)')
  .option('--data-dir <path>', 'data directory', './data')
  .action(async (slug: string, opts: { rebuild?: boolean; dataDir: string }) => {
    const config = await loadOrExit();
    if (!config) return;
    const slugs = config.competitors.map((c) => slugify(c.name));
    if (!slugs.includes(slug)) {
      console.error(`No competitor "${slug}". Known: ${slugs.join(', ')}`);
      process.exit(EXIT.CONFIG);
    }
    const storage = new FilesystemStorage(opts.dataDir);
    if (!opts.rebuild) {
      const card = await storage.read(battlecardPath(slug));
      console.log(card ?? `No battlecard for "${slug}" yet. Run "outflank run" first.`);
      return;
    }
    await guardOrExit(config);
    requireApiKey();
    try {
      const { models, prices } = resolveModelsAndPrices(config);
      const cost = new CostTracker(config.settings.max_cost_usd, prices);
      const llm = createLlm({ api: new Anthropic().messages, tracker: cost, models });
      await rebuildBattlecard({ config, storage, llm, slug, now: new Date() });
      console.log(`Rebuilt ${opts.dataDir}/${battlecardPath(slug)}\n${formatCost(cost.summary())}`);
    } catch (err) {
      if (err instanceof ConfigError || (err instanceof Error && /snapshots/.test(err.message))) {
        console.error(err.message);
        process.exit(EXIT.CONFIG);
      }
      throw err;
    }
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
