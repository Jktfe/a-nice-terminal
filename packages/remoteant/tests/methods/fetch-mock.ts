export const originalFetch = globalThis.fetch;

export function installFetchMock(fetchMock: typeof fetch): void {
  globalThis.fetch = fetchMock;
}

export function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}
