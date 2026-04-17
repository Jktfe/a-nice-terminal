<script lang="ts">
  import { goto } from '$app/navigation';
  import ShareButton from '$lib/components/ShareButton.svelte';
  import { theme } from '$lib/stores/theme.svelte';
  import { CLI_MODES } from '$lib/cli-modes';
  import { TTL_OPTIONS } from '$lib/stores/sessions.svelte';

  interface PageSession {
    id: string;
    name: string;
    type: string;
    handle?: string;
    display_name?: string;
    linked_chat_id?: string | null;
    ttl?: string;
    cli_flag?: string | null;
  }

  interface Props {
    session: PageSession | null;
    mode: string;
    showPanel: boolean;
    showMenu: boolean;
    sessionId: string;
    openTaskCount: number;
    onModeChange: (m: string) => void;
    onPanelToggle: () => void;
    onMenuToggle: () => void;
    onMenuClose: () => void;
    onCopyId: () => void;
    onRename: (newName: string) => void;
    onDelete: () => void;
    onCopyTmux: () => void;
    onCliFlagChange: (slug: string | null) => void;
    onChangeTtl: (ttl: string) => void;
  }

  const {
    session,
    mode,
    showPanel,
    showMenu,
    sessionId,
    openTaskCount,
    onModeChange,
    onPanelToggle,
    onMenuToggle,
    onMenuClose,
    onCopyId,
    onRename,
    onDelete,
    onCopyTmux,
    onCliFlagChange,
    onChangeTtl,
  }: Props = $props();

  let editingName = $state(false);
  let nameInput = $state('');
  let showTmuxMenu = $state(false);
  let showPersistenceMenu = $state(false);

  // Close dropdowns on outside click — uses window listener instead of backdrop overlay
  // (Svelte 5's synchronous DOM rendering causes backdrop onclick to fire on the same click that opens it)
  function onWindowClick(e: MouseEvent) {
    if (showTmuxMenu) {
      const tmuxWrapper = document.querySelector('[data-tmux-dropdown]');
      if (tmuxWrapper && !tmuxWrapper.contains(e.target as Node)) {
        showTmuxMenu = false;
      }
    }
    if (showMenu) {
      const menuWrapper = (e.target as Element)?.closest('[aria-label="Session menu"]')?.parentElement;
      if (!menuWrapper?.contains(e.target as Node)) {
        showPersistenceMenu = false;
        onMenuClose();
      }
    }
  }

  function copyTmuxCmd(cmd: string) {
    navigator.clipboard.writeText(cmd).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = cmd; ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    });
    showTmuxMenu = false;
    const btn = document.querySelector('[title="Copy tmux attach command"]');
    if (btn) {
      const orig = btn.querySelector('span')?.textContent;
      const span = btn.querySelector('span');
      if (span) { span.textContent = '✓ Copied!'; setTimeout(() => { span.textContent = orig || 'tmux'; }, 1500); }
    }
  }

  function startEditName() {
    nameInput = session?.name || '';
    editingName = true;
  }

  function commitEditName() {
    const trimmed = nameInput.trim();
    if (trimmed && trimmed !== session?.name) {
      onRename(trimmed);
    }
    editingName = false;
  }

  function handleNameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') commitEditName();
    if (e.key === 'Escape') editingName = false;
  }
</script>

<svelte:window onclick={onWindowClick} />

<div
  class="flex items-center px-2 sm:px-3 h-13 border-b flex-shrink-0 gap-1 sm:gap-2 min-w-0"
  style="border-color: #E5E7EB; background: var(--bg); min-height: 52px;"
