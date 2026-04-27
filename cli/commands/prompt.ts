import { api } from '../lib/api.js';

type PromptBridgeTarget =
  | { kind: 'linked_chat' }
  | { kind: 'chat'; session_id: string }
  | { kind: 'webhook'; url: string };

function parseTarget(value: string): PromptBridgeTarget {
  const v = value.trim();
  if (!v || v === 'linked' || v === 'linked_chat') return { kind: 'linked_chat' };
  if (v.startsWith('chat:')) return { kind: 'chat', session_id: v.slice(5) };
  if (v.startsWith('webhook:')) return { kind: 'webhook', url: v.slice(8) };
  throw new Error('target must be linked, chat:<session-id>, or webhook:<url>');
}

function targetsFromFlags(flags: any): PromptBridgeTarget[] | null {
  const raw = flags.target;
  if (!raw) return null;
  const values = Array.isArray(raw) ? raw : String(raw).split(',').map((v) => v.trim()).filter(Boolean);
  return values.map(parseTarget);
}

function printPending(pending: any) {
  if (!pending) {
    console.log('No pending prompt bridge event.');
    return;
  }
  console.log(`Prompt ${pending.id} on ${pending.terminal_id}`);
  console.log(pending.raw_text);
  console.log(`Respond: ant prompt respond ${pending.terminal_id} --text "..."`);
}

export async function prompt(args: string[], flags: any, ctx: any) {
  const sub = args[0];

  if (!sub || sub === 'help') {
    console.error('Usage: ant prompt <config|pending|respond> [options]');
    return;
  }

  if (sub === 'config') {
    const current = await api.get(ctx, '/api/prompt-bridge/config');
    const targetConfig = targetsFromFlags(flags);
    const shouldWrite =
      flags.enable ||
      flags.enabled ||
      flags.disable ||
      flags.disabled ||
      flags.audit !== undefined ||
      targetConfig;

    if (!shouldWrite) {
      if (ctx.json) { console.log(JSON.stringify(current.config, null, 2)); return; }
      console.log(JSON.stringify(current.config, null, 2));
      return;
    }

    const config = {
      ...current.config,
      enabled: flags.disable || flags.disabled ? false : (flags.enable || flags.enabled ? true : current.config.enabled),
      audit: flags.audit === undefined ? current.config.audit : !['false', '0', 'no'].includes(String(flags.audit).toLowerCase()),
      ...(targetConfig ? { default_targets: targetConfig } : {}),
    };
    const result = await api.put(ctx, '/api/prompt-bridge/config', { config });
    if (ctx.json) { console.log(JSON.stringify(result.config, null, 2)); return; }
    console.log(JSON.stringify(result.config, null, 2));
    return;
  }

  if (sub === 'pending') {
    const id = args[1];
    if (!id) { console.error('Usage: ant prompt pending <terminal-id>'); return; }
    const result = await api.get(ctx, `/api/sessions/${id}/prompt-bridge/pending`);
    if (ctx.json) { console.log(JSON.stringify(result, null, 2)); return; }
    printPending(result.pending);
    return;
  }

  if (sub === 'respond') {
    const id = args[1];
    const text = flags.text || flags.msg || args.slice(2).join(' ');
    if (!id || !text) { console.error('Usage: ant prompt respond <terminal-id> --text "response"'); return; }
    const result = await api.post(ctx, `/api/sessions/${id}/prompt-bridge/respond`, {
      text,
      enter: !(flags.no_enter || flags['no-enter']),
    });
    if (ctx.json) { console.log(JSON.stringify(result, null, 2)); return; }
    console.log('Prompt response injected.');
    return;
  }

  console.error(`Unknown prompt subcommand: ${sub}`);
}
