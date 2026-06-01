import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  extractMarkdownValidationClaimPointers,
  type ExtractMarkdownValidationClaimPointersInput
} from './validationMarkdownExtractor';
import type { ValidationClaimPointer } from './validationScoring';

export type ExtractMarkdownFileValidationClaimPointersInput = {
  filePath: string;
  sourcePointer?: string;
  url?: string;
};

function defaultSourcePointer(filePath: string): string {
  return `file:${basename(filePath)}`;
}

export function extractMarkdownFileValidationClaimPointers(
  input: ExtractMarkdownFileValidationClaimPointersInput
): ValidationClaimPointer[] {
  const markdown = readFileSync(input.filePath, 'utf8');
  const adapterInput: ExtractMarkdownValidationClaimPointersInput = {
    markdown,
    sourcePointer: input.sourcePointer ?? defaultSourcePointer(input.filePath)
  };
  if (input.url) adapterInput.url = input.url;
  return extractMarkdownValidationClaimPointers(adapterInput);
}
