#!/usr/bin/env bun
// ANT Channel Server — bridges ANT chat messages into Claude Code sessions.
// ANT's @mention fan-out POSTs here; this server pushes into Claude Code
// as a <channel> notification that arrives directly in the conversation.
//
// Env vars:
//   ANT_HANDLE        — the @handle for this channel (default: '@claude')
//   ANT_CHANNEL_PORT  — HTTP listener port (default: '8789')
//   ANT_SERVER        — ANT server base URL
//   ANT_API_KEY       — API key for ANT server
//   ANT_CHAT_SESSION  — default chat session ID

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const ANT_SERVER = process.env.ANT_SERVER || 'https://localhost:6458'
const ANT_API_KEY = process.env.ANT_API_KEY || ''
const ANT_CHAT_SESSION = process.env.ANT_CHAT_SESSION || ''
const PORT = parseInt(process.env.ANT_CHANNEL_PORT || '8789')
const HANDLE = process.env.ANT_HANDLE || '@claude'

// Derive MCP server name from handle (e.g. '@claude2' → 'ant-chat-claude2')
const serverName = 'ant-chat' + HANDLE.replace(/^@/, '-')

const mcp = new Server(
  { name: serverName, version: '0.2.0' },
  {
    capabilities: {
      experimental: { 'claude/channel': {} },
      tools: {},
    },
    instructions:
      `Messages from the ANT group chat arrive as <channel source="${serverName}" sender="..." session_id="...">. ` +
      'These are messages from other AI agents or James in the ANT coordination chat. ' +
      'Reply using the ant_reply tool with the session_id from the tag. ' +
      'Treat these as real-time coordination messages that may need immediate action.',
  },
)

// Reply tool — lets Claude send messages back to the ANT chat
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'ant_reply',
    description: 'Send a message back to the ANT group chat',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'The ANT chat session ID' },
        text: { type: 'string', description: 'The message to send' },
      },
      required: ['session_id', 'text'],
    },
  }],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  if (req.params.name === 'ant_reply') {
    const { session_id, text } = req.params.arguments as { session_id: string; text: string }
    try {
      const res = await fetch(`${ANT_SERVER}/api/sessions/${session_id}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(ANT_API_KEY ? { 'x-api-key': ANT_API_KEY } : {}),
        },
        body: JSON.stringify({
          role: 'user',
          content: text,
          format: 'text',
          sender_id: HANDLE,
          msg_type: 'message',
        }),
      })
      return { content: [{ type: 'text', text: res.ok ? 'sent' : `failed: ${res.status}` }] }
    } catch (e: any) {
      return { content: [{ type: 'text', text: `error: ${e.message}` }] }
    }
  }
  throw new Error(`unknown tool: ${req.params.name}`)
})

await mcp.connect(new StdioServerTransport())

// ─── Channel registration lifecycle ───────────────────────────────────────

async function registerSelf(): Promise<void> {
  try {
    const res = await fetch(`${ANT_SERVER}/api/channel/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ANT_API_KEY ? { 'x-api-key': ANT_API_KEY } : {}),
      },
      body: JSON.stringify({
        handle: HANDLE,
        port: PORT,
        session_id: ANT_CHAT_SESSION || undefined,
      }),
    })
    if (res.ok) {
      console.error(`[ant-channel] registered ${HANDLE} on port ${PORT}`)
    } else {
      console.error(`[ant-channel] registration failed: ${res.status} ${await res.text().catch(() => '')}`)
    }
  } catch (e: any) {
    console.error(`[ant-channel] registration error (server may not be running): ${e.message}`)
  }
}

async function deregisterSelf(): Promise<void> {
  try {
    const res = await fetch(`${ANT_SERVER}/api/channel/register?handle=${encodeURIComponent(HANDLE)}`, {
      method: 'DELETE',
      headers: {
        ...(ANT_API_KEY ? { 'x-api-key': ANT_API_KEY } : {}),
      },
    })
    if (res.ok) {
      console.error(`[ant-channel] deregistered ${HANDLE}`)
    } else {
      console.error(`[ant-channel] deregistration failed: ${res.status}`)
    }
  } catch (e: any) {
    console.error(`[ant-channel] deregistration error: ${e.message}`)
  }
}

// Register on startup
registerSelf()

// Deregister on shutdown
process.on('SIGTERM', async () => {
  await deregisterSelf()
  process.exit(0)
})

process.on('SIGINT', async () => {
  await deregisterSelf()
  process.exit(0)
})

// ─── HTTP listener — ANT POSTs here to deliver messages ──────────────────

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  async fetch(req) {
    if (req.method !== 'POST') return new Response('POST only', { status: 405 })

    const body = await req.json().catch(() => null)
    if (!body?.content) return new Response('need {content, sender, session_id}', { status: 400 })

    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: body.content,
        meta: {
          sender: body.sender || 'unknown',
          session_id: body.session_id || ANT_CHAT_SESSION,
        },
      },
    })

    return new Response('ok')
  },
})

console.error(`[ant-channel] ${HANDLE} listening on http://127.0.0.1:${PORT}`)
