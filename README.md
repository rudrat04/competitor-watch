# Competitor Watch

**Create a private repo from the template, add one secret, and get a weekly competitor digest.**

Competitor Watch is an open-source, 100% self-hosted agent that watches your competitors' public web pages (pricing, changelog, homepage, careers…), detects meaningful changes, explains what changed and why it matters to you, and keeps an up-to-date battlecard per competitor.

It runs on your own GitHub Actions minutes with your own Anthropic API key. There is no hosted service, no account and no telemetry.

<!-- Screenshot placeholder: replace with a real digest issue once one exists. -->

> 📸 _Screenshot of a digest issue coming soon. Until then, see the [sample weekly digest](examples/digest-weekly.md)._

### How is this different from changedetection.io?

[changedetection.io](https://changedetection.io) tells you a page changed. Competitor Watch tells you what the change **means for you** and keeps your battlecards current, for free and self-hosted. If you just want general page watching, use changedetection.io; it's great at that.

---

## Quickstart: GitHub, fully hands-off

1. Open [`rudrat04/competitor-watch-template`](https://github.com/rudrat04/competitor-watch-template) and click **Use this template → Create a new repository**. Set it to **Private**. (Don't fork: forks of public repos are public.)
2. In the new repo: **Settings → Secrets and variables → Actions → New repository secret**. Name it `ANTHROPIC_API_KEY`, with a key from [console.anthropic.com](https://console.anthropic.com). Optionally add `SLACK_WEBHOOK_URL` and/or `DISCORD_WEBHOOK_URL`.
3. Edit `competitors.yaml` in the browser: your company, then 2–5 competitors with their pricing, changelog and homepage URLs. Commit.
4. **Actions → Competitor Watch → Run workflow** to run it once now.
5. A few minutes later, a GitHub issue appears with the baseline digest, and `data/battlecards/` holds one battlecard per competitor.

After that it runs every Monday on its own. Each week, if anything meaningful changed, a new issue arrives (GitHub notifies repo owners by default). All history is in the repo: browse `data/digests/`, open any battlecard, or view a snapshot's history to see exactly what changed and when.

**Day-to-day**

- Add or remove competitors → edit `competitors.yaml`.
- Change the schedule → edit the `cron` line in `.github/workflows/competitor-watch.yml`.
- Stop it → disable the workflow in the Actions tab.
- Updates → nothing to do; each run uses the latest 1.x of the engine. To pin a version, change `CW_PACKAGE` in the workflow to an exact version, e.g. `@rudrat04/competitor-watch@1.0.0`.

---

## Other ways to run it

### Local only (no GitHub)

Requires Node.js 20 or newer.

```bash
mkdir my-competitors && cd my-competitors
npx @rudrat04/competitor-watch init      # creates competitors.yaml and .env
# add your key to .env, edit competitors.yaml
npx @rudrat04/competitor-watch check     # confirms every page is reachable
npx @rudrat04/competitor-watch run --dry-run
npx @rudrat04/competitor-watch run       # writes ./data
```

Schedule it with cron (macOS/Linux) or Task Scheduler (Windows). Optionally `git init` the folder to keep history: Competitor Watch never runs git itself, so commit `data/` however you like.

### Docker

```bash
docker build -t competitor-watch .
docker run --rm --env-file .env -v "$PWD:/work" competitor-watch run
```

Once a published image exists, use `ghcr.io/rudrat04/competitor-watch` instead of building. The current folder (mounted at `/work`) must contain `competitors.yaml`; `data/` is written there. Add `--user "$(id -u):$(id -g)"` so the files you get are owned by you rather than root. Schedule it with cron on any server you already have.

Playwright (for `render: true` pages) is not in the image by default. To include it:

```bash
docker build --build-arg INSTALL_PLAYWRIGHT=true -t competitor-watch .
```

### CLI reference

```
competitor-watch init                  # create competitors.yaml + .env here, print next steps
competitor-watch check                 # validate config and test-fetch every page; no LLM, no writes
competitor-watch run [--dry-run]       # full pipeline
          [--only <slug>]              # one competitor
          [--max-cost <usd>]           # override settings.max_cost_usd
          [--data-dir <path>]          # default ./data
          [--no-notify]
          [--verbose]                  # also print a per-page report
competitor-watch battlecard <slug>             # print a battlecard
competitor-watch battlecard <slug> --rebuild   # regenerate it from current snapshots
competitor-watch info --needs-browser  # "true" if any page has render: true
```

`--dry-run` writes nothing to the data directory and sends no notifications; it prints the digest instead. It does call the LLM (that's the point of trying it), and the cost cap still applies.

**Exit codes:** `0` success (including some pages failing, the cost cap being hit, or "not configured yet"); `1` config error; `3` unexpected error; `4` refused because the repo is public.

---

## Example outputs

These are **samples with fictional companies**, generated by the real code to show the format:

- [Baseline digest](examples/digest-baseline.md): the first run.
- [Weekly digest](examples/digest-weekly.md): one material and two minor changes.
- [Battlecard](examples/battlecard.md): after its first update.

---

## Configuration reference

Everything lives in `competitors.yaml`:

```yaml
company:
  name: 'Acme Analytics' # must be changed from "YOUR COMPANY"
  description: 'What you sell and to whom, in 1–3 sentences.'
  positioning: 'Why customers pick you.' # optional

settings:
  max_cost_usd: 1.00 # hard cap per run
  alert_on: [] # keywords watched on every page
  min_change_chars: 40 # ignore diffs smaller than this
  allow_public_repo: false # leave false unless you're sure
  models: # optional; defaults come from the engine
    triage: ''
    analysis: ''
  prices: # optional; only needed for models the engine doesn't know
    my-model-id: { input_per_mtok: 1.0, output_per_mtok: 5.0 }
  notify:
    github_issue: true # only works inside GitHub Actions
    slack: false # needs SLACK_WEBHOOK_URL
    discord: false # needs DISCORD_WEBHOOK_URL

competitors:
  - name: 'Northwind Metrics'
    pages:
      - type: pricing # pricing | changelog | homepage | careers | product | blog | other
        url: 'https://northwind.example/pricing'
        include: ['.pricing-table'] # optional: watch only these elements
        alert_on: ['enterprise', 'free plan'] # optional: keywords that always count as material
      - type: homepage
        url: 'https://northwind.example'
        ignore: ['.testimonial-carousel'] # optional: CSS selectors to strip
      - type: pricing
        url: 'https://northwind.example/plans'
        render: true # needs Playwright; see below
```

| Field                        | Meaning                                                                                                                                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `company.*`                  | Who "us" is. The analysis and battlecards are written from your point of view.                                                                                                                                                         |
| `settings.max_cost_usd`      | Hard cap on LLM spend per run. Before each call the worst-case cost is estimated; if it would cross the cap, no more LLM calls are made this run.                                                                                      |
| `settings.alert_on`          | Keywords checked on every page, merged with each page's own `alert_on`.                                                                                                                                                                |
| `settings.min_change_chars`  | Diffs smaller than this (total length of added and removed lines) are recorded as trivial, with no LLM call.                                                                                                                           |
| `settings.allow_public_repo` | See [Privacy](#privacy-and-responsible-use).                                                                                                                                                                                           |
| `settings.models`            | Override the triage (fast, cheap) and analysis (stronger) models. Defaults: `claude-haiku-5-5` and `claude-opus-5-5`.                                                                                                                  |
| `settings.prices`            | USD per million tokens, keyed by model id, for models the engine has no price for.                                                                                                                                                     |
| `settings.notify.*`          | Which notifications to send (see [How it works](#how-it-works)).                                                                                                                                                                       |
| `pages[].type`               | What kind of page it is; used in digests and prompts, and as the page id.                                                                                                                                                              |
| `pages[].include`            | CSS selectors. Only these elements are watched, in document order. If they stop matching (e.g. a redesign), the page is reported as an error and the previous snapshot is kept.                                                        |
| `pages[].ignore`             | CSS selectors stripped before extraction (carousels, banners, counters).                                                                                                                                                               |
| `pages[].alert_on`           | Keywords that force a change to **material** when they appear on or disappear from the page (case-insensitive, whole word, phrases allowed). Keyword checks are free and run before the size threshold, so even a tiny diff is caught. |
| `pages[].render`             | Load the page in a headless browser first, for JavaScript-rendered pages.                                                                                                                                                              |

Competitor slugs come from names (`Northwind Metrics` → `northwind-metrics`). A page's id is its `type`, or `type-<hash of URL>` if a competitor has two pages of the same type. Changing a page's URL starts a fresh baseline for it. Removing a page or competitor from the config keeps its files; the digest notes it as "no longer watched".

**Tip:** a price change on a short line can be under `min_change_chars`. For pages where every price matters, put the plan names or "free plan" in `alert_on`, or lower `min_change_chars`.

**Pages that need a browser.** In GitHub Actions, the workflow installs Playwright automatically when any page has `render: true`. Locally, run `npm install playwright && npx playwright install chromium` in the same folder first. Without Playwright, `render: true` pages fail with that instruction and the rest of the run continues.

---

## How it works

For each page: check `robots.txt` → fetch (or render) → extract the main content as Markdown → normalize away noise (timestamps, copyright years, tracking parameters, random IDs) → hash and compare with the last snapshot.

- **New page** → saved as a baseline.
- **Unchanged** → nothing to do.
- **Changed** → deterministic checks first: keyword triggers, then the size threshold. Tiny diffs with no keyword hit are recorded as trivial without any LLM call.
- Remaining changes go to a **fast, cheap model** for triage: _noise_, _minor_ or _material_. Only **material** changes go to the **stronger model** for analysis: what changed, why it matters, the impact on you, and a suggested response. The model only ever sees the diff and a little context, never two full pages.
- **Battlecards** are created from all current snapshots for a new competitor, and updated once per competitor when it has minor or material changes. Updates rewrite only the affected sections; the rest of the file stays byte-for-byte the same, so your own edits outside those sections survive.
- A **digest** is written to `data/digests/YYYY-MM-DD.md`.
- **Notifications** are sent when there was at least one minor or material change, a baseline, or the cost cap was hit. In GitHub Actions that's one issue per run, labelled `competitor-watch`. Slack and Discord get a short summary with a link.

One failing page never fails the run. A page whose change couldn't be analyzed (cost cap hit, or an LLM error) keeps its old snapshot, so the change is picked up again next run.

Data layout, all plain files in your repo:

```
data/
├── snapshots/<competitor>/<page>.md   # latest snapshot; git history keeps the rest
├── battlecards/<competitor>.md
├── digests/YYYY-MM-DD.md
└── state.json
```

### What it costs

You pay Anthropic directly for tokens; GitHub Actions minutes come from your plan (free private repos include a monthly allowance, and a weekly run uses a few minutes; `render: true` pages add time).

| Run                  | What happens                                                                     | Rough cost                      |
| -------------------- | -------------------------------------------------------------------------------- | ------------------------------- |
| First (baseline) run | One battlecard per competitor (stronger model)                                   | about $0.05–0.15 per competitor |
| Quiet week           | Fetching and hashing only                                                        | $0                              |
| Typical week         | A few triage calls, plus an analysis and a battlecard update per material change | about $0.02–0.20                |

The first run costs the most because it creates every battlecard. These figures are estimates from token counts and current prices, not yet measured on real runs; they will be updated once measured. The cost of each run is printed at the end and included in the digest, and `max_cost_usd` (default $1.00) is a hard cap.

---

## Privacy and responsible use

- **Private by default.** In GitHub Actions, the engine checks the repo's visibility before doing anything. If the repo is public, or the check fails, it writes nothing, sends nothing and exits with code 4. Set `allow_public_repo: true` only if you really want your competitor data public.
- **Public pages only.** No logins, no cookies, no bypassing bot protection.
- **`robots.txt` is respected.** Disallowed pages are skipped and listed in the digest. If a site's `robots.txt` can't be fetched (server error), the site is skipped.
- **It identifies itself** as `CompetitorWatch/<version> (+https://github.com/rudrat04/competitor-watch)`, and the `robots.txt` token is `CompetitorWatch`.
- **Rate-limited:** 1–2 seconds between requests to the same host, a 20-second timeout and 2 retries.
- **No telemetry, ever.** The only outbound calls are to the pages you configure, the Anthropic API, the GitHub API (inside Actions) and the webhooks you set.

## Limitations

- JavaScript-heavy pages need `render: true`.
- Some sites block bots or GitHub Actions IP ranges.
- LLM analysis can be wrong. Every claim links back to the diff and the snapshot history, so check before acting on it.

---

## Troubleshooting

- **Run exits with "Not configured yet"** → `competitors.yaml` still has placeholders (`YOUR COMPANY` or `example.com` URLs).
- **Exit code 4** → the repo is public; make it private.
- **Push fails in Actions** → the workflow token is read-only (**Settings → Actions → General → Workflow permissions → Read and write**), or `main` is protected and doesn't allow the bot to push.
- **No digest issue** → issues may be disabled for the repo, or your org forces a read-only token; the run log shows a warning.
- **`ANTHROPIC_API_KEY is not set`** → add the repository secret (Quickstart step 2) or put it in `.env` locally.
- **A page always errors** → the site may block bots, or need `render: true`. Run `competitor-watch check` to see each page's status.
- **"include selector matched nothing"** → the site was redesigned; update the page's `include` selectors.
- **The digest is noisy for one page** → add `ignore` selectors, or raise `min_change_chars`.
- **A battlecard looks wrong, or the update keeps failing** → `competitor-watch battlecard <slug> --rebuild` regenerates it from current snapshots and keeps the Recent changes log.

## Roadmap (v1.1)

Deliberately not in v1; each is meant to be an addition, not a rewrite:

- **JSON sources:** `format: json` pages with a `jsonpath` filter, for pricing loaded from public JSON endpoints.
- **Per-page frequency:** `every: daily | weekly | monthly`, using `last_checked` in `state.json`.
- **RSS output:** `data/feed.xml` built from the digests.
- **Proxy support:** respect `HTTPS_PROXY` for sites that block GitHub Actions IPs.
- **More storage adapters:** S3-compatible and Postgres.

## Contributing

Issues welcome, no SLA, PRs encouraged. Storage adapters (implement the small interface in `src/storage/storage.ts`) and new notifiers (see `src/outputs/notify/`) are good first contributions.

```bash
npm ci
npm run lint && npm run typecheck && npm test
```

Tests never call the network, GitHub or Anthropic; everything is mocked.

**Versioning:** semver. Breaking changes to the config or data layout get a new major version and a migration note here. `state.json` carries a `schema_version`.

## License

[MIT](LICENSE)
