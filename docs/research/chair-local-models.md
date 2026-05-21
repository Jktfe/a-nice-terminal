# Chair Local Models and AFM Routing

Date: 2026-05-16
Author: @evolveantcodex
Status: Decision doc. No implementation claim.
Task: #85

## Purpose

Chair is becoming the premium coordinator that turns room noise into a clean
operator queue: ask dedupe, ask clustering, refinement, answer fan-out, idle
agent suggestions, research verification triage, and permission-safe work
routing.

The premium opportunity is that most Chair work does not need a frontier cloud
model. It needs fast, private, cheap classification and summarisation close to
the user's machine. On Apple platforms, the first-choice runtime should be
Apple Foundation Models when available. On other platforms, or when Apple
Foundation Models is unavailable, Chair should use a local runtime such as
Ollama or llama.cpp before escalating to cloud.

## Recommendation

Implement Chair inference behind a provider-neutral local-model interface with
a server-authored capability object. Native clients render where the work ran:
on device, local LAN/runtime, or cloud. Fallback must be explicit and
auditable, not silent.

Tier boundary:

- OSS/web keeps the raw ask capture, room state, audit rows, and rendering of
  Chair metadata.
- Premium native clients get local Chair inference, offline-capable refinement,
  provider selection, and local-vs-cloud privacy controls.
- Server-side contracts stay shared so web, Tauri, iOS, and Mac render the
  same Chair result and audit note.

This aligns with the current v4 direction:

- `chairStore.ts` already exposes heuristic room digests and a seam for future
  generated summaries.
- `chairEnabledStore.ts` proves Chair should be operator-controllable.
- `chairHandoffStore.ts` already models Chair state and audit per room.
- #86 and #92 established the pattern: server is the authority, clients render
  compact capability/verification objects and do not infer locally.

## Chair Provider Capability Contract

Every active Chair provider should expose this object to clients:

```json
{
  "provider": "apple_foundation_models",
  "providerLabel": "Apple Foundation Models",
  "onDevice": true,
  "offlineAvailable": true,
  "networkScope": "none",
  "maxContextClass": "small",
  "contextWindowTokens": 4096,
  "supportedTasks": [
    "ask_dedupe",
    "ask_clustering",
    "basic_refinement",
    "room_digest",
    "idle_signal_classification"
  ],
  "unsupportedTasks": [
    "large_document_synthesis",
    "deep_research_generation"
  ],
  "fallbackPolicy": "ask_before_cloud",
  "fallbackProvider": "cloud_default",
  "availability": "available",
  "availabilityReason": null,
  "auditNote": "Chair refinement ran on device with Apple Foundation Models."
}
```

Fields:

| Field | Meaning |
|---|---|
| `provider` | Stable enum: `apple_foundation_models`, `ollama`, `llama_cpp`, `cloud_default`, `heuristic`. |
| `providerLabel` | Human label shown in native/web UI. |
| `onDevice` | True only when inference runs on the user's device, e.g. AFM on iOS/macOS. |
| `offlineAvailable` | True when the task can complete with no internet. |
| `networkScope` | `none`, `localhost`, `lan`, or `cloud`. |
| `maxContextClass` | `small`, `medium`, `large`, or `unknown`; clients use this for expectations, not routing. |
| `contextWindowTokens` | Known token window if the provider reports one; null if unknown. |
| `supportedTasks` | Chair tasks this provider is allowed to run. |
| `unsupportedTasks` | Tasks explicitly routed elsewhere. |
| `fallbackPolicy` | `never`, `ask_before_cloud`, `local_then_cloud`, or `cloud_allowed`. |
| `fallbackProvider` | Provider to use if the chosen provider cannot complete the task. |
| `availability` | `available`, `unavailable`, `degraded`, or `checking`. |
| `availabilityReason` | User-visible reason: `device_not_eligible`, `apple_intelligence_off`, `model_not_ready`, `runtime_offline`, `model_missing`, `context_too_small`, `rate_limited`, or null. |
| `auditNote` | Plain-English note stored with the Chair output. |

Clients should display this in a compact privacy badge:

