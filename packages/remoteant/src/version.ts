import { BUILD_GIT_SHA } from "./version-build-generated.ts";

export const VERSION = "0.1.0";
export const GIT_SHA = BUILD_GIT_SHA;
export const VERSION_STRING = `remoteant ${VERSION} (${GIT_SHA})`;
