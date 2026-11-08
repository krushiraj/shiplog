# Buffer API reference for an OAuth app client (verified 2026-11-08)

Sources, in order of authority:
- **[S] Live schema**: unauthenticated introspection of `POST https://api.buffer.com` on 2026-11-08. Every type and field name below came from it.
- **[D] Discovery**: `https://auth.buffer.com/.well-known/openid-configuration` (fetched live).
- **[G] Guides**: developers.buffer.com `guides/authentication`, `guides/building-apps`, `guides/api-limits`, and `llms-full.txt` (Error Handling, Character Limits, Tags, Post Metrics, Posts & Scheduling).
- **[R] Official starter**: `bufferapp/buffer-sample-apps/samples/app-client-starter-app/lib/{buffer,config,app}.js`.
- **[H] Buffer Commit Developer Handbook** (Notion).

Anything not confirmed is marked **UNVERIFIED**.

---

## 1. OAuth 2.0 (Authorization Code + PKCE)

| Item | Value | Src |
|---|---|---|
| Authorize | `GET https://auth.buffer.com/auth` | G, D, R |
| Token | `POST https://auth.buffer.com/token` (`application/x-www-form-urlencoded`) | G, D, R |
| Revocation | `https://auth.buffer.com/token/revocation`. Listed in discovery only; no guide documents it (**UNVERIFIED** behaviour) | D |
| Introspection | `https://auth.buffer.com/token/introspection` (discovery only) | D |
| Userinfo / end session | `https://auth.buffer.com/me`, `https://auth.buffer.com/session/end` (discovery only) | D |
| PKCE | **Required for every client, including confidential ones.** `code_challenge_methods_supported: ["S256"]` | H, G, D |
| Client auth | `token_endpoint_auth_methods_supported: ["none","client_secret_post"]`. Send the secret **in the form body**, never HTTP Basic | D, R |

Note: `/.well-known/oauth-authorization-server` advertises only `["none"]`. The OIDC document and the starter both use `client_secret_post`, so follow those.

### Authorize request params (exact)
```
GET https://auth.buffer.com/auth
  ?client_id=YOUR_CLIENT_ID
  &redirect_uri=YOUR_REDIRECT_URI
  &response_type=code
  &scope=account:read posts:write offline_access      # space-separated
  &state=RANDOM_STATE_VALUE
  &code_challenge=CODE_CHALLENGE                       # base64url(SHA-256(verifier)), no padding
  &code_challenge_method=S256
  &prompt=consent
```
The guide and the starter both send `prompt=consent`. In the starter, the verifier is `crypto.randomBytes(32).toString('base64url')` and the challenge is `sha256(verifier).digest('base64url')`.

Callback: `?code=...&state=...`. When the user denies, the callback is `?error=access_denied&state=...` and may also carry `error_description`. Authorize errors: `access_denied`, `invalid_request`, `invalid_client`, `invalid_grant`, `invalid_scope`. Discovery also sets `authorization_response_iss_parameter_supported: true`, so an `iss` param may come back too.

### Scopes
Documented in the guide: `posts:read`, `posts:write`, `ideas:read`, `ideas:write`, `account:read`, `account:write`, `snippets:read`, `snippets:write`, `notes:read`, `notes:write`, `offline_access`.
Advertised by discovery but not in the guide's table: `insights:read`, `engagements:read`, `engagements:write`, `channels:write`, `openid`.

What each operation needs (G):
- Account, organizations and `channels`: `account:read` ("listing channels requires `account:read`")
- `posts` / `post` queries: `posts:read`
- `createPost` / `editPost` / `deletePost`: `posts:write`
- `tagsV2` / `tag`: **`posts:read`** ("Reading tags needs the `posts:read` scope")
- `createTag` / `updateTag` / `deleteTag`: `posts:write`
- Refresh token: `offline_access` (without it, no `refresh_token` is returned)
- `dailyPostingLimits`: **UNVERIFIED** scope (probably `posts:read` or `account:read`; test it)
- The scopes you request must also be enabled on the app client in Settings → API ("Permissions"). Otherwise the result is `invalid_scope`.

The starter requests `account:read posts:write offline_access`. An app that reads past posts and tags also needs `posts:read`.

