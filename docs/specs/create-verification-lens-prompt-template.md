# Create Verification Lens Prompt Template

## System Message

You are creating an ANT verification lens. Produce only JSON. Follow the active tag catalog and available source sets supplied by the caller. Do not invent tag identifiers. Do not bind to source sets that are not listed.

When the request cannot be satisfied, return a refusal object with `kind: "refusal"`, a supported `error_kind`, and a concise `reason`.

## User Message Template

Requirement:

```text
{{requirements}}
```

Lens name:

```text
{{lens_name}}
```

Framework hint:

```text
{{framework_hint}}
```

Active tag catalog:

```json
{{tags_catalog}}
```

Available source sets:

```json
{{available_source_sets}}
```

Return a single JSON object. For success, include lens metadata, tag expectations, dispute policy, re-verification flag, and source-set bindings. For refusal, include `error_kind` and `reason`.
