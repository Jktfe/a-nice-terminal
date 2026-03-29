#!/usr/bin/env node
import { Command } from "commander";
import { resolveConfig } from "./config.js";
import { createClient } from "./client.js";
import { list } from "./commands/list.js";
import { create } from "./commands/create.js";
import { read } from "./commands/read.js";
import { post } from "./commands/post.js";
import { search } from "./commands/search.js";
import { del } from "./commands/delete.js";
import { archive } from "./commands/archive.js";
import { restore } from "./commands/restore.js";
import { rename } from "./commands/rename.js";
import { members } from "./commands/members.js";
import { filter } from "./commands/filter.js";
import { exec } from "./commands/exec.js";
import { attach } from "./commands/attach.js";
import { screen } from "./commands/screen.js";
import { health } from "./commands/health.js";
import { rooms } from "./commands/rooms.js";
import { room } from "./commands/room.js";
import { roomTasks } from "./commands/room-tasks.js";
import { roomTag } from "./commands/room-tag.js";
import { roomFile } from "./commands/room-file.js";
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
  .option("--role <role>", "Message role (human|agent|system)", "agent")
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

program.command("delete <session>").alias("rm").description("Delete a session permanently")
  .option("--force", "Skip confirmation prompt")
  .action(async (session, opts) => {
    try { const { client, format } = getClientAndFormat(); await del(client, session, { format, ...opts }); }
    catch (err: any) { out.error(err.message); process.exit(1); }
  });

program.command("archive <session>").description("Archive a session")
  .action(async (session) => {
    try { const { client, format } = getClientAndFormat(); await archive(client, session, { format }); }
    catch (err: any) { out.error(err.message); process.exit(1); }
  });

program.command("restore <session>").description("Restore an archived session")
  .action(async (session) => {
    try { const { client, format } = getClientAndFormat(); await restore(client, session, { format }); }
    catch (err: any) { out.error(err.message); process.exit(1); }
  });

program.command("rename <session> <new-name>").description("Rename a session")
  .action(async (session, newName) => {
    try { const { client, format } = getClientAndFormat(); await rename(client, session, newName, { format }); }
    catch (err: any) { out.error(err.message); process.exit(1); }
  });

program.command("members <session>").alias("m").description("List participants in a session")
  .action(async (session) => {
    try { const { client, format } = getClientAndFormat(); await members(client, session, { format }); }
    catch (err: any) { out.error(err.message); process.exit(1); }
  });

program.command("filter <session> <sender>").alias("f").description("Filter messages by sender")
  .option("-l, --limit <n>", "Max messages to scan", "100")
  .option("--role <role>", "Filter by role (human|agent|system)")
  .action(async (session, sender, opts) => {
    try { const { client, format } = getClientAndFormat(); await filter(client, session, sender, { format, limit: opts.limit ? parseInt(opts.limit) : undefined, ...opts }); }
    catch (err: any) { out.error(err.message); process.exit(1); }
  });

program.command("exec <session> [command]").alias("x").description("Execute a command in a terminal session")
  .option("-t, --timeout <seconds>", "Command timeout in seconds", "30")
  .option("-q, --quiet", "Suppress output, return exit code only")
  .option("-i, --interactive", "Interactive TTY attach")
  .action(async (session, command, opts) => {
    try { const { client, format } = getClientAndFormat(); await exec(client, session, command, { format, timeout: parseInt(opts.timeout), ...opts }); }
    catch (err: any) { out.error(err.message); process.exit(1); }
  });

program.command("attach <session>").alias("a").description("Attach interactively to a terminal session")
  .action(async (session) => {
    try { const { client } = getClientAndFormat(); await attach(client, session); }
    catch (err: any) { out.error(err.message); process.exit(1); }
  });

program.command("screen <session>").alias("sc").description("Show current terminal screen state")
  .option("--plain", "Strip ANSI escape codes")
  .option("--lines <n>", "Show last N lines")
  .action(async (session, opts) => {
    try { const { client, format } = getClientAndFormat(); await screen(client, session, { format, plain: opts.plain, lines: opts.lines ? parseInt(opts.lines) : undefined }); }
    catch (err: any) { out.error(err.message); process.exit(1); }
  });

program.command("health").description("Check server connectivity")
  .action(async () => {
    try { const { client, format } = getClientAndFormat(); await health(client, { format }); }
    catch (err: any) { out.error(err.message); process.exit(1); }
  });

program.command("rooms").description("List all active chat rooms")
  .action(async () => {
    try { const { client, format } = getClientAndFormat(); await rooms(client, { format }); }
    catch (err: any) { out.error(err.message); process.exit(1); }
  });

program.command("room <name>").description("Show room details (participants, tasks, files, tags)")
  .action(async (name) => {
    try { const { client, format } = getClientAndFormat(); await room(client, name, { format }); }
    catch (err: any) { out.error(err.message); process.exit(1); }
  });

program.command("room-tasks <name>").description("List tasks for a chat room")
  .option("--status <status>", "Filter by task status")
  .action(async (name, opts) => {
    try { const { client, format } = getClientAndFormat(); await roomTasks(client, name, { format, ...opts }); }
    catch (err: any) { out.error(err.message); process.exit(1); }
  });

program.command("room-tag <name> <terminalSessionId> <tag>").description("Add a tag to a participant in a room")
  .action(async (name, terminalSessionId, tag) => {
    try { const { client, format } = getClientAndFormat(); await roomTag(client, name, terminalSessionId, tag, { format }); }
    catch (err: any) { out.error(err.message); process.exit(1); }
  });

program.command("room-file <name> <path>").description("Add a context file to a room")
  .option("--desc <desc>", "File description")
  .option("--type <type>", "File type")
  .option("--short <shortname>", "Short display name")
  .action(async (name, path, opts) => {
    try { const { client, format } = getClientAndFormat(); await roomFile(client, name, path, { format, ...opts }); }
    catch (err: any) { out.error(err.message); process.exit(1); }
  });

program.parse();
