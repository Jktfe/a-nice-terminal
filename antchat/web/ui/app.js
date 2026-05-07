// antchat web — local browser UI for ANT chat rooms.
//
// Vanilla ES module, no build step. v0.3.0-alpha targets the
// "smallest end-to-end testable" subset of the production-shape plan:
//   - sidebar listing rooms from ~/.ant/config.json (+ "add room" wizard)
//   - one active room view at a time, backfill 50, live SSE, send
//   - @-mention regex highlight (autocomplete is v0.3.1)
//   - CSRF double-submit on all mutating fetches
//
// v0.3.1 will swap this single file for an htm+Preact bundle. The DOM
// structure here is intentionally close to the JSX shape that migration
// will produce, so the diff stays mechanical.
//
// Note: this file deliberately avoids `innerHTML` with any data that ever
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
  byRoom: {},
  ready: false,
};

const app = $('#app');

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

// ─── Mention rendering (safe text → mixed text+span nodes) ─────────────────

function appendContentNodes(parent, text) {
  // Word-boundary @handle, same shape as antchat/lib/notifier.ts mentionsHandle.
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

function buildMessageNode(m) {
  const isSystem = m.role === 'system' || m.msg_type === 'system';
  const sender = m.sender_id || m.role || 'unknown';
  const initials = String(sender).replace(/^@/, '').slice(0, 2).toUpperCase();

  const meta = el('div', { class: 'meta' },
    el('span', { class: 'sender', text: sender }),
    m.target ? el('span', { class: 'target', text: '→ ' + m.target }) : null,
    el('span', { class: 'ts', title: m.created_at || '', text: formatTs(m.created_at) }),
  );
  const content = el('div', { class: 'content' });
  appendContentNodes(content, String(m.content || ''));
  return el('div', { class: 'msg' + (isSystem ? ' system' : '') },
    el('div', { class: 'avatar', text: initials }),
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
  const addBtn = el('button', {
    class: 'add-room',
    title: 'Add room',
    on: { click: openWizard },
    text: '+',
  });
  app.appendChild(
    el('aside', { class: 'sidebar' },
      el('div', { class: 'sidebar-header' },
        el('span', { text: 'antchat' }),
        addBtn,
      ),
      el('ul', { class: 'room-list', id: 'room-list' }),
      el('div', { class: 'sidebar-footer', id: 'sidebar-footer', text: '…' }),
    )
  );
  app.appendChild(el('main', { class: 'chat', id: 'chat-main' }));
}

function renderRoomList() {
  const ul = $('#room-list');
  if (!ul) return;
  clear(ul);
  for (const r of state.rooms) ul.appendChild(buildRoomListItem(r));
  $('#sidebar-footer').textContent =
    `${state.rooms.length} room${state.rooms.length === 1 ? '' : 's'} • antchat web 0.3.0`;
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
}

function renderRoom(roomId) {
  const room = state.rooms.find(r => r.room_id === roomId);
  const main = $('#chat-main');
  if (!room) return renderEmpty();
  const handle = room.handles[0]?.handle || '';
  const meta = state.byRoom[roomId] || (state.byRoom[roomId] = { messages: [], participants: [], es: null, unread: 0 });

  clear(main);

  const header = el('div', { class: 'chat-header' },
    el('span', { class: 'h-room', text: room.room_id }),
    el('span', { class: 'h-handle', text: handle || '(no handle)' }),
  );

  const list = el('div', { class: 'message-list', id: 'msg-list' });
  if (!meta.messages.length) list.appendChild(buildEmptyMessages());
  else for (const m of meta.messages) list.appendChild(buildMessageNode(m));

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
}

function scrollToBottom() {
  const list = $('#msg-list');
  if (list) list.scrollTop = list.scrollHeight;
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
    id: 'wizard-form',
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
  const meta = state.byRoom[roomId] || (state.byRoom[roomId] = { messages: [], participants: [], es: null, unread: 0 });
  state.activeRoomId = roomId;
  meta.unread = 0;
  renderRoomList();
  renderRoom(roomId);

  try {
    const body = await api(`/api/rooms/${encodeURIComponent(roomId)}/messages?limit=50`);
    meta.messages = body.messages || [];
    if (state.activeRoomId === roomId) renderRoom(roomId);
  } catch (err) {
    console.error('backfill failed', err);
  }

  ensureStream(roomId);
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
  if (data && (data.type === 'message_added' || data.type === 'message_created')) {
    const msg = data.message || data;
    appendMessage(roomId, msg);
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
      list.appendChild(buildMessageNode(msg));
      scrollToBottom();
    }
  } else {
    meta.unread = (meta.unread || 0) + 1;
    renderRoomList();
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
  if (!readCookie('__antchat')) {
    clear(app);
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
