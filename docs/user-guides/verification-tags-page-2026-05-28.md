# The Verification Tags page

**Audience:** org admins, content reviewers, dispute lodgers, and anyone with read access to a room who wants to see *what counts as verified* and *who decided it*.
**You should know:** how to send a message in ANT, what a tag and a lens are (see the [verification tags and lenses guide](./verification-tags-and-lenses-2026-05-28.md)). You don't need to be technical to read this page; you need to be an org admin on a premium tier to write to it.
**Plan milestone:** G3 (`ant-verification-2026-05-28`)

---

## What this page does

The Verification Tags page is the single operations surface for your org's verification governance. From here you **browse** every tag visible to you, **author** new tags (if you're an org admin on a premium tier), and **audit** the complete history of every tag definition, application, verification, dispute, and override that's ever touched content you can see.

It is the human-facing counterpart to everything an agent does when it pulls a skill, applies tags, or records a verification observation. Both routes — a person clicking through this page, or an agent pulling the same skill from the registry — write to the same audit substrate. The page is what makes the audit trail *interactive*, not just inspectable.

---

## Getting here

- **iOS antios:** Settings → Verification → Tags
- **Mac antchat:** Settings → Verification → Tags
- **Web (your org dashboard):** Verification → Tags
- **CLI:** `ant tags list`

The page state is consistent across all four entry points — open it on iOS and the same tag list, audit feed, and pending dispute count surface on Mac and web. There is no separate "iOS-only" or "Mac-only" view.

---

## The three views

The page is structured as three tabs. All three are visible to anyone with room/org read access; only the **Author** tab requires premium-tier org-admin authorisation (and that authorisation is enforced by the server, not just hidden in the UI — more on this in *Permissions* below).

### Browse — everyone with read access

The Browse view lists every tag visible to you: the ~25 ANT defaults (under the `ant.*` namespace) plus everything under your org's namespace (`org.<yourOrg>.*`).

**What you see in the list:** tag id (e.g. `ant.claim.factual`, `org.acme.brandGuidelines.numberFormat`), human-readable label, category badge (claim, source, link, data, identity, content, context, process), namespace badge (blue for `ant.*`, purple for `org.*`), current version, deprecation indicator, and "Used in N lenses" count.

**Filters:** namespace, category, protocol class (deterministic / heuristic / judgement-required / consensus-required), active vs deprecated, and free-text search across id + label + definition.

**Tap-through:** opening a tag gives you its full definition, the detection rule, the allowed protocol classes (a tag can carry more than one — e.g. `ant.claim.factual` is `deterministic` when a primary source is attached, `heuristic` otherwise), the version history (every create, edit, deprecate, restore with handler and timestamp), the dependency graph (which lenses reference this tag — see below), and the last 20 applications with timestamps and scopes.

**Per-platform shape:**

- **iOS:** native list; tapping a row pushes the detail view as a sheet you swipe down to dismiss
- **Mac antchat:** list on the left, detail panel on the right; selecting a row updates the right pane (no modal)
- **Web:** master/detail layout matching the Mac shape

Concrete example: an editor on the brand team taps `org.acme.brandGuidelines.numberFormat`, sees that 3 lenses reference it (`acme-public-blog`, `acme-investor-deck`, `acme-board-pack`), and decides not to deprecate it after all.

### Author — org admins on the premium tier

The Author view is a 5-step wizard for creating a new org-scoped tag (or editing an existing one — editing publishes a new version, it never silently overwrites). Tags are **never hard-deleted**; deprecating a tag blocks new applications while leaving every historical application interpretable against its pinned version.

**The five steps:**

1. **Identity** — Name (auto-prefixed `org.<yourOrg>.`), human-readable label, definition (what this tag actually means), category picker.
2. **Detection** — Kind (regex, parser, manual-only, or "ask an agent" — which dispatches a task to a terminal that pulls the relevant skill), the spec for that kind, and an inline tester you can paste sample content into to see what the rule catches.
3. **Verification** — Multi-select chips for the allowed protocol classes (you can pick more than one), the operation description (what a verifier is actually checking), and the evidence shape builder (what fields any verification observation against this tag must carry).
4. **Failure modes** — Free-text list, one per line. What does it look like when this tag is applied incorrectly? What does it look like when verification fails? This is the human guidance that helps reviewers reason about disputes.
5. **Review + Save** — Summary card showing exactly what will be published, the affected lens count from the dependency graph, and a **Publish v1** (or **Publish vN+1** for edits) button.

**Per-platform shape:**

- **iOS:** paginated sheet wizard. Each step is a separate page; you swipe forward or tap **Next**. The wizard autosaves on every step transition and on dismiss, so accidentally closing the sheet doesn't lose work. Resume from the room shelf or the Author tab.
- **Mac antchat / web:** single-page form with live preview. The five steps are sections you scroll through; the preview pane on the right updates as you type, showing what the tag's detail surface will look like after publish.

**Editing an existing tag:**

