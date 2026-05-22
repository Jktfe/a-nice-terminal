import {
  extractValidationClaimPointers,
  type ValidationClaimFragment
} from './validationClaimExtractor';
import type { ValidationClaimPointer } from './validationScoring';

export type ExtractMarkdownValidationClaimPointersInput = {
  markdown: string;
  sourcePointer: string;
  url?: string;
};

type PendingParagraph = {
  startLine: number;
  endLine: number;
  parts: string[];
};

function linePointer(startLine: number, endLine: number): string {
  return startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`;
}

function stripListMarker(line: string): string {
  return line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim();
}

function isListItem(line: string): boolean {
  return /^\s*(?:[-*+]|\d+[.)])\s+/.test(line);
}

function isFence(line: string): boolean {
  return /^\s*(```|~~~)/.test(line);
}

function isHeading(line: string): boolean {
  return /^\s{0,3}#{1,6}\s+/.test(line);
}

function isSeparator(line: string): boolean {
  return /^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(line);
}

function isTableDelimiter(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isTableRow(line: string): boolean {
  return line.includes('|') && !isTableDelimiter(line);
}

function tableText(line: string): string {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
    .filter(Boolean)
    .join(' | ');
}

function shouldSkipStandalone(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length === 0 ||
    isHeading(trimmed) ||
    isSeparator(trimmed) ||
    trimmed.startsWith('>') ||
    isTableDelimiter(trimmed)
  );
}

function pushParagraph(
  fragments: ValidationClaimFragment[],
  paragraph: PendingParagraph | null
): PendingParagraph | null {
  if (!paragraph) return null;
  const text = paragraph.parts.join(' ').replace(/\s+/g, ' ').trim();
  if (text.length > 0) {
    fragments.push({
      pointer: linePointer(paragraph.startLine, paragraph.endLine),
      text
    });
  }
  return null;
}

function markdownFragments(markdown: string): ValidationClaimFragment[] {
  const fragments: ValidationClaimFragment[] = [];
  const lines = markdown.split(/\r?\n/);
  let inFrontmatter = lines[0]?.trim() === '---';
  let inFence = false;
  let paragraph: PendingParagraph | null = null;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();

    if (inFrontmatter) {
      if (lineNumber > 1 && trimmed === '---') inFrontmatter = false;
      return;
    }

    if (isFence(trimmed)) {
      paragraph = pushParagraph(fragments, paragraph);
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    if (shouldSkipStandalone(trimmed)) {
      paragraph = pushParagraph(fragments, paragraph);
      return;
    }

    if (isListItem(line)) {
      paragraph = pushParagraph(fragments, paragraph);
      const text = stripListMarker(line);
      if (text.length > 0) fragments.push({ pointer: linePointer(lineNumber, lineNumber), text });
      return;
    }

    if (isTableRow(line)) {
      paragraph = pushParagraph(fragments, paragraph);
      if (isTableDelimiter(lines[index + 1] ?? '')) return;
      const text = tableText(line);
      if (text.length > 0) fragments.push({ pointer: linePointer(lineNumber, lineNumber), text });
      return;
    }

    if (!paragraph) {
      paragraph = { startLine: lineNumber, endLine: lineNumber, parts: [trimmed] };
      return;
    }

    paragraph.endLine = lineNumber;
    paragraph.parts.push(trimmed);
  });

  pushParagraph(fragments, paragraph);
  return fragments;
}

export function extractMarkdownValidationClaimPointers(
  input: ExtractMarkdownValidationClaimPointersInput
): ValidationClaimPointer[] {
  return extractValidationClaimPointers({
    source: {
      tool: 'doc',
      pointer: input.sourcePointer,
      ...(input.url ? { url: input.url } : {})
    },
    fragments: markdownFragments(input.markdown)
  });
}
