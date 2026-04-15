// Disable SSR — the home page uses browser-only APIs (localStorage for grid
// state, WebSocket for session updates) and Svelte 5 event delegation has
// hydration issues with dynamically rendered components.
export const ssr = false;
