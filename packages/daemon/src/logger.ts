export function log(
  component: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  const prefix = `[${component}]`;
  if (data !== undefined) {
    console.log(`${prefix} ${message}`, JSON.stringify(data));
  } else {
    console.log(`${prefix} ${message}`);
  }
}

export function error(
  component: string,
  message: string,
  err?: unknown,
): void {
  const prefix = `[${component}]`;
  if (err !== undefined) {
    const detail =
      err instanceof Error ? err.message : JSON.stringify(err);
    console.error(`${prefix} ${message}: ${detail}`);
  } else {
    console.error(`${prefix} ${message}`);
  }
}
