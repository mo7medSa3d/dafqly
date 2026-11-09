# Prompts to paste into the coding agent

Put this whole folder at the root of an empty Git repo first. Use one prompt per session.

## 1. Kickoff (first session, M0)

```
You are the lead engineer for Tahseel. Read, in this order: AGENTS.md, docs/BUILD_PLAN.md, docs/BRAND.md, docs/HUMAN_INPUTS.md, docs/DECISIONS.md, docs/PROGRESS.md. They are the spec. packages/brand holds the logo, icons and design tokens; do not edit them.

Start with Milestone M0 from the plan, plus the brand integration in docs/BRAND.md Section 0 (tokens, icons, manifest, theme color, BrandMark component, font flag). Create the pnpm scripts listed in AGENTS.md, docker-compose, CI, env validation and the repo layout from the plan.

Work autonomously. For each task: write failing tests first, implement, run lint, typecheck and tests, exercise the feature for real, and record the evidence in docs/PROGRESS.md. Keep docs/DECISIONS.md current. Commit small.

Do not wait for me unless you are blocked by something only I can provide (credentials, font files, the font license answer, legal answers, real eval data). If blocked, list exactly what you need, keep going with fakes or synthetic data on everything else, and flag every place where a fake stands in for the real thing.

Never claim something works without evidence you produced by running it. Never mark a feature done if any acceptance criterion is unmet. If a test fails after three genuinely different attempts, stop and report your diagnosis.

When M0's exit criteria are met, stop and send me: what was verified, what was only tested with fakes, what I must check by hand (docs/RUNBOOK.md), and the next step.
```

## 2. Resume (any new session)

```
Continue working on Tahseel. Read AGENTS.md, then docs/PROGRESS.md and docs/DECISIONS.md to restore context. Check git status and run lint, typecheck and tests to confirm the repo is green before changing anything. Then continue with the "Next steps" in PROGRESS.md under the same rules as before. Stop at the end of the current milestone and report.
```

## 3. Start a milestone (replace N)

```
Start Milestone M{N} from docs/BUILD_PLAN.md Section 10. Read the feature sections it covers (and every acceptance criterion) first. Restate the acceptance criteria in docs/PROGRESS.md, then work through them with tests first and real evidence. Follow AGENTS.md. At the end, verify every exit criterion for M{N}, report what was verified versus faked, and list what I must test by hand.
```

## 4. Final verification (after M6)

```
Run the full acceptance checklist in docs/BUILD_PLAN.md Section 12 and the checks in docs/BRAND.md Section 10. For each item, run the check yourself and paste the evidence; mark it failed if you cannot demonstrate it. Run pnpm lint, typecheck, test, test:e2e and eval. Report results honestly, separate "verified by running" from "verified only with fakes" from "needs a human", and list remaining risks. Do not call the product ready unless every non-human item is green.
```
