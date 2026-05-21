# Native brand-mark asset policy (#71)

Date: 2026-05-17
Owner: @evolveantcodex
Scope: premium native provider/agent icons only. No OSS web bundle assets.

## Decision

Do not import third-party SVG/PNG brand assets into the repo yet. Ship the native picker with a three-tier model:

1. **Approved official kits**: OpenAI and Kimi can be considered for native use if we follow their published guidelines exactly.
2. **Text-only or generic generated marks**: Claude/Anthropic, DeepSeek, Pi/Inflection, and Qwen should default to text badges or ANT-styled generic provider glyphs until explicit permission or a clearer official public asset license is found.
3. **Enterprise/customer override**: allow a local/private icon upload per provider/agent in native apps, stored as user-provided asset, with no redistribution in OSS or default app bundles.

This keeps JWPK's premium polish direction without creating a trademark liability or accidentally implying endorsement by AI vendors.

## Product shape

Native paid apps should expose a curated "Provider icon" picker:

- `Generic` ANT icon: default, always safe.
- `Text badge`: provider name in ANT styling, e.g. `Claude`, `OpenAI`, `DeepSeek`, `Kimi`, `Pi`, `Qwen`.
- `Official mark`: only enabled when the source is approved and attribution/usage conditions are satisfied.
- `Custom local asset`: user-supplied image, local/native-only, not synced as a redistributed asset unless the user explicitly owns rights.

Data contract stays simple:

```ts
type ProviderIconPreset = {
  presetId: string;
  providerKey: 'anthropic' | 'openai' | 'deepseek' | 'kimi' | 'pi' | 'qwen' | 'custom';
  displayName: string;
  assetKind: 'generic' | 'text-badge' | 'official-mark' | 'custom-local';
  nativePaidOnly: true;
  sourceUrl?: string;
  usageStatus: 'approved-public-guidelines' | 'permission-required' | 'unclear';
  attribution?: string;
};
```

## Vendor findings

| Provider | Official/source URL | What the source says | Recommendation |
|---|---|---|---|
| OpenAI | https://openai.com/brand/ | OpenAI publishes a brand page with downloadable logos and usage terms. It says OpenAI marks include names/logos/icons/design elements, use must follow guidelines, marks must not be more prominent than our own, and permission can be revoked. | **Candidate official mark** for native paid only. Use exact downloaded asset, preserve spacing, include attribution, avoid implying partnership. |
| Kimi / Moonshot AI | https://moonshotai.github.io/Branding-Guide/ | Moonshot publishes Kimi brand guidelines with downloadable SVG/PNG options for Kimi with icon, wordmark, icon, and K-only variants. | **Candidate official mark** for native paid only. Use the provided variants only; record chosen asset variant in code metadata. |
| Anthropic / Claude | https://www.anthropic.com/news/introducing-claude and https://support.claude.com/en/articles/10023646-i-think-a-user-is-infringing-my-copyright-or-other-intellectual-property-how-do-i-report-it | Anthropic has official Claude product pages and IP reporting paths, but no public brand asset kit or logo usage guidelines were found in this pass. | **Do not bundle official logo yet**. Use `Claude` text badge or ANT-styled "C" mark. Ask Anthropic/Claude legal or partnerships before shipping a claw/Claude mark. |
| DeepSeek | https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html | DeepSeek terms prohibit use of trademarks, service marks, trade names, website names, company logos, URLs, or prominent brand features without permission. | **Permission required**. Use text badge only. Do not ship whale/logo asset unless DeepSeek grants permission. |
| Pi / Inflection AI | https://pi.ai/privacy | Pi/Inflection Terms state users receive no ownership/right/title/interest in Inflection AI services, trademarks, or other IP. No public Pi logo kit found in this pass. | **Permission required**. Use `Pi` text badge only. |
| Qwen / Alibaba Cloud | https://www.alibabacloud.com/en/solutions/generative-ai/qwen and https://www.alibabacloud.com/help/en/legal/latest/alibaba-cloud-international-website-terms-of-use-alibaba-cloud-international-website-terms-of-use | Alibaba Cloud has official Qwen product pages. Alibaba Cloud terms reserve rights in trademarks, service marks, logos, trade names, designs, software, and related IP. No public Qwen logo kit/license was found in this pass. | **Unclear / permission required**. Use `Qwen` text badge or generic Q mark until Alibaba/Qwen publishes usable brand guidance or grants permission. |

## Implementation recommendation

S1. Native icon registry

- Add a native-only registry file such as `native/provider-icons.json`.
- Include only generic/text badge entries by default.
- Mark OpenAI and Kimi as `candidate` until human review accepts their terms.
- Do not commit downloaded SVG/PNG files in S1.

S2. Native picker UX

- In participant identity editor, show:
  - current icon preview,
  - provider text badge options,
  - custom local upload/import,
  - official marks only where `usageStatus === approved-public-guidelines`.
- Selection must persist as a visible chip/preview and include remove/reset.

S3. Asset ingestion

- Only after legal/taste approval, add official assets under a native-only path:
  - `native/assets/provider-icons/openai/...`
  - `native/assets/provider-icons/kimi/...`
- Include adjacent `LICENSE-NOTES.md` with source URL, download date, terms summary, and allowed contexts.

S4. OSS boundary

- OSS/web should continue to render generic icon, initials, emoji-free fallback, or display_icon overrides already stored on `chat_room_members`.
- No third-party provider logo defaults in OSS.

## Risk notes

- Brand logos can imply partnership or endorsement. The picker must avoid labels like "official integration" unless there is a real partnership.
- App Store review may scrutinize third-party marks, especially if used in onboarding, screenshots, store listing, or paywall surfaces.
- Text badges are lower-risk than logo assets but still should be factual and not misleading.
- "Claude claw" is a product nickname from JWPK, not an approved Anthropic asset. Treat as a generated/generic ANT-style glyph unless permission is obtained.

## Morning asks for JWPK

- Confirm whether native paid apps should launch S1/S2 with **text badges + custom local upload only**, then add official OpenAI/Kimi later after human review.
- Confirm whether brand marks should be visible only inside participant identity editor/chat rows, or also in marketing/store screenshots. The latter is higher risk and should require explicit approval.