### Code exchange
```
POST https://auth.buffer.com/token
Content-Type: application/x-www-form-urlencoded

client_id=...&client_secret=...   # confidential only; public clients MUST NOT send it
&grant_type=authorization_code&code=...&redirect_uri=...&code_verifier=...
```
Response (G):
```json
{ "access_token": "eyJhbGciOi...", "refresh_token": "v1.MjAyNi...", "token_type": "Bearer",
  "expires_in": 3600, "scope": "posts:write posts:read ... offline_access" }
```
`refresh_token` is present only when `offline_access` was requested. The access token lasts "about an hour". Store an absolute expiry minus a margin (the starter uses 30 s).

### Refresh
```
POST https://auth.buffer.com/token
client_id=...&client_secret=...(confidential only)&grant_type=refresh_token&refresh_token=...
```
Rotation rules (G, H), quoted:
- "Refresh tokens are single-use. Every successful refresh returns a new refresh_token and invalidates the one you sent."
- "Reusing an old refresh token revokes all tokens for that grant — your user will need to re-authorize."
- "Concurrent refreshes collide." Keep exactly one place that refreshes, persist the new token immediately, and **never retry a failed refresh with the same token**.

Token errors come back as JSON `{ "error": "invalid_grant", "error_description": "Authorization code has expired" }`. Hints from the starter: `invalid_client` means the secret is set or missing for the wrong client type, `invalid_grant` means the code was reused or expired or `redirect_uri` differs, `invalid_scope` means the scope is not enabled on the client, and `unsupported_grant_type`.

### Redirect URI rules (G, H)
- Matched **character for character** in three places: the registered value, the authorize request, and the token exchange. A trailing slash, a different port, a different subdomain, or `127.0.0.1` in place of `localhost` all count as a mismatch (`redirect_uri_mismatch`).
- **HTTPS is required, including localhost** (`http://localhost:3000/callback` is rejected). Use a self-signed cert for local work, e.g. `https://localhost:3000/callback`.
- You can register several URIs (localhost and production).
- Revocation by the user shows up as API `401`. Prompt the user to re-authorize.

### Client types
Private (confidential) clients get a `client_id` and `client_secret`. Public clients get only a `client_id`. The handbook recommends a **private** client for the web apps in this contest. App-client creation limits: Free 1, Essentials 3, Team 5, and Buffer Commit participants get 2 extra (H, G).

---

## 2. GraphQL endpoint
- `POST https://api.buffer.com` (the root URL, with no `/graphql` path). Headers: `Authorization: Bearer <access_token>`, `Content-Type: application/json`. Body: `{"query": "...", "variables": {...}}`.
- Every GraphQL response is **HTTP 200**, including errors. The only exceptions are `429` (rate limit) and `401` (bad or expired token, as handled in the starter).
- Explorer: https://developers.buffer.com/explorer.html (uses a personal key).

---

## 3. Operations (names verified against live schema [S])

Custom scalars: `OrganizationId`, `ChannelId`, `PostId`, `TagId`, `DateTime` (ISO 8601 string, UTC in the examples).

### 3.1 Account + organizations
```graphql
query Account {
  account {
    id email name avatar timezone
    organizations { id name channelCount limits { channels tags scheduledPosts } }
  }
}
```
`Account.organizations(filter: OrganizationFilterInput)` takes `{ organizationId: String! }`. `Organization.id` is `OrganizationId!`.

### 3.2 Channels for an org
```graphql
query Channels($organizationId: OrganizationId!) {
  channels(input: { organizationId: $organizationId }) {
    id name displayName service avatar isDisconnected isLocked isQueuePaused timezone type descriptor
  }
}
```
- `ChannelsInput { organizationId: OrganizationId!, filter: ChannelsFiltersInput }`. Filter fields: `isLocked: Boolean`, `product: Product`.
- Field meanings: `name: String!` is the handle, `displayName: String` is nullable, `service: Service!`, `avatar: String!`, `isDisconnected: Boolean!` ("credentials.invalid"), `isLocked: Boolean!` (a locked channel cannot be used for posting), `isQueuePaused: Boolean!`.
- `enum Service { bluesky facebook googlebusiness instagram linkedin mastodon pinterest startPage substack threads tiktok twitter whatsapp youtube }`
- Single channel: `channel(input: { id: ChannelId! }): Channel!`
- Mastodon char limit: `metadata { ... on MastodonMetadata { maxCharacters serverUrl } }`. `ChannelMetadata` is a union, and `MastodonMetadata` is one of its members [S].

