# Shiplog — Design (working name)

> Your commits, turned into build-in-public posts in your voice, on your schedule.

**Contest:** Buffer Commit. Submit by **Nov 13, 9pm IST**. The hard deadline is Nov 13, 11:59pm PT = Nov 14, 1:29pm IST.
**Also targets:** the Build-in-Public Award. Multiple submissions are allowed if substantially different, so Encore is a separate project, built only if time remains.
**Crowded lane:** Releasebuff, Statbrag, LaunchBuddy and Tellirim all turn work into posts. Our edge:
1. Projects that group several repos.
2. Digest + instant triggers.
3. Real code understanding (what / why / how / impact).
4. Review in our inbox, with a voice memory that learns from edits.
5. Dogfooded: every Shiplog build post is written by Shiplog.

---

## 1. Architecture

```
GitHub App ──webhooks──▶ /api/github ──▶ events (normalised, deduped)
                                              │
Vercel Cron (15 min) ──▶ scheduler ───────────┤ per Project: digest due? instant event?
                                              ▼
                     analyser (diff → change card)   composer (Claude + memory)
                                              ▼
                                   drafts ──▶ Inbox (edit / regenerate / approve / reject)
                                              │                 │
                                              │       learner: edit diff → voice rules
                                              ▼
                 review mode: inbox → on approve │ draft → saveToDraft │ auto → after checks
                                              ▼
                                     Buffer createPost
```

| Piece | Choice |
|---|---|
| App | Next.js (App Router) + TypeScript, **yarn**, deployed on Vercel |
| UI | **BoardUI** (React 19, Tailwind v4, React Aria, TanStack Table) — free tier first; check Pro needs on Day 0 |
| DB | Neon Postgres + Drizzle |
| Auth | Sign in with Buffer (OAuth confidential client + PKCE, `offline_access`) is the only login. The GitHub App installation is linked to the user |
| GitHub | GitHub App. Events: `push`, `pull_request.closed` (merged), `release.published`, `issues.closed`, `create` (tag). Installation tokens read PR bodies, diffs and repo files on demand |
| AI | Claude API, `claude-sonnet-5-5`, structured JSON output |
| Jobs | Vercel Cron every 15 min; instant events are processed right after the webhook (queued via `waitUntil` / a DB-backed job table) |

## 2. Understanding and memory

**Input policy:** diffs are read **for understanding** by default.
- A secret scrubber runs first. Hunks are capped (≤ 40 lines each, summarised per file when large). Lockfiles, `dist/`, minified and generated files are skipped.
- `read_diffs: false` makes a Project metadata-only (for private repos).
- Code is **never quoted in posts** unless `quote_code: true`.

**Three memory layers per Project (Postgres, editable in the UI):**
1. **Project brief.** Built when a repo is added and refreshed on milestone changes.
   - Read: README, docs/, manifests, file tree, entry points and key modules (≤ 40 file summaries).
   - Produce: pitch, audience, problem, architecture map (module → purpose), glossary (internal name → plain words), stack, milestones.
2. **Change cards.** One per event, cached by SHA:
   - **what** — plain words
   - **why** — from PR body / issue / commit message / brief goals; marked `inferred` when guessed
   - **how** — the approach, from the diff
   - **impact** — for users and devs, with numbers when available
   - **significance** — 0 chore, 1 fix, 2 feature, 3 milestone
   - **open_question** — when the *why* is unclear, the inbox asks the user; the answer updates the card and the brief
3. **Voice memory.** One profile per user plus per-Project overrides (§3).

**Composing:** brief + change cards since the last post (grouped by theme, not by commit) + voice memory + recent posts (to avoid repeats). The output is a story, not a changelog: one variant per channel.

**Cost control:** analyse each SHA once; per-Project daily token budget; over budget means metadata-only.

## 3. Voice learning
Sources: Voice DNA Creator (structured JSON profile + "never say" list), Daria Cupareanu's Voice DNA skills (5–10 best samples, separate voice per format, voice-interview cold start, audience + business profiles), copydesk (registers, a two-part review gate, edit-diff learning loop with expiry).

1. **Bootstrap (about 2 min). Any of:**
   - pick 5–10 sent posts from Buffer (`posts`, status sent) or paste them
   - a 6-question voice interview (typed or dictated)
   - a preset (plain builder / storyteller / technical)
2. **Voice DNA per register** (`linkedin`, `x-short`, `thread`) as JSON: tone, openers, closers, sentence stats, signature vocab, `never` list, formatting (emoji, line breaks, hashtags), plus 3 example posts.
3. **Gate before the user sees a draft:**
   - **Rule check in code:** never-words, AI-isms (em dashes, "this isn't X, it's Y", "delve", ...), character limits, hashtag/emoji caps, secrets. Fixed silently.
   - **Voice check by the model:** drift score from 0 to 1 and ≤ 3 suggestion chips.
4. **Learn from inbox actions:**
   - edit + approve → diff → ≤ 2 proposed rule changes
   - reject with a reason → a `never` rule
   - approve unchanged → added to the examples pool

   A rule goes live after it appears in 2 edits, or straight away when the user accepts the "Shiplog learned: ..." toast. Rules unseen for 30 days expire. The memory screen lists each rule with its source edit, an on/off switch and undo.

Not this week: held-out A/B evaluation and a second craft reviewer.