- "On device" for AFM.
- "Local runtime" for localhost Ollama/llama.cpp.
- "LAN runtime" when the model endpoint is another trusted machine.
- "Cloud" only when the user or policy allowed escalation.

## Provider Priority

Recommended runtime order for premium clients:

1. Apple Foundation Models on eligible macOS/iOS/iPadOS devices.
2. Ollama on localhost.
3. llama.cpp server on localhost.
4. Trusted LAN runtime, if configured by the operator.
5. Cloud model only when policy allows it and the UI makes that visible.
6. Heuristic fallback when no model is available and the task can be safely
   approximated without generative output.

This order optimizes for privacy, offline use, latency, then capability.

## Apple Foundation Models

Apple Foundation Models is the best default for native Apple Chair tasks
because it is on device and built into Apple Intelligence-capable platforms.
Apple's documentation positions it for text generation and understanding,
summarization, entity extraction, classification/judgement, refinement, guided
generation, and tool calling. Those map directly to Chair's first premium
slice: dedupe asks, cluster similar questions, refine the canonical wording,
and summarise room state.

Availability must be checked before every session:

- device supports Apple Intelligence.
- Apple Intelligence is enabled.
- model assets are ready.
- requested locale is supported.
- task fits the context window.

Recommended AFM adapter surface:

```ts
type ChairLocalModelProvider = {
  provider: 'apple_foundation_models' | 'ollama' | 'llama_cpp' | 'cloud_default' | 'heuristic';
  getCapabilities(): Promise<ChairProviderCapabilities>;
  runTask<TInput, TOutput>(task: ChairTask<TInput, TOutput>): Promise<ChairTaskResult<TOutput>>;
};
```

Recommended AFM task mapping:

| Chair task | AFM fit | Notes |
|---|---|---|
| Ask dedupe | Strong | Classification and similarity over short text. |
| Ask clustering | Strong | Use guided generation to return cluster ids and canonical wording. |
| Basic refinement | Strong | Rewrite the canonical ask into one clear question. |
| Room digest | Good for short rooms | Use token budget guard and chunk first. |
| Research source triage | Good for metadata | Use AFM to classify, not to invent conclusions. |
| Permission explanation | Good | Explain server-returned capability decisions, not decide them. |
| Large document synthesis | Weak | Route to local/cloud larger-context provider after user-visible policy check. |
| Deep research generation | Weak | Needs source fetching, citations, and verification workflow beyond AFM alone. |

AFM errors should downgrade capabilities, not crash Chair:

| AFM condition | Chair behavior |
|---|---|
| Device not eligible | Mark provider unavailable; offer Ollama/llama.cpp/cloud if configured. |
| Apple Intelligence disabled | Show user-actionable setup message. |
| Model not ready | Mark degraded; retry later; allow local fallback. |
| Context window exceeded | Chunk or route to larger-context provider. |
| Guardrail/refusal | Store refusal in audit; never silently retry in cloud. |
| Rate limited/background limited | Queue task or use local runtime fallback if policy allows. |

## Ollama Runtime

Ollama is the default non-Apple local runtime because it is easy to install and
serves a local API at `http://localhost:11434/api`. Its chat endpoint supports
chat history, tools, JSON/schema output, streaming control, runtime options,
and timing data. It also exposes OpenAI-compatible `/v1` endpoints, which
means the Chair client can reuse a generic OpenAI-compatible adapter when
that is simpler.

Recommended first-pass Ollama configuration:

```json
{
  "provider": "ollama",
  "baseUrl": "http://localhost:11434",
  "model": "qwen3:8b",
  "networkScope": "localhost",
  "fallbackPolicy": "ask_before_cloud",
  "allowedTasks": [
    "ask_dedupe",
    "ask_clustering",
    "basic_refinement",
    "room_digest"
  ]
}
```

Use Ollama's structured outputs for canonical ask objects:

```json
{
  "type": "object",
  "properties": {
    "canonicalQuestion": { "type": "string" },
    "mergedAskIds": {
      "type": "array",
      "items": { "type": "string" }
    },
    "confidence": {
      "type": "number",
      "minimum": 0,
      "maximum": 1
    }
  },
  "required": ["canonicalQuestion", "mergedAskIds", "confidence"]
}
```

