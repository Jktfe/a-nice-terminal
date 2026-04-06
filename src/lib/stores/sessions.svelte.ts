interface Session {
  id: string;
  name: string;
  type: 'terminal' | 'chat' | 'agent';
  workspace_id: string | null;
  status: string;
  ttl: string;
  archived: number;
  deleted_at: string | null;
  last_activity: string | null;
  updated_at: string;
}

let sessions = $state<Session[]>([]);
let recoverable = $state<Session[]>([]);
let loading = $state(false);
let error = $state<string | null>(null);
let selectedId = $state<string | null>(null);

export const TTL_OPTIONS = [
  { value: '15m',     label: '15 min' },
  { value: '45m',     label: '45 min' },
  { value: '3h',      label: '3 hours' },
  { value: 'forever', label: 'Always On' },
] as const;

export function useSessionStore() {
  async function load() {
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      // Handle both old (array) and new (object) API shapes
      sessions = Array.isArray(data) ? data : (data.sessions ?? []);
      recoverable = Array.isArray(data) ? [] : (data.recoverable ?? []);
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function createSession(name: string, type: string, ttl = '15m') {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, ttl }),
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

  async function updateTtl(id: string, ttl: string) {
    const res = await fetch(`/api/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl }),
    });
    if (!res.ok) throw new Error('Failed to update TTL');
    sessions = sessions.map(s => s.id === id ? { ...s, ttl } : s);
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
      sessions = prev;
      error = e.message;
    }
  }

  // Soft-delete: session moves to recoverable list, PTY keeps running
  async function deleteSession(id: string) {
    const prev = sessions;
    const session = sessions.find(s => s.id === id);
    sessions = sessions.filter(s => s.id !== id);
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete session');
      // Move to recoverable list if not AON (AON sessions don't expire)
      if (session) {
        recoverable = [{ ...session, deleted_at: new Date().toISOString() }, ...recoverable];
      }
    } catch (e: any) {
      sessions = prev;
      error = e.message;
    }
  }

  async function restoreSession(id: string) {
    const session = recoverable.find(s => s.id === id);
    recoverable = recoverable.filter(s => s.id !== id);
    try {
      const res = await fetch(`/api/sessions/${id}/restore`, { method: 'POST' });
      if (!res.ok) throw new Error('Recovery window expired');
      const restored = await res.json();
      sessions = [restored, ...sessions];
    } catch (e: any) {
      if (session) recoverable = [session, ...recoverable];
      error = e.message;
    }
  }

  return {
    get sessions() { return sessions; },
    get recoverable() { return recoverable; },
    get loading() { return loading; },
    get error() { return error; },
    get selectedId() { return selectedId; },
    set selectedId(id: string | null) { selectedId = id; },
    load,
    createSession,
    renameSession,
    updateTtl,
    archiveSession,
    deleteSession,
    restoreSession,
  };
}
