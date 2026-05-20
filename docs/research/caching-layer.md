# Premium Caching Layer

Date: 2026-05-16
Author: @evolveantcodex
Status: Decision doc. No implementation claim.
Task: #87

## Purpose

JWPK direction: caching is a paid premium feature. The premium value is not
just faster repeated calls. It is lower model spend, faster research loops,
offline/native responsiveness, and clearer diagnostics for teams doing serious
work.

Caching must cover multiple layers:

- LLM provider prompt-cache alignment.
- ANT-owned LLM response caching.
- Embedding caching.
- Search result caching.
- Chair refinement caching.

It must also expose a quiet client contract so native apps can show cache
status in diagnostics and research panels without polluting normal chat.

## Recommendation

Build caching as a server-authoritative premium capability with shared render
metadata:

1. Provider prompt caching remains provider-owned. ANT shapes prompts to improve
   hit rate and records provider telemetry.
2. ANT-owned caches live in the v4 data plane, keyed by deterministic hashes
   scoped to user, room, org, provider, model, and permission context.
3. Cache reads never bypass permission checks. A cache hit is allowed only if
   the current actor would be allowed to recompute the same result.
4. Clients receive one compact `cacheStatus` object. Normal chat can hide it;
   research/premium diagnostics can show it.
5. OSS can render cache metadata if present, but cache creation, management,
   and premium diagnostics are paid-tier features.

This follows the recent design-doc pattern:

- #85: client-visible provider/privacy metadata.
- #86: server-authored verification badge.
- #92: server-authored capability booleans.

Clients render cache facts; they do not infer them locally.

## Provider Prompt Caching

### OpenAI

OpenAI prompt caching is automatic for supported models and long enough prompts.
Current docs say cache hits require exact prefix matches, static prompt content
should be placed before variable user content, and `cached_tokens` appears in
`usage.prompt_tokens_details`. OpenAI also exposes retention controls:
`in_memory` and `24h`, with model-specific support. ANT should record this
telemetry but should not pretend it owns or can manually purge OpenAI's
provider-side cache.

ANT behavior:

- Put stable system instructions, tool definitions, output schemas, and shared
  research policy at the beginning of prompts.
- Put room-specific messages, current asks, and one-off user text at the end.
- Use a stable `prompt_cache_key` per org/room/workflow where supported.
- Record `cached_tokens`, total prompt tokens, cache retention request, model,
  and provider.
- Treat provider prompt-cache status as telemetry, not as a durable product
  cache.

### Anthropic

Anthropic prompt caching is explicit: cacheable blocks use `cache_control`, and
responses expose cache usage through fields such as
`cache_creation_input_tokens` and `cache_read_input_tokens`. Anthropic supports
ephemeral cache behavior and extended TTL options. ANT should use this for
large static prefixes: project instructions, tool descriptions, research
rubrics, and long reference packs.

ANT behavior:

- Mark only stable blocks with `cache_control`.
- Avoid caching volatile room messages as a static block.
- Record cache creation and cache read token counts.
- Keep provider-cache telemetry separate from ANT-owned result caches.

## Cache Types

### 1. LLM Response Cache

Purpose: avoid paying for identical deterministic prompts where the output is
safe to reuse.

Good fits:

- deterministic classification.
- policy explanation over stable inputs.
- low-temperature canonical ask refinement.
- stable extract/transform operations.

Bad fits:

- high-temperature creative writing.
- live research where source freshness matters.
- outputs that depend on "current" external state.
- prompts with missing permission/audit context.

Cache key fields:

```ts
type LlmResponseCacheKey = {
  kind: 'llm_response';
  tenantId: string;
  userId: string;
  roomId?: string;
  provider: string;
  model: string;
  modelVersion?: string;
  systemPromptHash: string;
  toolSchemaHash: string;
  inputHash: string;
  outputSchemaHash?: string;
  temperature: number;
  topP?: number;
  seed?: number;
  permissionScopeHash: string;
  privacyScope: 'user' | 'room' | 'org';
};
```

