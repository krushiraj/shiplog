# Shiplog launch checklist

Deadline: submit by **Nov 13, 9pm IST** (contest closes Nov 13, 11:59pm PT = Nov 14, 1:29pm IST).

Status key: `[ ]` open · `[x]` done · `[~]` in progress / partly verified.

## Critical: nothing works without these

- [~] **Webhook → event → change card, live.**
  - 2026-11-09: every real GitHub delivery since install returned **401 invalid signature**. Production accepts payloads signed with the `.env.local` secret, so the secret saved in the GitHub App settings is different.
  - Fix: paste `GITHUB_WEBHOOK_SECRET` from `.env.local` into github.com/settings/apps/shiplog-build-log → Webhook secret → Save. Then redeliver the failed pushes from the app's Advanced tab, or push a commit.
  - Verify: `yarn tsx scripts/deliveries.mts` shows 200s; `yarn tsx scripts/status.mts` shows new events and cards.
  - Workaround for testing: `yarn tsx scripts/replay-push.mts krushiraj/shiplog <sha>...` sends a correctly signed copy of real commits.
  - 2026-11-09: with a replayed push, the pipeline after the signature check works. 2 events were stored and analysed into 2 good change cards (significance 2 and 1, one with a sensible open question).
- [ ] **Scheduler runs every 15 minutes.** GitHub Actions has run `tick.yml` **once** (16:33Z) in 3.5 hours; scheduled workflows are best-effort and often delayed for hours. Fix: an external cron (e.g. cron-job.org) calling `/api/cron/tick` with `Authorization: Bearer <CRON_SECRET>` every 15 min (needs a user-created account). Optionally also run a project-scoped tick right after a webhook's analysis, so instant posts don't wait for the cron.
- [ ] **Change cards → draft in the Inbox.** Commits only draft through the daily digest (18:30 project time, significance sum ≥ 3) or instantly for releases and significance-3 cards. Today's digest ran at 16:33Z with no cards (webhooks were failing), so the next one is Nov 9, 18:30 IST; the two real cards (sum 3) qualify. Force a run with `yarn tsx scripts/tick.mts`.
- [ ] **Approve → real post in Buffer** (LinkedIn or X), visible in the Buffer queue.
- [ ] **Submission:** demo video, 300-word summary, Buffer client ID.

## Must have: the demo looks broken without these

- [ ] Voice learned from Buffer history (onboarding step 3); the DNA reads like the user.
- [ ] Brief Rebuild works on the real project; Usage page shows estimate vs actual per call.
- [ ] Rebuild button styling confirmed visually.
- [ ] README: what it is, how it works, setup, screenshots.
- [ ] Shiplog posts about itself: Day 0 announcement + progress posts (Build-in-Public Award).

## Good to have

- [ ] Better cost estimates. First real calls: a big diff was estimated at $0.030 and cost $0.051 (19.8k input tokens, 1.7× under); a cached call was estimated at $0.0098 and cost $0.0044 (the estimate ignores cache reads). Count diff tokens more closely and price the cached system prefix at the cache-read rate.

- [ ] Project log: a dated milestone line per card, last ~10 in prompts, older lines compressed (Haiku).
- [ ] Brief patching: significance ≥ 2 cards update milestones / architecture / stack without re-reading the repo.
- [ ] Answer open questions from the Memory page (today only from the Inbox).
- [ ] Timeline links to the specific Buffer post instead of Buffer in general.

## Skip

- Instagram variants (needs images).

## Operator scripts

All read `.env.local`; none print secrets.

| Script | What it does |
|---|---|
| `scripts/deliveries.mts [limit]` | Lists recent GitHub App webhook deliveries with status codes |
| `scripts/ping-webhook.mts [baseUrl]` | Sends an unsigned and a signed ping, to tell a secret mismatch from a blocked route |
| `scripts/replay-push.mts <repo> <sha>...` | Replays real commits as a signed push webhook |
| `scripts/tick.mts [baseUrl]` | Runs the scheduler tick once and prints its summary |
| `scripts/status.mts [baseUrl]` | Prints projects, events, change cards, drafts and recent AI calls (`/api/cron/status`, cron secret) |
