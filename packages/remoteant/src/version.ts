// Build-time constant — git sha captured at build time so the binary works
// in environments without git on PATH (e.g. notarized Mac app bundle).
export const VERSION = "0.1.0";
export const GIT_SHA = "85f9373";
export const VERSION_STRING = `remoteant ${VERSION} (${GIT_SHA})`;
