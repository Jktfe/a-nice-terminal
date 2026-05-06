<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { PageData, ActionData } from './$types';

  interface Props {
    data: PageData;
    form: ActionData;
  }

  const { data, form }: Props = $props();

  interface OpenedFile {
    path: string;
    size: number;
    mtime_ms: number;
    sha256: string;
    is_text: boolean;
    content: string | null;
  }

  interface ConflictPayload {
    message: string;
    details: Record<string, unknown>;
    current: OpenedFile | null;
    attempted_content: string;
    attempted_base_hash: string | null;
    attempted_if_match_mtime: number | null;
    path: string;
    actor: string;
  }

  // Local editor state. `opened` is the file we're currently viewing/editing,
  // `draft` is the in-memory buffer the user is typing into, `baseHash` and
  // `baseMtime` are the if-match guards that get sent on save.
  let opened = $state<OpenedFile | null>(null);
  let draft = $state<string>('');
  let baseHash = $state<string | null>(null);
  let baseMtime = $state<number | null>(null);
  let saving = $state(false);
  let opening = $state<string | null>(null);
  let lastSaved = $state<{ path: string; sha256: string; mtime_ms: number } | null>(null);
  let inlineError = $state<string | null>(null);
  let conflict = $state<ConflictPayload | null>(null);

  // Surface form-action results back into the local state. Each branch maps a
  // form action's return shape onto the editor — keeps the page reactive
  // across `?/open` and `?/save` posts without manual fetches.
  $effect(() => {
    if (!form) return;
    const f = form as Record<string, unknown>;
    if (f.opened) {
      const next = f.opened as OpenedFile;
      opened = next;
      draft = next.content ?? '';
      baseHash = next.sha256;
      baseMtime = next.mtime_ms;
      conflict = null;
      inlineError = null;
      lastSaved = null;
    }
    if (f.saved && f.opened) {
      const saved = f.saved as { path: string; sha256: string; mtime_ms: number };
      const next = f.opened as OpenedFile;
      lastSaved = saved;
      opened = next;
      draft = next.content ?? '';
      baseHash = next.sha256;
      baseMtime = next.mtime_ms;
      conflict = null;
      inlineError = null;
    }
    if (f.conflict) {
      conflict = f.conflict as ConflictPayload;
      inlineError = null;
    }
    if (f.open_error) {
      inlineError = String(f.open_error);
    }
    if (f.save_error) {
      inlineError = String(f.save_error);
    }
  });

  const isDirty = $derived(opened ? draft !== (opened.content ?? '') : false);

  function fmtBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  function fmtTime(ms: number | null | undefined): string {
    if (!ms) return '—';
    return new Date(ms).toLocaleString();
  }

  function shortHash(hash: string | null | undefined): string {
    if (!hash) return '—';
    return hash.slice(0, 12);
  }

  function discardConflict() {
    // "Drop my edit" — keep the current-on-disk version as the new buffer.
    if (conflict?.current) {
      opened = conflict.current;
      draft = conflict.current.content ?? '';
      baseHash = conflict.current.sha256;
      baseMtime = conflict.current.mtime_ms;
    }
    conflict = null;
    inlineError = null;
  }

  function adoptCurrentBase() {
    // "Reload current and re-apply edits" — keep the user's in-memory edits
    // but refresh the if-match guards so the next save targets the disk's
    // current state. The user is the merge brain; we don't auto-merge.
    if (conflict?.current) {
      opened = conflict.current;
      baseHash = conflict.current.sha256;
      baseMtime = conflict.current.mtime_ms;
      // draft is intentionally NOT touched — it carries the user's edit
      // through the conflict.
    }
    conflict = null;
    inlineError = null;
  }

  async function refresh() {
    await invalidateAll();
  }
</script>

<svelte:head>
  <title>ANT · Deck · {data.deck.title}</title>
</svelte:head>

