// Disable SSR for the entire app.
//
// Svelte 5 event delegation has a hydration bug where onclick handlers on
// buttons silently fail on real mouse clicks (they work via JS .click()).
// This affects every component — ShareButton, ChatHeader, GridSlot, etc.
// Rather than patching each button individually, disable SSR globally.
//
// The app uses browser-only APIs everywhere (WebSocket, localStorage,
// clipboard, tmux) so SSR provides no benefit anyway.
export const ssr = false;
