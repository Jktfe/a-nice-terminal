/**
 * In-memory cache + fetcher for the latest ant CLI release (GitHub
 * releases API). Separated from `+server.ts` because SvelteKit only
 * allows HTTP-method exports in route handlers; the cache reset
 * helper needs its own module so the test seam compiles.
 *
 * NMT feedback #E (@jstephenson via @james, 2026-05-26): Settings page
 * needs a click-to-upgrade affordance. This module is the data path.
 */

const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/Jktfe/a-nice-terminal/releases/latest';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const INSTALL_COMMAND = 'brew install jktfe/antchat/ant';
const UPGRADE_COMMAND = 'brew upgrade jktfe/antchat/ant';

export type LatestCliReleasePayload = {
  version: string;
  tag: string;
  publishedAt: string;
  releaseNotesUrl: string;
  installCommand: string;
  upgradeCommand: string;
  fetchedAt: string;
};

type CacheEntry = {
  expiresAt: number;
  payload: LatestCliReleasePayload;
};

let cache: CacheEntry | null = null;

export function parseVersionFromTag(tag: string): string {
  // Tag shape is `ant-vX.Y.Z`. Strip the `ant-v` prefix; if the prefix
  // ever changes, fall back to `v`-prefix then raw tag so the user
  // always sees something readable.
  if (tag.startsWith('ant-v')) return tag.slice('ant-v'.length);
  if (tag.startsWith('v')) return tag.slice(1);
  return tag;
}

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export async function fetchLatestFromGitHub(
  fetchImpl: FetchImpl = fetch
): Promise<LatestCliReleasePayload> {
  const res = await fetchImpl(GITHUB_LATEST_RELEASE_URL, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'ant-server-settings-cli-version-check'
    }
  });
  if (!res.ok) {
    throw new Error(`github releases ${res.status}`);
  }
  const data = (await res.json()) as {
    tag_name?: string;
    published_at?: string;
    html_url?: string;
  };
  const tag = typeof data.tag_name === 'string' ? data.tag_name : '';
  if (!tag) throw new Error('github response missing tag_name');
  return {
    version: parseVersionFromTag(tag),
    tag,
    publishedAt: typeof data.published_at === 'string' ? data.published_at : '',
    releaseNotesUrl: typeof data.html_url === 'string' ? data.html_url : '',
    installCommand: INSTALL_COMMAND,
    upgradeCommand: UPGRADE_COMMAND,
    fetchedAt: new Date().toISOString()
  };
}

/**
 * Returns the cached payload if fresh, else fetches + caches. On
 * upstream failure, returns the stale cached value if any (so the
 * settings page is never stranded), else re-throws.
 */
export async function getLatestCliRelease(
  fetchImpl: FetchImpl = fetch
): Promise<LatestCliReleasePayload> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.payload;
  }
  try {
    const payload = await fetchLatestFromGitHub(fetchImpl);
    cache = { expiresAt: now + CACHE_TTL_MS, payload };
    return payload;
  } catch (cause) {
    if (cache) return cache.payload;
    throw cause;
  }
}

export function _resetCliReleaseCacheForTests(): void {
  cache = null;
}

export const INSTALL_COMMAND_FOR_FALLBACK = INSTALL_COMMAND;
export const UPGRADE_COMMAND_FOR_FALLBACK = UPGRADE_COMMAND;
