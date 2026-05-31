import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(__dirname, "..");

const sha = execSync("git rev-parse --short HEAD", { cwd: pkgDir, encoding: "utf-8" }).trim();
const version = "0.1.0";

const content = `export const VERSION = "${version}";\nexport const GIT_SHA = "${sha}";\nexport const VERSION_STRING = \`remoteant \${VERSION} (\${GIT_SHA})\`;\n`;

writeFileSync(join(pkgDir, "src", "version.ts"), content, "utf-8");
console.log(`Generated version.ts: ${version} (${sha})`);