Editing publishes a new version (e.g. v2 → v3). The old version is retained forever so verifications run against v2 stay interpretable. The Author wizard pre-fills with the latest version's fields; you change what you need to and **Publish vN+1**.

**Deprecating a tag:**

Deprecation requires a reason (free-text, mandatory). Deprecated tags can't accept new applications; existing applications keep working against their pinned version. Restoring a deprecated tag also requires a reason and is itself an audit event.

**No hard delete.** Anywhere. Ever.

### Audit — everyone with read access

The Audit view is the chronological feed of every verification-relevant action across all tags you can see. It is the "what just happened, and who did it" surface.

**What appears in the feed:** tag definition events (create, edit, deprecate, restore); tag applications (an agent or human attached a tag); verification observations (pass, fail, dispute, insufficient_evidence, retag_required); per-application protocol-class overrides; disputes lodged; lens-row changes; source-set changes.

**Each row carries:** actor handle + kind (`agent`, `human`, `system`, `automated`); timestamp (relative, with absolute on hover or long-press); action verb (Applied, Verified, Disputed, Overrode, Created, Edited, Deprecated); target reference; and reason text where one was recorded.

**Filters:** by tag, by actor, by scope (room / artefact / file), and by time window (last hour, day, week, custom).

**Per-platform shape:**

- **iOS:** filterable list, pull-to-refresh, tap a row → expanded detail sheet showing the full observation including any evidence references and the before/after state.
- **Mac / web:** filterable list with persistent filter sidebar; selecting a row updates the right pane.

Concrete example: after a board pack lens runs, the audit feed shows 41 tag applications, 38 pass observations, 2 insufficient-evidence observations, and 1 disputed source — each as its own row with who did what.

---

## Per-application protocol-class override

Sometimes a tag fires on content that shouldn't actually be verified — a joke in a chat message, a hypothetical in a brainstorm, an obvious placeholder. The override flow exists for exactly these cases.

**How to override (the "joke flagged as ignorable" case):**

1. Find the tag chip on the content (long-press on iOS, right-click on Mac/web).
2. Choose **Override protocol class** from the action sheet.
3. Pick the new class. The canonical choice for jokes/hypotheticals is `process.flagged-ignorable`, but the four real classes (deterministic, heuristic, judgement-required, consensus-required) are available if the application truly belongs in a different class.
4. **Provide a reason.** The submit button stays disabled until the reason field has at least one character. There is no skip-reason path.
5. Submit. The override is recorded immediately with your identity, timestamp, before-class, after-class, and reason.

**What the override changes:** the specific tag application is treated as the new class for verification purposes from this point on, and the audit trail gains a new event.

