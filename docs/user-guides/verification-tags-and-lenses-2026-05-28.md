# Verification in ANT — tagging, lenses, and proof

**Audience:** anyone using ANT to verify what's in a document, deck, or room.
**You should know:** how to send a message, what a room is. You don't need to be technical.
**Plan milestone:** G2 (`ant-verification-2026-05-28`)

---

## What verification means in ANT

Verification in ANT is **not** "ask an agent to check this." It's two distinct, recorded operations against a typed classification of content:

1. **Tag the file** — agents (or you) attach typed labels to spans of content. A claim, a source, a link, a number. Each label has a definition; nothing is implicit.
2. **Verify under a lens** — apply a policy that says "for these tags, this many agents (and/or humans) must confirm, with this kind of evidence, against this dispute rule." The lens runs against the tagged content and produces a verdict.

Both operations leave an **audit trail**: every tag application, every verification observation, every dispute is recorded forever in a way you can read back.

### The two-step intuition

> "Tag the file, then verify the file under this lens."

That's the entire user-facing model. The complexity below (tag definitions, lens rules, dispute policies) lives in the system; you mostly use the two verbs.

### Two equal entry points

You can do verification work two ways, and ANT treats them as equally valid:

- **Through the apps** — open the file on iOS, Mac, or web, tap the tag chips, run a lens, lodge a dispute. You are doing the work directly.
- **By asking an agent** — ask any terminal running an agent ("please tag this doc and verify it under our brand-safety lens"). The agent pulls the relevant skill or memory definition, does the work, and records the outcome.

Either way, the same audit substrate records *who did what, when, and why*. Agents are not privileged — the audit trail names the human or agent that did each step, so a reviewer can always trace the work back to a real handler.

---

## Section 1 — Tags: what's in a label?

A **tag** is a typed label with a published definition. Tagging a span of content is like highlighting it with a meaning attached: not just "this looks important," but "this is a factual claim" or "this is a citation of a primary source." Every tag has a stable ID (e.g. `claim.factual`), a version, and a written definition you can read.

Tagging is the prerequisite for verification. You can't ask "is this claim verified?" until somebody has said *which words make up the claim*.

### 1.1 What ANT ships by default

ANT comes with around 25 default tags grouped into 8 categories. The categories cover the building blocks of any document or conversation:

| Category | What it labels | Example tags |
|---|---|---|
| **claim** | Assertions made in the content | `claim.factual`, `claim.opinion`, `claim.prediction`, `claim.definition`, `claim.ratified-decision` |
| **source** | Citations and where evidence comes from | `source.primary`, `source.secondary`, `source.reputable`, `source.unverified`, `source.agent-generated`, `source.supports-claim.<claimID>`, `source.refutes-claim.<claimID>` |
| **link** | Pointers out to other artefacts | `link.html`, `link.file`, `link.repo`, `link.room`, `link.external-doc` |
| **data** | Numeric content | `data.raw-number`, `data.formula`, `data.percentage`, `data.monetary`, `data.cited-statistic` |
| **identity** | Named people, orgs, roles | `identity.named-person`, `identity.named-org`, `identity.named-role`, `identity.quoted-speaker` |
| **content** | Formal content shape | `content.direct-quote`, `content.paraphrase`, `content.summary`, `content.image`, `content.table`, `content.chart` |
| **context** | Confidence + temporal qualifiers | `context.confidence-high/med/low`, `context.time-bound`, `context.deadline`, `context.file-summary-retrieved` |
| **process** | Status that emerged from earlier verification work | `process.verified-by-agent`, `process.verified-by-human`, `process.disputed`, `process.superseded-by` |

A few worth flagging because they show up often:

- **`source.supports-claim.<claimID>` and `source.refutes-claim.<claimID>`** are *relational* tags — they bind a specific source to a specific claim. Many lenses require both supporting and refuting evidence to be tagged before they'll pass a claim, because honest verification means looking at what argues against you, not just what agrees.
- **`process.*` tags** are written by verification runs themselves, not by humans during initial tagging. You normally see them appear after you run a lens, not before.