Only cache requests with deterministic or near-deterministic settings:

- `temperature <= 0.2`.
- no real-time clock dependency.
- no unscoped external fetch dependency.
- no unresolved permission decision.

### 2. Embedding Cache

Purpose: avoid re-embedding the same text repeatedly and support persistent
semantic search.

Provider docs position embeddings as vector representations for search,
clustering, recommendations, anomaly detection, diversity measurement, and
classification. That maps directly to ANT memory recall, artefact search,
research source clustering, and Chair ask clustering.

Cache key fields:

```ts
type EmbeddingCacheKey = {
  kind: 'embedding';
  tenantId: string;
  provider: string;
  model: string;
  dimensions: number;
  inputTextHash: string;
  normalizationVersion: string;
};
```

Store:

- hash of normalized text.
- provider/model/dimensions.
- vector bytes.
- source resource id.
- permission scope.
- created/last-used timestamps.

Invalidation:

- text change -> new hash, old vector becomes unused.
- delete/tombstone -> vector excluded from search immediately.
- permission revoke -> vector may remain stored but is not returned for actors
  who lost access.
- model/dimensions change -> separate cache namespace.

### 3. Search Result Cache

Purpose: make repeated room/research searches fast without hiding stale data.

Good fits:

- search query repeated inside a room.
- research source search with fixed filters.
- memory recall with unchanged corpus version.
- artefact list/search by type.

Cache key fields:

```ts
type SearchResultCacheKey = {
  kind: 'search_result';
  tenantId: string;
  actorHandle: string;
  roomId?: string;
  queryHash: string;
  filtersHash: string;
  corpusVersion: string;
  permissionScopeHash: string;
};
```

TTL defaults:

| Surface | Default TTL |
|---|---|
| Room message search | 30 seconds |
| Memory recall | 2 minutes |
| Artefact list/search | 1 minute |
| Research source search | 5 minutes |
| External web/search connector | Provider-specific, max 15 minutes unless source says otherwise |

Invalidation events:

- new message in scoped room.
- message deleted/tombstoned.
- memory create/edit/delete.
- artefact create/delete/update.
- permission grant/revoke.
- plan/task dependency or priority update when task search is cached.

### 4. Chair Refinement Cache

Purpose: keep Chair ask clustering/refinement cheap and stable.

Cache key fields:

```ts
type ChairRefinementCacheKey = {
  kind: 'chair_refinement';
  roomId: string;
  openAskSetHash: string;
  chairPolicyHash: string;
  provider: string;
  model: string;
  outputSchemaHash: string;
  privacyScope: 'room' | 'user';
};
```

Invalidation:

- new ask opened.
- ask answered/dismissed.
- Chair handoff changes policy.
- premium/local-model provider changes.
- room permission context changes.

Chair cache results should include the #85 model capability object so users can
see whether the refinement was local, on-device, LAN, or cloud.

## Storage Layer

### Recommended V1: SQLite

Use SQLite first because the current v4 data plane is SQLite-heavy and local
native deployments benefit from a single portable file. Add dedicated cache
tables instead of hiding cache rows in existing domain tables.

Suggested tables:

- `cache_entries`
- `cache_events`
- `embedding_cache_entries`
- `cache_corpus_versions`

`cache_entries`:

```ts
type CacheEntry = {
  id: string;
  tenantId: string;
  cacheKind: 'llm_response' | 'search_result' | 'chair_refinement';
  cacheKeyHash: string;
  privacyScope: 'user' | 'room' | 'org';
  sourceScope: 'message' | 'room' | 'memory' | 'artefact' | 'research' | 'chair';
  valueJson: string;
  valueHash: string;
  permissionScopeHash: string;
  createdAtMs: number;
  expiresAtMs: number | null;
  lastHitAtMs: number | null;
  hitCount: number;
  invalidatedAtMs: number | null;
  invalidatedReason: string | null;
};
```

`cache_events`:

