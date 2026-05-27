<!--
  /settings — canonical home for preferences, identity, plugins, tools,
  skills, data, system + activity. Per Settings Home design contract
  2026-05-14 (Q1-Q7). Single-page anchored sections; per-route sub-pages
  deferred. Per Q7 + T2: Preferences/Identity/Skills/Activity render real
  data; Plugins/Tools/Data remain stubs (Tools admin+room-scoped per
  Q4 delta-2; Plugins gated on M-PLUGINS; Data export own slice).
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import SettingsTabs from '$lib/components/SettingsTabs.svelte';
  import QuickShortcutsBar from '$lib/components/QuickShortcutsBar.svelte';
  import CliVersionCard from '$lib/components/CliVersionCard.svelte';
  import DeckRootsCard from '$lib/components/DeckRootsCard.svelte';
  import { firstCapabilityRows } from '$lib/domain/capabilityLedger';
  import { theme } from '$lib/stores/theme.svelte';
  import { agentKinds } from '$lib/stores/agentKinds.svelte';
  import Explainable from '$lib/components/Explainable.svelte';

  let pendingAgent = $state('');
  function addAgent(): void {
    if (pendingAgent.trim().length === 0) return;
    agentKinds.add(pendingAgent.trim());
    pendingAgent = '';
  }

  type SkillEntry = { name: string; description: string };
  type Props = { data: { skills: SkillEntry[] } };
  let { data }: Props = $props();
  const skills = $derived<SkillEntry[]>(data.skills ?? []);

  const tabs = [
    { id: 'preferences', label: 'Preferences' },
    { id: 'shortcuts', label: 'Shortcuts' },
    { id: 'identity', label: 'Identity' },
    { id: 'voice', label: 'Voice' },
    { id: 'plugins', label: 'Plugins' },
    { id: 'tools', label: 'Tools' },
    { id: 'skills', label: 'Skills' },
    { id: 'data', label: 'Data' },
    { id: 'system', label: 'System' },
    { id: 'activity', label: 'Activity' }
  ];

  // Voice settings — read-only slice 3 (write path TBD with auth hardening).
  // Displays the current /api/voice/elevenlabs state + a Test Voice button
  // so JWPK / agents can verify the configured ElevenLabs key + voice ID
  // without leaving the Settings page.
  type VoiceConfig = {
    available: boolean;
    stage_provider: string;
    stage_autoplay: boolean;
    browser_fallback_allowed: boolean;
    default_voice_id: string;
    default_model_id: string;
  };
  let voiceConfig = $state<VoiceConfig | null>(null);
  let voiceLoadError = $state('');
  let testVoiceStatus = $state<'idle' | 'playing' | 'error'>('idle');
  let testVoiceNotice = $state('');
  let testAudio: HTMLAudioElement | null = null;

  async function loadVoiceConfig(): Promise<void> {
    try {
      const response = await fetch('/api/voice/elevenlabs');
      if (!response.ok) {
        voiceLoadError = `Could not load voice config (HTTP ${response.status}).`;
        return;
      }
      voiceConfig = await response.json();
      voiceLoadError = '';
    } catch {
      voiceLoadError = 'Could not load voice config (network).';
    }
  }

  async function testVoice(): Promise<void> {
    if (testVoiceStatus === 'playing' && testAudio) {
      testAudio.pause();
      testAudio = null;
      testVoiceStatus = 'idle';
      testVoiceNotice = 'Test stopped.';
      return;
    }
    if (!voiceConfig?.available) {
      testVoiceNotice = 'ElevenLabs API key not configured on the server.';
      return;
    }
    testVoiceStatus = 'playing';
    testVoiceNotice = 'Synthesising...';
    try {
      const response = await fetch('/api/voice/elevenlabs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: 'This is a test of the Stage voice. Hello from ANT settings.'
        })
      });
      if (!response.ok) {
        testVoiceStatus = 'error';
        testVoiceNotice = `Voice test failed (HTTP ${response.status}).`;
        return;
      }
      const cacheState = response.headers.get('X-ANT-Voice-Cache') ?? 'unknown';
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      testAudio = new Audio(url);
      testAudio.onended = () => {
        testVoiceStatus = 'idle';
        testVoiceNotice = `Done. Cache: ${cacheState}.`;
        URL.revokeObjectURL(url);
        testAudio = null;
      };
      testAudio.onerror = () => {
        testVoiceStatus = 'error';
        testVoiceNotice = 'Audio playback failed.';
        URL.revokeObjectURL(url);
        testAudio = null;
      };
      await testAudio.play();
      testVoiceNotice = `Playing... (cache: ${cacheState})`;
    } catch {
      testVoiceStatus = 'error';
      testVoiceNotice = 'Voice test failed (network).';
    }
  }

  // Load voice config on mount (browser only).
  if (typeof window !== 'undefined') {
    void loadVoiceConfig();
  }
