import type {
  BriefView,
  ChangeCardView,
  DraftView,
  PostRow,
  ProjectView,
  VoiceRuleView,
} from "./ui-types";

const REPO = "krushiraj/shiplog";
const gh = (path: string) => `https://github.com/${REPO}/${path}`;

export const mockUser = {
  name: "Krushi Raj",
  handle: "krushiraj",
  email: "krushi@example.com",
  initials: "KR",
};

export const mockProjects: ProjectView[] = [
  {
    id: "p-shiplog",
    name: "Shiplog itself",
    repos: [REPO],
    channels: ["linkedin", "x", "threads"],
    cadence: "Daily digest at 18:30",
    reviewMode: "inbox",
    paused: false,
    stats: { changesThisWeek: 23, postsThisWeek: 4, streakDays: 6 },
  },
  {
    id: "p-encore",
    name: "Encore",
    repos: ["krushiraj/encore-web", "krushiraj/encore-api"],
    channels: ["linkedin", "x"],
    cadence: "Weekly on Friday",
    reviewMode: "inbox",
    paused: false,
    stats: { changesThisWeek: 9, postsThisWeek: 1, streakDays: 2 },
  },
  {
    id: "p-dotfiles",
    name: "dotfiles",
    repos: ["krushiraj/dotfiles"],
    channels: ["x"],
    cadence: "Releases only",
    reviewMode: "draft",
    paused: true,
    stats: { changesThisWeek: 0, postsThisWeek: 0, streakDays: 0 },
  },
];

export const mockCards: ChangeCardView[] = [
  {
    id: "c1",
    repo: REPO,
    ref: "#41",
    kind: "pr_merged",
    url: gh("pull/41"),
    what: "Drafts now go through a voice gate before you ever see them.",
    why: "Early drafts kept slipping in phrases I never use, and I was fixing the same words every day.",
    whyInferred: false,
    how: "A rule check runs in code first (banned words, AI-isms, length, hashtags), then the model scores drift from 0 to 1 and suggests up to 3 fixes.",
    impact: "Edits per draft dropped from about 6 to 2 on the last 20 drafts.",
    significance: 2,
    occurredAt: "2026-11-08T09:12:00Z",
  },
  {
    id: "c2",
    repo: REPO,
    ref: "a3f9c21",
    kind: "commit",
    url: gh("commit/a3f9c21"),
    what: "Secrets are scrubbed from diffs before anything reaches the model.",
    why: "Probably to make it safe to turn on diff reading for private repos.",
    whyInferred: true,
    how: "Pattern and entropy checks redact keys, tokens and .env values, and hunks are capped at 40 lines.",
    impact: "Diff reading can stay on by default without leaking credentials.",
    significance: 2,
    occurredAt: "2026-11-08T07:40:00Z",
  },
  {
    id: "c3",
    repo: REPO,
    ref: "#39",
    kind: "pr_merged",
    url: gh("pull/39"),
    what: "Posting picks the next best slot per channel instead of posting instantly.",
    why: "So a burst of evening commits doesn't turn into three posts at 1am.",
    whyInferred: false,
    how: "Slots come from your timezone, quiet days and a per-channel daily cap.",
    impact: "Max 2 posts per channel per day, never on quiet days.",
    significance: 2,
    occurredAt: "2026-11-07T18:05:00Z",
  },
  {
    id: "c4",
    repo: REPO,
    ref: "9be21d0",
    kind: "commit",
    url: gh("commit/9be21d0"),
    what: "Fixed the token budget resetting at UTC midnight instead of local midnight.",
    why: null,
    whyInferred: false,
    how: "The budget window now uses the project timezone.",
    impact: null,
    significance: 1,
    occurredAt: "2026-11-07T15:22:00Z",
  },
  {
    id: "c5",
    repo: REPO,
    ref: "v0.3.0",
    kind: "release",
    url: gh("releases/tag/v0.3.0"),
    what: "v0.3: Shiplog learns your voice from the edits you make.",
    why: "Approving a draft should teach it something, not just publish it.",
    whyInferred: false,
    how: "Each edit is diffed against the draft and turned into at most 2 proposed rules. A rule goes live after 2 sightings or when you accept it.",
    impact: "New users get usable drafts after about 5 approvals.",
    significance: 3,
    occurredAt: "2026-11-08T11:00:00Z",
  },
];