```ts
type CacheEvent = {
  id: string;
  cacheEntryId: string | null;
  actorHandle: string;
  event: 'hit' | 'miss' | 'write' | 'refresh' | 'stale' | 'invalidate' | 'deny';
  reason: string;
  atMs: number;
  costSavedEstimateUsd?: number;
  latencySavedEstimateMs?: number;
};
```

### Redis Later

Redis becomes useful for shared enterprise deployments or multi-server cloud
hosting. Do not start there for local/native premium because it adds ops
surface and weakens the "portable self-hosted" story.

Use Redis later for:

- short-lived search-result caches.
- distributed cache locks.
- high-volume team deployments.
- rate-limited prewarming.

Keep embeddings in SQLite/vector storage, not Redis, unless a deployment
explicitly provisions a vector database.

### In-Memory Cache

Use in-memory only for short request coalescing:

- dedupe simultaneous identical work.
- prevent a thundering herd while one request computes.
- never treat in-memory rows as durable savings evidence.

## Cache Status Contract

Native/client angle from Swift: cache status should be renderable but not
noisy. It belongs in premium diagnostics, research panels, and detailed audit
views, not every normal chat message.

```json
{
  "status": "hit",
  "ageMs": 42000,
  "sourceScope": "research",
  "privacyScope": "room",
  "providerCache": {
    "provider": "openai",
    "cachedInputTokens": 1920,
    "retention": "in_memory"
  },
  "antCache": {
    "cacheKind": "chair_refinement",
    "cacheKeyId": "cache_123",
    "ttlMs": 300000,
    "hitCount": 4
  },
  "costSavedEstimate": {
    "inputTokens": 1920,
    "usd": 0.0142
  },
  "auditLink": "/cache/cache_123/audit"
}
```

Fields:

| Field | Meaning |
|---|---|
| `status` | `hit`, `miss`, `refreshed`, `stale`, `bypass`, or `denied`. |
| `ageMs` | Age of the ANT-owned cached value, null for miss. |
| `sourceScope` | What kind of surface produced the cached output. |
| `privacyScope` | `user`, `room`, or `org`. |
| `providerCache` | Provider-side telemetry such as cached tokens. |
| `antCache` | ANT-owned cache entry metadata. |
| `costSavedEstimate` | Approximate saved input tokens and currency. |
| `auditLink` | Stable audit detail route. |

Render defaults:

- Chat message: hide unless user opens details.
- Research panel: show small "cached" badge when status is hit/refreshed.
- Premium diagnostics: show full object.
- Enterprise admin: show aggregate hit rate and savings.

## Premium Gate

OSS:

- can render `cacheStatus` if returned.
- can use provider prompt-cache telemetry only as passive usage fields.
- does not manage persistent ANT caches.
- does not expose cache prewarm/refresh controls.

Premium native:

- enables persistent embedding and Chair refinement caches.
- exposes local/offline cache controls.
- shows cache diagnostics and savings.
- supports manual refresh and scoped purge.

Enterprise:

- org-level cache policy.
- cache residency policy.
- per-source TTL rules.
- admin purge and audit export.
- Redis/distributed cache option.

## Privacy and Security

### Tenant Isolation

Every cache key must include tenant/org and permission scope. Never share
cached results across users unless the privacy scope explicitly allows room or
org sharing and the current actor passes the same capability check.

### Permission Scope Hash

Cache keys must include `permissionScopeHash`, derived from:

- actor handle.
- room membership.
- grants/revocations relevant to the source set.
- resource ids used.
- action class: find/preview/share/edit/export/remember.

If the permission scope changes, the cache key changes or the row is denied.

### Cache Poisoning

Risks:

- malicious prompt creates a cached answer reused in a trusted context.
- stale search results hide a newer correction.
- revoked material remains accessible through cached output.

Mitigations:

- include source hashes and permission scope in keys.
- keep TTLs short for search results.
- tombstone/delete invalidates all derived cache entries.
- store `valueHash` and source ids for audit.
- never cache outputs from untrusted raw terminal bytes without a high-trust
  parsed source.

### Deletion and Memory Hygiene

JWPK's delete/memory concern means deleted messages must not keep influencing
cache outputs. When a message is tombstoned:

