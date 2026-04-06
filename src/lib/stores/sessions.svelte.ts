interface Session {
  id: string;
  name: string;
  type: 'terminal' | 'chat' | 'agent';
  workspace_id: string | null;
  status: string;
  archived: number;
  updated_at: string;
}

let sessions = $state<Session[]>([]);
let loading = $state(false);
let error = $state<string | null>(null);
let selectedId = $state<string | null>(null);

export function useSessionStore() {
  async function load() {
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/sessions');
      sessions = await res.json();
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function createSession(name: string, type: string) {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type }),
    });
    const session = await res.json();
    sessions = [session, ...sessions];
    return session;
  }

  async function renameSession(id: string, name: string) {
    const res = await fetch(`/api/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error('Failed to rename session');
    sessions = sessions.map(s => s.id === id ? { ...s, name } : s);
  }

  async function archiveSession(id: string) {
    const prev = sessions;
    sessions = sessions.filter(s => s.id !== id);
    try {
      const res = await fetch(`/api/sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      });
      if (!res.ok) throw new Error('Failed to archive session');
    } catch (e: any) {
      sessions = prev; // rollback on failure
      error = e.message;
    }
  }

  async function deleteSession(id: string) {
    const prev = sessions;
    sessions = sessions.filter(s => s.id !== id);
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete session');
    } catch (e: any) {
      sessions = prev; // rollback on failure
      error = e.message;
    }
  }

  return {
    get sessions() { return sessions; },
    get loading() { return loading; },
    get error() { return error; },
    get selectedId() { return selectedId; },
    set selectedId(id: string | null) { selectedId = id; },
    load,
    createSession,
    renameSession,
    archiveSession,
    deleteSession,
  };
}