### 3.3 createPost
```graphql
mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    ... on PostActionSuccess { post { id text status dueAt channelId shareMode } }
    ... on MutationError { message }
  }
}
```
Variables (minimal working example from the starter, saved as a draft so nothing publishes):
```json
{ "input": { "channelId": "CH_ID", "text": "Hello", "assets": [], "needsApproval": false,
             "mode": "addToQueue", "schedulingType": "automatic", "saveToDraft": true } }
```
`input CreatePostInput` (exact):
| Field | Type | Notes |
|---|---|---|
| `channelId` | `ChannelId!` | **One channel per post.** There is no `channelIds`; call once per channel, or use `createContentItem` for multi-channel |
| `text` | `String` | For threads it must equal `metadata.<svc>.thread[0]` text |
| `mode` | `ShareMode!` | `addToQueue` \| `customScheduled` \| `shareNext` \| `shareNow` |
| `schedulingType` | `SchedulingType!` | `automatic` \| `notification` (reminder; required for FB Groups and IG personal) |
| `dueAt` | `DateTime` | Required with `customScheduled`, "always in the future" (G) |
| `saveToDraft` | `Boolean` | true gives status `draft`, "Posting limits are not checked", and the post never publishes |
| `needsApproval` | `Boolean!` default `false` | Only when the channel policy requires approval; conflicts with `saveToDraft: false` |
| `assets` | `[AssetInput!]!` default `[]` | The starter sends it explicitly |
| `tagIds` | `[TagId!]` | IDs of existing tags (from `tagsV2`) |
| `metadata` | `PostInputMetaData` | Keys: `bluesky facebook google instagram linkedin mastodon pinterest substack threads tiktok twitter youtube`. **Google Business uses the key `google`**, not `googlebusiness` |
| `ideaId`, `draftId`, `aiAssisted`, `source` | optional | |

`AssetInput { image: ImageAssetInput, video: VideoAssetInput, document: DocumentAssetInput }`. Set one per asset.
- `ImageAssetInput { url: String!, thumbnailUrl, metadata }`
- `VideoAssetInput { url: String!, metadata }`. Do **not** set `thumbnailUrl`, because it is rejected; use `metadata.thumbnailOffset`.
- `DocumentAssetInput { url: String!, title: String!, thumbnailUrl: String! }` (LinkedIn)
- There is no upload endpoint. Media must sit at a public HTTPS URL (H).
- A link card is not an asset. It goes in `metadata.<svc>.linkAttachment` (FB, LinkedIn, Threads, Bluesky) and cannot be combined with a non-empty `assets`.

Metadata the starter treats as **required** per service:
`instagram: { type: "post", shouldShareToFeed: true }`, `facebook: { type: "post" }`, `google: { type: "whats_new" }` (for `googlebusiness` channels), and `youtube: { title }` (≤100 chars, no `<`/`>`).

Result: `union PostActionPayload = PostActionSuccess | NotFoundError | UnauthorizedError | UnexpectedError | RestProxyError | LimitReachedError | InvalidInputError`. All the error types implement `interface MutationError { message: String! }`. Always select `... on MutationError { message }`.

`Post` fields: `id text status dueAt sentAt createdAt updatedAt channelId channelService shareMode schedulingType isCustomScheduled externalLink via tags{...} assets{...} error{ message supportUrl }`. Statuses are `enum PostStatus { draft error needs_approval scheduled sending sent }`.

Related mutations: `editPost(input: EditPostInput!)` (`id: PostId!` plus optional fields; omitted fields are unchanged) returns `PostActionPayload`, and `deletePost(input: { id })` returns `DeletePostSuccess | VoidMutationError`.