<div class="overflow-y-auto" style="background: var(--bg); color: var(--text); height: var(--ant-viewport-h, 100dvh);">
  <div class="sticky top-0 z-20 border-b" style="background: var(--bg-surface); border-color: var(--border-subtle);">
    <div class="flex items-center gap-4 px-4 sm:px-6 py-3">
      <a href="/" class="text-sm transition-colors hover:text-white" style="color: var(--text-muted);">
        ← Sessions
      </a>
      <div class="w-px h-4" style="background: var(--border-light);"></div>
      <div class="min-w-0">
        <h1 class="text-sm font-semibold truncate">{data.deck.title}</h1>
        <p class="text-xs truncate" style="color: var(--text-faint);">{data.deck.slug} · {data.deck.deck_dir}</p>
      </div>
      <button
        type="button"
        onclick={refresh}
        class="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
        style="background: var(--bg-card); color: var(--text-muted); border: 1px solid var(--border-subtle);"
      >Refresh</button>
    </div>
  </div>

  <main class="max-w-7xl mx-auto p-4 sm:p-6 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_240px]">
    <!-- File list -->
    <aside class="rounded-lg border" style="border-color: var(--border-subtle); background: var(--bg-surface);">
      <div class="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide" style="color: var(--text-faint); border-bottom: 1px solid var(--border-subtle);">
        Files ({data.files.length})
      </div>
      <ul class="max-h-[70vh] overflow-y-auto py-1">
        {#each data.files as file (file.path)}
          <li>
            <form method="POST" action="?/open" use:enhance={() => {
              opening = file.path;
              return async ({ update }) => {
                await update({ reset: false });
                opening = null;
              };
            }}>
              <input type="hidden" name="path" value={file.path} />
              <button
                type="submit"
                disabled={opening === file.path}
                class="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors disabled:opacity-50"
                style="{opened?.path === file.path ? 'background: #6366F124; color: var(--text);' : 'color: var(--text-muted);'}"
              >
                <span class="truncate flex-1">{file.path}</span>
                <span class="text-[10px]" style="color: var(--text-faint);">{fmtBytes(file.size)}</span>
              </button>
            </form>
          </li>
        {/each}
        {#if data.files.length === 0}
          <li class="px-3 py-3 text-xs" style="color: var(--text-faint);">No files yet.</li>
        {/if}
      </ul>
    </aside>

    <!-- Editor -->
    <section class="rounded-lg border flex flex-col" style="border-color: var(--border-subtle); background: var(--bg-surface);">
      {#if !opened}
        <div class="flex flex-col items-center justify-center text-center py-24 px-6 text-sm" style="color: var(--text-faint);">
          <p class="font-medium" style="color: var(--text-muted);">Select a file to edit.</p>
          <p class="mt-1 text-xs">Saves use the deck cowork write-guard so concurrent edits surface as a 409.</p>
        </div>
      {:else}
        <div class="flex flex-wrap items-center gap-2 px-3 py-2 border-b text-xs" style="border-color: var(--border-subtle);">
          <span class="font-mono truncate" style="color: var(--text);">{opened.path}</span>
          <span class="px-1.5 py-0.5 rounded border text-[10px]" style="background: var(--bg-card); color: var(--text-faint); border-color: var(--border-subtle);">
            sha {shortHash(opened.sha256)}
          </span>
          <span class="text-[10px]" style="color: var(--text-faint);">mtime {fmtTime(opened.mtime_ms)}</span>
          {#if isDirty}
            <span class="px-1.5 py-0.5 rounded border text-[10px]" style="background: #F59E0B18; color: #F59E0B; border-color: #F59E0B33;">Unsaved</span>
          {/if}
          {#if lastSaved && lastSaved.path === opened.path}
            <span class="px-1.5 py-0.5 rounded border text-[10px]" style="background: #10B98118; color: #10B981; border-color: #10B98133;">Saved {fmtTime(lastSaved.mtime_ms)}</span>
          {/if}
        </div>

        {#if !opened.is_text}
          <div class="p-6 text-sm" style="color: var(--text-muted);">
            <p>This file isn't a text file we know how to edit in-line (or it exceeds the 512 kB editor cap). Edit it in your tool of choice and refresh.</p>
            <p class="mt-2 text-xs" style="color: var(--text-faint);">Size: {fmtBytes(opened.size)}</p>
          </div>
        {:else}
          <form
            method="POST"
            action="?/save"
            class="flex flex-col flex-1"
            use:enhance={() => {
              saving = true;
              return async ({ update }) => {
                await update({ reset: false });
                saving = false;
              };
            }}
          >
            <input type="hidden" name="path" value={opened.path} />
            <input type="hidden" name="base_hash" value={baseHash ?? ''} />
            <input type="hidden" name="if_match_mtime" value={baseMtime ?? ''} />
            <input type="hidden" name="actor" value="web" />
            <textarea
              name="content"
              bind:value={draft}
              spellcheck="false"
              class="flex-1 min-h-[50vh] resize-none px-4 py-3 text-xs font-mono outline-none"
              style="background: var(--bg-card); color: var(--text); border: 0;"
            ></textarea>

            <div class="flex items-center gap-2 px-3 py-2 border-t" style="border-color: var(--border-subtle);">
              <span class="text-[11px]" style="color: var(--text-faint);">
                base sha {shortHash(baseHash)} · base mtime {fmtTime(baseMtime)}
              </span>
              <button
                type="submit"
                disabled={saving || !isDirty}
                class="ml-auto px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-50"
                style="background: #6366F1; color: white;"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        {/if}

        {#if inlineError}
          <div class="mx-3 mb-3 rounded-md border px-3 py-2 text-xs" style="background: #EF444414; color: #F87171; border-color: #EF444433;">
            {inlineError}
          </div>
        {/if}
      {/if}
    </section>

    <!-- Audit rail -->
    <aside class="rounded-lg border" style="border-color: var(--border-subtle); background: var(--bg-surface);">
      <div class="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide" style="color: var(--text-faint); border-bottom: 1px solid var(--border-subtle);">
        Activity
      </div>
      <ol class="max-h-[70vh] overflow-y-auto p-2 space-y-2">
        {#each data.audit as event}
          <li class="rounded-md border px-2 py-1.5 text-[11px]" style="background: var(--bg-card); border-color: var(--border-subtle);">
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold" style="color: {event.type === 'conflict' ? '#F87171' : event.type === 'file_write' ? '#34D399' : 'var(--text)'};">
                {event.type}
              </span>
              <span style="color: var(--text-faint);">{new Date(event.ts).toLocaleTimeString()}</span>
            </div>
            {#if event.path}
              <div class="mt-0.5 truncate font-mono" style="color: var(--text-muted);">{event.path}</div>
            {/if}
            <div class="mt-0.5" style="color: var(--text-faint);">{event.actor}</div>
          </li>
        {/each}
        {#if data.audit.length === 0}
          <li class="text-xs px-2 py-2" style="color: var(--text-faint);">No audit entries yet.</li>
        {/if}
      </ol>
    </aside>
  </main>

  {#if conflict}
    <div class="fixed inset-0 z-30 flex items-center justify-center p-4" style="background: rgba(0,0,0,0.55);">
      <div class="w-full max-w-5xl rounded-lg border shadow-xl flex flex-col max-h-[90vh]" style="background: var(--bg-surface); border-color: var(--border-subtle);">
        <header class="px-4 py-3 border-b" style="border-color: var(--border-subtle);">
          <h2 class="text-sm font-semibold" style="color: #F87171;">Conflict — {conflict.path}</h2>
          <p class="text-xs mt-1" style="color: var(--text-muted);">{conflict.message}</p>
          <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono" style="color: var(--text-faint);">
            <div>expected sha: <span style="color: var(--text);">{shortHash(String(conflict.details.expected_base_hash ?? '') || null)}</span></div>
            <div>actual sha: <span style="color: var(--text);">{shortHash(String(conflict.details.actual_hash ?? '') || null)}</span></div>
            <div>expected mtime: <span style="color: var(--text);">{fmtTime(Number(conflict.details.expected_mtime_ms) || null)}</span></div>
            <div>actual mtime: <span style="color: var(--text);">{fmtTime(Number(conflict.details.actual_mtime_ms) || null)}</span></div>
          </dl>
        </header>

        <div class="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-2 gap-0 border-b" style="border-color: var(--border-subtle);">
          <div class="flex flex-col border-r" style="border-color: var(--border-subtle);">
            <div class="px-3 py-1.5 text-[11px] font-semibold uppercase" style="color: var(--text-faint); background: var(--bg-card);">
              Current on disk
            </div>
            <pre class="flex-1 overflow-auto p-3 text-xs font-mono whitespace-pre-wrap" style="color: var(--text); background: var(--bg);"
            >{conflict.current?.content ?? '(file is binary or unreadable)'}</pre>
          </div>
          <div class="flex flex-col">
            <div class="px-3 py-1.5 text-[11px] font-semibold uppercase" style="color: var(--text-faint); background: var(--bg-card);">
              Your edit
            </div>
            <pre class="flex-1 overflow-auto p-3 text-xs font-mono whitespace-pre-wrap" style="color: var(--text); background: var(--bg);"
            >{conflict.attempted_content}</pre>
          </div>
        </div>

        <footer class="px-4 py-3 flex flex-wrap items-center gap-2 justify-end">
          <button
            type="button"
            onclick={discardConflict}
            class="px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors"
            style="background: var(--bg-card); color: var(--text-muted); border-color: var(--border-subtle);"
          >Discard my edit</button>
          <button
            type="button"
            onclick={adoptCurrentBase}
            class="px-3 py-1.5 rounded-md text-xs font-semibold transition-colors"
            style="background: #6366F1; color: white;"
          >Reload current and re-apply edits</button>
        </footer>
      </div>
    </div>
  {/if}
</div>

<style>
  :global(body:has(.deck-editor-page)) {
    overflow: auto;
  }
</style>
