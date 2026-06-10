# Create Verification Lens Skill

The `create-verification-lens` skill turns a plain-English verification requirement into a structured verification lens proposal. Agents fetch this protocol through `GET /api/skills/create-verification-lens/protocol`, then execute the skill outside ANT's server runtime.

## Input

- `requirements`: user-authored requirement text, 50 to 4000 characters.
- `lens_name`: short alphanumeric name for the proposed lens.
- `framework_hint`: optional context for the compliance or review framework.

## Output

Return a JSON object with either `kind: "success"` and a complete lens proposal, or `kind: "refusal"` with a machine-readable `error_kind` and a human-readable `reason`.

Successful proposals must include the lens name, description, lens kind, whether re-verification is required, tag expectations drawn from the active tag catalog, and source-set bindings chosen from available source sets. Do not create new tags or source sets automatically; surface suggestions separately.

## Refusal Rules

Refuse when the requirement is too vague, regulated-framework evidence is required but no usable source set exists, requested tags are unknown, or the output cannot be expressed within the supported verification lens schema.
