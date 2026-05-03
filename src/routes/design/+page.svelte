<script lang="ts">
  import { NOCTURNE, AGENTS, surfaceTokens } from '$lib/nocturne';
  import AgentCard from '$lib/components/AgentCard.svelte';
  import ChatRow from '$lib/components/ChatRow.svelte';
  import ToolCallBlock from '$lib/components/ToolCallBlock.svelte';
  import Composer from '$lib/components/Composer.svelte';
  import InlineCode from '$lib/components/InlineCode.svelte';
  import Grain from '$lib/components/Grain.svelte';
  import CommandBlock from '$lib/components/CommandBlock.svelte';
  import { sampleRunEvents } from '$lib/components/CommandBlock/_fixture';

  let mode: 'dark' | 'light' = $state('dark');
  const s = $derived(surfaceTokens(mode));
  const isDark = $derived(mode === 'dark');

  // M3 CommandBlock visual harness — backs R4 §6 acceptance gate.
  const cbEvents = sampleRunEvents;
  function handleRerun(cmd: string, id: string) { console.log('rerun', id, cmd); }
  function handleBookmark(id: string) { console.log('bookmark', id); }
  function handleRespond(promptId: string, choice: string) { console.log('respond', promptId, choice); }
</script>

<svelte:head>
  <title>ANT · Nocturne — Components v1</title>
</svelte:head>

<div
  class="min-h-screen overflow-auto"
  style="background: {mode === 'dark' ? '#E8E6E0' : '#E8E6E0'}; font-family: var(--font-sans);"
