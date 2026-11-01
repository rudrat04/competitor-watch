> **SAMPLE OUTPUT — not real data.** A weekly digest with one material and two minor changes. The companies (Acme Analytics, Northwind Metrics, Globex Insights) are fictional; this file shows the format Outflank produces.

# Outflank — 2026-11-09

**1 material, 2 minor changes across 2 competitors**

## Material changes

### Northwind Metrics — pricing

**Pro rose to $69/month, an Enterprise plan was added and the free plan was removed.**

- Page: https://northwind.example/pricing · [change history](https://github.com/you/my-outflank/commits/HEAD/data/snapshots/northwind-metrics/pricing.md)
- Keyword trigger: "free plan" removed
- **What changed:** The Pro plan rose from $49 to $69 per month, and a new Enterprise plan with SSO and audit logs was added at custom pricing. The "Free plan" section was removed.
- **Why it matters:** Likely a move upmarket: dropping the free tier and adding Enterprise suggests they are prioritising larger accounts (speculation, based on the plan changes only).
- **Impact on us:** Our flat pricing is now clearly cheaper for small teams, and teams on their free plan will need a new home.
- **Suggested response:** Marketing: publish a short "moving from Northwind" guide aimed at former free-plan users this week. Sales: lead with total cost for teams under 50 seats. _(confidence: high)_

## Minor changes

- **Northwind Metrics** (changelog): Added a Salesforce export integration. — [history](https://github.com/you/my-outflank/commits/HEAD/data/snapshots/northwind-metrics/changelog.md)
- **Globex Insights** (homepage): Headline changed from "Analytics for everyone" to "AI analytics for product teams". — [history](https://github.com/you/my-outflank/commits/HEAD/data/snapshots/globex-insights/homepage.md)

## Needs attention

- 🚫 **Globex Insights / careers** blocked: disallowed by https://globex.example/robots.txt (https://globex.example/careers). Skipped.

Cost: $0.1268 of $1.00 cap (6 LLM calls, 18950 in / 4120 out tokens)