export const mockDrafts: DraftView[] = [
  {
    id: "d1",
    project: { id: "p-shiplog", name: "Shiplog itself" },
    trigger: { kind: "digest", label: "Daily digest · 6 changes" },
    slot: { label: "Today, 18:30", iso: "2026-11-08T13:00:00Z" },
    variants: {
      linkedin:
        "Day 6 of building Shiplog in public.\n\nThe drafts it wrote kept using words I never use. So every draft now passes a voice gate before I see it: a rule check in code, then a drift score with up to 3 suggested fixes.\n\nOn the last 20 drafts my edits went from about 6 per post to 2.\n\nAlso shipped: secrets get scrubbed from diffs before the model reads them, and posts wait for the next good slot instead of going out at 1am.\n\n#BuildInPublic",
      x: "Shiplog drafts now pass a voice gate before I see them.\n\nRule check in code, then a drift score + up to 3 fixes.\n\nMy edits per post: ~6 → 2.\n\n#BuildInPublic",
      threads:
        "Small win today: Shiplog's drafts go through a voice gate now. Code checks first, then a drift score with a few suggested fixes. I went from ~6 edits per post to 2.",
    },
    cards: [mockCards[0], mockCards[1], mockCards[2], mockCards[3]],
    openQuestion: {
      cardId: "c2",
      question: "Why did you add secret scrubbing now? I guessed it's for private repos.",
    },
    gate: {
      drift: 0.18,
      suggestions: [
        { id: "s1", text: "Drop \"in public\" from the opener, you rarely say it twice" },
        { id: "s2", text: "Lead with the number (6 → 2)" },
      ],
      fixed: ["Removed an em dash", "Cut \"super\""],
    },
    createdAt: "2026-11-08T12:10:00Z",
  },
  {
    id: "d2",
    project: { id: "p-shiplog", name: "Shiplog itself" },
    trigger: { kind: "release", label: "Release v0.3" },
    slot: { label: "Tomorrow, 09:00", iso: "2026-11-09T03:30:00Z" },
    variants: {
      linkedin:
        "Shiplog v0.3 is out.\n\nIt now learns from the edits you make. Change a word in a draft, approve it, and Shiplog proposes a rule like \"never say 'super'\". Accept it and the next draft already follows it.\n\nNew users get drafts they'd post as-is after about 5 approvals.\n\nRelease notes: github.com/krushiraj/shiplog/releases/tag/v0.3.0",
      x: "Shiplog v0.3: it learns from your edits.\n\nCut a word, approve, and it proposes a rule. Accept it and every next draft follows it.\n\n~5 approvals to drafts you'd post as-is.",
    },
    cards: [mockCards[4]],
    openQuestion: null,
    gate: { drift: 0.41, suggestions: [{ id: "s3", text: "Shorter opener, you usually start with the version" }], fixed: [] },
    createdAt: "2026-11-08T11:02:00Z",
  },
];

export const mockPosts: PostRow[] = [
  {
    id: "t1",
    project: "Shiplog itself",
    channel: "linkedin",
    excerpt: "Shiplog now reads what changed, not just the commit message…",
    status: "sent",
    at: "2026-11-07T13:00:00Z",
    bufferUrl: "https://publish.buffer.com",
    sources: [{ ref: "#36", url: gh("pull/36") }, { ref: "4d1e0aa", url: gh("commit/4d1e0aa") }],
  },
  {
    id: "t2",
    project: "Shiplog itself",
    channel: "x",
    excerpt: "Change cards are cached by SHA, so the same commit is never analysed twice.",
    status: "sent",
    at: "2026-11-06T13:00:00Z",
    bufferUrl: "https://publish.buffer.com",
    sources: [{ ref: "b77c310", url: gh("commit/b77c310") }],
  },
  {
    id: "t3",
    project: "Encore",
    channel: "linkedin",
    excerpt: "Encore can now resume a setlist mid-song after a dropped connection.",
    status: "queued",
    at: "2026-11-09T03:30:00Z",
    bufferUrl: null,
    sources: [{ ref: "#112", url: "https://github.com/krushiraj/encore-web/pull/112" }],
  },
  {
    id: "t4",
    project: "Shiplog itself",
    channel: "threads",
    excerpt: "Day 4: connected Buffer. OAuth with PKCE, tokens encrypted at rest.",
    status: "sent",
    at: "2026-11-05T13:00:00Z",
    bufferUrl: "https://publish.buffer.com",
    sources: [{ ref: "#28", url: gh("pull/28") }],
  },
  {
    id: "t5",
    project: "Encore",
    channel: "x",
    excerpt: "Setlist sharing links are live.",
    status: "error",
    at: "2026-11-04T10:15:00Z",
    bufferUrl: null,
    sources: [{ ref: "v1.4.0", url: "https://github.com/krushiraj/encore-web/releases" }],
  },
];

export const mockBrief: BriefView = {
  pitch: "Your commits, turned into build-in-public posts in your voice, on your schedule.",
  audience: "Indie hackers and small teams who ship often but rarely post about it.",
  problem: "Writing about your work takes longer than the work feels worth, so most progress goes unshared.",
  stack: ["Next.js 15", "Postgres (Neon)", "Drizzle", "Claude", "Buffer GraphQL API", "GitHub App"],
  glossary: [
    { term: "change card", plain: "a short what / why / how / impact summary of one change" },
    { term: "gate", plain: "the checks a draft passes before you see it" },
    { term: "digest", plain: "one post that covers several days of changes" },
  ],
  architecture: [
    { module: "lib/github", purpose: "Receives webhooks and normalises events" },
    { module: "lib/ai", purpose: "Writes change cards and drafts" },
    { module: "lib/voice", purpose: "Learns rules from your edits" },
    { module: "lib/buffer", purpose: "Schedules approved posts through Buffer" },
  ],
  milestones: ["v0.1 change cards", "v0.2 inbox + Buffer posting", "v0.3 voice learning"],
};

export const mockRules: VoiceRuleView[] = [
  { id: "r1", kind: "never", rule: "Never say \"super\"", register: null, source: "Edit on draft d0 · Nov 7", sightings: 2, active: true },
  { id: "r2", kind: "never", rule: "No em dashes", register: null, source: "Default AI-ism list", sightings: 1, active: true },
  { id: "r3", kind: "prefer", rule: "Lead with a number when there is one", register: "linkedin", source: "Edit on draft c9 · Nov 6", sightings: 3, active: true },
  { id: "r4", kind: "format", rule: "At most 1 hashtag on X", register: "x-short", source: "Settings", sightings: 1, active: true },
  { id: "r5", kind: "prefer", rule: "Say \"shipped\" instead of \"launched\"", register: null, source: "Edit on draft b2 · Nov 5", sightings: 1, active: false },
];

export const inboxCount = mockDrafts.length;