You'll see these IDs in the apps and the CLI. Tap any tag chip in the Verification Tags page to read its full definition.

### 1.2 What your org can add

If your org has a paid license, your org admin can publish custom tags under your org's namespace: `org.<yourOrgName>.<dotted.name>`. Org-namespace registration happens at license purchase on antonline.dev — it isn't self-serve, and there isn't a separate approval queue.

A concrete example: an investment firm called Acme might publish a brand-guidelines pack of org tags so every Acme deck can be verified against the same standards.

```
org.acme.brandGuidelines.numberFormat
  → "Numbers over 1,000 must use thousands separators and at most one decimal place."

org.acme.brandGuidelines.toneOfVoice
  → "Plain English, second person, no exclamation marks, UK spelling."

org.acme.legal.contractClause
  → "Marks a span of contract language; triggers the legal-review lens."

org.acme.dealroom.confidentialFigure
  → "Marks a financial figure that must not be shared outside the deal room."
```

Acme's monthly investor update can then be tagged with both ANT defaults (claims, sources, links) and Acme's org tags (brand and confidentiality). Acme's verification lenses can refer to either.

Your org cannot override ANT's default tags. You can only add new ones under your namespace. This keeps the meaning of `claim.factual` consistent across every org on ANT, while still letting Acme define what *Acme* counts as a brand-compliant number.

### 1.3 The tag lifecycle (Create → Edit → Deprecate)

Every tag definition has a **version**.

- **Create.** A new tag is published with v1. Anyone with permission to apply tags can start using it.
- **Edit.** When a definition is updated, ANT publishes a new version (v2, v3, …) and keeps every prior version intact. Existing tag applications stay pinned to the version they were created with, so a verification from last month is still interpretable against last month's definition.
- **Deprecate.** A tag can be retired. Existing applications keep working forever; new applications are blocked. Deprecation is reversible — an org admin can **restore** a deprecated tag if it was retired in error.

Tags are **never hard-deleted**. That's deliberate: deletion would make historical verifications unreadable, which would gut the audit trail. Every create, edit, deprecate, and restore is recorded with the handler who did it, the timestamp, and the reason they typed in.

### 1.4 Where tags live in the apps

The **Verification Tags page** is your home for tag governance. It has three views:

