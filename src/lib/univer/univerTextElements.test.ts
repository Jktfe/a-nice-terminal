import { describe, expect, it } from 'vitest';
import {
  listUniverTextElements,
  updateUniverTextElement,
  univerSnapshotToPlainText
} from './univerTextElements';

const snapshot = {
  id: 'deck-test',
  title: 'Deck',
  body: {
    pageOrder: ['slide-1', 'slide-2'],
    pages: {
      'slide-1': {
        id: 'slide-1',
        title: 'Opening',
        pageElements: {
          title: {
            id: 'title',
            type: 2,
            richText: { text: 'ANT can edit shared decks.', fs: 36 }
          },
          shape: {
            id: 'shape',
            type: 0,
            shape: { shapeType: 'rect' }
          }
        }
      },
      'slide-2': {
        id: 'slide-2',
        title: 'Validation',
        pageElements: {
          claim: {
            id: 'claim',
            type: 2,
            richText: { text: 'The launch has 4 validation checks.', fs: 24 }
          },
          canonical: {
            id: 'canonical',
            type: 2,
            richText: {
              rich: {
                id: 'canonical-doc',
                body: {
                  dataStream: 'Canonical Univer text is editable.\r\n',
                  textRuns: [{ st: 0, ed: 34, ts: { fs: 24 } }],
                  paragraphs: [{ startIndex: 34 }]
                }
              }
            }
          }
        }
      }
    }
  }
};

describe('univer text element helpers', () => {
  it('lists editable text elements from a deck snapshot in slide order', () => {
    expect(listUniverTextElements(snapshot)).toEqual([
      {
        pageId: 'slide-1',
        pageTitle: 'Opening',
        elementId: 'title',
        text: 'ANT can edit shared decks.'
      },
      {
        pageId: 'slide-2',
        pageTitle: 'Validation',
        elementId: 'claim',
        text: 'The launch has 4 validation checks.'
      },
      {
        pageId: 'slide-2',
        pageTitle: 'Validation',
        elementId: 'canonical',
        text: 'Canonical Univer text is editable.'
      }
    ]);
  });

  it('updates one text element without mutating the original snapshot', () => {
    const updated = updateUniverTextElement(snapshot, {
      pageId: 'slide-1',
      elementId: 'title',
      text: 'ANT can edit this text now.'
    });

    expect(listUniverTextElements(updated)[0].text).toBe('ANT can edit this text now.');
    expect(listUniverTextElements(snapshot)[0].text).toBe('ANT can edit shared decks.');
  });

  it('updates canonical rich body text and keeps paragraph indexes aligned', () => {
    const updated = updateUniverTextElement(snapshot, {
      pageId: 'slide-2',
      elementId: 'canonical',
      text: 'Canonical rich body updated.'
    }) as typeof snapshot;
    const element = updated.body.pages['slide-2'].pageElements.canonical;
    const richBody = element.richText.rich.body;

    expect(listUniverTextElements(updated).at(-1)?.text).toBe('Canonical rich body updated.');
    expect(richBody.dataStream).toBe('Canonical rich body updated.\r\n');
    expect(richBody.textRuns[0].ed).toBe('Canonical rich body updated.'.length);
    expect(richBody.paragraphs[0].startIndex).toBe('Canonical rich body updated.'.length);
  });

  it('converts text-bearing snapshots to plain text for validation claims', () => {
    expect(univerSnapshotToPlainText(snapshot)).toContain('ANT can edit shared decks.');
    expect(univerSnapshotToPlainText(snapshot)).toContain('The launch has 4 validation checks.');
    expect(univerSnapshotToPlainText(snapshot)).toContain('Canonical Univer text is editable.');
    expect(univerSnapshotToPlainText(snapshot)).not.toContain('shapeType');
  });
});
