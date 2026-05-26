export type UniverTextElement = {
  pageId: string;
  pageTitle: string;
  elementId: string;
  text: string;
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneSnapshot(snapshot: unknown): unknown {
  return JSON.parse(JSON.stringify(snapshot)) as unknown;
}

function pagesFromSnapshot(snapshot: unknown): { pageOrder: string[]; pages: Record<string, JsonObject> } {
  if (!isObject(snapshot) || !isObject(snapshot.body) || !isObject(snapshot.body.pages)) {
    return { pageOrder: [], pages: {} };
  }
  const pages = snapshot.body.pages as Record<string, JsonObject>;
  const pageOrder = Array.isArray(snapshot.body.pageOrder)
    ? snapshot.body.pageOrder.filter((id): id is string => typeof id === 'string')
    : Object.keys(pages);
  return { pageOrder, pages };
}

function textFromElement(element: unknown): string | null {
  if (!isObject(element) || element.type !== 2 || !isObject(element.richText)) return null;
  return typeof element.richText.text === 'string' ? element.richText.text : null;
}

export function listUniverTextElements(snapshot: unknown): UniverTextElement[] {
  const { pageOrder, pages } = pagesFromSnapshot(snapshot);
  const elements: UniverTextElement[] = [];

  for (const pageId of pageOrder) {
    const page = pages[pageId];
    if (!isObject(page) || !isObject(page.pageElements)) continue;
    const pageTitle = typeof page.title === 'string' ? page.title : pageId;
    for (const [elementId, element] of Object.entries(page.pageElements)) {
      const text = textFromElement(element);
      if (text === null) continue;
      elements.push({ pageId, pageTitle, elementId, text });
    }
  }

  return elements;
}

export function updateUniverTextElement(
  snapshot: unknown,
  input: { pageId: string; elementId: string; text: string }
): unknown {
  const next = cloneSnapshot(snapshot);
  const { pages } = pagesFromSnapshot(next);
  const page = pages[input.pageId];
  if (!isObject(page) || !isObject(page.pageElements)) return next;
  const element = page.pageElements[input.elementId];
  if (!isObject(element) || element.type !== 2 || !isObject(element.richText)) return next;
  element.richText.text = input.text;
  return next;
}

export function univerSnapshotToPlainText(snapshot: unknown): string {
  return listUniverTextElements(snapshot)
    .map((element) => element.text.trim())
    .filter(Boolean)
    .join('\n');
}
