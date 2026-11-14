# Shiplog

**Your commits, posted in your voice.** Shiplog watches your GitHub repos, turns real work into build-in-public posts, and queues them through [Buffer](https://buffer.com) once you approve.

Live: https://getshiplog.vercel.app · Built for the Buffer Commit contest.

## Why

Building in public works, but turning a commit log into a post takes longer than the commit did, so most people stop. Shiplog does the writing and leaves you a two-minute review.

## How it works

```
GitHub push / release ──webhook──▶ change card ──▶ scheduler ──▶ draft per channel ──▶ you approve ──▶ Buffer
                                    (Haiku)        digest /        (Sonnet, your         per channel     createPost
                                                   instant         voice + rules)
```

1. **Change cards.** The Shiplog GitHub App sends every push and release to `/api/github/webhook` (HMAC-verified). A small model reads each change and writes a plain-language card: what changed, why it matters, a significance score (0–3), and an open question when the "why" is a guess.
2. **Project memory.** A project brief (what it is, who it's for, stack, milestones, facts you've answered) is built once and reused, so the repo isn't re-read on every post.
3. **Scheduler.** Cards roll up into a daily digest once they're significant enough. Releases and major changes draft right away. **Draft now** on a project page writes one on demand. Ticks run after webhook analysis, on Inbox visits, and on a cron backstop.
4. **Drafts per channel.** One draft, one text per channel: a story for LinkedIn and a short take for X. A gate checks real limits. X accounts with a subscription (read from Buffer's `TwitterMetadata.subscriptionType`) get the 25,000-character limit.
5. **Your voice.** Voice DNA is learned from posts you've already sent through Buffer (one register for long posts, one for short). With too little history, a six-question interview or pasted posts fill in. Every edit you make before approving is diffed into a proposed rule. A rule goes live once it's been seen twice or you confirm it on the Memory page.
6. **You approve.** Nothing posts without you. Pick which channels to post to, then queue for the next best slot, post now, or pick a time. Posts go out through the Buffer API.
7. **Cost control.** Every AI call is logged with its estimate and actual cost against a per-user budget (Usage page).

## Buffer API usage

- OAuth sign-in
- Channels query, including channel metadata (X subscription tier)
- Sent-post history, for voice learning
- `createPost`: queue, share now, or schedule; draft mode supported

## Stack

Next.js 15 (App Router) · TypeScript · Drizzle + Neon Postgres · Anthropic Claude (Haiku for analysis, Sonnet for writing and voice) · Vercel · vitest (425 tests)

## Run it locally

```bash
yarn install
yarn db:migrate
yarn dev
```

Put these in `.env.local`: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `BUFFER_CLIENT_ID`, `BUFFER_CLIENT_SECRET`, `BUFFER_SCOPES`, `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_PRIVATE_KEY` (or `GITHUB_PRIVATE_KEY_PATH`), `GITHUB_WEBHOOK_SECRET`, `SESSION_SECRET`, `TOKEN_ENC_KEY`, `CRON_SECRET`, `APP_URL`.

Create a GitHub App with push and release events and its webhook at `<APP_URL>/api/github/webhook`, and a Buffer app with its redirect at `<APP_URL>/api/auth/buffer/callback`.

## Operator scripts

`yarn tsx scripts/<name>.mts`: `status` (pipeline state), `tick` (run the scheduler once), `deliveries` (GitHub webhook deliveries, and redeliver), `replay-push` (replay real commits as a signed webhook). See `docs/2026-11-09-launch-checklist.md`.

## Docs

- `docs/2026-11-08-shiplog-design.md`: design
- `docs/buffer-api.md`: Buffer API notes