Do not assume every Ollama model supports every capability. The provider must
run a startup probe that records:

- model installed.
- chat endpoint reachable.
- structured-output support accepted.
- tool-call support accepted, if needed.
- median latency for a small classification prompt.
- context size if known or configured.

## llama.cpp Runtime

llama.cpp is the lower-level local runtime for users who want direct GGUF
model control, CPU/GPU tuning, or a portable server without Ollama. Its server
provides OpenAI-compatible chat completions, responses, embeddings routes,
tool/function calling, schema-constrained JSON, monitoring endpoints, and
parallel decoding.

Recommended first-pass llama.cpp configuration:

```json
{
  "provider": "llama_cpp",
  "baseUrl": "http://localhost:8080",
  "model": "local-gguf",
  "networkScope": "localhost",
  "fallbackPolicy": "ask_before_cloud",
  "allowedTasks": [
    "ask_dedupe",
    "ask_clustering",
    "basic_refinement"
  ]
}
```

llama.cpp should be treated as expert mode in the first native release:

- user chooses the endpoint.
- user chooses whether LAN endpoints are trusted.
- UI shows that localhost is private to that machine, while LAN sends content
  to another local machine.
- no automatic LAN discovery in v1.
- route through the OpenAI-compatible adapter where possible.

## Cloud Fallback

Cloud fallback is a product and privacy decision, not just a technical retry.

Default policy:

| Tier | Default fallback |
|---|---|
| OSS/web | No local model execution; render existing Chair metadata. |
| Native Solo | Local first; ask before cloud. |
| Native Team | Local first; ask before cloud unless room policy allows cloud. |
| Enterprise | Policy-controlled; cloud may be disallowed per room/source. |

Fallback prompt copy should be explicit:

> Chair can refine this ask locally, but the local model is unavailable. Send
> this room excerpt to the cloud model instead?

The audit row should record:

- requested provider.
- actual provider.
- fallback reason.
- actor who allowed fallback.
- input scope sent.
- timestamp.

## Task Router

Route Chair tasks by capability, privacy policy, and context size:

```ts
type ChairTaskKind =
  | 'ask_dedupe'
  | 'ask_clustering'
  | 'basic_refinement'
  | 'room_digest'
  | 'research_source_triage'
  | 'permission_explanation'
  | 'idle_signal_classification';

type ChairTaskInputScope = {
  roomId: string;
  messageIds?: string[];
  askIds?: string[];
  artefactIds?: string[];
  maxInputChars: number;
};

type ChairTaskDecision = {
  taskKind: ChairTaskKind;
  selectedProvider: ChairProviderCapabilities;
  fallbackProvider?: ChairProviderCapabilities;
  inputScope: ChairTaskInputScope;
  requiresUserConsent: boolean;
  decisionReason: string;
};
```

Routing algorithm:

1. Build the minimum input scope. Prefer ask text and metadata over full room
   transcripts.
2. Load provider capabilities.
3. Filter providers by task support.
4. Filter providers by room policy and user tier.
5. Filter providers by context size.
6. Prefer on-device, then localhost, then trusted LAN, then cloud.
7. If chosen provider is unavailable, apply fallback policy.
8. Store the task decision and audit note with the output.

## Chair Output Types

### Ask Refinement Output

```json
{
  "kind": "ask_refinement",
  "canonicalQuestion": "Should provider icons be native premium only?",
  "mergedAskIds": ["ask_1", "ask_2", "ask_3"],
  "waitingHandles": ["@evolveantcodex", "@evolveantswift"],
  "confidence": 0.88,
  "modelCapability": {
    "provider": "apple_foundation_models",
    "onDevice": true,
    "offlineAvailable": true,
    "networkScope": "none",
    "fallbackPolicy": "ask_before_cloud",
    "auditNote": "Ask clustering ran on device."
  }
}
```

### Room Digest Output

