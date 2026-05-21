# ANT Commercial Licence

**Effective**: 2026-05-19
**Licensor**: James William Peter King ("Licensor")
**Project**: ANT — Agent-Native Terminal (https://github.com/Jktfe/a-nice-terminal)

This is the Commercial Licence option for ANT. The default open-source licence is
**AGPL-3.0-or-later** (see [LICENSE](LICENSE)). This Commercial Licence is offered as
an alternative for users whose intended use is incompatible with AGPL's source-
availability obligations.

## When you need this licence

You need a Commercial Licence (and a paid agreement with the Licensor) if **any** of
the following are true:

1. You are running ANT (or a derivative work) as a **hosted commercial service** for
   third-party users, and you do not wish to be obligated to make your source
   modifications available to those users (which AGPL §13 would otherwise require).
2. You are distributing ANT (or a derivative work) **bundled inside a proprietary
   product** that you do not wish to release under the AGPL.
3. You are using ANT (or a derivative work) inside a paid **closed-source mobile app**
   (e.g. proprietary iOS/Android native client built on ANT primitives) sold under
   commercial terms incompatible with AGPL.
4. You are a **legal/compliance organisation** that cannot use AGPL-licensed software
   under your internal policies.

If your use case is **self-hosted single-user or single-team**, or **personal use**,
or **non-hosted internal tools for your own organisation**, then the AGPL covers you
fully and you do not need this licence.

## What the Commercial Licence grants

Subject to the executed agreement and payment of agreed fees:

- The right to use, modify, and distribute ANT (and derivative works) **without** the
  AGPL §13 source-availability obligation
- The right to embed ANT in proprietary products without releasing those products
  under AGPL
- The right to operate ANT as a closed-source hosted commercial service
- Optional: priority support, custom development, deployment assistance
  (negotiated per-agreement)

## What it does NOT grant

- It does NOT remove copyright. ANT remains the intellectual property of the Licensor
  and contributors.
- It does NOT grant exclusivity. The Licensor retains the right to grant equivalent
  licences to other parties.
- It does NOT cover third-party dependencies (SvelteKit, Bun, etc) which travel under
  their own licences.

## How to obtain

This is a **negotiated per-licensee agreement**, not a click-through.

1. Email **redacted@example.com** with:
   - Your organisation name + jurisdiction
   - Your intended use (brief — "hosted SaaS for X", "embedded in product Y", etc)
   - Expected user volume / deployment scale
2. Licensor responds within ~5 business days with proposed terms + pricing
3. Sign + payment → executed commercial licence agreement
4. You're covered going forward

## Pricing

Pricing is negotiated based on use case + scale. Indicative ranges (subject to change):

- **Premium native mobile app** (single-app, internal team distribution like New Model
  Venture Capital's antchat-mac): included in the £5.99/user/month native subscription
  model. No separate commercial licence required.
- **Hosted commercial SaaS using ANT as backend**: from £500/month + tier-based
  volume pricing. Includes priority support.
- **Embedded-in-product distribution**: per-deployment fee, varies by product.
- **Enterprise on-premise**: negotiated.

## Term + termination

- The Commercial Licence agreement is per-term (typically annual or perpetual-with-
  maintenance, depending on the executed contract).
- Upon termination, the licensee must either (a) stop distributing/operating ANT under
  the commercial terms, or (b) revert to AGPL compliance.
- Licensor may terminate for material breach (including non-payment) on 30 days
  notice + cure period.

## Warranty + liability

The Commercial Licence carries a limited warranty per the executed agreement
(typically: ANT performs materially as documented; bugs are fixed in a commercially
reasonable timeframe). Liability is capped at fees paid in the prior 12 months,
except for willful misconduct. Full terms in the per-licensee contract.

## Why the dual-licence shape

ANT is built in the open under AGPL because:
- The orchestration discipline (banked memory, agent coordination, plan/task system)
  is itself the product on display — running it transparently is the marketing.
- Self-hosting + single-team use should be free + frictionless.
- Contributors should benefit from a strong copyleft for derivative works.

The Commercial Licence exists because:
- Some legitimate use cases (premium native apps, hosted SaaS for paying users) need
  to be financially sustainable + don't fit AGPL's hosted-service obligation.
- Funding the project's continued development comes from these commercial seats.

We follow the model proven by projects like MongoDB (pre-SSPL), MariaDB Corporation,
and most recently inspirations like Shellin (`jaycho46/shellin-core`) — same shape:
permissive on the OSS side, commercial when business reality requires it.

## Contact

For commercial licence enquiries, custom development, or to discuss
unusual use cases:

**redacted@example.com** — Licensor, New Model Venture Capital Ltd

Subject line: "ANT Commercial Licence — [your org name]"

For general OSS questions, file an issue at the project repository.
