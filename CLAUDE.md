# Working rules

- PLAN.md is the source of truth. Follow it; if something in it is wrong, stop and say why instead of deviating.
- Work one milestone at a time. Finish it, run lint, typecheck and tests, commit, then stop and summarize.
- Never call live APIs (Anthropic, GitHub, or real websites) in tests. Mock everything.
- Don't add dependencies that PLAN.md doesn't list without asking first.
- If the same error happens twice, stop and explain instead of retrying.
