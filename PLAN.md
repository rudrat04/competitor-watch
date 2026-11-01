# Competitor Watch — Build Plan (v3)

> This file is the source of truth for building this project. Work through the milestones in order. After each milestone: run the tests, make sure they pass, commit, and summarize what was done before moving on. If something in this plan seems wrong or unworkable, stop and explain why instead of quietly deviating.

---

## 1. What we're building

An open-source, **100% self-hosted** agent that watches competitors' public web pages (pricing, changelog, homepage, careers, etc.), detects meaningful changes, explains what changed and why it matters, and keeps an up-to-date battlecard per competitor.

**The one-line pitch:** Create a private repo from the template, add one secret, and get a weekly competitor digest.

### Who it's for
Founders, product marketers, sales teams and PMs at any company. No CRM, no paid data source, no account with the maintainer.

### Core principles (non-negotiable)
1. **Zero infrastructure for the maintainer.** No servers, no hosted database, no hosted version. The maintainer pays for nothing.
2. **Bring your own key.** The only required secret is `ANTHROPIC_API_KEY`. Everything else is optional.
3. **Git is the database (by default).** Snapshots, state, digests and battlecards are plain files in the user's own **private** repo. Git history is the change log. The engine itself only writes through a storage interface; committing to git is the workflow's job, not the engine's.
4. **GitHub Actions is the default scheduler.** It runs on the user's own Actions minutes. The CLI is the product, so any scheduler (cron, Docker, other CI) can call it.
5. **Private by default.** Competitor data must never become public by accident.
6. **Updates without git merges.** Users get fixes through npm, not by syncing their repo with upstream.
7. **Cheap by design.** Deterministic code does as much as possible. The LLM is called only for baselines and real changes. A cheap model triages; a stronger model analyzes only material changes.
8. **Safe defaults.** `--dry-run` writes nothing to the data directory. Notifications are opt-in (except the GitHub issue inside Actions, which is private to the user's repo). Respect `robots.txt`. No telemetry, ever.

---

## 2. Two repos

| Repo | Visibility | Contains | Published as |
|---|---|---|---|
| `competitor-watch` (the **engine**) | Public, MIT | All code, tests, docs, Dockerfile, and a `template/` folder holding the template repo's files | npm package `@rudrat04/competitor-watch` (bin: `competitor-watch`) |
| `competitor-watch-template` (the **template**) | Public, marked as a GitHub template repository | Only `competitors.yaml`, the workflow, `.gitignore`, a short README, and an empty `data/` | Nothing — users click "Use this template" |

- **This build session works in the engine repo only.** The template's files are built and tested inside `template/` in the engine repo. The maintainer copies them into the template repo afterwards (see §13).
- The package name lives in one constant and in `package.json`. Before publishing, check the name is free on npm; if not, change it everywhere.
- The engine `package.json` has a `prepare` script that builds, so it can also be installed straight from GitHub (`npm install github:rudrat04/competitor-watch`) for testing before the first npm publish.

---

## 3. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js 20+, TypeScript (strict), ESM | |
| LLM | `@anthropic-ai/sdk` | Two model roles: `triage` (fast, cheap) and `analysis` (stronger). Default model IDs and per-token prices live in one file (`src/llm/defaults.ts`), overridable in config. Use current Anthropic model IDs from the official docs; leave a clear comment where to update them. |
| Output validation | `zod` | Every LLM response is parsed against a schema; retry once on parse failure, then record the item as failed and continue |
| CLI | `commander` | |
| Env loading | `dotenv` | Local runs only; in Actions, env comes from secrets |
| Config | `yaml` + `zod` | Clear, field-specific error messages |
| Fetching | Native `fetch` | Custom user agent, timeout, retries with backoff |
| Content extraction | `@mozilla/readability` + `linkedom` | Fallback to full body text if Readability returns nothing |
| HTML → Markdown | `turndown` | Snapshots are stored as normalized Markdown |
| JS-rendered pages | `playwright` — optional, loaded with dynamic `import()` | Only for pages with `render: true`. If it isn't installed, that page fails with a message explaining how to enable it; the run continues. |
| Diffing | `diff` | |
| robots.txt | `robots-parser` | |
| Tests | `vitest` | All network, GitHub API and LLM calls mocked |
| Lint/format | `eslint` + `prettier` | |

**Do not add:** a database, a web server, a UI, any SaaS dependency beyond Anthropic, or any analytics.

---

## 4. Engine repo structure

```
competitor-watch/
├── src/
│   ├── cli.ts                 # commander entry point
│   ├── config.ts              # load + validate competitors.yaml
│   ├── constants.ts           # package name, version, user agent
│   ├── fetch/
│   │   ├── fetcher.ts         # UA, timeout, retry, per-host delay, robots check
│   │   ├── render.ts          # optional playwright rendering
│   │   └── extract.ts         # readability + turndown
│   ├── snapshot/
│   │   ├── normalize.ts       # noise-stripping rules (one function per rule)
│   │   └── state.ts           # state.json schema + helpers
│   ├── storage/
│   │   ├── storage.ts         # Storage interface
│   │   └── filesystem.ts      # the only v1 adapter
│   ├── diff/
│   │   ├── differ.ts          # structured diffs
│   │   └── threshold.ts       # skip trivial diffs before any LLM call
│   ├── llm/
│   │   ├── client.ts          # Anthropic wrapper + cost tracking + cap guard
│   │   ├── defaults.ts        # default model IDs + prices
│   │   ├── schemas.ts         # zod schemas for every LLM output
│   │   ├── triage.ts
│   │   ├── analyze.ts
│   │   ├── battlecard.ts      # create/update battlecards
│   │   └── prompts/           # prompt templates as .md files
│   ├── outputs/
│   │   ├── digest.ts
│   │   └── notify/
│   │       ├── github-issue.ts
│   │       ├── slack.ts
│   │       └── discord.ts
│   ├── github/
│   │   └── context.ts         # detects Actions, repo visibility, builds links
│   ├── cost.ts
│   └── run.ts                 # orchestrates the pipeline
├── template/                  # files for the template repo (see §11)
├── test/
│   ├── fixtures/
│   └── *.test.ts
├── examples/                  # sample outputs for the README, clearly labeled
├── .github/workflows/ci.yml   # lint + typecheck + tests (engine only)
├── competitors.example.yaml
├── .env.example
├── Dockerfile
├── package.json
├── tsconfig.json
├── LICENSE                    # MIT
└── README.md
```

The engine repo does **not** contain a scheduled workflow and never stores competitor data.

---

## 5. Storage

### Interface
```ts
interface Storage {
  read(path: string): Promise<string | null>;   // null if missing
  write(path: string, content: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}
```
Paths are relative and always use `/`. v1 ships only `FilesystemStorage(rootDir)`. Nothing outside `src/storage/` touches the disk for data files. This keeps an S3 or Postgres adapter a future PR rather than a rewrite.

### Data layout (relative to the data root, default `./data`)
```
snapshots/<competitor-slug>/<page-id>.md     # latest snapshot only; git keeps history
battlecards/<competitor-slug>.md
digests/YYYY-MM-DD.md                        # if two runs on one day: YYYY-MM-DD-2.md
state.json
```
- `page-id` = `<type>` if unique for that competitor, else `<type>-<short hash of URL>`. It must be stable across runs.
- Removing a page from config does not delete its files; the digest notes it as "no longer watched."

### `state.json`
```json
{
  "schema_version": 1,
  "last_run": "2026-11-02T03:00:00Z",
  "pages": {
    "<slug>/<page-id>": {
      "url": "https://...",
      "hash": "sha256...",
      "last_checked": "...",
      "last_changed": "...",
      "last_status": "ok | unchanged | trivial | noise | minor | material | baseline | error | blocked",
      "last_error": null
    }
  }
}
```
`last_run` is updated on every non-dry run. It serves as a heartbeat, so the workflow always has something to commit.

---

## 6. Configuration

### `competitors.yaml`
```yaml
company:
  name: "YOUR COMPANY"                     # must be changed before the first run
  description: "What you sell and to whom, in 1–3 sentences."
  positioning: "Why customers pick you."   # optional

settings:
  max_cost_usd: 1.00            # hard cap per run (see §7.9)
  alert_on: []                  # optional keywords watched on every page
  min_change_chars: 40          # ignore diffs smaller than this
  allow_public_repo: false      # see §10.3 — leave false unless you're sure
  models:                       # optional; defaults come from the engine
    triage: ""
    analysis: ""
  notify:
    github_issue: true          # only works inside GitHub Actions
    slack: false                # needs SLACK_WEBHOOK_URL
    discord: false              # needs DISCORD_WEBHOOK_URL

competitors:
  - name: "Example Competitor"
    pages:
      - type: pricing           # pricing | changelog | homepage | careers | product | blog | other
        url: "https://example.com/pricing"
        include: [".pricing-table"]         # optional: watch only these elements
        alert_on: ["enterprise", "free plan"] # optional: keywords that always count as material
      - type: homepage
        url: "https://example.com"
        ignore: [".testimonial-carousel"]   # optional CSS selectors to strip
      - type: pricing
        url: "https://example.com/plans"
        render: true            # needs playwright; see README
```

### Validation rules
- `company.name` still `"YOUR COMPANY"` **or** any URL on `example.com` → the run exits cleanly with code `0` and the message "Not configured yet — edit competitors.yaml" and does nothing else. This stops the public template repo (and freshly created user repos) from doing anything on schedule.
- Slugs are derived from names; duplicate slugs are an error.
- At least one competitor with at least one page.
- URLs must be `http(s)`.
- `include` and `ignore` are lists of CSS selectors; `alert_on` is a list of non-empty strings. A top-level `settings.alert_on` list applies to every page and is merged with any per-page list.

### `.env.example` (local runs)
```
ANTHROPIC_API_KEY=      # required — https://console.anthropic.com
SLACK_WEBHOOK_URL=      # optional
DISCORD_WEBHOOK_URL=    # optional
```

---

## 7. Pipeline (one run)

```
load + validate config (exit early if not configured)
→ visibility guard (§10.3)
→ for each competitor, for each page (failures never stop the run):
    robots check → fetch (or render) → extract → normalize → hash
    → compare with state.json:
        no previous snapshot   → save as baseline           (status: baseline)
        hash unchanged         → nothing                    (status: unchanged)
        changed → KEYWORD CHECK (§7.3a, deterministic)
            keyword hit              → TRIAGE for category/summary, force material → ANALYZE, save (status: material)
            no hit, below threshold  → save snapshot          (status: trivial)
            no hit, above threshold  → TRIAGE (fast model)
                noise    → save snapshot                      (status: noise)
                minor    → save snapshot, collect for digest  (status: minor)
                material → ANALYZE (strong model), save       (status: material)
→ battlecards:
    competitor has no battlecard and has snapshots → CREATE (analysis model)
    competitor has minor/material changes          → UPDATE (analysis model, one call per competitor)
→ build digest → write files (unless --dry-run) → notify (§7.8) → print cost summary
```

### 7.1 Fetching
- User agent: `CompetitorWatch/<version> (+https://github.com/rudrat04/competitor-watch)`.
- Timeout 20s; 2 retries with exponential backoff; 1–2s delay between requests to the same host.
- `robots.txt` checked per host and cached per run. Disallowed → skip, status `blocked`, listed in the digest. Never bypass.
- Public pages only. No logins, no cookies carried over, no bot-protection bypass.

### 7.2 Extraction and normalization
Goal: two fetches of an unchanged page produce identical text.
- Strip `ignore` selectors, then scripts, styles, nav, footer and common cookie-banner selectors.
- **If `include` is set:** keep only the matching elements (in document order) and convert them straight to Markdown with Turndown — **skip Readability**, which could drop the very content the user selected. Selectors apply to the rendered DOM when `render: true`.
- **If `include` matches nothing:** treat it as a page error ("include selector matched nothing — the site may have been redesigned"), keep the previous snapshot and hash, and report it in the digest. Never save an empty snapshot, or the next run would look like everything was deleted.
- **If `include` is not set:** Readability → Turndown → Markdown; fallback to body text.
- Normalize: collapse whitespace; normalize quotes and dashes; strip query strings and fragments from links; remove volatile content (relative timestamps like "3 hours ago", copyright years, cache-busting tokens, CSRF strings, long random IDs).
- One function per rule, each with a unit test.

### 7.3 Diffing
- Line-level diff with added/removed hunks and a few lines of context.
- `changed_chars` below `min_change_chars` → trivial, no LLM call.
- The LLM only ever sees diff hunks plus short context, never two full pages.

### 7.3a Keyword triggers
- Runs on every changed page **before** the threshold check, so a keyword change in a tiny diff is never skipped.
- For each `alert_on` keyword: case-insensitive, whole-word match (phrases allowed). Compare occurrence counts in the old vs new snapshot. A hit = the keyword appeared (0 → ≥1) or disappeared (≥1 → 0).
- A hit forces the change to material: triage still runs (for category and summary) but its significance is overridden; analysis always runs and is told which keywords triggered.
- The digest shows triggers explicitly, e.g. `Keyword trigger: "free plan" removed`.
- Keyword checks are pure code and cost nothing. If the cost cap is already hit, record the keyword hit in the digest anyway, and keep the old hash so the full analysis happens next run.

### 7.4 Triage (fast model)
Output schema:
```ts
{
  significance: "noise" | "minor" | "material",
  category: "pricing" | "packaging" | "feature" | "positioning" | "hiring" | "partnership" | "other",
  summary: string   // one plain-English sentence
}
```
Prompt guidance: rewording without a change in meaning is noise; any change to a price, plan, limit or feature is at least minor; new plans, price moves, new product lines or major messaging shifts are material.

### 7.5 Analysis (strong model, material only)
Input: diff hunks, page type, URL, the competitor's current battlecard (if any), and the `company` block.
Output schema:
```ts
{
  what_changed: string,        // factual, 1–3 sentences
  why_it_matters: string,      // likely intent; speculation labeled as such
  impact_on_us: string,
  suggested_response: string,  // concrete action for sales, marketing or product
  confidence: "low" | "medium" | "high"
}
```
Prompt rules: claim only what the diff supports; label speculation; never invent numbers.

### 7.6 Battlecards
`battlecards/<slug>.md`, sections:
- Overview (what they sell, who for)
- Pricing & packaging (as last observed)
- Positioning & messaging
- Recent changes (dated, newest first, last 15 entries; older entries drop off here but remain in past digests and git history)
- Where they're strong / where we win
- How to handle them in a sales conversation
- "Last updated" line

**Create** from all current snapshots for that competitor. **Update** with this run's minor and material changes: the model returns updated content for the affected sections only, and code merges them so untouched sections are byte-identical. If an update fails validation, keep the old battlecard and note it in the digest.

### 7.7 Digest
`digests/YYYY-MM-DD.md`:
- Headline, e.g. "2 material, 3 minor changes across 4 competitors"
- First run: "Baseline created for N competitors, M pages" plus links to the new battlecards
- Material changes first (full analysis + page URL + link to that snapshot's history)
- Minor changes (one line each)
- Pages that failed, were blocked by robots.txt, or are no longer watched
- Cost of this run, and whether the cap was hit
- Nothing changed: a short "No meaningful changes" digest

**Links:** inside GitHub Actions, build links from `GITHUB_SERVER_URL` and `GITHUB_REPOSITORY` to the file's commit history (e.g. `<server>/<repo>/commits/HEAD/data/snapshots/<slug>/<page-id>.md`). Locally, use relative file paths.

### 7.8 Notifications
- Notify when the run has at least one minor or material change, **or** it was a baseline run (so the user sees setup worked), **or** the cost cap was hit.
- **GitHub issue** (inside Actions, when enabled): one issue per run, labeled `competitor-watch`, body = digest. Uses `GITHUB_TOKEN`. If issues are disabled or the call fails, log a warning; never fail the run.
- **Slack / Discord**: short summary plus a link to the digest.
- `--no-notify` disables all of them.

### 7.9 Cost control
- Track tokens per call; compute $ from the price table (defaults overridable in config).
- Before each call, estimate its cost. If it would push the run over `max_cost_usd`, make no more LLM calls this run.
- Pages that were changed but not analyzed because of the cap: **do not update their snapshot or hash**, so they are picked up again next run. Say so in the digest.
- Hitting the cap is a normal outcome: exit `0`, so the workflow still commits what was done.
- Print a cost summary at the end of every run.
- The first (baseline) run costs the most because it creates every battlecard. The README must say this and give a typical figure once measured.

---

## 8. CLI

```
competitor-watch init                  # create competitors.yaml + .env in the current folder, print next steps
competitor-watch check                 # validate config and test-fetch every page; no LLM, no writes
competitor-watch run [--dry-run]       # full pipeline
          [--only <slug>]
          [--max-cost <usd>]
          [--data-dir <path>]          # default ./data
          [--no-notify]
          [--verbose]
competitor-watch battlecard <slug> --rebuild
competitor-watch info --needs-browser  # prints "true" if any page has render: true, else "false"
```

- The CLI **never runs git**. Committing is the workflow's job.
- `--dry-run`: no writes to the data directory, no notifications; prints the digest to the terminal. It does call the LLM (that's the point of trying it), and the cost cap still applies.
- Exit codes: `0` success (including some pages failing, cap hit, or "not configured yet"); `1` config error; `3` unexpected error; `4` blocked by the visibility guard.

---

## 9. Testing

- **No live network, GitHub API or Anthropic calls in tests.** Mock all of them.
- Fixtures: at least three before/after HTML pairs — a pricing change (material), a copy tweak (noise), and a volatile-timestamp-only change (must normalize to identical).
- Unit tests: config validation and the "not configured yet" path; `include` extraction (match, multiple matches in order, no match → error with old snapshot kept); keyword triggers (appear, disappear, count change without appear/disappear is not a hit, case-insensitivity, whole-word, hit below the diff threshold still fires, merge of global + per-page lists); each normalization rule; diff threshold; cost cap (including "changed but unanalyzed pages keep their old hash"); zod parsing and retry; battlecard update leaves other sections byte-identical; visibility guard; page-id stability.
- One end-to-end test of `run` against fixtures with a mocked LLM, asserting the files written to a temp data dir.
- A test that the workflow file in `template/` is valid YAML and references the right package name.

---

## 10. GitHub Actions (the template's workflow)

File: `template/.github/workflows/competitor-watch.yml`

### 10.1 Behaviour
- Triggers: `schedule` (weekly, Monday 03:17 UTC, with a comment on how to change it) and `workflow_dispatch`.
- Skip entirely when running in the template repo itself: `if: github.repository != 'rudrat04/competitor-watch-template'`.
- `permissions: contents: write, issues: write`.
- `concurrency: { group: competitor-watch, cancel-in-progress: false }`.
- Env at the top: `CW_PACKAGE: "@rudrat04/competitor-watch@1"` with a comment explaining that `@1` means "latest 1.x — fixes arrive automatically" and that users can pin an exact version for reproducibility.

### 10.2 Steps
1. Checkout.
2. Setup Node 20.
3. `npm install --no-save "$CW_PACKAGE"` (the template has no package.json, so nothing is saved; `node_modules/` is gitignored).
4. If `npx competitor-watch info --needs-browser` prints `true`: `npm install --no-save playwright` and `npx playwright install --with-deps chromium`.
5. `npx competitor-watch run` with `ANTHROPIC_API_KEY`, optional webhook secrets, and `GITHUB_TOKEN` in env. Fail early with a clear message if `ANTHROPIC_API_KEY` is missing.
6. Commit and push `data/` only, as `github-actions[bot]`, with a message like `watch: 2 material, 3 minor (2026-11-02)`; skip the commit if nothing changed (in practice `last_run` always changes).

### 10.3 Visibility guard (in the engine, not the workflow)
When `GITHUB_ACTIONS=true`, the engine calls the GitHub API with `GITHUB_TOKEN` to check whether the repo is private. If it is **public** and `allow_public_repo` is not `true`, it writes nothing, sends nothing, prints a clear explanation ("This repo is public, so your competitor data would be visible to everyone. Make the repo private, or set allow_public_repo: true"), and exits `4`. If the API check itself fails, treat the repo as public (fail safe). Keeping this in the engine means it improves via npm updates.

### 10.4 Known limits to document
- Scheduled runs can be delayed during busy periods on GitHub.
- Free private repos include a monthly allowance of Actions minutes; a weekly run uses a few. Playwright pages add time.
- Org settings may force read-only `GITHUB_TOKEN` or protect `main`; the README troubleshooting section explains the fix.

---

## 11. Template repo contents (`template/` in the engine repo)

```
template/
├── .github/workflows/competitor-watch.yml
├── competitors.yaml          # placeholder config (triggers "not configured yet")
├── data/.gitkeep
├── .gitignore                # node_modules/, .env
└── README.md                 # short: the 5-step setup from §13.1, links to the engine README
```

---

## 12. Packaging

- npm: `bin: { "competitor-watch": "dist/cli.js" }`, `files` limited to `dist/`, `prompts`, `README.md`, `LICENSE`. `prepare` script builds.
- Semver: breaking config or data-layout changes require a new major version, plus a migration note. `state.json` carries `schema_version`.
- Dockerfile: multi-stage, small; working directory mounted for config and `data/`. Playwright is not included by default; document a build arg to include it.
- MIT license. No telemetry, stated in the README.

---

## 13. End-to-end usage (the README is built from this section)

### 13.1 Recommended: GitHub, fully hands-off
1. Open `rudrat04/competitor-watch-template` and click **Use this template → Create a new repository**. Set it to **Private**. (Don't fork — forks of public repos are public.)
2. In the new repo: **Settings → Secrets and variables → Actions → New repository secret** — name `ANTHROPIC_API_KEY`, value from console.anthropic.com. Optionally add `SLACK_WEBHOOK_URL` / `DISCORD_WEBHOOK_URL`.
3. Edit `competitors.yaml` in the browser: your company, then 2–5 competitors with their pricing, changelog and homepage URLs. Commit.
4. **Actions → Competitor Watch → Run workflow** to run it once now.
5. A few minutes later: a GitHub issue appears with the baseline digest, and `data/battlecards/` holds one battlecard per competitor.

After that it runs every Monday on its own. Each week, if anything meaningful changed, a new issue arrives (GitHub notifies repo owners by default). All history is in the repo: browse `data/digests/`, open any battlecard, or view a snapshot's history to see exactly what changed and when.

**Day-to-day:**
- Add or remove competitors → edit `competitors.yaml`.
- Change schedule → edit the `cron` line in the workflow.
- Stop it → disable the workflow in the Actions tab.
- Updates → nothing to do; each run uses the latest 1.x of the engine.

### 13.2 Local only (no GitHub)
```bash
mkdir my-competitors && cd my-competitors
npx @rudrat04/competitor-watch init      # creates competitors.yaml and .env
# add your key to .env, edit competitors.yaml
npx @rudrat04/competitor-watch check     # confirms every page is reachable
npx @rudrat04/competitor-watch run --dry-run
npx @rudrat04/competitor-watch run       # writes ./data
```
Schedule it with cron (macOS/Linux) or Task Scheduler (Windows). Optionally `git init` the folder to keep history.

### 13.3 Docker
```bash
docker run --rm --env-file .env -v "$PWD:/work" ghcr.io/rudrat04/competitor-watch run
```
Schedule with cron on any server the user already has.

### 13.4 Troubleshooting (README section)
- Run exits with "Not configured yet" → `competitors.yaml` still has placeholders.
- Exit code 4 → repo is public; make it private.
- Push fails → workflow token is read-only (Settings → Actions → General → Workflow permissions → Read and write) or `main` is protected.
- A page always errors → the site may block bots or need `render: true`.
- Digest is noisy for one page → add `ignore` selectors or raise `min_change_chars`.

---

## 14. Engine README outline

1. Name + one-line pitch
2. Screenshot of a digest issue (placeholder until a real one exists)
3. One short "How is this different from changedetection.io?" note: changedetection.io tells you a page changed; Competitor Watch tells you what the change means for you and keeps battlecards current — free and self-hosted. Use changedetection.io for general page watching.
4. Quickstart — GitHub (§13.1)
5. Other ways to run it — local and Docker (§13.2–13.3)
6. Example outputs (`examples/`, labeled as samples)
7. Configuration reference
8. How it works (pipeline in brief) and what it costs (baseline run vs weekly run)
9. Privacy and responsible use: private repo by default, public pages only, robots.txt respected, identifies itself, rate-limited, no telemetry
10. Limitations: JS-heavy pages need `render: true`; some sites block bots; LLM analysis can be wrong
11. Troubleshooting (§13.4)
12. Roadmap (§18)
13. Contributing — "Issues welcome, no SLA, PRs encouraged"; storage adapters and notifiers are good first contributions
14. License

---

## 15. Milestones

Each ends with passing tests and a commit.

- **M1 — Scaffold.** package.json (name constant, bin, prepare, files), tsconfig, eslint/prettier, vitest, CLI with all commands stubbed, config loader + zod schema + "not configured yet" check, `competitors.example.yaml`, `.env.example`, `ci.yml`.
- **M2 — Fetch, extract, store.** Storage interface + filesystem adapter, fetcher (UA, timeout, retry, per-host delay, robots), extraction including `include`/`ignore` selectors, normalization rules, `state.json`, `check` and `info --needs-browser`. Baseline snapshots work with no LLM.
- **M3 — Diff.** Differ, keyword triggers, threshold, trivial detection, page-id stability. `run --dry-run` reports changed pages with the LLM mocked out.
- **M4 — LLM layer.** Client wrapper, defaults file, cost tracking, cap guard (including unanalyzed pages keeping their old hash), zod schemas, triage, analysis, prompts as files.
- **M5 — Outputs.** Battlecard create/update with section merge, digest (with GitHub/local link building), `battlecard --rebuild`.
- **M6 — GitHub integration.** Visibility guard, GitHub issue notifier, Slack and Discord notifiers, `template/` folder with the workflow, template README and placeholder config.
- **M7 — Packaging and docs.** Dockerfile, npm pack dry-run check, engine README, `examples/` with clearly labeled sample outputs.

---

## 16. Definition of done

- Fresh clone → `npm ci` → `npm test` passes; `npm pack --dry-run` includes only intended files.
- The placeholder `competitors.yaml` makes `run` exit `0` with "Not configured yet" and write nothing.
- A public repo in Actions is refused with exit `4` and nothing written.
- With a valid key, the first run creates baselines, battlecards, a digest and (in Actions) an issue; a later run against a changed page produces a triaged change, an analysis if material, an updated battlecard and a digest.
- No run exceeds `max_cost_usd`; pages skipped by the cap are retried next run.
- One failing page never fails the run.
- The engine never runs git; the workflow commits only `data/`.

## 17. Out of scope for v1

- Any web UI, dashboard, hosted service, database or account system
- Storage adapters other than the filesystem (the interface exists for contributors)
- Logging in, bypassing bot protection, or scraping sites that forbid it
- Social media monitoring and review sites (G2, Capterra)
- Screenshots and visual diffs (images bloat the repo; the LLM works on text)
- Multi-step browser flows (clicking through pages, filling forms)
- Notification channels beyond GitHub issues, Slack and Discord (good contributor PRs)

## 18. Roadmap (v1.1 — do not build in v1)

These are deliberately deferred. Design v1 so each is an addition, not a rewrite.

- **JSON sources.** `format: json` pages with a `jsonpath` filter, for pricing data loaded from public JSON endpoints. More reliable than rendered pages. (Keep extraction behind one function per format so this slots in.)
- **Per-page frequency.** `every: daily | weekly | monthly` per page. Actions still runs on one schedule; the engine skips pages not yet due, using `last_checked` in `state.json`. (Already stored in v1.)
- **RSS output.** Write `data/feed.xml` from the digests so changes can be followed in any feed reader. Static file, zero infra.
- **Proxy support.** Respect `HTTPS_PROXY` (via an undici `ProxyAgent`) for users whose target sites block GitHub Actions IPs.
- **More storage adapters.** S3-compatible and Postgres, implementing the §5 interface.