## 4. Configuration
Hierarchy: **user defaults → Project → repo overrides**. The UI shows each effective value and where it comes from. Settings are exportable as YAML; reading `.shiplog.yml` from repos comes after the contest.

```yaml
project: "Encore"
repos:
  - kr/encore-web
  - kr/encore-api: { include_paths: ["src/**"], skip_paths: ["infra/**"] }
channels: [linkedin:me, x:me, threads:me]
timezone: Asia/Kolkata
triggers:
  digest: { every: 1d, at: "18:30", min_significance_sum: 3, max_age: 7d }   # every: 1d | 2d | weekly:Fri | off
  instant: [release.published, { tag: "v*" }, { pr.merged: { label: ship-it } }, { significance: 3 }]
review:
  mode: inbox            # inbox (default) | draft | auto
  auto_requires: { voice_score: ">=0.8", rules_passed: true }   # else → inbox
  expire_after: 48h      # stale drafts fold into the next digest
posting:
  when: next_best_slot   # now | next_best_slot | fixed "09:00"
  per_channel_daily_cap: 2
  quiet_days: [Sun]
  hashtags: ["#BuildInPublic"]
  link: repo             # repo | release | none
ai:
  read_diffs: true
  quote_code: false
  register_map: { linkedin: linkedin, x: x-short, threads: x-short }
  daily_token_budget: 200k
```

- One repo can belong to several Projects. Events and analysis are shared and cached by SHA.
- **Rate-limit safety:** Buffer writes happen only when a post is approved or posted, never per event, so a typical user makes about 1–3 calls a day. Every write goes through a global budget meter for the shared quota (100 / 15 min, 250 / 24 h, 3,000 / 30 d).

## 5. Screens
1. **Landing:** pitch, a live sample post being written, **Try the demo** (no login), **Sign in with Buffer**.
2. **Onboarding:** connect Buffer → install the GitHub App and pick repos (Project suggested) → bootstrap the voice. The brief builds in the background (Agent progress).
3. **Inbox (home):** one card per draft.
   - Header: Project, trigger, slot.
   - A tab per channel with a character count.
   - A "What changed" panel of change cards (what / why / how / impact, *inferred* marks, commit/PR links).
   - An open-question chip and voice-gate chips.
   - Actions: approve (next best slot / now / pick a time), inline edit, regenerate with a nudge, reject with a reason, snooze into the next digest.
4. **Timeline:** everything posted or queued, with Buffer post links and the source commits.
5. **Project settings:** the §4 form plus YAML export.
6. **Memory:** the editable brief, change-card history, and voice rules (source, on/off switch, undo).

**Demo mode:**
- A seeded Project, "Shiplog itself", made from our real commits and change cards, plus a sample voice.
- AI calls are real but capped per session. Buffer writes are simulated until the judge connects Buffer.
- It shows the main loop in about 2 minutes: commits → understood change → post in your voice → learns from your edit.

**BoardUI mapping:**
- Sidebar → app shell
- Auth card → sign-in
- Agent progress / Agent thinking / Composer loader → brief building and composing
- Composer → regenerate box
- Data table → Timeline
- Calendar → schedule
- Contributor profile → Project dashboard (shipping streak, changes/week, posts)
- Agent limits → token budget

**Notifications:** an optional email when a digest is ready. Slack and Telegram come after the contest.

## 6. Error handling
- **Webhooks:**
  - Verify the signature and store the event before processing.
  - Dedupe by delivery ID + SHA.
  - Ignore force-pushes. A revert cancels its pending change card.
- **Buffer:**
  - Single-flight token refresh (a replay revokes the grant).
  - Idempotency key per post.
  - Honour `Retry-After`; back off at 80% of the budget.
  - A past `dueAt` gets the next slot.
  - A disconnected channel sends the draft back to the inbox with a reconnect prompt.
- **GitHub:** app uninstalled or repo removed → pause the Project and show a banner. Installation tokens are refreshed per call.
- **AI:** schema-validated output, one retry, then a plain fallback draft built from the change cards. Over the token budget → metadata-only.
- **Safety:** scrub secrets before the model and before posting. No code quotes unless enabled. Auto mode falls back to the inbox on any failed check.
- **Scheduler:** claim due Projects with a row lock (no double digests). Missed runs catch up once.

## 7. Testing
- **Unit:**
  - config resolution
  - digest selection (significance sum, max age, carry-forward)
  - rule checks (never-words, limits, secrets)
  - the edit-diff → rule learner on recorded pairs
- **Contract:** recorded GitHub webhook payloads → change cards; mocked Buffer GraphQL (`createPost`, errors, rate limits).
- **Golden prompts:** 5 fixture events with expected what/why/how/impact structure, spot-reviewed.
- **Dogfood E2E:** this repo is Project #1 from Day 1. Every Shiplog build post is written by Shiplog.

## 8. Out of scope (this week)
Repo `.shiplog.yml`, Slack/Telegram notifications, images/cards (Statbrag's lane), GitLab/Bitbucket, team workspaces, held-out A/B voice evaluation, analytics (app clients can't read metrics; that's Encore).

## 9. Open items for Day 0
- Check the name "Shiplog" for clashes; it can't contain "Buffer".
- Which BoardUI components are free vs Pro; buy Pro only if a must-have needs it.
- GitHub App permissions: contents:read, pull_requests:read, issues:read, metadata:read; events listed in §1.
- Buffer OAuth redirect URIs: prod, preview, `https://localhost:3000/api/auth/buffer/callback`.
