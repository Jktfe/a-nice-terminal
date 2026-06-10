#!/usr/bin/env node
/**
 * `@jktfe/mcp-server-ant` — stdio MCP server entrypoint.
 *
 * Bridges Claude Desktop / Claude Code / any MCP client to the local
 * ANT OSS daemon (default `http://127.0.0.1:6174`) via the tools
 * registered in `./tools.ts` (see that file's header for the full list).
 *
 * Run directly via `npx @jktfe/mcp-server-ant` or wire into a client's
 * config file (see README.md for sample Claude Desktop config).
 *
 * Environment variables:
 *   ANT_SERVER_URL    – base URL of the ANT server (default 127.0.0.1:6174)
 *   ANT_DEVICE_TOKEN  – optional Bearer token from `ant identity`
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AntClient } from './ant-client.js';
import { installStdinExitGuards, reapOlderSiblingMcpServers } from './lifecycle.js';
import { registerAntTools } from './tools.js';

const PACKAGE_NAME = '@jktfe/mcp-server-ant';
const PACKAGE_VERSION = '0.1.0';

async function main(): Promise<void> {
  installStdinExitGuards();
  await reapOlderSiblingMcpServers({ stderr: process.stderr }).catch((cause) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`${PACKAGE_NAME} sibling cleanup skipped: ${message}\n`);
  });

  const server = new McpServer({
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION
  });

  const client = new AntClient();
  registerAntTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Note: do NOT log to stdout. Stdio transport is on stdout. Any stderr
  // output is forwarded to the MCP client's logs (Claude Desktop surfaces
  // these in its log file).
  process.stderr.write(`${PACKAGE_NAME} v${PACKAGE_VERSION} ready (stdio)\n`);
}

main().catch((cause) => {
  const message = cause instanceof Error ? `${cause.message}\n${cause.stack ?? ''}` : String(cause);
  process.stderr.write(`${PACKAGE_NAME} failed to start: ${message}\n`);
  process.exit(1);
});