- **Browse** — every tag visible to you (ANT defaults + your org's). Filter by namespace, deprecation status, or protocol class. Tap a tag for its full definition, its version history, and which lenses currently reference it.
- **Apply** — pick a file or room, choose a tag set (ANT defaults only, or defaults plus your org's), and tag spans. Most users will see agents do most of the applying; this view is for when you want to add or correct a tag yourself.
- **Audit** — chronological feed of every tag definition change and every tag application across the scopes you can see. Filterable by tag, handler, scope, or time.

In the chat and document views, tags appear as small chips on the relevant spans. Long-press or right-click a chip to see who applied it, which version was used, and the verification observations that referenced it.

---

## Section 2 — Lenses: what's a policy?

A **lens** is a verification policy. It says: "for content tagged this way, here's what counts as verified."

Where a tag answers *what is this?*, a lens answers *what would it take to trust it?*

### 2.1 What a lens is

Under the hood, a lens is a table. Each row binds a tag (or family of tags) to a set of verification requirements: how many agents must check, whether a human must be in the loop, what evidence counts, what happens if verifiers disagree.

A simple lens might look like this:

| Tag | Agents | Humans | Evidence | Dispute policy |
|---|---|---|---|---|
| `claim.factual` | 2 | 1 | required (citation or test) | unanimous |
| `link.html` | 1 | — | optional (HTTP 200) | accept-disputes |
| `source.reputable` (from set: `org.acme.approved-sources`) | 1 | — | required | unanimous |
| `data.cited-statistic` | 2 | — | required (link to source) | majority-only |

You can read each row aloud as a sentence: "For factual claims, two agents and one human must confirm with evidence, and they must all agree." That's the contract the lens enforces.

### 2.2 The four protocol classes

Tags carry **protocol classes** that determine *how* they can be verified at all. There are four:

- **`deterministic`** — agents alone can verify against a clear rule. Example: `link.html` passes when the URL returns HTTP 200. No judgement needed.
- **`heuristic`** — agents can verify against a defined policy or registry. Example: `source.reputable` passes when the source is in the lens's approved source set.
- **`judgement-required`** — at least one human must be in the verifier mix. Example: `claim.factual` plausibility — does this claim square with what you actually know about the world?
- **`consensus-required`** — multiple independent verifiers (agents, or agents plus humans) must converge on the same observation. Example: a high-stakes financial claim where you want two independent checks to land in the same place before you trust it.

A tag can carry **more than one** protocol class depending on context. `claim.factual` might behave as `deterministic` when a primary source already exists (just check the source matches), and as `heuristic` when no primary source is available (apply the lens's reasonableness policy).

Lenses enforce these rules. A lens that demands a `judgement-required` tag with zero humans in the verifier mix will be rejected by the server when an org admin tries to publish it. The protocol class is contract, not advice.

### 2.3 Overriding a protocol class on one application

Sometimes content carries a tag whose protocol class doesn't fit the situation. A factual claim that's actually a joke. A monetary figure that's a hypothetical. A link that's intentionally broken in a demo.

You can **override** the protocol class for that one application by flagging it (for example, as `process.flagged-ignorable`) with a **required reason**. The lens skips it. The original tag definition is untouched — overrides are always per-application.

Crucially, **who flagged the override is recorded forever**. The audit trail captures the flagger, the timestamp, the protocol class before and after, and the reason text. Without that, override flags would become a silent bypass. With it, anyone reviewing the document later can ask "why did this span skip verification?" and get an answer.

### 2.4 ANT's three default lenses

You don't have to author your own lens to get value. ANT ships three baseline lenses you can run immediately on any tagged content:

1. **`link-verify-1-agent`** — at least one agent has checked every `link.*` tag in the scope and confirmed the link works. Fast, cheap, deterministic. Good first pass on any document with citations.
2. **`link-verify-2-agent`** — same as above, but two independent agents must check. Useful when you're about to publish externally and want a second pair of eyes (or terminals) on every link.
3. **`source-context-1h1a`** — at least one agent and one human have verified that each `source.*` tag actually supports (or refutes) the claim it points at, with every supporting *and* refuting link checked. This is the lens that catches the bigger problem: "the link works, but the page doesn't say what we claimed it says."

You can apply these three from day one. For anything more specific, the lens-creation skill builds you a custom lens.

### 2.5 Authoring a lens with the lens-creation skill

You describe what you want a lens to do in plain English; ANT generates the lens for you.

The lens-creation skill is invoked the same way as any other ANT skill — ask any agent to run it, or trigger it from the Verification Tags page Author view. The substrate dispatches the work to a terminal, the terminal does the construction work, and the result comes back as a lens spec your org admin can review and publish.

A concrete example of a request:

> "Create a Verification lens that would meet the requirements of FCA financial promotions of Private Equity, called FCA PE FO Lens."

The skill produces:

- A name and a description
- Taxonomy bindings (which tags the lens cares about: claims, monetary figures, regulator references)
- A source set reference (which sources the lens trusts — your org admin curates this separately)
- The verifier mix per row (agents and humans)
- The dispute policy per row (unanimous, majority, accept-disputes)
- Temporal rules (how long a verdict stays valid before re-verification is needed)

Other examples you might ask for:

- "Create a lens for monthly investor updates that checks every monetary figure, every named investee company, and every link to a portfolio company page."
- "Create a lens for due-diligence reports that requires two human reviewers on any `claim.factual` over £1m and unanimous agreement on conclusions."
- "Create a lens for marketing copy that enforces our brand-guidelines org tags with a single agent and `accept-disputes`."

Your org admin reviews the generated lens, edits if needed, and publishes. From that point on, you can run it from any app or the CLI.

### 2.6 The lens lifecycle

Lenses have the same lifecycle as tags: create, edit (each edit publishes a new version), deprecate, restore. Past verifications stay pinned to the lens version they were run against, so a verdict from last quarter is still interpretable against last quarter's policy.

### 2.7 The tag-dependency graph

Tags and lenses are entangled. If your org deprecates a tag that three lenses rely on, those lenses break.

The Verification Tags page makes this visible. Tap a tag and you see the navigable list of every lens that references it. Tap a lens and you see every tag it depends on. Before deprecating anything, you can see what you'd be breaking — and decide whether to update the lens first, or accept the breakage and document why.

---

## Section 3 — Source sets: who counts as "reputable"?

A source is reputable for one purpose and not another. The FCA's filings are reputable for a financial-promotions check; a tech blog is reputable for "what shipped in this framework"; an academic database is reputable for a clinical claim. No single global list of "reputable sources" can serve every context.

So in ANT, **all source sets are owned by your org**. ANT ships no public source sets. Your org admin curates them.

### 3.1 What a source set contains

A source set is a list of references that count as reputable, scoped to one or more lenses. Each member can be:

- A **domain** (`fca.org.uk`) — anything under this domain is trusted for the lens
- A **specific URL** (`https://example.org/2025-statement.pdf`) — only this exact page
- A **repo** (`github.com/yourorg/policies`) — code or docs in this repo
- A **file** (a stable file reference inside ANT, including documents and decks)
- A **named person** (`identity.named-person:Alice Smith`) — quotes attributed to this person count as reputable for the lens
- A **named org** (`identity.named-org:Bank of England`) — statements attributed to this org count
- A **database** (a query against a structured store your org has registered)

Every add and remove is audited: who added it, when, why.

### 3.2 Per-org examples

What goes in a source set depends entirely on what your org is verifying. A few realistic shapes:

**An investment firm running an FCA-aligned promotions check:**

```
org.acme.sources.fca-financial-promotions
  fca.org.uk
  www.fca.org.uk/publications/policy-statements
  www.handbook.fca.org.uk
  identity.named-org:Financial Conduct Authority
```

**A research team running clinical-evidence checks:**

```
org.medco.sources.peer-reviewed-cardiology
  nejm.org
  thelancet.com
  pubmed.ncbi.nlm.nih.gov
  identity.named-org:European Society of Cardiology
```

**A software team verifying technical claims about their own stack:**

```
org.devshop.sources.internal-truth
  github.com/devshop/api
  github.com/devshop/docs
  file:devshop-architecture-2026.deck
  identity.named-role:Head of Platform
```

**A news desk running fact-checking on a story:**

```
org.newsdesk.sources.uk-public-records
  gov.uk
  parliament.uk
  ons.gov.uk
  companieshouse.gov.uk
```

### 3.3 Curation cadence

Your org admin sets the review cadence — quarterly, on demand, or tied to specific events. The audit trail records every change, so when a verdict from six months ago referenced a source that's since been removed, a reviewer can still see what the source set looked like when the verdict was issued.

There is no shortcut for curation. The source set is a deliberate statement of trust by your org. Take it seriously.

---

## Section 4 — Running a verification

Once content is tagged, you run a lens against it. This produces a verdict (passed, disputed, or failed) and a record of every verifier's observation.

### 4.1 From the apps (Mac antchat, iOS antios, web)

The two-tap flow is the same everywhere:

1. Open the file, document, or room you want to verify.
2. Tap **Tag the file** → choose a tag set (ANT defaults, or defaults + your org's). Agents apply tags in the background, or you tag spans yourself.
3. Tap **Verify under this lens** → choose the lens.
4. Read the verdict on the **Trust chip** in the room header.

Both steps record handler identity (you, or the agent that did the work), timestamp, and the relevant inputs. If you want to see what happened, tap the Trust chip and you'll drop into the audit feed for that scope.

You can also do either step manually. On any tag chip in the content, long-press to apply, correct, or override a tag. On the Trust chip, tap "Re-verify" to run the lens again after edits.

### 4.2 From the CLI

The same two operations, named the same way:

```bash
ant tags apply <scope> --tagset "default+org.<yourOrg>"
ant verify <scope> --lens <lensId>
```

`<scope>` is a file reference, a room ID, or any artefact ANT knows about. `<lensId>` is the published lens (e.g. `link-verify-1-agent`, `source-context-1h1a`, or one your org has published).

Both commands stream progress and finish with a one-line summary. Full detail is in the audit feed.

You can also lodge a dispute from the CLI:

```bash
ant verify dispute <observationId> --reason "Link returns 404 from EU IPs"
```

### 4.3 What the Trust chip means

The Trust chip is the at-a-glance status of a scope under its active lens.

| State | What it means | What to do |
|---|---|---|
| **Green (Verified)** | Current verdict is PASSED under the active lens, within its temporal threshold. | Nothing — you can rely on it. Click for the supporting record. |
| **Amber (Stale)** | Last passed verdict has aged past the lens's temporal threshold. Content may still be fine — but the lens says it's old enough to need a fresh look. | Re-verify. The work usually completes in seconds for default lenses. |
| **Red (Disputed)** | Verifiers disagreed. The lens's dispute policy did not resolve into a pass. | Open the audit feed to see who disagreed and why. You may need to add evidence, override a span, or accept the dispute. |
| **Grey (Unverified)** | No lens has been run yet (or the content has changed since the last run and is now unanchored). | Tag the content (if needed) and run a lens. |

The Trust chip is always honest about what it knows. It will not show green for content that hasn't been verified, even if you'd really like it to.

### 4.4 What a verification observation captures

Each verifier (human or agent) records an **observation** when they finish their work on a tag row. The observation includes:

- Who the verifier was (handle + kind: human, agent, system, automated)
- The verdict for this row (passed, failed, abstain)
- Evidence references (links, file refs, citations, attached notes)
- A free-text rationale
- Timestamp

The lens then aggregates the row's observations against its dispute policy to produce the row verdict, and the row verdicts aggregate to the overall verdict. Every level of that aggregation is inspectable.

---

## Section 5 — Reading the audit trail

The audit trail is the value. Verification is only worth doing if a reviewer can later trace exactly what happened: which tags were applied, by whom, against which version of the definition; which lens was run; which verifier observed what; which dispute changed the outcome.

### 5.1 Where the audit trail lives

You can reach it three ways:

- **From a tag.** Browse view → tap a tag → version history. Shows every create, edit, deprecate, and restore with handler + timestamp + rationale. From there you can drill into any version's applications.
- **From a tag chip on content.** Long-press (or right-click) → "View audit." Shows who applied this specific tag to this specific span, with what version, plus every verification observation that referenced it and any disputes lodged.
- **From the Audit view on the Verification Tags page.** A chronological feed across every scope you can see, filterable by tag, handler, scope, or time. Use this when you want the full picture across an artefact or across a quarter.

### 5.2 What gets recorded

Every action that matters is captured forever:

- **Tag definition events** — create, edit, deprecate, restore. Each event names the handler, the timestamp, and the rationale they typed.
- **Tag applications** — applier (human or agent), timestamp, the content span, the version of the definition used.
- **Verification observations** — verifier (human or agent), timestamp, the row verdict, evidence references, free-text rationale.
- **Protocol-class overrides** — flagger, timestamp, before/after class, REQUIRED reason.
- **Disputes** — disputer, timestamp, reason, the specific observation being disputed.
- **Source set changes** — who added or removed each member, when, and the rationale.

### 5.3 Append-only by design

Nothing in the audit trail is mutable. If somebody made a mistake — tagged the wrong span, ran the wrong lens, lodged a dispute that turned out to be wrong — they correct it by adding a **new** record (a new tag application, a new override, a new dispute-withdrawal), not by editing prior ones.

This is uncomfortable at first ("can't I just delete the wrong one?") and quickly becomes the whole point. You can see the history of how an artefact's status changed over time, not just the latest snapshot. That's what makes the audit trail trustworthy.

### 5.4 What a typical audit story looks like

You're reviewing last quarter's investor update. The Trust chip is green. You tap it and walk back through:

- The active lens was your org's `investor-update-quarterly` lens, version 4.
- The lens ran 11 days ago. The temporal threshold is 90 days, so the verdict is still in date.
- Of 47 tag applications in the scope, 47 had passing observations. Two had been overridden as `process.flagged-ignorable` (one was a joke in the CEO's footnote; one was a hypothetical figure in an appendix). Both overrides name the handler and reason.
- Three observations had initial disputes that resolved under the lens's `majority-only` policy. The audit shows who disagreed and what evidence was added to settle the disagreement.
- Every applied tag was at the latest version of its definition at the time of application.

You can hand that record to a compliance reviewer, a board member, or a regulator and explain exactly what was verified, by whom, against which policy, with which evidence. That's verification in ANT.

---

## Section 6 — Permissions

Verification permissions are deliberately conservative. Reading and contributing are open; **authoring** the things others rely on is restricted.

| Action | Who can do it | Tier required |
|---|---|---|
| Browse tags + lenses + source sets | Anyone who can see the content | OSS |
| Apply tags to spans | Anyone in the room | OSS |
| Run a lens | Anyone in the room | OSS |
| View audit trails | Anyone who can see the content | OSS |
| Lodge a dispute | Anyone in the room | OSS |
| Override a protocol class on one application | Anyone in the room (with required reason) | OSS |
| Create / edit / deprecate org tags | Org admin | Premium |
| Author / publish / deprecate org lenses | Org admin | Premium |
| Curate org source sets | Org admin | Premium |
| Register an org namespace | Account management at license purchase on antonline.dev | Premium |

A few clarifications worth flagging:

- **Org admin** is a role assigned through your org's account on antonline.dev. It is independent of any room-membership role inside ANT.
- **Premium tier** is required for Author actions only. OSS tier sees Browse / Apply / Run-Lens / Audit / Dispute / Override — everything you need to consume and contribute to verification work, just not to publish the definitions others rely on.
- **All authorisation is enforced by the server.** What the apps hide is a convenience for the user, not a security boundary. If you ask the CLI to do something your account isn't allowed to do, the server says no.

---

## Section 7 — FAQs

> *Can I delete a tag?*

No. Tags are deprecated but never hard-deleted. Deletion would make historical verifications unreadable, which would break the audit trail. Deprecation blocks new applications while keeping every existing one interpretable. Your org admin can restore a deprecated tag if it was retired in error.

> *Can I edit a tag definition after it's been used?*

Yes. Editing publishes a new version of the definition. Existing applications stay pinned to the version they were created with, so old verifications remain readable. New applications use the latest version. The version history is visible on the Verification Tags page.

> *What if my org has a regulator-specific verification need?*

Use the lens-creation skill: describe the regulator's requirements in plain English, name the lens, ANT generates a draft spec (taxonomy bindings, source-set, verifier mix, dispute policy, temporal rules). Your org admin reviews, edits, and publishes. ANT does not ship hardcoded regulator-specific lenses — your org owns what counts as compliant for your context.

> *Can someone bypass verification?*

Not silently. Per-application protocol-class overrides exist for legitimate cases — jokes, hypotheticals, out-of-scope content — but every override requires a typed reason and is recorded with the flagger's identity, timestamp, and the before/after class. A reviewer can always pull the list of overrides on a scope and read why each one was applied. There is no quiet bypass route.

> *What if verifiers disagree?*

The lens's **dispute policy** decides. The three common policies are:

- `accept-disputes` — record every observation; the verdict reflects the spread. Useful when you want the full picture and are happy to read the disagreement yourself.
- `majority-only` — vote. The majority wins; minority observations are still recorded but don't change the verdict.
- `unanimous_only` — every verifier must agree, or the verdict stays `DISPUTED`. Use for high-stakes content where you'd rather not pass than pass with disagreement.

The lens author picks the policy per row based on the stakes. There is no separate adjudicator above the lens — the policy is the final authority.

> *How do disputes actually resolve once lodged?*

When you lodge a dispute on an observation, three things can happen, depending on the lens's policy:

1. Under `accept-disputes`, the dispute is recorded alongside the existing observations. The verdict reflects the recorded spread; nothing else changes automatically.
2. Under `majority-only`, the dispute is one more vote. If the majority still favours the original verdict, the verdict stands. If the dispute tips the balance, the verdict flips and the audit feed shows the moment it flipped.
3. Under `unanimous_only`, the dispute breaks consensus. The verdict moves to `DISPUTED` until a new round of verification (with fresh evidence) resolves it.

In all three cases, the dispute itself is permanent — even if a follow-up verification later overturns it, the record of the dispute being lodged and considered is preserved. That's the audit trail doing its job.

> *What happens to verified content when its tag is deprecated?*

Previous verifications remain valid. The lens verdict from before the deprecation still reads as PASSED, because that verdict was produced against the lens-and-tag-version state at the time. The audit trail clearly shows which version of the tag was used. New verifications cannot apply the deprecated tag, so the lens may need updating to point to a replacement tag if your org wants to keep verifying that kind of content going forward. The Trust chip on existing content does not turn red simply because a tag was deprecated — it only changes state when the lens is re-run.

> *Can two orgs use the same tag name?*

Only in their own namespaces. `org.acme.brandGuidelines.toneOfVoice` and `org.beta.brandGuidelines.toneOfVoice` are two completely separate tags with two completely separate definitions, owned by Acme and Beta respectively. There is no name collision because the org namespace is part of the tag's identity. Neither org can publish into ANT's default namespace; both can publish freely under their own.

> *What counts as a "claim" for the claim tags?*

A claim is any statement the document is asserting as true (factual claim), believing to be true (opinion), predicting will be true (prediction), defining (definition), or recording as decided (ratified-decision). The dividing line that matters in practice is: *if a reasonable reader could ask "is that actually true?", that's a claim and it can be tagged.* If you're tagging a document and a span feels like an assertion but you can't decide which claim sub-type it is, tag it `claim.factual` and let a verifier refine it during the verification pass. The definitions for each sub-type are on the tag's page in the Verification Tags Browse view.

> *I overrode a protocol class by mistake. How do I undo it?*

You can't edit the override (the audit trail is append-only), but you can add a **new** override that supersedes it. Long-press the tag chip, pick "Override protocol class," and either reapply the original class or pick a different one — with a fresh reason explaining why you're correcting the earlier override. The audit feed will then show both records: the original mistaken override, and the correcting override that supersedes it. A reviewer reading the history sees exactly what happened and when it was corrected. This is the same pattern as correcting any other mistake in ANT: nothing is hidden, everything is layered.

> *What is the lens-creation skill actually doing?*

When you ask for a new lens, the request is dispatched as a task to a terminal running an agent. The agent pulls the lens-creation skill's definition (the same way it would pull any other ANT skill), constructs the lens spec from your description, and posts the result back to the substrate. Your org admin sees the generated lens in the Author view of the Verification Tags page, reviews and edits, and publishes when satisfied. From your perspective, you described what you wanted; a lens came back. From the audit trail's perspective, every step (who asked, which terminal did the work, what was produced, who approved) is recorded.

---

## Cross-references

- **G1 verification concept doc** — canonical research note backing this guide.
- **Verification Tags page user guide (G3)** — deeper UX walk-through of the Browse, Apply, Author, and Audit views.
- **Lens-creation skill spec (B1)** — the input contract for the skill described in section 2.5.
- **Verification deck (`d5024535-…`) v7** — architectural source-of-truth slides that informed the ratified contract this guide describes.
