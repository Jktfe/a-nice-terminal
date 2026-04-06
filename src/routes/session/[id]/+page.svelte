<script>
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { useMessageStore } from '$lib/stores/messages.svelte';
  import { useSessionStore } from '$lib/stores/sessions.svelte';
  import MessageBubble from '$lib/components/MessageBubble.svelte';
  import MessageInput from '$lib/components/MessageInput.svelte';
  import CLIInput from '$lib/components/CLIInput.svelte';
  import Terminal from '$lib/components/Terminal.svelte';
  import ShareButton from '$lib/components/ShareButton.svelte';
  import { onMount } from 'svelte';

  const sessionId = $derived($page.params.id);
  const msgStore = useMessageStore();
  const sessionStore = useSessionStore();
  let session = $state(null);
  let mode = $state('chat');
  let signalMode = $state('xterm'); // 'xterm', 'signals', or 'raw'
  let showMenu = $state(false);

  onMount(async () => {
    const res = await fetch(`/api/sessions/${sessionId}`);
    session = await res.json();
    mode = session?.type === 'terminal' ? 'terminal' : 'chat';
    if (mode === 'chat') {
      await msgStore.load(sessionId);
    }
  });

  async function sendMessage(text) {
    await msgStore.send(sessionId, text);
  }

  // Two-call protocol: text then Enter with a small gap (v2 lesson — prevents bracketed paste issues)
  async function sendCommand(cmd) {
    const text = cmd.endsWith('\n') || cmd.endsWith('\r') ? cmd.slice(0, -1) : cmd;
    await fetch(`/api/sessions/${sessionId}/terminal/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: text }),
    });
    await new Promise(r => setTimeout(r, 5));
    await fetch(`/api/sessions/${sessionId}/terminal/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: '\r' }),
    });
  }

  async function copySessionId() {
    await navigator.clipboard.writeText(sessionId);
    showMenu = false;
  }

  async function renameSession() {
    const newName = prompt('New session name:', session?.name || '');
    if (!newName?.trim()) return;
    showMenu = false;
    await sessionStore.renameSession(sessionId, newName.trim());
    session = { ...session, name: newName.trim() };
  }

  async function deleteSession() {
    if (!confirm(`Delete session "${session?.name}"? This cannot be undone.`)) return;
    showMenu = false;
    await sessionStore.deleteSession(sessionId);
    goto('/');
  }
</script>

