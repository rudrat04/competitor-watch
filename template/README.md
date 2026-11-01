# My Competitor Watch

This repo watches your competitors' public web pages every week, explains what changed and why it matters, and keeps a battlecard per competitor. It is powered by [Competitor Watch](https://github.com/rudrat04/competitor-watch), which is free, open source and self-hosted: it runs on your own GitHub Actions minutes with your own Anthropic API key.

## Setup (5 steps)

1. **Create your own copy:** on [the template](https://github.com/rudrat04/competitor-watch-template), click **Use this template → Create a new repository** and set it to **Private**. (Don't fork: forks of public repos are public, and Competitor Watch refuses to run in a public repo.)
2. **Add your key:** in your new repo, go to **Settings → Secrets and variables → Actions → New repository secret**. Name it `ANTHROPIC_API_KEY`, with a key from [console.anthropic.com](https://console.anthropic.com). Optionally add `SLACK_WEBHOOK_URL` and/or `DISCORD_WEBHOOK_URL`.
3. **Describe your company and competitors:** edit [`competitors.yaml`](competitors.yaml) in the browser. Fill in your company, then 2–5 competitors with their pricing, changelog and homepage URLs. Commit.
4. **Run it once now:** **Actions → Competitor Watch → Run workflow**.
5. **A few minutes later**, a GitHub issue appears with the baseline digest, and `data/battlecards/` holds one battlecard per competitor.

After that it runs every Monday on its own. When something meaningful changes, a new issue arrives.

## Day to day

- **Add or remove competitors:** edit `competitors.yaml`.
- **Change the schedule:** edit the `cron` line in `.github/workflows/competitor-watch.yml`.
- **Stop it:** disable the workflow in the Actions tab.
- **Updates:** nothing to do; each run uses the latest 1.x of the engine.

Everything is in this repo: `data/digests/` has every digest, `data/battlecards/` the battlecards, and the history of any file in `data/snapshots/` shows exactly what changed and when.

See the [full documentation](https://github.com/rudrat04/competitor-watch#readme) for configuration options and troubleshooting.
