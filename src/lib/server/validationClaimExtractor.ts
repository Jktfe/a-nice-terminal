import { createHash } from 'node:crypto';
import type { ValidationClaimPointer } from './validationScoring';

export type ValidationClaimSource = ValidationClaimPointer['source'];

export type ValidationClaimFragment = {
  pointer: string;
  text: string;
};

export type ExtractValidationClaimPointersInput = {
  source: ValidationClaimSource;
  fragments: ValidationClaimFragment[];
};

const MATERIAL_WORDS = /\b(approval|billing|blocked|contract|cost|customer|deadline|decision|financial|legal|launch|policy|revenue|risk|security|ship|shipping)\b/i;
const URL_PATTERN = /\bhttps?:\/\/\S+/i;
const NUMBER_PATTERN = /\b\d+(?:\.\d+)?%?\b/;

function claimIdFor(sourcePointer: string, text: string): string {
  const digest = createHash('sha1')
    .update(`${sourcePointer}\n${text}`)
    .digest('hex')
    .slice(0, 10);
  return `claim_${digest}`;
}

function combinePointers(sourcePointer: string, fragmentPointer: string): string {
  const source = sourcePointer.trim();
  const fragment = fragmentPointer.trim();
  if (fragment.length === 0) return source;
  return `${source}#${fragment}`;
}

function kindForText(text: string): string {
  if (URL_PATTERN.test(text)) return 'link';
  if (/^\s*source\s*:/i.test(text) || /\bsigned by\b/i.test(text)) return 'source_quality';
  if (NUMBER_PATTERN.test(text)) return 'number';
  if (MATERIAL_WORDS.test(text)) return 'claim_material';
  return 'claim_nonmaterial';
}

export function extractValidationClaimPointers(
  input: ExtractValidationClaimPointersInput
): ValidationClaimPointer[] {
  const claims: ValidationClaimPointer[] = [];

  for (const fragment of input.fragments) {
    const text = fragment.text.trim();
    if (text.length === 0) continue;

    const pointer = combinePointers(input.source.pointer, fragment.pointer);
    claims.push({
      id: claimIdFor(pointer, text),
      kind: kindForText(text),
      text,
      source: {
        tool: input.source.tool,
        pointer,
        ...(input.source.url ? { url: input.source.url } : {})
      },
      checks: []
    });
  }

  return claims;
}