### 3.4 Past (sent) posts
```graphql
query SentPosts($org: OrganizationId!, $channelIds: [ChannelId!], $after: String) {
  posts(first: 50, after: $after, input: {
    organizationId: $org
    filter: { status: [sent], channelIds: $channelIds }
    sort: [{ field: createdAt, direction: desc }]
  }) {
    edges { cursor node { id text sentAt channelId channelService externalLink } }
    pageInfo { hasNextPage endCursor }
  }
}
```
- `PostsInput { organizationId!, filter: PostsFiltersInput, sort: [PostSortInput!] }`
- `PostsFiltersInput { channelIds, status: [PostStatus!], dueAt: DateTimeComparator{start,end}, createdAt: DateTimeComparator, dueAtPresence: absent|present, postTypes: [PostType!], tags: TagComparator{ in: [TagId!]!, isEmpty } }`
- `PostSortableKey { dueAt createdAt }`, `SortDirection { asc desc }`. Pagination is forward-only (`first`/`after`). `PostsResults.edges` is nullable.
- **UNVERIFIED**: the maximum `first` for `posts`. Tags and snippets reject more than 100 per page; assume 100 for posts too.
- Scope: `posts:read`.

### 3.5 Tags (early preview; may change without deprecation)
```graphql
query Tags($org: OrganizationId!) {
  tagsV2(first: 100, input: { organizationId: $org }) {
    edges { node { id name color colorName isLocked } }
    pageInfo { hasNextPage endCursor }
    totalCount
  }
}
mutation CreateTag($org: OrganizationId!, $name: String!, $color: String!) {
  createTag(input: { organizationId: $org, tag: { name: $name, color: $color } }) {
    ... on TagActionSuccess { tag { id name color colorName } }
    ... on DuplicateError { message }
    ... on LimitReachedError { message }
    ... on MutationError { message }
  }
}
```
- `TagsInput { organizationId!, filter: { isLocked } }`. Results are sorted by name ascending. `first` > 100 is rejected.
- `TagToCreateInput { name: String! (1–100 chars, exact-match unique), color: String! ("#RRGGBB" only; "#F51" is rejected) }`. The caller must be an org **administrator**.
- `CreateTagPayload = TagActionSuccess | InvalidInputError | DuplicateError | LimitReachedError | NotFoundError | UnauthorizedError | UnexpectedError | RestProxyError`
- Tag limit is **3 on Free and 250 on paid** (`LimitReachedError`). `colorName` is read-only and is null for custom colors.
- Single tag: `tag(input: { id })` returns `Tag` or null plus a `NOT_FOUND` error. `updateTag` replaces both name and color; `deleteTag`.

### 3.6 dailyPostingLimits
```graphql
query Limits($ids: [ChannelId!]!, $date: DateTime) {
  dailyPostingLimits(input: { channelIds: $ids, date: $date }) {
    channelId isAtLimit limit scheduled sent
  }
}
```
All the channels must belong to one org. `date` defaults to now. For X it uses rolling 24 h windows; for other networks it is the channel's local calendar day. `limit: null` means unlimited. These limits are separate from API rate limits.

### 3.7 Character limits from the API (alternative to the static table in section 5)
`configuration(input: { organizationId })` has the shape `{ services { service channelType content { configurationContentTypes rules { property __typename ... on LengthRule { maxLength } ... on CountRule { min max } } } } }`. The `ValidationRule` implementations are `CountRule`, `LengthRule`, `ExclusiveRule`, `RequiresRule`, `FileSizeRule`, `DurationRule`, `FormatRule`. **UNVERIFIED**: I have not run it with a token.

---

## 4. Rate limits and errors

**App client limits** (G, `guides/api-limits`) are per client and shared by every user of the app. They grow with the number of authorized users (up to 1,000 users):
| Window | Base | + per authorized user |
|---|---|---|
| 15 min | 100 | 10 |
| 24 h | 500 | 25 |
| 30 days | 15,000 | 100 |
Example from the guide: 40 users gives 500 / 1,500 / 19,000.

**Conflict:** the Handbook says the "Free Tier gets 100 requests per 15 minutes, 250 per 24 hours, and 3,000 per 30 days". Those numbers match neither table in the guide. Plan defensively against **100/15 min and 250/24 h** until real headers confirm otherwise. The headers are authoritative.

Personal key and MCP limits by plan (not app clients): 15 min 150/450/1,500; 24 h 600/1,800/6,000; 30 days 1,000 per channel (up to 3,000) / 3,000 per channel (up to 30,000) / 10,000 per channel (up to 100,000) for Free/Essentials/Team.

