import { runMcpStdioAdapter } from "./mcp-stdio/adapter.ts";
import { VERSION_STRING } from "./version.ts";

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write(VERSION_STRING + "\n");
  process.exit(0);
}

if (args.includes("--mcp-stdio")) {
  await runMcpStdioAdapter();
  process.exit(0);
}

const subcommand = args[0];
switch (subcommand) {
  case "install":
  case "serve":
  case "supervise":
    process.stderr.write(`${subcommand}: not yet implemented in A1\n`);
    process.exit(64); // EX_USAGE
  default:
    process.stderr.write(
      "usage: remoteant --mcp-stdio | remoteant --version | remoteant <install|serve|supervise>\n"
    );
    process.exit(64);
}
