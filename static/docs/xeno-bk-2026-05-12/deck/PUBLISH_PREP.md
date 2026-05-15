# Publish prep — `xeno-bk-pitch` first publish

> Prep + propose only. **Do not execute** until @James greenlights. xenoCC's call on whether timing matters (e.g. align with the `v1.1.0-preview` tag on `vendor_entitlement_audit`).
>
> Per xenoCC's earlier ANT primitive guidance:
> - **First** `file put` under a fresh slug **implicitly creates the deck** — no `--base-hash` / `--if-match-mtime` needed on round 1.
> - **Subsequent edits** require `file get` first to capture the current sha + mtime, then `file put` with `--base-hash <sha> --if-match-mtime <mtime>` to prevent stomping concurrent edits.
> - **Audit trail** retrievable via `antchat deck <room> audit <slug>`.

## Pre-flight check (zero-cost)

```bash
# Verify the slug doesn't already exist (we should see an empty / 404 / "not found" response)
antchat deck w5hMngV_jp8k5NmRcPVya audit xeno-bk-pitch
```

Expected: empty audit trail. Room `w5hMngV_jp8k5NmRcPVya` has had zero decks per xenoCC's recon. If the slug *does* return entries, **stop** and reconcile — we'd be overwriting or merging into someone else's deck.

## Publish ordering (proposed)

Twelve slides first (in numerical order), `index.md` last. Rationale: `index.md` lists each slide's status (currently all "draft"); we want it to be the *final* file landed so anyone viewing the deck via antchat hits a manifest that accurately reflects what's already there. If `index.md` lands first and a slide upload fails mid-sequence, the manifest claims content that doesn't exist yet — confusing for any viewer.

Drop into your antchat-capable terminal. **One-shot block** so the sequence runs atomically:

```bash
SLUG="xeno-bk-pitch"
ROOM="w5hMngV_jp8k5NmRcPVya"
cd /Users/jamesking/CascadeProjects/xenoMCP/docs/deck   # or the Windows-side path

for f in 01-cover.md 02-proposition.md 03-what-youve-built.md \
         04-architecture.md 05-customers.md 06-compliance.md \
         07-vendor-cost.md 08-market.md 09-what-we-built.md \
         10-dco-visibility.md 11-ai-thesis.md 12-path-forward.md \
         index.md; do
  echo "Publishing $f..."
  antchat deck "$ROOM" file put "$SLUG" "$f" --from-file "$f"
done
```

If a single-file failure mid-loop is a concern, swap the loop for explicit lines so a hang or 4xx halts the rest and the operator can resume:

```bash
antchat deck w5hMngV_jp8k5NmRcPVya file put xeno-bk-pitch 01-cover.md          --from-file docs/deck/01-cover.md
antchat deck w5hMngV_jp8k5NmRcPVya file put xeno-bk-pitch 02-proposition.md    --from-file docs/deck/02-proposition.md
antchat deck w5hMngV_jp8k5NmRcPVya file put xeno-bk-pitch 03-what-youve-built.md --from-file docs/deck/03-what-youve-built.md
antchat deck w5hMngV_jp8k5NmRcPVya file put xeno-bk-pitch 04-architecture.md    --from-file docs/deck/04-architecture.md
antchat deck w5hMngV_jp8k5NmRcPVya file put xeno-bk-pitch 05-customers.md       --from-file docs/deck/05-customers.md
antchat deck w5hMngV_jp8k5NmRcPVya file put xeno-bk-pitch 06-compliance.md      --from-file docs/deck/06-compliance.md
antchat deck w5hMngV_jp8k5NmRcPVya file put xeno-bk-pitch 07-vendor-cost.md     --from-file docs/deck/07-vendor-cost.md
antchat deck w5hMngV_jp8k5NmRcPVya file put xeno-bk-pitch 08-market.md          --from-file docs/deck/08-market.md
antchat deck w5hMngV_jp8k5NmRcPVya file put xeno-bk-pitch 09-what-we-built.md   --from-file docs/deck/09-what-we-built.md
antchat deck w5hMngV_jp8k5NmRcPVya file put xeno-bk-pitch 10-dco-visibility.md  --from-file docs/deck/10-dco-visibility.md
antchat deck w5hMngV_jp8k5NmRcPVya file put xeno-bk-pitch 11-ai-thesis.md       --from-file docs/deck/11-ai-thesis.md
antchat deck w5hMngV_jp8k5NmRcPVya file put xeno-bk-pitch 12-path-forward.md    --from-file docs/deck/12-path-forward.md
antchat deck w5hMngV_jp8k5NmRcPVya file put xeno-bk-pitch index.md              --from-file docs/deck/index.md
```

