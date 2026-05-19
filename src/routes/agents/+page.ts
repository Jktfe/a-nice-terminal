// ANT — Agents Page
// src/routes/agents/+page.ts — Load function for agents page

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
  const res = await fetch('/api/agents');
  if (!res.ok) {
    throw new Error('Failed to load agents');
  }
  const data = await res.json();
  
  return {
    agents: data.agents,
    summary: data.summary
  };
};
