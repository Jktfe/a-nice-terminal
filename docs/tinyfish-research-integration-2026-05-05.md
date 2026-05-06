# TinyFish Research Integration Note

Date: 2026-05-05

## Source Check

- TinyFish docs index: https://docs.tinyfish.ai/
- Coding-agent guide: https://docs.tinyfish.ai/for-coding-agents
- Search API: https://docs.tinyfish.ai/search-api
- Fetch API: https://docs.tinyfish.ai/fetch-api
- Browser API: https://docs.tinyfish.ai/browser-api
- MCP integration: https://docs.tinyfish.ai/mcp-integration

## What TinyFish Adds

TinyFish exposes four useful surfaces for ANT research tasks:

- Search: ranked web results with titles, snippets, and URLs.
- Fetch: browser-rendered URL extraction into clean markdown/html/json.
- Agent: natural-language, multi-step web automation with streaming runs.
- Browser: remote Playwright/CDP sessions when ANT needs direct browser control.

The docs recommend MCP for assistant-native use, but ANT should prefer a server-side integration for shared research because it gives one audit trail, one credential boundary, and one place to store sources.

## Recommended ANT Shape

Build this as a research evidence pipeline, not as another hidden browser agent.

First slice:

- Add `TINYFISH_API_KEY` server env support.
- Add `src/lib/server/research/tinyfish.ts`.
- Add `ant research search "query"` backed by TinyFish Search.
- Add `ant research fetch <url...>` backed by TinyFish Fetch.
- Persist each result as ANT evidence: URL, title, snippet/text hash, fetched_at, provider, and request id.
- Emit `research_search` and `research_fetch` run events so results appear in the same timeline as agent work.

Second slice:

- Add `ant research run --url <url> --goal <goal> --schema <json>`.
- Use TinyFish Agent SSE for multi-step extraction.
- Stream status into ANT run events.
- Treat `captcha`, `blocked`, `access denied`, and schema-mismatch as explicit failures, not successful research.
- Open an Ask Queue item when the agent needs credentials, site permission, or human judgement.

Later:

- Add Browser API support only for direct Playwright/CDP jobs that ANT cannot express through Search, Fetch, or Agent.
- Keep browser sessions short-lived and never treat them as general ambient browsing state.

## Policy Boundaries

- Prefer Search + Fetch for normal research; use Agent only for multi-step sites.
- Require a domain allowlist or per-run confirmation for authenticated/private sites.
- Do not pass personal credentials into TinyFish by default.
- Store extracted text and source metadata, not cookies, screenshots with secrets, or raw browser session state.
- Add provider audit fields to research events: `provider=tinyfish`, API surface, goal/query, URL set, result count, failure count, and actor.
- Keep prompt-injection defenses explicit: fetched page text is evidence, not instructions to the ANT agent.

## Why This Fits ANT

TinyFish can make research tasks CLI-obvious and less token-wasteful:

- Agents can ask ANT for `search` and `fetch` outputs instead of ad hoc browser wandering.
- Source capture can become structured evidence for Open Slide, Obsidian, memory, and Ask Queue.
- Research failures become visible timeline events instead of clipped terminal fragments.

Recommended implementation order: Search + Fetch first, Agent SSE second, Browser API last.
