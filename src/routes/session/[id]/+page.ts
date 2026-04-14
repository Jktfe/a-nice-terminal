// Disable SSR for the session page — terminal components (xterm.js, WebSocket)
// require browser APIs, and Svelte 5 event delegation has hydration issues
// with dynamically rendered components inside {#each}/{#if} blocks.
export const ssr = false;
