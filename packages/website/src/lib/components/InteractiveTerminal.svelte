<script>
  const commands = [
    {
      input: '$ ant create "Agent Chat" -t conversation',
      output: 'Created session "Agent Chat" (id: f7e2a91b)'
    },
    {
      input: '$ ant post "Agent Chat" "Hello from Claude"',
      output: 'Message sent to "Agent Chat"'
    },
    {
      input: '$ ant list',
      output: `ID        TYPE           NAME           CREATED
f7e2a91b  conversation   Agent Chat     2026-03-26 10:00
a3c8d012  terminal       Terminal 1     2026-03-26 09:55`
    }
  ];

  /** @type {Array<{ text: string, type: 'input' | 'output' }>} */
  let lines = $state([]);
  let cursorVisible = $state(true);

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let cursorTimer;
  let running = $state(false);

  async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  async function typeText(text, type) {
    if (type === 'output') {
      await sleep(300);
      lines = [...lines, { text, type }];
      await sleep(400);
      return;
    }

    // Typewriter for input
    let current = '';
    lines = [...lines, { text: current, type }];
    for (const char of text) {
      current += char;
      lines = [...lines.slice(0, -1), { text: current, type }];
      await sleep(30 + Math.random() * 40);
    }
    await sleep(500);
  }

  async function runDemo() {
    if (running) return;
    running = true;

    while (true) {
      lines = [];
      for (const cmd of commands) {
        await typeText(cmd.input, 'input');
        await typeText(cmd.output, 'output');
      }
      await sleep(3000);
    }
  }

  $effect(() => {
    runDemo();
    cursorTimer = setInterval(() => {
      cursorVisible = !cursorVisible;
    }, 530);

    return () => {
      if (cursorTimer) clearInterval(cursorTimer);
    };
  });
</script>

<div class="overflow-hidden rounded-xl border border-white/[0.06] bg-[var(--color-surface)]">
  <div class="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
    <div class="h-3 w-3 rounded-full bg-red-500/60"></div>
    <div class="h-3 w-3 rounded-full bg-yellow-500/60"></div>
    <div class="h-3 w-3 rounded-full bg-green-500/60"></div>
    <span class="ml-2 text-xs text-neutral-500">ant-demo</span>
  </div>
  <div class="bg-black/60 p-5 font-mono text-sm leading-relaxed" style="min-height: 280px;">
    {#each lines as line}
      <div class="{line.type === 'input' ? 'text-emerald-400' : 'text-neutral-400'} whitespace-pre-wrap">{line.text}</div>
    {/each}
    <span class="inline-block h-4 w-2 {cursorVisible ? 'bg-emerald-400' : 'bg-transparent'}" style="vertical-align: text-bottom;"></span>
  </div>
</div>
