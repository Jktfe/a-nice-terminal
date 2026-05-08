// antchat web — local browser UI for ANT chat rooms.
//
// v0.3.0-alpha.2 surface:
//   - sidebar listing rooms from ~/.ant/config.json (+ "add room" wizard)
//   - chatroom view: backfill 50, live SSE, send, @-mention regex highlight
//   - right panel with 3 tabs: Participants, Tasks, Files
//   - sender names rendered as alias > name > handle > id[:8]
//   - light/dark theme toggle (persisted in localStorage)
//   - CSRF double-submit on all mutating fetches
//
// v0.3.1 will swap this single file for an htm+Preact bundle. The DOM
// structure mirrors the JSX shape that migration will produce.
//
// This file deliberately avoids `innerHTML` with any data that ever
// originated outside this script. All such data flows through createElement
// + textContent. innerHTML is only used for fixed templates (no interpolation).

const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'on') for (const [evt, fn] of Object.entries(v)) e.addEventListener(evt, fn);
      else if (k === 'data') for (const [d, dv] of Object.entries(v)) e.dataset[d] = String(dv);
      else if (k === 'text') e.textContent = v;
      else if (k === 'title') e.title = String(v);
      else e.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

// ─── State ──────────────────────────────────────────────────────────────────

const state = {
  rooms: [],
  activeRoomId: null,
  csrf: null,
  byRoom: {},        // room_id → { messages, participants, tasks, fileRefs, es, unread, streamState, displayMap }
  ready: false,
  panelTab: 'participants',
  panelOpen: true,
  theme: 'dark',
};

const app = $('#app');

// ─── Theme ─────────────────────────────────────────────────────────────────

