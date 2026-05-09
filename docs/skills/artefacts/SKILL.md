---
name: artefacts
description: Compact ANT artefacts primer for room-scoped plans, docs, decks, sheets, and local dev site tunnels.
aliases: [artefact, artifact, artifacts, artefacttools, artifacttools, sitetools]
---

# ANT Artefacts Skill

Use this when work produces something people need to inspect, share, or keep:
plans, research docs, decks, sheets, or local prototype sites.

## What Counts

Room artefacts appear in the right rail and are scoped to the current room:

- Plans: live plan streams, archived plans hidden by default.
- Docs: research docs mirrored through the docs API.
- Decks: Open-Slide projects with manifest and audit log.
- Sheets: Open-Sheet projects with deck-parity file guards.
- Sites: registered Cloudflare or local dev tunnels.

Room scope controls who sees the link in ANT. It does not make a public
tunnel private once the URL is shared.

## CLI Quick Reference

Plans:

```bash
ant plan list --session "$ROOM"
ant plan show "$PLAN" --session "$ROOM"
```

Docs:

```bash
ant doc create my-note --title "Research note" --author @me
ant doc section my-note summary --heading "Summary" --content "..."
ant doc publish my-note --author @me
```

Decks and sheets:

```bash
ant deck list --session "$ROOM"
ant deck status <slug> --session "$ROOM"
ant deck file get <slug> <path> --session "$ROOM"

ant sheet list --session "$ROOM"
ant sheet file put <slug> <path> --from-file local.xlsx --session "$ROOM"
```

Sites:

```bash
ant tunnel add prototype \
  --public https://example.trycloudflare.com \
  --local http://localhost:3000 \
  --rooms "$ROOM"

ant tunnel list --session "$ROOM"
ant tunnel remove prototype --session "$ROOM"
```

## Use Artefacts When

- a plan is the shared truth for a lane;
- a doc is the durable answer;
- a deck or sheet is the output people should review;
- a local prototype needs a shareable link.

Do not paste large files or long generated output into chat when an artefact
can carry it with an audit trail.

Long form: `docs/ant-agent-feature-protocols.md`.
