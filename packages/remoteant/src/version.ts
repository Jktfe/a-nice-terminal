// __BUILD_GIT_SHA__ is replaced by bun's --define flag at build time with the
// short SHA of HEAD at the moment `bun run build` ran. The fallback string
// "dev" only appears in `bun run build:dev` or if someone runs src/ via
// `bun run src/cli.ts` directly (uncompiled dev path).
declare const __BUILD_GIT_SHA__: string;
const GIT_SHA: string = typeof __BUILD_GIT_SHA__ !== "undefined" ? __BUILD_GIT_SHA__ : "dev";

export const VERSION = "0.1.0";
export { GIT_SHA };
export const VERSION_STRING = `remoteant ${VERSION} (${GIT_SHA})`;