## Local state snapshot (at prep time, 2026-05-11)

For the RMW protocol on round-2 edits, capture these now. Any subsequent `file put` for one of these paths must include `--base-hash` matching its current server-side hash (which after round-1 will equal the local sha256 below) and `--if-match-mtime` matching the server's recorded mtime.

| Slide path | Lines | sha256 (12-char prefix) | local mtime |
| --- | --- | --- | --- |
| `01-cover.md` | 16 | `3f7a77a9136c…` | 2026-05-11 19:35:18 |
| `02-proposition.md` | 22 | `539336b303ac…` | 2026-05-11 19:35:28 |
| `03-what-youve-built.md` | 44 | `297bb4c799bb…` | 2026-05-11 19:35:40 |
| `04-architecture.md` | 53 | `5db7fe6c62d2…` | 2026-05-11 19:35:53 |
| `05-customers.md` | 43 | `2f3e4412ebf6…` | 2026-05-11 19:38:05 |
| `06-compliance.md` | 33 | `c558d632cb53…` | 2026-05-11 19:38:05 |
| `07-vendor-cost.md` | 61 | `71a1a077f139…` | 2026-05-11 19:47:11 |
| `08-market.md` | 49 | `41dd408024ea…` | 2026-05-11 19:38:05 |
| `09-what-we-built.md` | 56 | `688a1fbdf212…` | 2026-05-11 19:38:56 |
| `10-dco-visibility.md` | 56 | `06f114357172…` | 2026-05-11 19:47:11 |
| `11-ai-thesis.md` | 84 | `6fbaf78ef199…` | 2026-05-11 19:47:11 |
| `12-path-forward.md` | 70 | `dc377a6def99…` | 2026-05-11 19:40:00 |
| `index.md` | 41 | `ee6779191050…` | 2026-05-11 19:35:13 |
| **Total** | **628** | — | — |

(Regenerate with `shasum -a 256 *.md` + `stat -f '%Sm' *.md` if any slide has been edited since prep.)

## Post-publish verification

```bash
# Should show 13 file entries with timestamps
antchat deck w5hMngV_jp8k5NmRcPVya audit xeno-bk-pitch
```

Expected: 13 entries (12 slides + index.md), each with a hash and the publisher's identity. If any entry is missing or marked failed, re-run that file with `file put` (round-1 protocol still applies because the file path didn't land).

## Read-modify-write protocol (for edits after first publish)

When any single slide needs an update after the first publish:

```bash
# 1. Fetch current server-side hash + mtime
antchat deck w5hMngV_jp8k5NmRcPVya file get xeno-bk-pitch 07-vendor-cost.md > /tmp/current-07.md
SERVER_HASH=$(...)  # antchat CLI should expose this; fall back to: shasum -a 256 /tmp/current-07.md
SERVER_MTIME=$(...) # ditto for mtime

# 2. Make local edits
$EDITOR docs/deck/07-vendor-cost.md

# 3. Push with concurrency guard
antchat deck w5hMngV_jp8k5NmRcPVya file put xeno-bk-pitch 07-vendor-cost.md \
  --from-file docs/deck/07-vendor-cost.md \
  --base-hash "$SERVER_HASH" \
  --if-match-mtime "$SERVER_MTIME"
```

The `--base-hash` + `--if-match-mtime` guards prevent silently stomping a concurrent edit by another agent (or James editing via the antchat UI). If they don't match, the server returns a conflict; resolve locally with `file get` again, merge, and re-push.

## Rollback strategy

If round-1 publish goes wrong (wrong slug, wrong room, wrong content), there's no `antchat deck delete-slug` per the recon. Options:

1. **Re-publish with corrected content** — same RMW protocol works; the audit trail records both versions, which is acceptable for an internal/James-only audience.
2. **Ask the ANT team to drop the slug server-side** if the wrong content is sensitive or confusing.

This is one of the reasons "Don't actually publish until James greenlights" is the contract for round 1.

## Decisions waiting on @James

1. **Publish timing** — now, or wait for the `v1.1.0-preview` tag on xenoCC's `vendor_entitlement_audit` so the deck reflects 17-tools-shipped before BK sees it?
2. **Publish operator** — who runs the loop? James, xenoCC (terminal already on the Tailnet host), or me (Mac mini, antchat CLI confirmed working for chat-send, untested for `deck file put`)?
3. **Whether to publish at all before BK** — alternative is GitHub repo as the canonical view, antchat deck as a follow-up after the meeting if BK wants ongoing access.