</script>

<svelte:head>
  <title>Settings | ANT vNext</title>
</svelte:head>

<SimplePageShell
  eyebrow="Preferences"
  title="Settings."
  summary="Configure your fresh-ANT client. Plugins, tools, and skills surface from the shared layer; preferences and identity are per-client."
>
  <SettingsTabs {tabs} />

  <section id="preferences" class="settings-section">
    <h2>Preferences</h2>
    <div class="row">
      <span>Theme</span>
      <button type="button" class="btn" onclick={() => theme.toggle()}>
        {theme.isDark ? 'Light mode' : 'Dark mode'}
      </button>
    </div>
    <p class="stub-note">Chat preferences, memory-recall toggle, and room defaults land in a follow-up slice.</p>
  </section>

  <section id="shortcuts" class="settings-section">
    <h2>Quick shortcuts</h2>
    <p class="stub-note">Chips surfaced at the bottom of every terminal. Click a chip to send its text into the PTY; pencil to edit. Edits sync across devices.</p>
    <QuickShortcutsBar layout="list" />
  </section>

  <section id="identity" class="settings-section">
    <h2>Identity</h2>
    <p class="stub-note">Handle, fingerprint, and registration status surface here once <code>/api/identity/me</code> is wired. Today: outbound chat is stamped with whatever the CLI register flow set, or <code>@you</code> for unregistered browser sessions.</p>
  </section>

  <section id="voice" class="settings-section">
    <h2>Voice</h2>
    {#if voiceLoadError}
      <p class="stub-note">{voiceLoadError}</p>
    {:else if voiceConfig === null}
      <p class="stub-note">Loading voice config…</p>
    {:else}
      <div class="row">
        <span>Provider</span>
        <code>{voiceConfig.stage_provider}</code>
      </div>
      <div class="row">
        <span>ElevenLabs API key</span>
        <code>{voiceConfig.available ? 'configured ✓' : 'not configured'}</code>
      </div>
      <div class="row">
        <span>Voice ID</span>
        <code>{voiceConfig.default_voice_id}</code>
      </div>
      <div class="row">
        <span>Model</span>
        <code>{voiceConfig.default_model_id}</code>
      </div>
      <div class="row">
        <span>Autoplay on slide change</span>
        <code>{voiceConfig.stage_autoplay ? 'on' : 'off'}</code>
      </div>
      <div class="row">
        <span>Test voice</span>
        <button type="button" class="btn" onclick={testVoice} disabled={!voiceConfig.available && testVoiceStatus !== 'playing'}>
          {testVoiceStatus === 'playing' ? 'Stop test' : 'Test voice'}
        </button>
      </div>
      {#if testVoiceNotice}
        <p class="stub-note" role="status">{testVoiceNotice}</p>
      {/if}
      <p class="stub-note">
        Configuration today is server-env only — set <code>ELEVENLABS_API_KEY</code> + <code>ELEVENLABS_DEFAULT_VOICE_ID</code> in <code>~/.ant/secrets.env</code>.
        Write-from-UI lands in a follow-up slice with admin-auth gate. Per JWPK voice spec 2026-05-22.
      </p>
    {/if}
  </section>

  <section id="plugins" class="settings-section">
    <h2>Plugins</h2>
    <p class="stub-note">Plugin discovery + enable/disable lands with the M-PLUGINS slice. No plugins discovered yet.</p>
  </section>

  <section id="tools" class="settings-section">
    <h2>Tools (MCP)</h2>
    <p class="stub-note">MCP tools inventory lands when <code>/api/mcp/grants</code> read-side ships in this UI. Today: see <code>ant skill mcp</code> for canonical list.</p>

    <h3 class="sub-heading">Available agent kinds</h3>
    <p class="stub-note">Labels shown in the terminal header dropdown + claim modal. Custom labels can map to canonical classifier kinds via server-side aliases.</p>
    <div class="agent-pills">
      {#each agentKinds.enabled as kind (kind)}
        <span class="agent-pill">
          {kind}
          <button type="button" class="pill-remove" onclick={() => agentKinds.remove(kind)} aria-label={`Remove ${kind}`}>×</button>
        </span>
      {/each}
    </div>
    <form class="agent-add" onsubmit={(e) => { e.preventDefault(); addAgent(); }}>
      <input type="text" bind:value={pendingAgent} placeholder="e.g. perplexity" aria-label="New agent label" />
      <button type="submit" class="btn">Add</button>
      <button type="button" class="btn-secondary" onclick={() => agentKinds.reset()}>Reset to defaults</button>
    </form>
  </section>

  <section id="skills" class="settings-section">
    <h2>Skills ({skills.length})</h2>
    {#if skills.length === 0}
      <p class="stub-note">No skills found. Today: <code>ant skill list</code> via CLI.</p>
    {:else}
      <ul class="skill-list">
        {#each skills as skill}
          <li>
            <strong>{skill.name}</strong>
            <p>{skill.description}</p>
          </li>
        {/each}
      </ul>
    {/if}
    <p class="stub-note">Skills manifest is at <code>static/skills.json</code> (kept in sync with <code>ant skill list</code> for v1).</p>
  </section>

  <section id="data" class="settings-section">
    <h2>Data</h2>
    <p class="stub-note">Export, backup, and prune controls land in the Data slice. Today: <code>ant sessions export</code> for per-session evidence.</p>
  </section>

  <section id="system" class="settings-section">
    <h2>System</h2>
    <CliVersionCard />
    <DeckRootsCard />
    <p class="stub-note system-stub">Server status + certs widget lands in the server-status slice (claude2 NAV-POLISH followup).</p>
  </section>

  <section id="activity" class="settings-section">
    <h2>Activity</h2>
    <p class="stub-note">Capability ledger — every feature gets a keep / change / dedupe / defer / reject status.</p>
    <ul class="activity-list" aria-label="Capability activity preview">
      {#each firstCapabilityRows as row}
        <li>
          <span class="status-pill">{row.status}</span>
          <div>
            <strong>{row.capability}</strong>
            <p>{row.note}</p>
            <small>{row.source} / {row.owner}</small>
          </div>
        </li>
      {/each}
    </ul>
  </section>
</SimplePageShell>

<style>
  .settings-section {
    margin-top: 2rem;
    padding: 1.25rem;
    border-radius: 1.2rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    scroll-margin-top: 5rem;
  }
  .settings-section h2 { margin: 0 0 0.75rem; font-size: 1.25rem; }
  .stub-note { margin: 0; color: var(--ink-soft); line-height: 1.55; }
  .stub-note code {
    padding: 0.05rem 0.35rem;
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
    background: var(--bg);
    border-radius: 0.3rem;
  }
  .row { display: flex; align-items: center; gap: 0.85rem; margin-bottom: 0.55rem; }
  .row span { font-weight: 800; }
  .btn {
    padding: 0.4rem 0.85rem;
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: var(--accent);
    color: white;
    font-weight: 800;
    cursor: pointer;
  }
  :global(:root[data-theme='dark']) .btn { color: #101607; }
  .activity-list { list-style: none; margin: 0.85rem 0 0; padding: 0; display: grid; gap: 0.5rem; }
  .activity-list li {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.85rem;
    padding: 0.85rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.85rem;
    background: var(--bg);
  }
  .status-pill {
    height: fit-content;
    padding: 0.35rem 0.6rem;
    border-radius: 999px;
    color: white;
    background: var(--accent);
    font-size: 0.72rem;
    font-weight: 900;
  }
  :global(:root[data-theme='dark']) .status-pill { color: #101607; }
  .skill-list { list-style: none; margin: 0.85rem 0 1rem; padding: 0; display: grid; gap: 0.55rem; }
  .skill-list li {
    padding: 0.85rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.85rem;
    background: var(--bg);
  }
  .skill-list strong { font-size: 1rem; color: var(--ink-strong); }
  .skill-list p { margin: 0.3rem 0 0; color: var(--ink-soft); font-size: 0.9rem; }
  .activity-list strong { font-size: 1rem; }
  .activity-list p { margin: 0.25rem 0 0; color: var(--ink-soft); }
  .activity-list small { display: block; margin-top: 0.4rem; color: var(--ink-muted); font-weight: 800; }
  .sub-heading { margin: 0.85rem 0 0.35rem; font-size: 0.9rem; color: var(--ink-strong); font-weight: 700; }
  .agent-pills { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0.55rem 0; }
  .agent-pill {
    display: inline-flex; align-items: center; gap: 0.3rem;
    padding: 0.3rem 0.5rem 0.3rem 0.7rem; border-radius: 999px;
    border: 1px solid var(--line-soft); background: var(--bg); color: var(--ink-strong);
    font-family: ui-monospace, monospace; font-size: 0.85rem;
  }
  .pill-remove {
    width: 1.3rem; height: 1.3rem; padding: 0; border-radius: 50%;
    border: none; background: transparent; color: var(--ink-soft); cursor: pointer;
    font-size: 1rem; line-height: 1;
  }
  .pill-remove:hover { color: var(--accent); background: var(--surface-card); }
  .agent-add { display: flex; gap: 0.45rem; align-items: center; flex-wrap: wrap; }
  .agent-add input {
    padding: 0.45rem 0.6rem; border-radius: 0.45rem; border: 1px solid var(--line-soft);
    background: var(--surface-card); color: var(--ink-strong); flex: 1 1 12rem; min-width: 8rem;
  }
  .btn-secondary {
    padding: 0.45rem 0.85rem; border-radius: 0.45rem;
    border: 1px solid var(--line-soft); background: var(--surface-card); color: var(--ink-strong);
    font-weight: 600; cursor: pointer;
  }
</style>
