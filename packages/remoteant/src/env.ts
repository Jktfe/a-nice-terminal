// E1 §5 — env contract for remoteant daemon
// All optional with documented defaults; A1 only uses ANT_SERVER_URL for ant.ping.

export interface RemoteantEnv {
  ANT_ADMIN_TOKEN?: string;
  ANT_SERVER_URL: string;
  ANT_AS_HANDLE?: string;
}

export function parseEnv(processEnv = process.env): RemoteantEnv {
  return {
    ANT_ADMIN_TOKEN: processEnv.ANT_ADMIN_TOKEN,
    ANT_SERVER_URL: processEnv.ANT_SERVER_URL ?? "http://127.0.0.1:6174",
    ANT_AS_HANDLE: processEnv.ANT_AS_HANDLE,
  };
}