**Headers on every response**, one of each per window:
```
RateLimit:        "150-in-15min";r=98;t=897          # r = remaining, t = seconds to reset
RateLimit-Policy: "150-in-15min";q=150;w=900;pk=:...: # q = quota, w = window seconds (900 / 86400 / 2592000)
```
Match on `w`, not on the policy name. `fetch` joins repeated headers with `, `; split on `/,\s*(?=")/`. Note the space after `;`.

**429** body and headers:
```json
{ "errors": [ { "message": "Too many requests from this client. Please try again later.",
                "extensions": { "code": "RATE_LIMIT_EXCEEDED", "window": "15m" } } ] }
```
`Retry-After: <seconds>` equals `t` of the exhausted policy. A 429 does not consume quota. The guidance is to wait out short values with jitter and surface long ones, which matters on serverless (the starter caps the wait at 5 s).

**Query limits:** cost ≤ 175,000 points, depth ≤ 25, ≤ 30 aliases, ≤ 50 directives, ≤ 15,000 tokens. The error has the form `{"errors":[{"message":"Query exceeds maximum allowed complexity. Please simplify your query."}]}`.

**Error model** (G):
- Typed mutation errors arrive in `data` (`{"data":{"createPost":{"message":"Text is required"}}}`).
- System errors arrive in `errors[].extensions.code`: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `UNEXPECTED`, `RATE_LIMIT_EXCEEDED`.
- Example character-limit error: `{"data":{"createPost":{"message":"LinkedIn posts cannot exceed 3000 characters."}}}`.
- **UNVERIFIED**: the exact message for a past `dueAt` and for posting to a disconnected or locked channel. Both are expected as `InvalidInputError` (or `LimitReachedError`) `message` values in `data.createPost`. Check the `isDisconnected` and `isLocked` flags yourself before posting, as the starter does. A post whose channel later disconnects ends in status `error`, with `Post.error.message`.

---

## 5. Per-network text limits (G, "Character Limits")
| Channel | Post `text` | First comment |
|---|---|---|
| Facebook (pages, groups) | 5,000 | 5,000 |
| Instagram | 2,196 | 2,200 |
| X / Twitter, Free | 280 | – |
| X, Basic/Premium/Premium+ | 25,000 | – |
| LinkedIn | 3,000 | 1,250 |
| Pinterest | 500 | – |
| TikTok photo/text / with video | 4,000 / 2,200 | – |
| Threads | 500 | – |
| Bluesky | 300 | – |
| YouTube (description) | 5,000 | – |
| Google Business Profile | 4,000 | – |
| Mastodon | server `maxCharacters` (default 500, Buffer caps at 20,000) | – |
| Substack | 10,000 | – |

Other field limits: Pinterest and YouTube titles are 100 (YouTube title and description cannot contain `<` or `>`), Threads topics are 50 (no `&` or `.`), and TikTok comments are 150.

How text is counted: most networks count **UTF-16 code units** (JS `string.length`), so emoji and Unicode bold/italic count as 2. Exceptions:
- LinkedIn counts each URL as 24.
- Instagram counts each line break as 2.
- Mastodon counts URLs as 23 and does not count the `@server` part of a mention.
- X uses its own weighted count (URLs 23, emoji 2).
- Bluesky counts graphemes, with a URL counting as the host plus up to 16 characters.
Images and videos do not use characters, except that a video on TikTok lowers the limit.

There is no per-tier character limit for X in the API. The tier is not exposed on `Channel`, so **assume 280**.

---

## 6. Metrics are unavailable to app clients
Quoted from G: "**Post metrics are only available with a personal API key. App Clients cannot read them.** Reading metrics requires the `insightsRead` scope, which an App Client cannot request through OAuth."
H says the same: "Can my app client read post metrics? No." So `Post.metrics`, `metricsUpdatedAt` and `aggregatedPostMetrics` are off-limits to app clients, even though discovery lists `insights:read`.

---

## 7. Gotchas checklist
- Send `assets: []` and `needsApproval: false` explicitly (starter comment: "non-null in the schema"). `mode` and `schedulingType` are required.
- Use `saveToDraft: true` for testing. It validates the post but never publishes.
- Cache `organizationId` and the channel list for the session, because the quota is shared across every user of the client.
- On serverless, keep the PKCE verifier and state in an encrypted cookie or a shared store, not in memory ("Invalid state parameter").
- Keep tokens server side only, with a single refresher per grant.