>
  <!-- Mode toggle -->
  <div class="fixed top-4 right-4 z-50 flex gap-2">
    <button
      class="px-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer"
      style="
        background: {mode === 'dark' ? '#1B1A15' : 'transparent'};
        color: {mode === 'dark' ? '#E3E7F0' : '#5A584B'};
        border: 1px solid {mode === 'dark' ? '#363E58' : '#DAD9D2'};
      "
      onclick={() => mode = 'dark'}
    >Dark</button>
    <button
      class="px-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer"
      style="
        background: {mode === 'light' ? '#FFFFFF' : 'transparent'};
        color: {mode === 'light' ? '#1B1A15' : '#5A584B'};
        border: 1px solid {mode === 'light' ? '#DAD9D2' : '#DAD9D2'};
      "
      onclick={() => mode = 'light'}
    >Light</button>
  </div>

  <!-- ═══════════════ Agent Card Section ═══════════════ -->
  <div class="p-10">
    <h2 class="text-lg font-semibold mb-6" style="color: #2A2922; letter-spacing: -0.02em;">
      Agent Card — Workspace Context
    </h2>

    <div
      class="relative rounded-2xl overflow-hidden"
      style="
        background: {s.bg};
        padding: 40px;
        color: {s.text};
      "
    >
      <!-- Interior light -->
      <div
        aria-hidden="true"
        class="absolute inset-0 pointer-events-none"
        style="
          background: {isDark
            ? 'radial-gradient(80% 60% at 20% 0%, rgba(59,130,246,0.14) 0%, transparent 60%), radial-gradient(60% 50% at 85% 20%, rgba(52,208,111,0.08) 0%, transparent 60%)'
            : 'radial-gradient(80% 60% at 20% 0%, rgba(59,130,246,0.08) 0%, transparent 60%), radial-gradient(60% 50% at 85% 20%, rgba(52,208,111,0.05) 0%, transparent 60%)'};
        "
      ></div>
      {#if isDark}
        <Grain opacity={0.025} />
      {/if}

      <div class="relative z-10">
        <!-- Header bar -->
        <div
          class="flex items-center gap-3.5 pb-4 mb-7"
          style="border-bottom: 0.5px solid {s.hairline};"
        >
          <img src="/ant-logo.png" alt="ANT" style="height: 36px; width: auto;" onerror={(e: Event) => { (e.currentTarget as HTMLElement).style.display = 'none'; }} />
          <div class="flex-1"></div>
          <div
            style="
              font-family: var(--font-mono);
              font-size: 11px;
              color: {s.textFaint};
              padding: 5px 10px;
              border-radius: 6px;
              background: {isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)'};
              border: 0.5px solid {s.hairline};
            "
          >
            <span style="color: {isDark ? NOCTURNE.emerald[400] : NOCTURNE.emerald[600]};">●</span>
            3 colonists · 1 thinking
          </div>
          <div
            style="
              font-size: 11px;
              letter-spacing: 1.2px;
              text-transform: uppercase;
              font-weight: 600;
              color: {s.textFaint};
            "
          >{mode} mode</div>
        </div>

        <!-- Section label -->
        <div class="mb-4">
          <div
            style="
              font-size: 11px;
              font-weight: 700;
              letter-spacing: 1.4px;
              text-transform: uppercase;
              color: {s.textFaint};
              font-family: var(--font-mono);
            "
          >Agent Card · workspace context</div>
          <div style="font-size: 13px; color: {s.textMuted}; margin-top: 4px; max-width: 580px; letter-spacing: -0.005em;">
            The unit in the Workspace Context panel. Hover a card for the handoff affordance. Thinking state streams the eye-gradient through the shimmer.
          </div>
        </div>

        <div class="grid grid-cols-3 gap-4 mb-9">
          <AgentCard id="claude" name="Claude" model="sonnet-4.5" status="active" signal={4} location="cloud" themeMode={mode} />
          <AgentCard id="gemini" name="Gemini" model="2.5-pro" status="thinking" thinkingLabel="Reviewing diff…" signal={3} location="cloud" themeMode={mode} />
          <AgentCard id="ollama" name="Ollama" model="qwen2.5-coder:32b" status="idle" signal={4} location="local" themeMode={mode} />
        </div>

        <!-- States -->
        <div class="mb-4">
          <div
            style="
              font-size: 11px;
              font-weight: 700;
              letter-spacing: 1.4px;
              text-transform: uppercase;
              color: {s.textFaint};
              font-family: var(--font-mono);
            "
          >States</div>
          <div style="font-size: 13px; color: {s.textMuted}; margin-top: 4px;">All four states, for reference.</div>
        </div>
        <div class="grid grid-cols-4 gap-4">
          <AgentCard id="codex" name="Codex" model="gpt-5.1" status="active" signal={4} location="cloud" themeMode={mode} />
          <AgentCard id="copilot" name="Copilot" model="gpt-5" status="thinking" thinkingLabel="Generating…" signal={3} location="cloud" themeMode={mode} />
          <AgentCard id="lmstudio" name="LM Studio" model="llama-3.3-70b" status="idle" signal={2} location="local" themeMode={mode} />
          <AgentCard id="gemini" name="Gemini" model="2.5-pro" status="offline" signal={0} location="cloud" themeMode={mode} />
        </div>
      </div>
    </div>
  </div>

  <!-- ═══════════════ Chat Row Section ═══════════════ -->
  <div class="p-10 pt-0">
    <h2 class="text-lg font-semibold mb-6" style="color: #2A2922; letter-spacing: -0.02em;">
      Chat Row — message, tool call, composer
    </h2>

    <div
      class="relative rounded-2xl overflow-hidden"
      style="
        background: {s.bg};
        padding: 40px;
        color: {s.text};
      "
    >
      <!-- Interior light -->
      <div
        aria-hidden="true"
        class="absolute inset-0 pointer-events-none"
        style="
          background: {isDark
            ? 'radial-gradient(80% 60% at 50% 0%, rgba(59,130,246,0.14) 0%, transparent 60%), radial-gradient(60% 50% at 85% 20%, rgba(52,208,111,0.08) 0%, transparent 60%)'
            : 'radial-gradient(80% 60% at 50% 0%, rgba(59,130,246,0.08) 0%, transparent 60%), radial-gradient(60% 50% at 85% 20%, rgba(52,208,111,0.05) 0%, transparent 60%)'};
        "
      ></div>
      {#if isDark}
        <Grain opacity={0.025} />
      {/if}

      <div class="relative z-10">
        <!-- Section label -->
        <div class="mb-4">
          <div
            style="
              font-size: 11px;
              font-weight: 700;
              letter-spacing: 1.4px;
              text-transform: uppercase;
              color: {s.textFaint};
              font-family: var(--font-mono);
            "
          >Chat Row · #deploy</div>
          <div style="font-size: 13px; color: {s.textMuted}; margin-top: 4px; max-width: 580px; letter-spacing: -0.005em;">
            A user message, an agent reply with inline code, and a tool call awaiting approval. Hover a row for reply/thread/ask-Claude affordances.
          </div>
        </div>

        <!-- Glasshouse chat panel -->
        <div
          class="relative overflow-hidden"
          style="
            background: {s.elev};
            border-radius: var(--radius-panel);
            padding: 8px;
            box-shadow: inset 0 0 0 0.5px {s.hairlineStrong}
              {isDark
                ? ', 0 1px 0 rgba(0,0,0,0.25), 0 20px 50px -30px rgba(0,0,0,0.6)'
                : ', 0 1px 0 rgba(0,0,0,0.02), 0 16px 40px -28px rgba(0,0,0,0.12)'};
          "
        >
          <!-- Interior glow -->
          <div
            aria-hidden="true"
            class="absolute inset-0 rounded-[inherit] pointer-events-none"
            style="
              background: {isDark
                ? 'radial-gradient(50% 30% at 50% 0%, rgba(59,130,246,0.10) 0%, transparent 70%)'
                : 'radial-gradient(50% 30% at 50% 0%, rgba(59,130,246,0.05) 0%, transparent 70%)'};
            "
          ></div>
          {#if isDark}
            <Grain opacity={0.02} />
          {/if}

          <div class="relative">
            <ChatRow who="user" timestamp="14:02:11" themeMode={mode}>
              {#snippet children()}
                <p style="margin: 0;">
                  We need to ship the auth migration before the demo. Can <InlineCode {isDark}>@claude</InlineCode> draft the PR
                  and have <InlineCode {isDark}>@gemini</InlineCode> double-check it before we run anything on prod?
                </p>
              {/snippet}
            </ChatRow>

            <div style="height: 1px; margin: 2px 18px; background: {s.hairline};"></div>

            <ChatRow who="agent" agentId="claude" timestamp="14:02:38" themeMode={mode}>
              {#snippet children()}
                <p style="margin: 0 0 8px;">
                  On it. I've drafted <InlineCode {isDark}>migrations/0042_auth_refresh.sql</InlineCode> and a matching rollback.
                  Diff looks clean — <span style="color: {isDark ? NOCTURNE.emerald[400] : NOCTURNE.emerald[700]}; font-weight: 500;">+84 / −12</span>, no schema drift.
                  Handing the review to Gemini, then I'll stage it.
                </p>

                <ToolCallBlock
                  themeMode={mode}
                  name="ant.deploy"
                  requiresApproval={true}
                  args={[
                    { k: 'target',    v: 'staging' },
                    { k: 'migration', v: '0042_auth_refresh.sql' },
                    { k: 'rollback',  v: '0042_auth_refresh.down.sql' },
                    { k: 'reviewers', v: '@gemini' },
                  ]}
                />
              {/snippet}
            </ChatRow>
          </div>
        </div>

        <!-- Composer -->
        <div class="mt-7">
          <div class="mb-4">
            <div
              style="
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 1.4px;
                text-transform: uppercase;
                color: {s.textFaint};
                font-family: var(--font-mono);
              "
            >Composer</div>
            <div style="font-size: 13px; color: {s.textMuted}; margin-top: 4px;">
              Composer with agent summoner — @-mention routes to the right colony member.
            </div>
          </div>

          <Composer
            themeMode={mode}
            mentionedAgent="claude"
            placeholder="run the deploy once Gemini signs off"
            contextPills={['#deploy', 'staging', '+2 files']}
          />
        </div>
      </div>
    </div>
  </div>

  <!-- ═══════════════ M3 CommandBlock Section (R4 §3a / §6 acceptance harness) ═══════════════ -->
  <div class="p-10 pt-0" id="m3-commandblock">
    <h2 class="text-lg font-semibold mb-2" style="color: #2A2922; letter-spacing: -0.02em;">
      M3 · CommandBlock
    </h2>
    <p style="font-size: 13px; color: #5A584B; max-width: 640px; margin-bottom: 24px;">
      Renders from <code style="font-family: var(--font-mono); font-size: 12px;">run_event &#123;kind, payload, trust, raw_ref&#125;</code>
      per R4 §3a. Three kinds: command_block, agent_prompt, artifact. Trust-tier-locked: trust:raw never rich.
      Hover a block to reveal the toolbar; click chevron to expand.
    </p>

    <div
      class="relative rounded-2xl overflow-hidden"
      style="background: {s.bg}; padding: 32px; color: {s.text};"
    >
      {#if isDark}<Grain opacity={0.025} />{/if}

      <!-- The 3-event OSC-133 acceptance flow: ls && false && echo ok -->
      <div
        style="
          font-family: var(--font-mono); font-size: 10px; font-weight: 700;
          letter-spacing: 1.4px; text-transform: uppercase; color: {s.textFaint};
          margin-bottom: 10px;
        "
      >M1 acceptance flow · ls &amp;&amp; false &amp;&amp; echo ok</div>
      <div style="margin-bottom: 32px;">
        {#each cbEvents.slice(0, 3) as event (event.id)}
          <CommandBlock
            {event}
            themeMode={mode}
            onRerun={handleRerun}
            onBookmark={handleBookmark}
          />
        {/each}
      </div>

      <!-- Long-output collapse -->
      <div
        style="
          font-family: var(--font-mono); font-size: 10px; font-weight: 700;
          letter-spacing: 1.4px; text-transform: uppercase; color: {s.textFaint};
          margin-bottom: 10px;
        "
      >Long output · collapse-by-default</div>
      <div style="margin-bottom: 32px;">
        <CommandBlock
          event={cbEvents[3]}
          themeMode={mode}
          onRerun={handleRerun}
          onBookmark={handleBookmark}
        />
      </div>

      <!-- trust:raw — never rich -->
      <div
        style="
          font-family: var(--font-mono); font-size: 10px; font-weight: 700;
          letter-spacing: 1.4px; text-transform: uppercase; color: {s.textFaint};
          margin-bottom: 10px;
        "
      >trust:raw · alt-screen TUI capture (no rich render, byte-faithful)</div>
      <div style="margin-bottom: 32px;">
        <CommandBlock
          event={cbEvents[4]}
          themeMode={mode}
          defaultExpanded
        />
      </div>

      <!-- agent_prompt with options -->
      <div
        style="
          font-family: var(--font-mono); font-size: 10px; font-weight: 700;
          letter-spacing: 1.4px; text-transform: uppercase; color: {s.textFaint};
          margin-bottom: 10px;
        "
      >agent_prompt · inline overlay (R4 §3c)</div>
      <div style="margin-bottom: 32px;">
        <CommandBlock
          event={cbEvents[5]}
          themeMode={mode}
          defaultExpanded
          onRespond={handleRespond}
        />
      </div>

      <!-- artifact via /api/artifacts/:hash -->
      <div
        style="
          font-family: var(--font-mono); font-size: 10px; font-weight: 700;
          letter-spacing: 1.4px; text-transform: uppercase; color: {s.textFaint};
          margin-bottom: 10px;
        "
      >trust:high · artifact · inline image via /api/artifacts/:hash (R4 §3b)</div>
      <div style="margin-bottom: 32px;">
        <CommandBlock
          event={cbEvents[6]}
          themeMode={mode}
          defaultExpanded
        />
      </div>

      <!-- trust:medium artifact — link only, never inline render -->
      <div
        style="
          font-family: var(--font-mono); font-size: 10px; font-weight: 700;
          letter-spacing: 1.4px; text-transform: uppercase; color: {s.textFaint};
          margin-bottom: 10px;
        "
      >trust:medium · artifact · structured but escaped — link only (R4 §3e)</div>
      <div style="margin-bottom: 32px;">
        <CommandBlock
          event={cbEvents[7]}
          themeMode={mode}
          defaultExpanded
        />
      </div>

      <!-- trust:raw artifact — no img, no caption, only raw_ref + audit link -->
      <div
        style="
          font-family: var(--font-mono); font-size: 10px; font-weight: 700;
          letter-spacing: 1.4px; text-transform: uppercase; color: {s.textFaint};
          margin-bottom: 10px;
        "
      >trust:raw · artifact · §1 non-negotiable — no rich render, raw_ref + audit link only</div>
      <div style="margin-bottom: 32px;">
        <CommandBlock
          event={cbEvents[8]}
          themeMode={mode}
          defaultExpanded
        />
      </div>

      <!-- trust:raw agent_prompt — no @agent highlight, no option buttons -->
      <div
        style="
          font-family: var(--font-mono); font-size: 10px; font-weight: 700;
          letter-spacing: 1.4px; text-transform: uppercase; color: {s.textFaint};
          margin-bottom: 10px;
        "
      >trust:raw · agent_prompt · §1 non-negotiable — escaped text only, no buttons</div>
      <div>
        <CommandBlock
          event={cbEvents[9]}
          themeMode={mode}
          defaultExpanded
          onRespond={handleRespond}
        />
      </div>
    </div>
  </div>
</div>