```json
{
  "kind": "room_digest",
  "roomId": "zj4jlety9q",
  "summary": "Codex owns #96; Kimi owns #100; Swift is monitoring native contracts.",
  "needsAttention": [
    {
      "reason": "JWPK ask waiting more than one loop",
      "askId": "ask_123"
    }
  ],
  "modelCapability": {
    "provider": "ollama",
    "onDevice": false,
    "offlineAvailable": true,
    "networkScope": "localhost",
    "fallbackPolicy": "ask_before_cloud",
    "auditNote": "Chair digest ran through local Ollama on this machine."
  }
}
```

## Privacy Model

Chair privacy must be legible:

| Runtime | Privacy label | User meaning |
|---|---|---|
| AFM | On device | Room excerpt never leaves the Apple device for this inference. |
| Ollama localhost | Local runtime | Room excerpt goes to a process on this machine. |
| llama.cpp localhost | Local runtime | Room excerpt goes to a process on this machine. |
| LAN endpoint | Local network | Room excerpt goes to another trusted machine on the network. |
| Cloud | Cloud | Room excerpt leaves local devices and follows cloud provider policy. |

Native premium UI should show this before the first cloud fallback and in the
audit detail after every Chair task.

## Benchmark Plan

V1 benchmarks should be tiny, repeatable, and product-oriented:

| Benchmark | Target |
|---|---|
| Ask dedupe, 20 asks | p50 under 2s local, p95 under 5s local. |
| Ask clustering, 50 asks | p50 under 5s local, p95 under 12s local. |
| Basic refinement | p50 under 1.5s local. |
| Room digest, 30 recent messages | p50 under 5s local. |
| Memory footprint | Must not make the native app unusable while running. |
| Battery/thermal | iOS should defer non-urgent Chair tasks in low power mode. |

Capture per run:

- provider.
- model.
- runtime version.
- device class.
- prompt tokens.
- output tokens.
- latency.
- fallback used.
- error/refusal category.

## Implementation Slices

### S1: Contract and Settings

- Add `ChairProviderCapabilities` and `ChairTaskDecision` types.
- Add native premium settings for provider preference and fallback policy.
- Render provider privacy badge in web/native from stored metadata.
- No model calls yet.

### S2: Heuristic Provider Adapter

- Wrap current `chairStore.ts` heuristic digest as provider `heuristic`.
- Emit the same capability object with `provider: "heuristic"`.
- This keeps OSS/web behavior consistent while premium providers are added.

### S3: Ollama Adapter

- Add localhost Ollama probe.
- Implement ask dedupe and ask clustering with structured JSON output.
- Store audit note with actual provider and latency.

### S4: Apple Foundation Models Adapter

- Add native-only AFM adapter in Mac/iOS targets.
- Gate on AFM availability.
- Implement ask dedupe, clustering, and refinement first.
- Surface unavailable reasons exactly: device not eligible, Apple Intelligence
  off, model not ready, unsupported locale, context too small.

### S5: llama.cpp/OpenAI-Compatible Adapter

- Add OpenAI-compatible local endpoint adapter.
- Support localhost first, trusted LAN later.
- Implement provider probe and model metadata capture.

### S6: Cloud Fallback and Audit

- Add explicit fallback prompts and policy.
- Store fallback audit rows.
- Add "why cloud was used" detail in Chair output UI.

## Open Decisions

1. Whether cloud fallback is allowed by default for Native Solo, or must always
   ask once per room.
2. Whether LAN local-model endpoints are allowed before enterprise permission
   policy exists.
3. Which default Ollama model should ship in recommendations for Mac mini class
   machines.
4. Whether AFM outputs can be cached for Chair ask clustering, or whether
   privacy positioning should avoid persistent local inference caches in S1.

## Sources Checked

- Apple Foundation Models documentation:
  `https://developer.apple.com/documentation/FoundationModels`
- Apple SystemLanguageModel availability and context documentation:
  `https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel`
- Apple Foundation Models task guidance:
  `https://developer.apple.com/documentation/FoundationModels/generating-content-and-performing-tasks-with-foundation-models`
- Ollama API introduction:
  `https://docs.ollama.com/api/introduction`
- Ollama chat endpoint:
  `https://docs.ollama.com/api/chat`
- Ollama OpenAI compatibility:
  `https://docs.ollama.com/api/openai-compatibility`
- llama.cpp server README:
  `https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md`
