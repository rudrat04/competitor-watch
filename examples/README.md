<p align="center"><img src="../assets/logo.svg" alt="Outflank" width="320"></p>

# Example outputs

There are two kinds of example here. They're labelled so you never mistake one for the other.

## 1. A live run on real competitors: [`live-run/`](live-run/)

The real engine, run on 2026-11-01 against **real, public pages** of four companies in AI sales roleplay and coaching: Mindtickle, Awarathon, Second Nature and Hyperbound. It's written from the point of view of **Rehearsely, a fictional company**: an Indian AI sales-coaching tool for BFSI and pharma teams.

| File | What it is |
|---|---|
| [`competitors.yaml`](live-run/competitors.yaml) | The config used, unchanged. |
| [`digests/2026-11-01.md`](live-run/digests/2026-11-01.md) | First run: baseline for 4 competitors and 8 pages. |
| [`digests/2026-11-01-2.md`](live-run/digests/2026-11-01-2.md) | Second run the same day: every page fetched again, nothing changed. |
| [`battlecards/`](live-run/battlecards/) | One battlecard per competitor, built from their real pages. |

**How it was made.** Everything except the model was the real engine: robots.txt, live fetching, extraction, normalization, hashing, battlecard assembly and digests. No Anthropic API key was used. At each point where Outflank calls the API, the exact prompt it built was answered by Claude in a Claude Code session, following the same system prompt and JSON schema. The engine then validated each answer with its schema, just as it does with an API response.

**What to keep in mind:**

- **The cost is $0** in these digests because no API was called. On the API, the four battlecard calls are about 7.5k input and 3.3k output tokens, roughly $0.10–0.25 on Claude Opus 5.5.
- **These are snapshots from 2026-11-01.** The competitors' pages, prices and claims will change, and that's exactly what Outflank exists to catch. Check the live pages before relying on anything here.
- **Snapshots are not included**, so we don't republish the competitors' full page text. The battlecards quote only short phrases.

## 2. Fictional samples: what a change looks like

The live run had no changes to show yet, so these files use **fictional companies** (Acme Analytics, Northwind Metrics, Globex Insights). They were generated with Outflank's own digest and battlecard code, so the format is exact, but the analysis text is hand-written to show the style.

- [`digest-weekly.md`](digest-weekly.md): a weekly digest with one material change (with a keyword trigger) and two minor ones.
- [`digest-baseline.md`](digest-baseline.md): a first-run digest.
- [`battlecard.md`](battlecard.md): a battlecard after its first weekly update.

Links in the fictional samples point to a made-up GitHub repo (`you/my-outflank`), as they would inside GitHub Actions.