<div class="h-screen w-screen flex flex-col bg-[#0A1628] text-white overflow-hidden">
  <!-- Toolbar -->
  <div class="flex items-center justify-between px-4 py-3 h-16 border-b border-[var(--border-light)] bg-[#0A1628]/50 backdrop-blur-sm">
    <!-- Left: Back Button -->
    <button
      onclick={() => goto('/')}
      class="flex items-center gap-2 px-3 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#1E1E24] transition-all"
      title="Back to sessions"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      <span class="text-sm font-medium">Back</span>
    </button>

    <!-- Center: Session Name & Type -->
    <div class="flex-1 flex items-center justify-center min-w-0 px-4">
      <div class="text-center truncate">
        <h1 class="text-lg font-semibold truncate">
          {session?.name || 'Session'}
        </h1>
        <p class="text-xs text-gray-400 mt-0.5">
          {mode === 'chat' ? '💬 Chat Session' : '> Terminal Session'}
        </p>
      </div>
    </div>

    <!-- Right: Controls -->
    <div class="flex items-center gap-2">
      <!-- Mode Toggle -->
      <div class="flex gap-1 bg-[#1A1A22] rounded-lg p-1 border border-[var(--border-subtle)]">
        <button
          class="px-3 py-1.5 text-xs rounded transition-all duration-200"
          class:bg-[#6366F1]={mode === 'chat'}
          class:text-white={mode === 'chat'}
          class:text-gray-400={mode !== 'chat'}
          onclick={() => (mode = 'chat')}
          title="Chat mode"
        >
          💬 Chat
        </button>
        <button
          class="px-3 py-1.5 text-xs rounded transition-all duration-200"
          class:bg-[#22C55E]={mode === 'terminal'}
          class:text-white={mode === 'terminal'}
          class:text-gray-400={mode !== 'terminal'}
          onclick={() => (mode = 'terminal')}
          title="Terminal mode"
        >
          > Term
        </button>
      </div>

      <!-- Share Button -->
      {#if session}
        <ShareButton {sessionId} sessionType={session.type} />
      {/if}

      <!-- Menu -->
      <div class="relative">
        <button
          onclick={() => (showMenu = !showMenu)}
          class="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#1E1E24] transition-all"
          title="More options"
        >
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        </button>

        {#if showMenu}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="fixed inset-0 z-40"
            onclick={() => (showMenu = false)}
          ></div>
          <div class="absolute right-0 mt-2 w-48 bg-[#1A1A22] rounded-lg border border-[var(--border-light)] shadow-xl z-50 overflow-hidden">
            <button
              onclick={copySessionId}
              class="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-[#24242E] hover:text-white transition-colors border-b border-[var(--border-subtle)]"
            >
              📋 Copy Session ID
            </button>
            <button
              onclick={renameSession}
              class="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-[#24242E] hover:text-white transition-colors border-b border-[var(--border-subtle)]"
            >
              🔄 Rename Session
            </button>
            <button
              onclick={deleteSession}
              class="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
            >
              🗑️ Delete Session
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Content -->
  {#if mode === 'chat'}
    <!-- Chat Mode -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Messages -->
      <div class="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {#if msgStore.messages.length === 0}
          <div class="flex flex-col items-center justify-center h-full text-center">
            <div class="w-12 h-12 rounded-full bg-[#6366F1]/10 flex items-center justify-center mb-4">
              <span class="text-2xl">💬</span>
            </div>
            <h2 class="text-lg font-semibold text-white mb-1">Start a conversation</h2>
            <p class="text-gray-400 text-sm max-w-xs">
              Type a message below to begin chatting with your session
            </p>
          </div>
        {:else}
          {#each msgStore.messages as msg (msg.id)}
            <MessageBubble message={msg} />
          {/each}
        {/if}
      </div>

      <!-- Input -->
      <MessageInput onSend={sendMessage} />
    </div>
  {:else}
    <!-- Terminal Mode -->
    <div class="flex flex-col flex-1 overflow-hidden">
      <!-- View Mode Selector -->
      <div class="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-light)] bg-[#16161A]/50">
        <span class="text-xs text-gray-500 font-medium mr-2">VIEW:</span>
        <button
          class="px-2.5 py-1 text-xs rounded transition-all duration-200"
          class:bg-[#6366F1]={signalMode === 'xterm'}
          class:text-white={signalMode === 'xterm'}
          class:text-gray-400={signalMode !== 'xterm'}
          onclick={() => (signalMode = 'xterm')}
        >
          XTERM
        </button>
        <button
          class="px-2.5 py-1 text-xs rounded transition-all duration-200"
          class:bg-[#6366F1]={signalMode === 'signals'}
          class:text-white={signalMode === 'signals'}
          class:text-gray-400={signalMode !== 'signals'}
          onclick={() => (signalMode = 'signals')}
        >
          SIGNALS
        </button>
        <button
          class="px-2.5 py-1 text-xs rounded transition-all duration-200"
          class:bg-[#6366F1]={signalMode === 'raw'}
          class:text-white={signalMode === 'raw'}
          class:text-gray-400={signalMode !== 'raw'}
          onclick={() => (signalMode = 'raw')}
        >
          RAW
        </button>
      </div>

      <!-- Terminal Container -->
      <div class="flex-1 bg-[#0D0D12] overflow-hidden">
        {#if signalMode === 'xterm'}
          <Terminal {sessionId} />
        {:else if signalMode === 'signals'}
          <div class="flex flex-col items-center justify-center h-full text-center px-6">
            <div class="w-12 h-12 rounded-full bg-[#6366F1]/10 flex items-center justify-center mb-4">
              <span class="text-2xl">📊</span>
            </div>
            <p class="text-gray-300 font-medium mb-1">Signal view</p>
            <p class="text-gray-500 text-sm">Classifier integration pending</p>
          </div>
        {:else}
          <div class="flex flex-col items-center justify-center h-full text-center px-6">
            <div class="w-12 h-12 rounded-full bg-[#6366F1]/10 flex items-center justify-center mb-4">
              <span class="text-2xl">📝</span>
            </div>
            <p class="text-gray-300 font-medium mb-1">Raw buffer</p>
            <p class="text-gray-500 text-sm">Buffer integration pending</p>
          </div>
        {/if}
      </div>

      <!-- CLI Input -->
      <CLIInput onSubmit={sendCommand} />
    </div>
  {/if}
</div>