**What the override never changes:** the tag *definition* (overrides are per-application; next time the tag fires on different content, it's back to its declared classes), any prior verification observation (older observations stand), or any previous audit-trail entry (nothing is mutated; the override is an *additional* event).

This is the only sanctioned bypass route, and it leaves a footprint every time. There is no silent override.

---

## Tag-dependency graph

On the detail page of any tag, before you can edit or deprecate it, you see **Used in N lenses** with a tap-through to the dependency graph.

The graph shows every lens that currently references this tag, the lens row that names it, and the role the tag plays (acceptable tag, evidence requirement, source-set member, etc.). For an org admin considering changes, this is the impact-assessment surface.

**Why this matters:** deprecating `org.acme.brandGuidelines.numberFormat` without realising it's referenced by `acme-investor-deck` would silently weaken the investor-deck lens. The graph makes that consequence visible before the deprecation publishes.

**Per-platform shape:**

- **iOS:** the dependency graph is a list of lens cards, each with a chevron tap-through to the lens detail.
- **Mac / web:** the graph is shown both as a list and a visual node diagram (lens nodes connected to tag node), useful when a tag is referenced by many lenses.

---

## Permissions

Authorisation is enforced **server-side**. The client UI hides surfaces it doesn't believe you have access to, but that hiding is convenience, not security. Every write to the substrate is checked against your identity and role on the server before it persists.

| Capability | Who | Tier |
|---|---|---|
| **Read** (Browse + Audit views) | Anyone with org/room read access | OSS or premium |
| **Apply** (apply tags + run lenses + lodge disputes) | Room/org members | OSS or premium |
| **Author** (create/edit/deprecate org-scoped tags) | Org admins | Premium only |
| **Curate** (edit org source-sets) | Org admins | Premium only |
| **Override** (per-application protocol-class override) | Anyone who can apply tags | OSS or premium |

**What "server-authoritative" means in practice:** the Author tab is hidden in the apps if you aren't an org admin on a premium tier, but even if you somehow surfaced the Author UI, every write (tag create/edit/deprecate, source-set edit, lens-row edit) is rejected with 403 by the server when the caller doesn't have the required role. You can never have a "the button worked in the UI but didn't actually save" mismatch — both gates pass together or neither does. The UI hides, the substrate enforces.

---

## Premium tier specifics

ANT ships in two tiers. The OSS tier gives you everything you need to *participate* in verification; the premium tier adds the ability to *define* verification for your org.

**OSS tier:** Browse view, Apply tags, Run any lens (including the three ANT default lens scaffolds: 1-agent link verification, 2-agent link verification, and 1-human + 1-agent source-context verification), Audit view, Lodge disputes, and Override the protocol class of a tag application with a recorded reason. OSS users have **full read + write access to the immutable substrate** — they just can't change the org-level policy (tag definitions, source-sets, or lenses).

**Premium tier adds:** Author view (create / edit / deprecate org-scoped tags), source-set curation, the richer lens designer, and the org namespace allocation that lets you publish `org.<yourId>.*` tags at all.

**How tiering is set:** at license purchase on antonline.dev. Buying a premium licence allocates your org's namespace (`org.<yourId>.*`) and sets your admins to the Author + Curate roles automatically. There is no self-serve namespace registration and no manual approval queue — namespace allocation is part of the licence purchase flow.

---

## CLI parity

Everything the page does, the CLI does. Same APIs, same audit trail, same identity model.

```bash
# Browse tags
ant tags list [--namespace=ant|org.<id>] [--category=claim|source|...] [--deprecated]

# Apply tags to a scope (file, room, artefact, message)
ant tags apply <scopeRef> --tagset=default|default+org:<id>|<explicit-list>

# Run a verification lens
ant verify <scopeRef> --lens <lensId>

# Read the audit feed
ant tags audit [--tag <id>] [--actor <handle>] [--scope <ref>] [--since-ms <ms>]

# Override a tag application's protocol class
ant tags override <applicationRef> --class <newClass> --reason "<why>"

# Author (premium org admin only)
ant tags create --spec <path>
ant tags edit <tagId> --spec <path>
ant tags deprecate <tagId> --reason "<why>"
```

The CLI writes to the same endpoints (`POST /api/scopes/:id/tagging-runs`, `POST /api/scopes/:id/verification-runs`, etc.) the apps use. A tag applied from the CLI shows up in the Audit feed of the apps within seconds, and vice-versa.

---

## FAQs

> *The Author tab is missing — what's wrong?*

Either you're not an org admin, or your org isn't on the premium tier, or both. Check Settings → Account → Role. If you should be an admin and aren't, your org owner can promote you. If your org isn't on premium, upgrade via antonline.dev.

> *I can see a tag in Browse but can't apply it — why?*

Either the tag is deprecated (deprecated tags accept no new applications), or it's scoped to a different namespace your role doesn't have apply rights on, or the lens you're running doesn't list it as an acceptable tag. The detail page tells you which.

> *Who applied this tag?*

Open the audit feed and filter by the target scope, or tap the tag chip on the content and choose **View audit**. Every tag application records the applier's identity (`agent` / `human` / `system` / `automated`) and timestamp.

> *Can I undo an override?*

You can't "undo" in the sense of erasing the audit event — nothing in the audit trail is mutable. What you can do is record a **new** override that puts the application back to its original class (or a different class), with a fresh reason. The audit trail keeps both events, in order.

> *How do I report a stuck dispute?*

A `DISPUTED` verdict that won't resolve is the lens's policy doing what it's supposed to do (`unanimous_only` rejects anything less than full agreement, for example). The remedy is to lodge a fresh verification observation that breaks the tie, edit the lens's dispute policy (org admin, premium), or accept that the verdict stays `DISPUTED`. There is no separate adjudicator surface — the lens's policy is the final authority by design.

> *The page won't load my org's tags. What now?*

Check Settings → Account → Org namespace. If it's blank, your premium licence may not have been provisioned yet (or you're on the OSS tier and the org namespace was never allocated). If it's set but the Browse list is empty under the org filter, you genuinely have no org-scoped tags yet — the Author wizard is how you create the first one.

> *Can someone bypass verification entirely?*

No silent bypass. The only sanctioned bypass is the per-application protocol-class override, which records the flagger's identity and a mandatory reason. A tag that would otherwise require a human verifier can be downgraded to `process.flagged-ignorable` only with a recorded reason and identity.

> *What's the difference between this page and the Trust chip in a room header?*

The Trust chip is the *summary*: green/amber/red/grey for the most recent verdict on a scope. This page is the *full operations surface*: every tag definition, every application, every observation, every dispute, every override, ever. The Trust chip tells you the verdict; this page tells you the workings.

---

## Cross-references

- [Verification in ANT — tagging, lenses, and proof](./verification-tags-and-lenses-2026-05-28.md) (G2 — the general guide; read this first if you're new to verification)
- Phase D iOS implementation spec (`antios/docs/phase-d-ios-implementation-spec-2026-05-28.md`)
- Verification classification research doc (`antios/docs/verification-classification-system-research-2026-05-28.md`)
- JWPK ratification memory `project_verification_ratification_2026_05_28.md`
- PULL-not-PUSH framing memory `feedback_ant_skills_are_tasks_not_model_calls.md`
