/**
 * No-network smoke test for the MCP server surface.
 *
 * Spins up a real McpServer + a real MCP Client over a linked in-memory
 * transport pair (no stdio, no sockets, no ANT daemon) and asserts the
 * advertised tool list: names, input schemas, and read-only/destructive
 * annotations. This is the contract an MCP client (Claude Desktop /
 * Claude Code) sees on `tools/list` — if a tool is renamed, dropped, or
 * loses its schema, this test fails before any release does.
 */

import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AntClient } from '../src/ant-client.js';
import { registerAntTools } from '../src/tools.js';

const EXPECTED_TOOLS = [
  'ant_get_pending_mentions',
  'ant_post_message',
  'ant_list_rooms',
  'ant_get_room',
  'ant_get_room_messages',
  'ant_get_message',
  'ant_search_room_messages',
  'ant_list_agents',
  'ant_list_plans',
  'ant_get_plan'
] as const;

const READ_ONLY_TOOLS = EXPECTED_TOOLS.filter((name) => name !== 'ant_post_message');

async function listToolsOverInMemoryTransport() {
  const server = new McpServer({ name: 'smoke', version: '0.0.0' });
  const neverFetch = (async () => {
    throw new Error('smoke test must not perform HTTP');
  }) as unknown as typeof fetch;
  registerAntTools(server, new AntClient({ baseUrl: 'http://smoke.invalid', fetchImpl: neverFetch }));

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'smoke-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
    await server.close();
  }
}

describe('MCP server smoke (tools/list over in-memory transport)', () => {
  it('advertises exactly the expected tool names', async () => {
    const tools = await listToolsOverInMemoryTransport();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it('every tool ships a JSON-schema object inputSchema and a description', async () => {
    const tools = await listToolsOverInMemoryTransport();
    for (const tool of tools) {
      expect(tool.description, `${tool.name} description`).toBeTruthy();
      expect(tool.inputSchema?.type, `${tool.name} inputSchema.type`).toBe('object');
    }
  });

  it('required params survive into the advertised schema', async () => {
    const tools = await listToolsOverInMemoryTransport();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const required = (name: string) =>
      ((byName.get(name)?.inputSchema?.required ?? []) as string[]).sort();
    expect(required('ant_post_message')).toEqual(['body', 'roomId']);
    expect(required('ant_get_room')).toEqual(['roomId']);
    expect(required('ant_get_room_messages')).toEqual(['roomId']);
    expect(required('ant_get_message')).toEqual(['messageId']);
    expect(required('ant_search_room_messages')).toEqual(['query', 'roomId']);
    expect(required('ant_get_plan')).toEqual(['planId']);
    expect(required('ant_get_pending_mentions')).toEqual([]);
    expect(required('ant_list_agents')).toEqual([]);
    expect(required('ant_list_plans')).toEqual([]);
  });

  it('pagination params are advertised on the list/history tools', async () => {
    const tools = await listToolsOverInMemoryTransport();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const props = (name: string) =>
      Object.keys((byName.get(name)?.inputSchema?.properties ?? {}) as Record<string, unknown>);
    expect(props('ant_get_room_messages')).toEqual(
      expect.arrayContaining(['limit', 'before'])
    );
    expect(props('ant_search_room_messages')).toEqual(expect.arrayContaining(['limit']));
    expect(props('ant_list_agents')).toEqual(expect.arrayContaining(['limit', 'offset']));
    expect(props('ant_list_plans')).toEqual(expect.arrayContaining(['limit', 'offset']));
  });

  it('read tools are annotated readOnlyHint and the write tool is non-destructive', async () => {
    const tools = await listToolsOverInMemoryTransport();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    for (const name of READ_ONLY_TOOLS) {
      expect(byName.get(name)?.annotations?.readOnlyHint, `${name} readOnlyHint`).toBe(true);
    }
    const post = byName.get('ant_post_message');
    expect(post?.annotations?.readOnlyHint).toBe(false);
    expect(post?.annotations?.destructiveHint).toBe(false);
  });
});