- search caches for that room become stale immediately.
- Chair refinement caches that included the message become stale.
- embeddings from that message are excluded from retrieval.
- LLM response cache rows with that message id in source metadata are denied
  and then invalidated.

## Telemetry and Cost Savings

Record both provider-side and ANT-owned cache events:

```ts
type CacheTelemetry = {
  provider: string;
  model: string;
  status: 'hit' | 'miss' | 'refreshed' | 'stale' | 'bypass' | 'denied';
  promptTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
  estimatedCostSavedUsd: number;
};
```

Cost-savings projection:

- For provider prompt caches, use provider usage fields such as cached-token
  counts and pricing tables.
- For ANT response caches, estimate saved full request cost for a hit.
- For embeddings, estimate saved embedding call cost and vector-store write.
- For search caches, estimate latency saved rather than model cost.

Dashboard aggregates:

- hit rate by cache kind.
- savings by provider/model.
- latency saved.
- stale/denied counts.
- top invalidation causes.

## Invalidation Strategy

Use event-driven invalidation plus TTL.

| Event | Cache effect |
|---|---|
| Message create | Invalidate scoped room search and Chair digest/refinement caches. |
| Message delete/tombstone | Invalidate derived caches and deny rows that cite deleted message ids. |
| Memory create/edit/delete | Invalidate memory recall/search and dependent embeddings. |
| Artefact create/delete/update | Invalidate artefact searches and research source packs. |
| Permission grant/revoke | Invalidate or deny entries with affected `permissionScopeHash`. |
| Research confirmation changes | Invalidate research answer cache and badge cache. |
| Chair policy/provider changes | Invalidate Chair refinement cache namespace. |
| Model version changes | New namespace; old rows can age out. |

Prefer stale-while-refresh for premium UI:

- serve cached result if within TTL.
- mark stale if TTL elapsed but no invalidating event occurred.
- refresh in background only for premium/native contexts where policy permits.
- never stale-serve after permission revoke or tombstone.

## Implementation Slices

### S1: Cache Contract and Telemetry

- Add `CacheStatus` type.
- Attach cache telemetry to provider calls without storing durable values.
- Render cache status in diagnostics/research detail only.

### S2: Search Result Cache

- Implement SQLite `cache_entries` and `cache_events`.
- Cache scoped search/memory recall results with short TTLs.
- Invalidate on message, memory, artefact, and permission changes.

### S3: Embedding Cache

- Add `embedding_cache_entries`.
- Cache text-to-vector outputs by provider/model/dimensions/text hash.
- Ensure tombstones and permission revokes exclude vectors from results.

### S4: Chair Refinement Cache

- Cache ask clustering/refinement by open-ask-set hash and Chair policy.
- Include #85 model capability and privacy metadata in cached outputs.
- Surface cost and latency saved in premium diagnostics.

### S5: LLM Response Cache

- Cache only deterministic, permission-safe response classes.
- Add per-kind allowlist.
- Add manual refresh and purge for premium native.

### S6: Enterprise Policy

- Add org-level cache policy.
- Add admin purge/export.
- Add optional Redis backend for distributed deployments.

## Open Decisions

1. Whether Native Solo should enable persistent response caching by default or
   start with embeddings/search/Chair only.
2. Whether room-shared cache entries are allowed before the #92 permissions
   engine is implemented, or whether V1 must stay user-scoped.
3. Whether enterprise customers can require "no cloud provider prompt cache"
   for sensitive rooms even when provider terms allow it.
4. Which dashboard should show savings first: research panel, settings
   diagnostics, or Chair admin view.

## Sources Checked

- OpenAI prompt caching:
  `https://platform.openai.com/docs/guides/prompt-caching`
- OpenAI embeddings:
  `https://platform.openai.com/docs/guides/embeddings`
- Anthropic prompt caching:
  `https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching`
- Existing ANT docs:
  `docs/research/chair-local-models.md`, `docs/research/research-mode.md`,
  `docs/research/agent-permissions.md`
