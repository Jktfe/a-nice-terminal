// Read-only room viewer is fully client-side: token lives in localStorage
// (so we can't render anything on the server without it) and the SSE stream
// is opened from the browser anyway.
export const ssr = false;
