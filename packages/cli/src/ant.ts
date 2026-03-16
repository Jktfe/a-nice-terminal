#!/usr/bin/env node
import { Command } from "commander";
import { resolveConfig } from "./config.js";
import { createClient } from "./client.js";
import { list } from "./commands/list.js";
import { create } from "./commands/create.js";
import { read } from "./commands/read.js";
import { post } from "./commands/post.js";
import { search } from "./commands/search.js";
import * as out from "./output.js";

const program = new Command()
  .name("ant")
  .description("CLI for A Nice Terminal")
  .version("0.1.0")
  .option("--json", "Output raw JSON")
  .option("--no-color", "Disable colour output")
  .option("--server <url>", "Server URL")
  .option("--api-key <key>", "API key");

function getClientAndFormat() {
  const opts = program.opts();
  const config = resolveConfig({ server: opts.server, apiKey: opts.apiKey, json: opts.json });
  const client = createClient({ server: config.server, apiKey: config.apiKey });
  return { client, format: config.format };
}

program.command("list").alias("ls").description("List sessions")
  .option("--archived", "Show only archived sessions")
  .option("--type <type>", "Filter by type (terminal|conversation)")
  .option("--workspace <name>", "Filter by workspace name")
  .action(async (opts) => {
    try { const { client, format } = getClientAndFormat(); await list(client, { format, ...opts }); }
    catch (err: any) { out.error(err.message); process.exit(1); }
  });

program.command("create <name>").alias("c").description("Create a new session")
  .option("-t, --type <type>", "Session type (terminal|conversation)", "conversation")
  .option("--workspace <name>", "Workspace name")
  .option("--cwd <path>", "Working directory for terminal sessions")
  .action(async (name, opts) => {
    try { const { client, format } = getClientAndFormat(); await create(client, name, { format, ...opts }); }
    catch (err: any) { out.error(err.message); process.exit(1); }
  });

program.command("read <session>").alias("r").description("Read messages or terminal output")
  .option("-l, --limit <n>", "Number of items to fetch", "50")
  .option("--since <value>", "Fetch after this timestamp or cursor")
  .option("-f, --follow", "Tail new messages/output in real-time")
  .option("--plain", "Strip ANSI escape codes")
  .action(async (session, opts) => {
    try { const { client, format } = getClientAndFormat(); await read(client, session, { format, limit: parseInt(opts.limit), ...opts }); }
    catch (err: any) { out.error(err.message); process.exit(1); }
  });

program.command("post <session> [message]").alias("p").description("Post a message or send input")
  .option("--role <role>", "Message role (human|agent|system)", "human")
  .option("--sender-name <name>", "Sender display name")
  .option("--sender-type <type>", "Sender type identifier")
  .option("--key <keyname>", "Send a single key (terminal only)")
  .option("--seq <sequence>", "Send a key sequence (terminal only)")
  .option("--raw", "Don't auto-append Enter for terminal input")
  .action(async (session, message, opts) => {
    try { const { client, format } = getClientAndFormat(); await post(client, session, message, { format, ...opts }); }
    catch (err: any) { out.error(err.message); process.exit(1); }
  });

program.command("search <query>").alias("s").description("Search sessions and messages")
  .option("--workspace <name>", "Filter by workspace")
  .option("-l, --limit <n>", "Max results")
  .option("--include-archived", "Include archived sessions")
  .action(async (query, opts) => {
    try { const { client, format } = getClientAndFormat(); await search(client, query, { format, limit: opts.limit ? parseInt(opts.limit) : undefined, ...opts }); }
    catch (err: any) { out.error(err.message); process.exit(1); }
  });

program.parse();