>
  <!-- ANT logo + back -->
  <button
    onclick={() => goto('/')}
    class="flex items-center gap-1 sm:gap-2 flex-shrink-0 rounded-lg px-1 sm:px-1.5 py-1 transition-all"
    style="color: var(--text-muted);"
    title="Back to sessions"
  >
    <img
      src={theme.dark ? '/ANTlogo.png' : '/ANTlogo-black-text.png'}
      alt="ANT"
      class="hidden sm:block h-6 w-auto object-contain"
    />
    <svg class="w-4 h-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
    </svg>
  </button>

  <!-- Divider -->
  <div class="w-px h-5 flex-shrink-0" style="background:#E5E7EB;"></div>

  <!-- Editable session name -->
  <div class="flex items-center gap-1 sm:gap-1.5 flex-1 min-w-0 overflow-hidden">
    {#if editingName}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        autofocus
        bind:value={nameInput}
        onblur={commitEditName}
        onkeydown={handleNameKeydown}
        class="text-sm font-semibold rounded px-2 py-0.5 outline-none min-w-0 max-w-[260px]"
        style="border: 1.5px solid #6366F1; color: var(--text); background: var(--bg);"
      />
    {:else}
      <button
        onclick={startEditName}
        class="flex items-center gap-1.5 group min-w-0"
        title="Click to rename"
      >
        <span class="text-sm font-semibold truncate" style="color: var(--text);">
          {session?.name || 'Session'}
        </span>
        <svg class="w-3.5 h-3.5 flex-shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:var(--text-muted);">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H7v-3a2 2 0 01.586-1.414z"/>
        </svg>
      </button>
    {/if}
    {#if session?.handle}
      <span class="text-[11px] font-mono flex-shrink-0" style="color:#22C55E;">{session.handle}</span>
    {/if}
  </div>

  <!-- CLI mode buttons — only for terminal sessions -->
  {#if session?.type === 'terminal'}
    <div class="flex items-center gap-0.5 overflow-x-auto flex-shrink-0 max-w-[50%]" style="scrollbar-width: none;">
      {#each CLI_MODES as mode}
        <button
          class="flex-shrink-0 px-1.5 py-0.5 text-[10px] rounded-md transition-all border"
          style={session.cli_flag === mode.slug
            ? 'background: #6366F1; color: #fff; border-color: #6366F1;'
            : 'background: transparent; color: var(--text-muted); border-color: transparent;'}
          title={mode.label}
          onclick={() => {
            if (session?.cli_flag === mode.slug) {
              onCliFlagChange(null);
            } else {
              onCliFlagChange(mode.slug);
            }
          }}
        >
          <span class="mr-0.5">{mode.icon}</span>{mode.label}
        </button>
      {/each}
    </div>
  {/if}

  <!-- Spacer -->
  <div class="flex-1"></div>

  <!-- Right-side controls -->
  <div class="flex items-center gap-1 flex-shrink-0">

    <!-- Mode toggle — only for terminal sessions -->
    {#if session?.type === 'terminal'}
      <div
        class="flex rounded-full p-0.5"
        style="background: #F3F4F6; border: 1px solid #E5E7EB;"
      >
        <button
          class="px-2.5 py-1 text-xs rounded-full font-medium transition-all"
          style={mode === 'chat'
            ? 'background: #6366F1; color: #fff;'
            : 'color: #6B7280; background: transparent;'}
          onclick={() => onModeChange('chat')}
          title="Chat view"
        >💬</button>
        <button
          class="px-2.5 py-1 text-xs rounded-full font-medium transition-all"
          style={mode === 'terminal'
            ? 'background: #22C55E; color: #fff;'
            : 'color: #6B7280; background: transparent;'}
          onclick={() => onModeChange('terminal')}
          title="Terminal text view"
        >⌨</button>
      </div>

      <!-- tmux dropdown: local or SSH -->
      <div class="relative" data-tmux-dropdown>
        <button
          class="flex items-center gap-1.5 p-1.5 sm:px-2.5 sm:py-1.5 text-xs rounded-lg border transition-all"
          style="border-color: var(--border-subtle); color: var(--text-muted); background: var(--bg-card);"
          title="Copy tmux attach command"
          onclick={() => { showTmuxMenu = !showTmuxMenu; }}
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M8 5H6a2 2 0 00-2 2v11a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/>
          </svg>
          <span class="hidden sm:inline">tmux</span>
        </button>
        {#if showTmuxMenu}
          <div class="absolute right-0 top-10 z-50 w-72 rounded-lg border shadow-xl overflow-hidden text-xs"
               style="background:var(--bg-card);border-color:var(--border-light);">
            <button
              class="w-full text-left px-3 py-2.5 border-b transition-colors flex items-center gap-2"
              style="color:var(--text);border-color:var(--border-subtle);"
              onclick={() => { copyTmuxCmd(`tmux attach-session -t ${sessionId}`); }}
            >
              <span style="color:var(--text-muted);">💻</span>
              <div>
                <p class="font-medium">Local</p>
                <p style="color:var(--text-faint);">tmux attach-session -t {sessionId.slice(0,12)}…</p>
              </div>
            </button>
            <button
              class="w-full text-left px-3 py-2.5 transition-colors flex items-center gap-2"
              style="color:var(--text);"
              onclick={() => { copyTmuxCmd(`ssh ${window.location.hostname} -t tmux attach-session -t ${sessionId}`); }}
            >
              <span style="color:var(--text-muted);">🌐</span>
              <div>
                <p class="font-medium">SSH (Tailscale)</p>
                <p style="color:var(--text-faint);">ssh [host] -t tmux attach…</p>
              </div>
            </button>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Share -->
    {#if session}
      <ShareButton {sessionId} sessionType={session.type} />
    {/if}

    <!-- Moon / sun theme toggle -->
    <button
      onclick={() => theme.toggle()}
      class="hidden sm:flex p-1.5 rounded-lg transition-all"
      style="color: var(--text-muted);"
      title="Toggle theme"
    >
      {#if theme.dark}
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z"/>
        </svg>
      {:else}
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
        </svg>
      {/if}
    </button>

    <!-- Docs link -->
    <a
      href="/help"
      class="hidden sm:flex p-1.5 rounded-lg transition-all"
      style="color: var(--text-muted);"
      title="Documentation"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
      </svg>
    </a>

    <!-- Panel toggle -->
    <button
      onclick={onPanelToggle}
      class="relative p-1.5 rounded-lg transition-all"
      style={showPanel ? 'color: #6366F1;' : 'color: var(--text-muted);'}
      title="Toggle side panel"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <rect x="3" y="3" width="18" height="18" rx="2" stroke-width="2"/>
        <line x1="15" y1="3" x2="15" y2="21" stroke-width="2"/>
        {#if showPanel}
          <polyline points="11,9 8,12 11,15" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        {:else}
          <polyline points="9,9 12,12 9,15" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        {/if}
      </svg>
      {#if openTaskCount > 0}
        <span
          class="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center text-white"
          style="background: #6366F1;"
        >{openTaskCount}</span>
      {/if}
    </button>

    <!-- Three-dot menu -->
    <div class="relative">
      <button
        onclick={onMenuToggle}
        class="p-1.5 rounded-lg transition-all"
        style="color: var(--text-muted);"
        aria-label="Session menu"
      >
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="5" r="1.8"/>
          <circle cx="12" cy="12" r="1.8"/>
          <circle cx="12" cy="19" r="1.8"/>
        </svg>
      </button>
      {#if showMenu}
        <div
          class="absolute right-0 mt-1 w-44 rounded-xl border shadow-xl z-50 overflow-hidden text-sm"
          style="background: var(--bg-card); border-color: #E5E7EB;"
        >
          <button
            onclick={onCopyId}
            class="w-full text-left px-3 py-2 border-b transition-colors hover:bg-gray-50 dark:hover:bg-white/5"
            style="color: var(--text-muted); border-color: #F3F4F6;"
          >
            <span class="inline-flex items-center gap-2">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
              </svg>
              Copy ID
            </span>
          </button>
          <button
            onclick={() => { onMenuClose(); startEditName(); }}
            class="w-full text-left px-3 py-2 border-b transition-colors hover:bg-gray-50 dark:hover:bg-white/5"
            style="color: var(--text-muted); border-color: #F3F4F6;"
          >
            <span class="inline-flex items-center gap-2">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H7v-3a2 2 0 01.586-1.414z"/>
              </svg>
              Rename
            </span>
          </button>
          <button
            onclick={() => { showPersistenceMenu = !showPersistenceMenu; }}
            class="w-full text-left px-3 py-2 border-b transition-colors hover:bg-gray-50 dark:hover:bg-white/5"
            style="color: var(--text-muted); border-color: #F3F4F6;"
          >
            <span class="inline-flex items-center gap-2 w-full">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              Persistence
              <span class="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded"
                style={session?.ttl === 'forever'
                  ? 'background: rgba(34,197,94,0.15); color: #22C55E;'
                  : 'background: rgba(99,102,241,0.12); color: #6366F1;'}>
                {TTL_OPTIONS.find(o => o.value === session?.ttl)?.label ?? session?.ttl ?? '—'}
              </span>
            </span>
          </button>
          {#if showPersistenceMenu}
            <div class="border-b" style="border-color: #F3F4F6; background: var(--bg);">
              {#each TTL_OPTIONS as opt}
                <button
                  onclick={() => {
                    onChangeTtl(opt.value);
                    showPersistenceMenu = false;
                    onMenuClose();
                  }}
                  class="w-full text-left px-4 py-1.5 text-xs transition-colors hover:bg-gray-50 dark:hover:bg-white/5 flex items-center gap-2"
                  style={session?.ttl === opt.value
                    ? 'color: #6366F1; font-weight: 600;'
                    : 'color: var(--text-muted);'}
                >
                  {#if session?.ttl === opt.value}
                    <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
                    </svg>
                  {:else}
                    <span class="w-3"></span>
                  {/if}
                  {opt.label}
                  {#if opt.value === 'forever'}
                    <span class="text-[9px]">⚡</span>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
          <button
            onclick={onDelete}
            class="w-full text-left px-3 py-2 transition-colors text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
          >
            <span class="inline-flex items-center gap-2">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2"/>
              </svg>
              Delete
            </span>
          </button>
        </div>
      {/if}
    </div>
  </div>
</div>