function loadTheme() {
  let saved = null;
  try { saved = localStorage.getItem('antchat:theme'); } catch {}
  if (saved === 'light' || saved === 'dark') {
    state.theme = saved;
  } else {
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    state.theme = prefersLight ? 'light' : 'dark';
  }
  applyTheme();
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  try { localStorage.setItem('antchat:theme', state.theme); } catch {}
  // Re-render sidebar so the toggle button reflects the new state.
  const btn = $('#theme-btn');
  if (btn) btn.textContent = state.theme === 'dark' ? '☀' : '☾';
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function readCookie(name) {
  const m = document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

function formatTs(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

async function api(path, init = {}) {
  const opts = { credentials: 'same-origin', ...init };
  opts.headers = { ...(init.headers || {}) };
  if (init.method && init.method !== 'GET' && init.method !== 'HEAD') {
    if (!state.csrf) await refreshCsrf();
    opts.headers['x-csrf'] = state.csrf;
    opts.headers['content-type'] = opts.headers['content-type'] || 'application/json';
  }
  const res = await fetch(path, opts);
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const msg = (body && body.error) || `HTTP ${res.status}`;
    const error = new Error(msg);
    error.status = res.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function refreshCsrf() {
  const body = await fetch('/api/csrf', { credentials: 'same-origin' }).then(r => r.json());
  state.csrf = body.csrfToken;
}

// ─── Display name resolution ───────────────────────────────────────────────

/** alias > name > handle > id[:8]. Returns the friendly display label for
 * a sender_id within a given room, using the room's participants list. */
function displayNameFor(senderId, roomId) {
  if (!senderId) return '?';
  const meta = state.byRoom[roomId];
  if (meta && meta.displayMap && meta.displayMap[senderId]) return meta.displayMap[senderId];
  // Fall back to handle-shaped strings as themselves.
  if (senderId.startsWith('@')) return senderId;
  return senderId.length > 10 ? senderId.slice(0, 8) + '…' : senderId;
}

function buildDisplayMap(participants) {
  const map = {};
  for (const p of participants || []) {
    const display = p.alias || p.name || p.handle || (p.id && (p.id.length > 10 ? p.id.slice(0, 8) + '…' : p.id));
    if (p.id) map[p.id] = display;
    if (p.handle) map[p.handle] = display;
  }
  return map;
}

function senderInitials(display) {
  // Alias-driven initials: take first 2 alphanumerics from the display name.
  const stripped = String(display || '?').replace(/^@/, '');
  const parts = stripped.match(/[A-Za-z0-9]/g) || ['?'];
  return parts.slice(0, 2).join('').toUpperCase();
}

// ─── Mention rendering (safe text → mixed text+span nodes) ────────────────

function appendContentNodes(parent, text) {
  const re = /(^|[^A-Za-z0-9_])(@[A-Za-z0-9_-]+)/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    const idx = match.index;
    if (idx > last) parent.appendChild(document.createTextNode(text.slice(last, idx)));
    if (match[1]) parent.appendChild(document.createTextNode(match[1]));
    parent.appendChild(el('span', { class: 'mention', text: match[2] }));
    last = idx + match[0].length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

// ─── Building blocks ───────────────────────────────────────────────────────

function buildRoomListItem(room) {
  const handle = room.handles[0]?.handle || '';
  const label = room.handles[0]?.label || '';
  const meta = state.byRoom[room.room_id] || {};
  const isActive = room.room_id === state.activeRoomId;
  const stateClass = meta.streamState === 'open' ? ' connected'
                   : meta.streamState === 'error' ? ' error' : '';
  const display = label || (room.room_id.length > 14 ? room.room_id.slice(0, 12) + '…' : room.room_id);
  return el('li', {
    class: (isActive ? 'active' : '') + stateClass,
    data: { room: room.room_id },
    on: { click: () => selectRoom(room.room_id) },
  },
    el('span', { class: 'dot' }),
    el('span', { class: 'room-id', title: room.room_id, text: display }),
    handle ? el('span', { class: 'handle', text: handle }) : null,
    meta.unread > 0 ? el('span', { class: 'badge', text: String(meta.unread) }) : null,
  );
}

function buildMessageNode(m, roomId) {
  const isSystem = m.role === 'system' || m.msg_type === 'system';
  const senderId = m.sender_id || m.role || 'unknown';
  const displayName = displayNameFor(senderId, roomId);
  const senderIsHandle = String(senderId).startsWith('@');
  const showSenderId = !senderIsHandle && displayName !== senderId;
  const targetDisplay = m.target ? displayNameFor(m.target, roomId) : null;

  const meta = el('div', { class: 'meta' },
    el('span', { class: 'sender', text: displayName }),
    showSenderId ? el('span', { class: 'sender-id', title: senderId, text: senderId.slice(0, 8) + '…' }) : null,
    targetDisplay ? el('span', { class: 'target', text: '→ ' + targetDisplay }) : null,
    el('span', { class: 'ts', title: m.created_at || '', text: formatTs(m.created_at) }),
  );
  const content = el('div', { class: 'content' });
  appendContentNodes(content, String(m.content || ''));
  return el('div', { class: 'msg' + (isSystem ? ' system' : '') },
    el('div', { class: 'avatar', text: senderInitials(displayName) }),
    el('div', { class: 'body' }, meta, content),
  );
}

function buildEmptyMessages() {
  return el('div', { class: 'empty' },
    el('div', { text: 'No messages yet — say hello.' }),
  );
}

// ─── Top-level render functions ────────────────────────────────────────────

function renderShell() {
  clear(app);
  app.classList.toggle('no-side-panel', !state.panelOpen);
  const themeBtn = el('button', {
    id: 'theme-btn',
    class: 'icon-btn',
    title: 'Toggle theme',
    on: { click: toggleTheme },
    text: state.theme === 'dark' ? '☀' : '☾',
  });
  const addBtn = el('button', {
    class: 'icon-btn',
    title: 'Add room',
    on: { click: openWizard },
    text: '+',
  });
  app.appendChild(
    el('aside', { class: 'sidebar' },
      el('div', { class: 'sidebar-header' },
        el('span', { class: 'title', text: 'antchat' }),
        el('div', { class: 'header-actions' }, themeBtn, addBtn),
      ),
      el('ul', { class: 'room-list', id: 'room-list' }),
      el('div', { class: 'sidebar-footer', id: 'sidebar-footer', text: '…' }),
    )
  );
  app.appendChild(el('main', { class: 'chat', id: 'chat-main' }));
  if (state.panelOpen) {
    app.appendChild(el('aside', { class: 'side-panel', id: 'side-panel' }));
  }
}

function renderRoomList() {
  const ul = $('#room-list');
  if (!ul) return;
  clear(ul);
  for (const r of state.rooms) ul.appendChild(buildRoomListItem(r));
  $('#sidebar-footer').textContent =
    `${state.rooms.length} room${state.rooms.length === 1 ? '' : 's'} • antchat web 0.3.0-alpha.2`;
}

function renderEmpty() {
  const main = $('#chat-main');
  clear(main);
  main.appendChild(
    el('div', { class: 'empty' },
      el('div', { text: 'No rooms yet.' }),
      el('div', { text: 'Click + in the sidebar (or below) to paste an ant:// invite.' }),
      el('button', { on: { click: openWizard }, text: 'Add room' }),
    )
  );
  const panel = $('#side-panel');
  if (panel) clear(panel);
}

function renderRoom(roomId) {
  const room = state.rooms.find(r => r.room_id === roomId);
  const main = $('#chat-main');
  if (!room) return renderEmpty();
  const handle = room.handles[0]?.handle || '';
  const meta = ensureRoomMeta(roomId);

  clear(main);

  const togglePanelBtn = el('button', {
    class: 'icon-btn panel-toggle',
    title: state.panelOpen ? 'Hide side panel' : 'Show side panel',
    on: { click: toggleSidePanel },
    text: state.panelOpen ? '⟩' : '⟨',
  });

  const header = el('div', { class: 'chat-header' },
    el('span', { class: 'h-room', text: room.room_id }),
    el('span', { class: 'h-handle', text: handle ? `you = ${handle}` : '(no handle)' }),
    el('span', { class: 'h-spacer' }),
    togglePanelBtn,
  );

  const list = el('div', { class: 'message-list', id: 'msg-list' });
  if (!meta.messages.length) list.appendChild(buildEmptyMessages());
  else for (const m of meta.messages) list.appendChild(buildMessageNode(m, roomId));

  const ta = el('textarea', {
    id: 'composer-input',
    rows: '1',
    placeholder: `Message ${room.room_id} — @handle to direct`,
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onComposerSubmit(e); }
  });
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(200, ta.scrollHeight) + 'px';
  });
  const sendBtn = el('button', { type: 'submit', id: 'composer-send', text: 'Send' });
  const composer = el('form', {
    class: 'composer',
    id: 'composer',
    on: { submit: onComposerSubmit },
  }, ta, sendBtn);

  main.appendChild(header);
  main.appendChild(list);
  main.appendChild(composer);

  scrollToBottom();
  ta.focus();
  renderSidePanel();
}

function scrollToBottom() {
  const list = $('#msg-list');
  if (list) list.scrollTop = list.scrollHeight;
}

// ─── Right panel ───────────────────────────────────────────────────────────

function ensureRoomMeta(roomId) {
  if (!state.byRoom[roomId]) {
    state.byRoom[roomId] = {
      messages: [], participants: [], tasks: [], fileRefs: [],
      es: null, unread: 0, displayMap: {},
    };
  }
  return state.byRoom[roomId];
}

function toggleSidePanel() {
  state.panelOpen = !state.panelOpen;
  app.classList.toggle('no-side-panel', !state.panelOpen);
  if (state.panelOpen) {
    if (!$('#side-panel')) app.appendChild(el('aside', { class: 'side-panel', id: 'side-panel' }));
    renderSidePanel();
  } else {
    const p = $('#side-panel');
    if (p) p.remove();
  }
  // Update the toggle arrow on the chat header.
  if (state.activeRoomId) renderRoom(state.activeRoomId);
}

function renderSidePanel() {
  const panel = $('#side-panel');
  if (!panel || !state.activeRoomId) { if (panel) clear(panel); return; }
  clear(panel);

  const tabs = el('div', { class: 'tabs' },
    ['participants', 'Participants'],
    ['tasks', 'Tasks'],
    ['files', 'Files'],
  );
  // Replace tab content (the text constants above) with proper buttons.
  clear(tabs);
  for (const [key, label] of [['participants', 'Participants'], ['tasks', 'Tasks'], ['files', 'Files']]) {
    tabs.appendChild(el('button', {
      class: state.panelTab === key ? 'active' : '',
      on: { click: () => { state.panelTab = key; renderSidePanel(); } },
      text: label,
    }));
  }
  panel.appendChild(tabs);

  const body = el('div', { class: 'tab-body', id: 'tab-body' });
  panel.appendChild(body);

  const meta = ensureRoomMeta(state.activeRoomId);
  if (state.panelTab === 'participants') renderParticipantsTab(body, meta);
  else if (state.panelTab === 'tasks')   renderTasksTab(body, meta);
  else if (state.panelTab === 'files')   renderFilesTab(body, meta);
}

function renderParticipantsTab(body, meta) {
  if (!meta.participants.length) {
    body.appendChild(el('div', { class: 'empty-tab', text: 'No participants yet.' }));
    return;
  }
  for (const p of meta.participants) {
    const display = p.alias || p.name || p.handle || (p.id || '').slice(0, 8);
    const status = (p.session_status === 'connected' || p.attention_state === 'engaged') ? 'online'
                 : (p.attention_state === 'away') ? 'away' : '';
    const item = el('div', { class: 'list-item participant' + (status ? ' ' + status : '') },
      el('div', { class: 'avatar', text: senderInitials(display) }),
      el('div', { class: 'info' },
        el('div', { class: 'name' }, display, p.role === 'external' ? el('span', { class: 'role-badge', text: 'ext' }) : null),
        p.handle ? el('div', { class: 'handle', text: p.handle }) : null,
      ),
      el('span', { class: 'dot' }),
    );
    body.appendChild(item);
  }
}

function renderTasksTab(body, meta) {
  if (!meta.tasks.length) {
    body.appendChild(el('div', { class: 'empty-tab', text: 'No tasks yet.' }));
    return;
  }
  for (const t of meta.tasks) {
    const status = (t.status || 'proposed').toLowerCase();
    const item = el('div', { class: 'list-item' },
      el('div', null,
        el('span', { class: 'task-status ' + status, text: status.replace(/_/g, ' ') }),
        el('span', { class: 'li-title', text: t.title || '(untitled)' }),
      ),
      t.description ? el('div', { class: 'li-sub', text: t.description }) : null,
      el('div', { class: 'li-meta' },
        t.created_by ? `by ${displayNameFor(t.created_by, state.activeRoomId)} • ` : '',
        formatTs(t.created_at),
        t.assigned_to ? ` • → ${displayNameFor(t.assigned_to, state.activeRoomId)}` : '',
      ),
    );
    body.appendChild(item);
  }
}

function renderFilesTab(body, meta) {
  if (!meta.fileRefs.length) {
    body.appendChild(el('div', { class: 'empty-tab', text: 'No file references yet.' }));
    return;
  }
  for (const f of meta.fileRefs) {
    const item = el('div', { class: 'list-item' },
      el('div', { class: 'li-title', text: f.file_path || '(no path)' }),
      f.note ? el('div', { class: 'li-sub', text: f.note }) : null,
      el('div', { class: 'li-meta' },
        f.flagged_by ? `flagged by ${displayNameFor(f.flagged_by, state.activeRoomId)}` : 'unattributed',
        f.created_at ? ` • ${formatTs(f.created_at)}` : '',
      ),
    );
    body.appendChild(item);
  }
}

// ─── Wizard ────────────────────────────────────────────────────────────────

function openWizard() {
  const overlay = el('div', { class: 'dialog-overlay' });
  const msgBox = el('div', { id: 'wizard-msg' });

  const fld = (label, input) => [el('label', { text: label }), input];

  const shareInput = el('input', { type: 'text', name: 'share', placeholder: 'ant://example.com/r/abc123?invite=xyz', autocomplete: 'off', required: 'required' });
  const passwordInput = el('input', { type: 'password', name: 'password', autocomplete: 'off' });
  const handleInput = el('input', { type: 'text', name: 'handle', placeholder: '@your-name', autocomplete: 'off' });
  const kindSelect = el('select', { name: 'kind' },
    el('option', { value: 'cli', selected: 'selected', text: 'cli — full read+write' }),
    el('option', { value: 'mcp', text: 'mcp — read+write (agent-tagged)' }),
    el('option', { value: 'web', text: 'web — read-only' }),
  );
  const labelInput = el('input', { type: 'text', name: 'label', placeholder: "e.g. Marco's pitch room", autocomplete: 'off' });

  const close = () => overlay.remove();

  const form = el('form', {
    on: {
      submit: async (e) => {
        e.preventDefault();
        clear(msgBox);
        msgBox.appendChild(el('span', { class: 'ok', text: 'Exchanging…' }));
        try {
          const result = await api('/api/rooms/exchange', {
            method: 'POST',
            body: JSON.stringify({
              share: shareInput.value,
              password: passwordInput.value,
              handle: handleInput.value,
              kind: kindSelect.value,
              label: labelInput.value,
            }),
          });
          clear(msgBox);
          msgBox.appendChild(el('span', { class: 'ok', text: `Joined ${result.room_id}.` }));
          await loadRooms();
          selectRoom(result.room_id);
          setTimeout(close, 600);
        } catch (err) {
          clear(msgBox);
          msgBox.appendChild(el('span', { class: 'err', text: err.message || 'Exchange failed' }));
        }
      }
    }
  },
    ...fld('Share string', shareInput),
    ...fld('Password (if the room is gated)', passwordInput),
    ...fld('Your handle for this room', handleInput),
    ...fld('Token kind', kindSelect),
    ...fld('Label (optional)', labelInput),
    msgBox,
    el('div', { class: 'actions' },
      el('button', { type: 'button', class: 'btn-secondary', on: { click: close }, text: 'Cancel' }),
      el('button', { type: 'submit', class: 'btn-primary', text: 'Join' }),
    ),
  );

  const dialog = el('div', { class: 'dialog' },
    el('h2', { text: 'Add room' }),
    el('div', { class: 'hint', text: 'Paste the ant://host/r/<id>?invite=<token> share string from the room owner.' }),
    form,
  );

  overlay.appendChild(dialog);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  shareInput.focus();
}

// ─── Room actions ──────────────────────────────────────────────────────────

async function loadRooms() {
  const body = await api('/api/rooms');
  state.rooms = body.rooms || [];
  renderRoomList();
}

async function selectRoom(roomId) {
  if (!roomId) return;
  const meta = ensureRoomMeta(roomId);
  state.activeRoomId = roomId;
  meta.unread = 0;
  renderRoomList();
  renderRoom(roomId);

  // Backfill messages + participants in parallel.
  const messagesP = api(`/api/rooms/${encodeURIComponent(roomId)}/messages?limit=50`)
    .then(body => { meta.messages = body.messages || []; })
    .catch(err => console.error('backfill failed', err));
  const participantsP = api(`/api/rooms/${encodeURIComponent(roomId)}/participants`)
    .then(body => {
      const all = body.all || [...(body.participants || []), ...(body.postsFrom || [])];
      meta.participants = all;
      meta.displayMap = buildDisplayMap(all);
    })
    .catch(err => console.error('participants failed', err));

  await Promise.all([messagesP, participantsP]);
  // Re-render with the resolved data.
  if (state.activeRoomId === roomId) renderRoom(roomId);

  ensureStream(roomId);
  // Lazy-load tasks and files for the side-panel tabs (don't block initial paint).
  loadTasks(roomId);
  loadFileRefs(roomId);
}

async function loadTasks(roomId) {
  const meta = state.byRoom[roomId];
  if (!meta) return;
  try {
    const body = await api(`/api/rooms/${encodeURIComponent(roomId)}/tasks`);
    meta.tasks = body.tasks || [];
    if (state.activeRoomId === roomId) renderSidePanel();
  } catch (err) {
    console.warn('tasks fetch failed', err);
  }
}

async function loadFileRefs(roomId) {
  const meta = state.byRoom[roomId];
  if (!meta) return;
  try {
    const body = await api(`/api/rooms/${encodeURIComponent(roomId)}/file-refs`);
    meta.fileRefs = body.refs || [];
    if (state.activeRoomId === roomId) renderSidePanel();
  } catch (err) {
    console.warn('file-refs fetch failed', err);
  }
}

function ensureStream(roomId) {
  const meta = state.byRoom[roomId];
  if (!meta) return;
  if (meta.es) return;
  const es = new EventSource(`/api/rooms/${encodeURIComponent(roomId)}/stream`);
  meta.es = es;
  meta.streamState = 'connecting';
  es.onopen = () => { meta.streamState = 'open'; renderRoomList(); };
  es.onerror = () => { meta.streamState = 'error'; renderRoomList(); };
  es.onmessage = (ev) => onUpstreamFrame(roomId, null, ev.data);
  es.addEventListener('closed', () => {
    meta.streamState = 'closed';
    renderRoomList();
    es.close();
    meta.es = null;
  });
}

function onUpstreamFrame(roomId, _eventName, dataString) {
  let data;
  try { data = JSON.parse(dataString); } catch { return; }
  if (!data) return;
  if (data.type === 'message_added' || data.type === 'message_created') {
    const msg = data.message || data;
    appendMessage(roomId, msg);
    return;
  }
  if (data.type === 'task_created' || data.type === 'task_updated') {
    // Refetch the whole list — server is the source of truth for status.
    loadTasks(roomId);
    return;
  }
  if (data.type === 'file_ref_created' || data.type === 'file_ref_deleted') {
    loadFileRefs(roomId);
    return;
  }
  if (data.type === 'participants_changed' || data.type === 'participant_joined') {
    // Refresh participant list so aliases stay accurate.
    api(`/api/rooms/${encodeURIComponent(roomId)}/participants`)
      .then(body => {
        const all = body.all || [...(body.participants || []), ...(body.postsFrom || [])];
        const meta = state.byRoom[roomId];
        if (!meta) return;
        meta.participants = all;
        meta.displayMap = buildDisplayMap(all);
        if (state.activeRoomId === roomId) renderSidePanel();
      })
      .catch(() => {});
    return;
  }
}

function appendMessage(roomId, msg) {
  const meta = state.byRoom[roomId];
  if (!meta) return;
  if (meta.messages.find(m => m.id && m.id === msg.id)) return;
  meta.messages.push(msg);
  if (state.activeRoomId === roomId) {
    const list = $('#msg-list');
    if (list) {
      if (list.firstChild && list.firstChild.classList?.contains('empty')) clear(list);
      list.appendChild(buildMessageNode(msg, roomId));
      scrollToBottom();
    }
  } else {
    meta.unread = (meta.unread || 0) + 1;
    renderRoomList();
  }
  // If we don't recognise the sender yet, refresh the participants list so
  // future renders pick up the alias.
  if (msg.sender_id && !meta.displayMap[msg.sender_id]) {
    api(`/api/rooms/${encodeURIComponent(roomId)}/participants`)
      .then(body => {
        const all = body.all || [...(body.participants || []), ...(body.postsFrom || [])];
        meta.participants = all;
        meta.displayMap = buildDisplayMap(all);
      })
      .catch(() => {});
  }
}

async function onComposerSubmit(e) {
  e.preventDefault();
  const ta = $('#composer-input');
  if (!ta) return;
  const text = ta.value.trim();
  if (!text || !state.activeRoomId) return;
  const targetMatch = text.match(/^(@[A-Za-z0-9_-]+)\s+([\s\S]+)$/);
  const target = targetMatch ? targetMatch[1] : null;
  const content = targetMatch ? targetMatch[2] : text;
  ta.value = '';
  ta.style.height = '32px';
  const sendBtn = $('#composer-send');
  if (sendBtn) sendBtn.disabled = true;
  try {
    await api(`/api/rooms/${encodeURIComponent(state.activeRoomId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, target }),
    });
  } catch (err) {
    console.error('send failed', err);
    ta.value = text;
    alert('Send failed: ' + err.message);
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

// ─── Boot ──────────────────────────────────────────────────────────────────

async function boot() {
  loadTheme();
  if (!readCookie('__antchat')) {
    clear(app);
    app.classList.add('no-side-panel');
    app.appendChild(
      el('div', { class: 'empty' },
        el('div', { text: 'No launch token.' }),
        el('div', { text: 'Run `antchat web` in a terminal to get a fresh URL.' }),
      )
    );
    return;
  }
  try {
    await refreshCsrf();
    renderShell();
    await loadRooms();
    if (state.rooms.length === 0) {
      renderEmpty();
    } else {
      selectRoom(state.rooms[0].room_id);
    }
    state.ready = true;
  } catch (err) {
    console.error('boot failed', err);
    clear(app);
    app.appendChild(
      el('div', { class: 'empty' },
        el('div', { class: 'err', text: 'Boot failed: ' + err.message }),
      )
    );
  }
}

boot();
