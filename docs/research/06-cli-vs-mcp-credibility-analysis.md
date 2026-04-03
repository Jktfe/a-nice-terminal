# CLI vs MCP Reliability Claims: Credibility Analysis

> Follow-up research conducted April 2026 to verify claims used in the synthesis document.

## The "100% vs 72%" Reliability Claim

### Origin

The statistics trace back primarily to **Anthropic's internal evaluations** (early 2025), presented when explaining why Claude Code chose CLI tools over MCP for core operations.

### Methodology Concerns

**What we know:**
- Internal Anthropic benchmarks, not independent third-party audits
- Tasks: agentic coding workflows (commits, PRs, codebase search, file operations)
- "Reliability" = given well-formed intent, does the tool call succeed end-to-end?
- The 72% figure aggregates across multiple MCP server implementations

**What we do NOT know:**
- Exact number of trials/tasks
- Whether the comparison was strictly apples-to-apples (same model, same prompts)
- Variance (72% +/- 5% or +/- 20%?)
- Which MCP server implementations were tested
- Whether failures were protocol-level or implementation-level

### Critical Assessment

**This is a single-source statistic from a party with a vested interest.** No independent replication exists in public literature as of early 2026.

The comparison may be unfair to MCP at that point in time. MCP was months old; CLI tools like `git` and `grep` have decades of stability. The failure modes matter — if MCP's 28% failure rate was mostly schema/token budget issues, that's a solvable engineering problem, not a fundamental flaw.

## The "~55,000 Tokens of Schema" Claim

Refers to the **GitHub MCP server's** full `tools/list` response. **Plausible and likely accurate** — the GitHub API is enormous. At ~4 chars/token, 55,000 tokens ≈ 220,000 characters of JSON schema.

**Context**: This is a worst case for a maximally broad server. Well-designed MCP servers can curate smaller surfaces. MCP's spec has since evolved to address this (tool filtering, pagination, dynamic registration).

## What Major AI Tools Actually Recommend (2025-2026)

- **Claude Code**: Hybrid — CLI for core operations, MCP as extension mechanism. MCP is NOT deprecated.
- **Cursor**: Supports MCP for user extensions. Core operations are built-in tools.
- **Windsurf**: Adopted MCP as part of extensibility story.
- **Broader ecosystem**: Microsoft, JetBrains added MCP support. Streamable HTTP transport replaced SSE. OAuth auth added.

## Counter-Arguments to "CLI > MCP"

1. **Apples-to-oranges**: CLI works for tasks with existing command-line tools. MCP is for services without CLIs.
2. **MCP has improved**: Server quality, spec maturity, and client handling have all improved since early benchmarks.
3. **CLI has hidden costs**: Model needs training-time knowledge of CLI syntax. MCP is self-describing.
4. **Schema overhead is solvable**: Tool filtering, lazy loading, server-side curation.
5. **CLI parsing is fragile in its own way**: Unstructured output can fail silently. MCP returns structured JSON.

## Recommended Framing

**They are complementary, not competing.** CLI tools offer reliability for tasks where mature CLIs exist. MCP's value is extensibility to novel integrations. For ANT specifically, terminal session management is a perfect CLI use case.

When citing: attribute to Anthropic's internal evaluations, note the timeframe (early MCP era), and note the absence of independent replication.
