/**
 * @fileoverview Real-time collaboration: presence + comments & mentions.
 *
 * Runs INSIDE the canvas iframe and renders its own floating UI over the canvas
 * (a toolbar, remote cursors, an avatar stack, comment pins + threads). It needs
 * no Angular changes.
 *
 * Transport: connects to the server relay at ws(s)://<host>/collab?doc=<id>.
 * If the WebSocket can't open (e.g. running under `ng serve` without the SSR
 * server), it falls back to a same-origin BroadcastChannel so presence +
 * comments still work live across browser TABS — handy for testing. The two
 * transports speak the exact same JSON messages, so the WS backend is a drop-in.
 *
 * Identity: a lightweight local user { id, name, color } in localStorage
 * (name is editable). This is identity-only — no passwords yet.
 *
 * Message types (all fan-out via the relay):
 *   presence:hello | presence:cursor | presence:select | presence:leave
 *   comment:add | comment:reply | comment:resolve | comment:delete
 */
(function () {
  'use strict';
  const DOC_ID = (new URLSearchParams(location.search).get('doc')) || 'default';
  const USER_KEY = 'cs-collab-user';
  const COMMENTS_KEY = 'cs-collab-comments-' + DOC_ID;
  const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
  const uid = (p) => p + Math.random().toString(16).slice(2, 10);

  // The persistent toolbar must render in the HOST window — this canvas iframe
  // is a tall element scrolled by the host, so a `position:fixed` toolbar inside
  // it lands at the bottom of the tall iframe (off-screen). Pins/cursors/popovers
  // stay in the iframe (they're anchored to content, which scrolls with it).
  const hostWin = (() => { try { return (window.parent && window.parent !== window) ? window.parent : window; } catch (e) { return window; } })();
  const hostDoc = hostWin.document;

  // Feature flags, driven by the host settings toggles (collab:config message).
  // Default ON; the host pushes the real values on load + whenever toggled.
  let cfg = { comments: true, presence: true };

  /* ------------------------------- identity -------------------------------- */
  // Identity lives in sessionStorage (NOT localStorage) so every browser TAB is
  // a DISTINCT user. localStorage is shared across all same-origin tabs, which
  // made two tabs load the SAME id — the collab protocol then treated them as
  // one person: snapshots self-rejected via `senderId === me.id` (so a new tab
  // never received the canvas), and a rename in one tab leaked into the other.
  // sessionStorage survives a reload of the SAME tab (id + chosen name persist
  // across refresh) but is unique per tab — exactly what multi-user collab needs.
  // NOTE: in production with real auth, seed `id` from the logged-in account.
  const loadUser = () => {
    try { const u = JSON.parse(sessionStorage.getItem(USER_KEY)); if (u && u.id) return u; } catch (e) { /* */ }
    const u = { id: uid('u_'), name: 'Guest ' + Math.floor(100 + Math.random() * 900), color: COLORS[Math.floor(Math.random() * COLORS.length)] };
    try { sessionStorage.setItem(USER_KEY, JSON.stringify(u)); } catch (e) { /* */ }
    return u;
  };
  let me = loadUser();
  const saveUser = () => { try { sessionStorage.setItem(USER_KEY, JSON.stringify(me)); } catch (e) { /* */ } };

  /* ------------------------------- transport ------------------------------- */
  let send = () => { };
  const listeners = [];
  const onMsg = (fn) => listeners.push(fn);
  const dispatch = (msg) => { if (msg) listeners.forEach((fn) => { try { fn(msg); } catch (e) { /* */ } }); };

  const initTransport = () => {
    let ws = null, bc = null, wsOk = false;
    const startBC = () => {
      if (bc) return;
      try {
        bc = new BroadcastChannel('cs-collab-' + DOC_ID);
        send = (m) => { try { bc.postMessage(m); } catch (e) { /* */ } };
        bc.onmessage = (e) => dispatch(e.data);
        hello();
      } catch (e) { /* */ }
    };
    try {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/collab?doc=${encodeURIComponent(DOC_ID)}`);
      ws.onopen = () => { wsOk = true; send = (m) => { try { ws.send(JSON.stringify(m)); } catch (e) { /* */ } }; hello(); };
      ws.onmessage = (e) => { try { dispatch(JSON.parse(e.data)); } catch (err) { /* */ } };
      ws.onclose = () => { if (!wsOk) startBC(); };
      ws.onerror = () => { if (!wsOk) startBC(); };
    } catch (e) { startBC(); }
    setTimeout(() => { if (!wsOk && !bc) startBC(); }, 1500);
  };
  const hello = () => send({ type: 'presence:hello', user: me, joinedAt: _joinedAt });

  /* --------------------------- coordinate mapping -------------------------- */
  // Cursors are shared in page-relative fractions so they line up regardless of
  // each peer's scroll position / window size.
  const docs = () => Array.from(document.querySelectorAll('.cs_margin'));
  const docAt = (cx, cy) => docs().find((d) => { const r = d.getBoundingClientRect(); return cy >= r.top && cy <= r.bottom && cx >= r.left && cx <= r.right; });
  const toPageFrac = (cx, cy) => {
    const all = docs(); const d = docAt(cx, cy) || all[0]; if (!d) return null;
    const r = d.getBoundingClientRect();
    return { page: all.indexOf(d), nx: (cx - r.left) / r.width, ny: (cy - r.top) / r.height };
  };
  const fromPageFrac = (p) => {
    const all = docs(); const d = all[p.page] || all[0]; if (!d) return null;
    const r = d.getBoundingClientRect();
    return { x: r.left + p.nx * r.width, y: r.top + p.ny * r.height };
  };
  // Comments anchor to a block id + fractional offset, so they follow the block.
  const blockAnchor = (cx, cy) => {
    const el = document.elementFromPoint(cx, cy);
    const block = el && el.closest && el.closest('.cs_block_s, .canvas-block');
    if (block) {
      if (!block.id) block.id = uid('block_');
      const r = block.getBoundingClientRect();
      return { blockId: block.id, relX: (cx - r.left) / r.width, relY: (cy - r.top) / r.height };
    }
    const pf = toPageFrac(cx, cy);
    return pf ? { page: pf.page, nx: pf.nx, ny: pf.ny } : null;
  };
  const anchorToViewport = (a) => {
    if (!a) return null;
    if (a.blockId) {
      const b = document.getElementById(a.blockId);
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + (a.relX || 0) * r.width, y: r.top + (a.relY || 0) * r.height };
    }
    return fromPageFrac(a);
  };

  /* --------------------------------- styles -------------------------------- */
  const STYLE = `
  .cs-collab-cursor{position:fixed;z-index:99000;pointer-events:none;transform:translate(-2px,-2px);transition:left .08s linear,top .08s linear}
  .cs-collab-cursor svg{display:block;filter:drop-shadow(0 1px 1px rgba(0,0,0,.3))}
  .cs-collab-cursor span{position:absolute;left:14px;top:10px;white-space:nowrap;font:600 11px/1 Inter,sans-serif;color:#fff;padding:2px 6px;border-radius:4px}
  .cs-collab-selout{position:fixed;z-index:98000;pointer-events:none;border:2px solid;border-radius:4px}
  .cs-collab-selout span{position:absolute;top:-18px;left:-2px;font:600 10px/1 Inter,sans-serif;color:#fff;padding:2px 5px;border-radius:3px}
  .cs-collab-bar{position:fixed;left:12px;bottom:12px;z-index:99500;display:flex;align-items:center;gap:8px;background:#111827;color:#fff;border-radius:10px;padding:6px 8px;box-shadow:0 6px 20px rgba(0,0,0,.3);font:500 12px/1 Inter,sans-serif}
  .cs-collab-bar button{border:none;background:#374151;color:#fff;border-radius:6px;padding:6px 9px;font-size:12px;cursor:pointer}
  .cs-collab-bar button.on{background:#248567}
  .cs-collab-avatars{display:flex}
  .cs-collab-av{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;color:#fff;font:700 10px/1 Inter,sans-serif;border:2px solid #111827;margin-left:-6px;cursor:default}
  .cs-collab-av:first-child{margin-left:0}
  .cs-collab-pin{position:fixed;z-index:98500;width:26px;height:26px;border-radius:50% 50% 50% 2px;display:grid;place-items:center;color:#fff;font-size:13px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.35);border:2px solid #fff}
  .cs-collab-pin.resolved{opacity:.45}
  .cs-collab-pop{position:fixed;z-index:99600;width:300px;max-height:60vh;overflow:auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.25);font:13px/1.4 Inter,sans-serif;color:#1f2937}
  .cs-collab-pop__hd{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #eee;font-weight:600}
  .cs-collab-pop__msgs{padding:8px 12px;display:flex;flex-direction:column;gap:10px}
  .cs-collab-msg__a{font-weight:600;font-size:12px}
  .cs-collab-msg__t{font-size:11px;color:#9ca3af;margin-left:6px}
  .cs-collab-msg__b{font-size:13px;margin-top:2px;white-space:pre-wrap}
  .cs-collab-msg__b .men{color:#2563eb;font-weight:600}
  .cs-collab-comp{position:relative;padding:8px 12px;border-top:1px solid #eee}
  .cs-collab-comp textarea{width:100%;box-sizing:border-box;border:1px solid #e5e7eb;border-radius:6px;padding:6px 8px;font:13px Inter,sans-serif;resize:vertical;min-height:42px}
  .cs-collab-comp__row{display:flex;justify-content:flex-end;gap:6px;margin-top:6px}
  .cs-collab-comp__row button{border:none;border-radius:6px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer}
  .cs-collab-btn-primary{background:#248567;color:#fff}
  .cs-collab-btn-ghost{background:#f3f4f6;color:#374151}
  .cs-collab-ment{position:absolute;left:12px;right:12px;bottom:60px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);max-height:160px;overflow:auto}
  .cs-collab-ment div{padding:7px 10px;cursor:pointer;display:flex;align-items:center;gap:8px}
  .cs-collab-ment div:hover,.cs-collab-ment div.sel{background:#eef2ff}
  .cs-collab-dot{width:16px;height:16px;border-radius:50%;color:#fff;display:grid;place-items:center;font:700 8px/1 Inter}
  body.cs-comment-mode .cs_paper{cursor:crosshair}`;
  const injectStyle = () => {
    const targets = hostDoc === document ? [document] : [document, hostDoc];
    targets.forEach((d) => {
      if (!d || d.getElementById('cs-collab-style')) return;
      const s = d.createElement('style'); s.id = 'cs-collab-style'; s.textContent = STYLE; d.head.appendChild(s);
    });
  };

  /* ------------------------------- presence -------------------------------- */
  const peers = new Map();         // userId → { user, lastSeen }
  const cursorEls = new Map();     // userId → element
  const selEls = new Map();        // userId → element
  const knownUsers = () => { const m = new Map(); m.set(me.id, me); peers.forEach((p) => m.set(p.user.id, p.user)); return Array.from(m.values()); };

  const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();
  let avatarsEl;
  const renderAvatars = () => {
    if (!avatarsEl) return;
    const users = knownUsers();
    avatarsEl.innerHTML = '';
    users.forEach((u) => {
      const a = document.createElement('div');
      a.className = 'cs-collab-av'; a.style.background = u.color; a.textContent = initial(u.name);
      a.title = u.id === me.id ? `${u.name} (you)` : u.name;
      avatarsEl.appendChild(a);
    });
  };

  const showCursor = (user, pos) => {
    if (!pos) return;
    let el = cursorEls.get(user.id);
    if (!el) {
      el = document.createElement('div'); el.className = 'cs-collab-cursor';
      el.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 1l5 13 2-5 5-2z" fill="${user.color}"/></svg><span style="background:${user.color}">${user.name}</span>`;
      document.body.appendChild(el); cursorEls.set(user.id, el);
    } else {
      // Element already exists — refresh label/color in case the peer renamed.
      const span = el.querySelector('span');
      if (span && (span.textContent !== user.name || span.style.background !== user.color)) {
        span.textContent = user.name; span.style.background = user.color;
      }
      const path = el.querySelector('path');
      if (path && path.getAttribute('fill') !== user.color) path.setAttribute('fill', user.color);
    }
    el.style.left = pos.x + 'px'; el.style.top = pos.y + 'px';
  };
  const showRemoteSelection = (user, blockId) => {
    let el = selEls.get(user.id);
    const b = blockId && document.getElementById(blockId);
    if (!b) { if (el) { el.remove(); selEls.delete(user.id); } return; }
    if (!el) {
      el = document.createElement('div'); el.className = 'cs-collab-selout';
      el.style.borderColor = user.color;
      el.innerHTML = `<span style="background:${user.color}">${user.name}</span>`;
      document.body.appendChild(el); selEls.set(user.id, el);
    } else {
      // Refresh label/color in case the peer renamed.
      el.style.borderColor = user.color;
      const span = el.querySelector('span');
      if (span) { span.textContent = user.name; span.style.background = user.color; }
    }
    el._blockId = blockId;
    const r = b.getBoundingClientRect();
    el.style.left = r.left + 'px'; el.style.top = r.top + 'px';
    el.style.width = r.width + 'px'; el.style.height = r.height + 'px';
  };
  // Refresh a peer's already-rendered cursor + selection labels after a rename
  // (the elements are created once with the name baked in; without this they'd
  // keep showing the old name until the element is recreated).
  const refreshPeerLabels = (user) => {
    const cur = cursorEls.get(user.id);
    if (cur) {
      const span = cur.querySelector('span');
      if (span) { span.textContent = user.name; span.style.background = user.color; }
      const path = cur.querySelector('path');
      if (path) path.setAttribute('fill', user.color);
    }
    const sel = selEls.get(user.id);
    if (sel) {
      sel.style.borderColor = user.color;
      const span = sel.querySelector('span');
      if (span) { span.textContent = user.name; span.style.background = user.color; }
    }
  };
  const dropPeer = (userId) => {
    peers.delete(userId);
    [cursorEls, selEls].forEach((m) => { const e = m.get(userId); if (e) e.remove(); m.delete(userId); });
    renderAvatars();
  };
  const touchPeer = (user, joinedAt) => {
    const existing = peers.get(user.id);
    const isNew = !existing;
    // A peer renamed / recolored if we already knew them but name/color differs.
    const changed = existing && (existing.user.name !== user.name || existing.user.color !== user.color);
    peers.set(user.id, {
      user,
      lastSeen: performance.now(),
      // Preserve the known joinedAt when this update carries none (cursor/select
      // messages call touchPeer without it) — otherwise it would reset to 0 and
      // wrongly look like a re-join on the next hello.
      joinedAt: (joinedAt != null) ? joinedAt : (existing ? existing.joinedAt : 0),
    });
    if (isNew || changed) renderAvatars();
    if (changed) refreshPeerLabels(user);   // push the new name onto live cursor/selection
    if (isNew) hello();                      // let the new peer learn us
  };
  // Reap peers we haven't heard from in a while (covers BroadcastChannel, which
  // has no disconnect event).
  setInterval(() => {
    const now = performance.now();
    peers.forEach((p, id) => { if (now - p.lastSeen > 15000) dropPeer(id); });
  }, 5000);

  let lastCursorSent = 0;
  const onPointerMove = (e) => {
    if (!cfg.presence) return;
    const now = performance.now();
    if (now - lastCursorSent < 60) return;
    lastCursorSent = now;
    const pf = toPageFrac(e.clientX, e.clientY);
    if (pf) send({ type: 'presence:cursor', user: me, pos: pf });
  };

  /* -------------------------------- comments ------------------------------- */
  let comments = [];
  const loadComments = () => { try { comments = JSON.parse(localStorage.getItem(COMMENTS_KEY) || '[]'); } catch (e) { comments = []; } };
  const persistComments = () => {
    try { localStorage.setItem(COMMENTS_KEY, JSON.stringify(comments)); } catch (e) { /* */ }
    // Best-effort server persistence (no-op under ng serve).
    try { fetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc: DOC_ID, comments }) }).catch(() => { }); } catch (e) { /* */ }
  };
  const fetchServerComments = () => {
    try {
      fetch('/api/comments?doc=' + encodeURIComponent(DOC_ID)).then((r) => r.json()).then((d) => {
        if (Array.isArray(d.comments) && d.comments.length) { comments = mergeComments(comments, d.comments); renderPins(); }
      }).catch(() => { });
    } catch (e) { /* */ }
  };
  const mergeComments = (a, b) => { const m = new Map();[...a, ...b].forEach((c) => m.set(c.id, c)); return Array.from(m.values()); };

  const fmtTime = (ts) => { const d = (new Date(ts)).getTime?.() ? new Date(ts) : new Date(); const diff = Date.now() - ts; const mn = Math.floor(diff / 60000); if (mn < 1) return 'just now'; if (mn < 60) return mn + 'm'; const h = Math.floor(mn / 60); if (h < 24) return h + 'h'; return Math.floor(h / 24) + 'd'; };
  const escapeHtml = (s) => (s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const renderBody = (text) => escapeHtml(text).replace(/@([A-Za-z0-9 _-]{1,24})/g, '<span class="men">@$1</span>');

  let commentMode = false, panelOpen = false, openThreadId = null;
  const pinEls = new Map();

  const renderPins = () => {
    if (!cfg.comments) { pinEls.forEach((el) => { el.style.display = 'none'; }); return; }
    const live = new Set();
    comments.forEach((c) => {
      if (c.parentId) return; // only roots get pins
      live.add(c.id);
      const pos = anchorToViewport(c.anchor);
      let pin = pinEls.get(c.id);
      if (!pos) { if (pin) { pin.style.display = 'none'; } return; }
      if (!pin) {
        pin = document.createElement('div'); pin.className = 'cs-collab-pin';
        pin.addEventListener('click', (e) => { e.stopPropagation(); openThread(c.id); });
        document.body.appendChild(pin); pinEls.set(c.id, pin);
      }
      pin.style.display = '';
      pin.style.background = c.color || '#248567';
      pin.classList.toggle('resolved', !!c.resolved);
      pin.textContent = c.resolved ? '✓' : '💬';
      pin.style.left = pos.x + 'px'; pin.style.top = (pos.y - 26) + 'px';
    });
    pinEls.forEach((el, id) => { if (!live.has(id)) { el.remove(); pinEls.delete(id); } });
  };

  const threadOf = (rootId) => comments.filter((c) => c.id === rootId || c.parentId === rootId)
    .sort((a, b) => a.createdAt - b.createdAt);

  let popEl = null;
  const closePopover = () => { if (popEl) { popEl.remove(); popEl = null; } openThreadId = null; };
  const openThread = (rootId) => {
    closePopover();
    const root = comments.find((c) => c.id === rootId); if (!root) return;
    openThreadId = rootId;
    const pos = anchorToViewport(root.anchor) || { x: 100, y: 100 };
    popEl = document.createElement('div'); popEl.className = 'cs-collab-pop';
    popEl.style.left = Math.min(window.innerWidth - 312, pos.x + 16) + 'px';
    popEl.style.top = Math.min(window.innerHeight - 280, Math.max(8, pos.y - 20)) + 'px';
    const msgs = threadOf(rootId).map((c) => `
      <div data-mid="${c.id}">
        <div><span class="cs-collab-msg__a" style="color:${c.color || '#1f2937'}">${escapeHtml(c.author)}</span><span class="cs-collab-msg__t">${fmtTime(c.createdAt)}</span></div>
        <div class="cs-collab-msg__b">${renderBody(c.body)}</div>
      </div>`).join('');
    popEl.innerHTML = `
      <div class="cs-collab-pop__hd">
        <span>Comment ${root.resolved ? '· resolved' : ''}</span>
        <span>
          <button class="cs-collab-btn-ghost" data-act="resolve" style="padding:4px 8px;border:none;border-radius:5px;cursor:pointer;font-size:11px">${root.resolved ? 'Reopen' : 'Resolve'}</button>
          <button class="cs-collab-btn-ghost" data-act="del" style="padding:4px 8px;border:none;border-radius:5px;cursor:pointer;font-size:11px;color:#ef4444">Delete</button>
          <button class="cs-collab-btn-ghost" data-act="close" style="padding:4px 8px;border:none;border-radius:5px;cursor:pointer;font-size:11px">✕</button>
        </span>
      </div>
      <div class="cs-collab-pop__msgs">${msgs}</div>
      <div class="cs-collab-comp">
        <textarea placeholder="Reply… use @ to mention"></textarea>
        <div class="cs-collab-comp__row">
          <button class="cs-collab-btn-primary" data-act="reply">Reply</button>
        </div>
      </div>`;
    document.body.appendChild(popEl);
    const ta = popEl.querySelector('textarea');
    wireMentions(ta, popEl.querySelector('.cs-collab-comp'));
    popEl.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') return closePopover();
      if (act === 'resolve') { toggleResolve(rootId); return; }
      if (act === 'del') { deleteThread(rootId); return; }
      if (act === 'reply') { const body = ta.value.trim(); if (body) addComment(root.anchor, body, rootId); ta.value = ''; }
    });
  };

  // @mention autocomplete
  const wireMentions = (ta, container) => {
    let menu = null, items = [], sel = 0, atPos = -1;
    const close = () => { if (menu) { menu.remove(); menu = null; } atPos = -1; };
    const apply = (u) => {
      const before = ta.value.slice(0, atPos);
      const after = ta.value.slice(ta.selectionStart);
      ta.value = before + '@' + u.name + ' ' + after;
      close(); ta.focus();
    };
    ta.addEventListener('input', () => {
      const caret = ta.selectionStart;
      const upto = ta.value.slice(0, caret);
      const m = /@([A-Za-z0-9 _-]*)$/.exec(upto);
      if (!m) return close();
      atPos = caret - m[0].length;
      const q = m[1].toLowerCase();
      items = knownUsers().filter((u) => u.name.toLowerCase().includes(q)).slice(0, 6);
      if (!items.length) return close();
      sel = 0;
      if (!menu) { menu = document.createElement('div'); menu.className = 'cs-collab-ment'; container.appendChild(menu); }
      menu.innerHTML = items.map((u, i) => `<div data-i="${i}" class="${i === sel ? 'sel' : ''}"><span class="cs-collab-dot" style="background:${u.color}">${initial(u.name)}</span>${escapeHtml(u.name)}</div>`).join('');
      menu.querySelectorAll('[data-i]').forEach((d) => d.addEventListener('mousedown', (e) => { e.preventDefault(); apply(items[+d.dataset.i]); }));
    });
    ta.addEventListener('keydown', (e) => {
      if (!menu) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % items.length; }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; }
      else if (e.key === 'Enter') { e.preventDefault(); apply(items[sel]); return; }
      else if (e.key === 'Escape') { close(); return; }
      else return;
      menu.querySelectorAll('[data-i]').forEach((d, i) => d.classList.toggle('sel', i === sel));
    });
  };

  const extractMentions = (body) => {
    const ids = []; const names = knownUsers();
    (body.match(/@([A-Za-z0-9 _-]{1,24})/g) || []).forEach((tok) => {
      const nm = tok.slice(1).trim();
      const u = names.find((x) => nm.startsWith(x.name) || x.name === nm);
      if (u) ids.push(u.id);
    });
    return Array.from(new Set(ids));
  };

  const addComment = (anchor, body, parentId) => {
    const c = {
      id: uid('c_'), docId: DOC_ID, anchor, body,
      author: me.name, authorId: me.id, color: me.color,
      mentions: extractMentions(body), parentId: parentId || null,
      resolved: false, createdAt: Date.now(),
    };
    comments.push(c); persistComments(); renderPins();
    send({ type: parentId ? 'comment:reply' : 'comment:add', comment: c });
    openThread(parentId || c.id);
    notifyMentions(c);
  };
  const toggleResolve = (rootId) => {
    const c = comments.find((x) => x.id === rootId); if (!c) return;
    c.resolved = !c.resolved; persistComments(); renderPins();
    send({ type: 'comment:resolve', id: rootId, resolved: c.resolved });
    openThread(rootId);
  };
  const deleteThread = (rootId) => {
    comments = comments.filter((c) => c.id !== rootId && c.parentId !== rootId);
    persistComments(); renderPins(); closePopover();
    send({ type: 'comment:delete', id: rootId });
  };
  const notifyMentions = (c) => {
    if (c.mentions && c.mentions.includes(me.id) && c.authorId !== me.id) toast(`${c.author} mentioned you`);
  };

  let toastEl;
  const toast = (text) => {
    if (!toastEl) { toastEl = hostDoc.createElement('div'); toastEl.className = 'cs-collab-toast'; toastEl.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;background:#111827;color:#fff;padding:10px 14px;border-radius:8px;font:600 13px Inter,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.3)'; hostDoc.body.appendChild(toastEl); }
    toastEl.textContent = '🔔 ' + text; toastEl.style.opacity = '1';
    clearTimeout(toastEl._t); toastEl._t = setTimeout(() => { toastEl.style.opacity = '0'; }, 4000);
  };

  /* ========================= CANVAS REAL-TIME SYNC ========================= */

  // Guard: set true while applying a remote mutation so we don't re-broadcast it.
  let _applyingRemote = false;
  // Debounce timers per block for text updates (avoid flooding on every keystroke).
  const _textTimers = new Map();
  // Move/resize debounce — throttle to one broadcast per 60 ms per block.
  const _moveTimers = new Map();
  // Tracks which blocks are locked by remote users { blockId → user }.
  const _lockedBy = new Map();
  // My own join timestamp — used to decide who sends the snapshot to a newcomer.
  const _joinedAt = Date.now();

  // Ensure every block has a stable DOM id.
  const _ensureId = (el) => { if (!el.id) el.id = uid('block_'); return el.id; };

  // Walk up from a block to find the nearest container that matches canvas
  // structure (.cs_margin → .cs_doc → .cs_page → .cs_paper). Assigns a stable
  // ID to that container so the remote tab can find the exact insertion point.
  const _ensureParentId = (block) => {
    const CONTAINER_CLASSES = ['cs_margin', 'cs_doc', 'cs_page', 'cs_paper', 'cs-doc-wrapper', 'custom-form-design'];
    let p = block.parentElement;
    while (p) {
      if (p.id) return p.id;
      if (CONTAINER_CLASSES.some((cls) => p.classList && p.classList.contains(cls))) {
        p.id = uid('container_');
        return p.id;
      }
      p = p.parentElement;
    }
    return '';
  };

  // Root canvas element (contains all .cs_page / .cs_doc children).
  const _canvas = () =>
    document.querySelector('.cs_paper') ||
    document.querySelector('.cs-doc-wrapper') ||
    document.querySelector('.custom-form-design');

  // ---- outbound helpers ----

  const _sendBlockAdd = (block) => {
    if (_applyingRemote) return;
    const id = _ensureId(block);
    // Use _ensureParentId so the container gets a stable id that the remote
    // tab can look up — plain parentElement.id is often '' for .cs_margin etc.
    const parentId = _ensureParentId(block);
    // nextSiblingId helps remote tab insert at the right position.
    const nextId = (block.nextElementSibling && block.nextElementSibling.id) || '';
    send({ type: 'block:add', blockId: id, html: block.outerHTML, parentId, nextId });
  };

  const _sendBlockRemove = (blockId) => {
    if (_applyingRemote || !blockId) return;
    send({ type: 'block:remove', blockId });
  };

  const _sendBlockMove = (block) => {
    if (_applyingRemote) return;
    const id = _ensureId(block);
    clearTimeout(_moveTimers.get(id));
    _moveTimers.set(id, setTimeout(() => {
      send({ type: 'block:move', blockId: id, style: block.getAttribute('style') || '' });
    }, 60));
  };

  const _sendBlockText = (block) => {
    if (_applyingRemote) return;
    const id = _ensureId(block);
    clearTimeout(_textTimers.get(id));
    _textTimers.set(id, setTimeout(() => {
      const editMe = block.querySelector('.edit_me');
      if (editMe) send({ type: 'block:text', blockId: id, html: editMe.innerHTML });
    }, 250));
  };

  const _sendLock = (blockId) => {
    if (_applyingRemote || !blockId) return;
    send({ type: 'block:lock', blockId, user: me });
  };

  const _sendUnlock = (blockId) => {
    if (_applyingRemote || !blockId) return;
    send({ type: 'block:unlock', blockId });
  };

  // Count real content blocks in the canvas (ignoring transient lock overlays).
  const _blockCount = (root) => (root || document).querySelectorAll('.cs_block_s').length;

  const _sendSnapshot = () => {
    const root = _canvas();
    if (!root) return;
    // Never broadcast an empty canvas — an empty snapshot would wipe a peer that
    // has content. Only the tab(s) that actually hold blocks act as the source.
    if (_blockCount(root) === 0) return;
    send({ type: 'canvas:snapshot', html: root.innerHTML, senderId: me.id, ts: _joinedAt });
  };

  // ---- inbound apply ----

  const _applyAdd = (blockId, html, parentId, nextId) => {
    if (document.getElementById(blockId)) return; // already exists
    const temp = document.createElement('div');
    temp.innerHTML = html;
    const block = temp.firstElementChild;
    if (!block) return;
    _applyingRemote = true;
    try {
      // Remove any collab lock overlays from the incoming HTML (they're transient).
      block.querySelectorAll('.cs-sync-lock').forEach((e) => e.remove());
      // Find the right parent container by id first, then by class fallback.
      let parent = parentId ? document.getElementById(parentId) : null;
      if (!parent) {
        // The sender assigned an id to the container — but on THIS tab the same
        // container hasn't received that id yet (fresh page). Mirror the id and
        // use the matching container element so future adds resolve correctly.
        if (parentId) {
          const FALLBACK_SELECTORS = ['.cs_margin', '.cs_doc', '.cs_page', '.cs_paper', '.cs-doc-wrapper', '.custom-form-design'];
          for (const sel of FALLBACK_SELECTORS) {
            const el = document.querySelector(sel);
            if (el) { el.id = parentId; parent = el; break; }
          }
        }
        if (!parent) parent = document.querySelector('.cs_margin') || document.querySelector('.cs_doc') || _canvas();
      }
      if (!parent) return;
      const nextSib = nextId ? document.getElementById(nextId) : null;
      parent.insertBefore(block, nextSib || null);
    } finally { _applyingRemote = false; }
  };

  const _applyRemove = (blockId) => {
    const block = document.getElementById(blockId);
    if (!block) return;
    // Don't remove a block the local user is actively editing.
    if (block.classList.contains('cs-editing') || block.classList.contains('cs-selected')) return;
    _applyingRemote = true;
    try { block.remove(); } finally { _applyingRemote = false; }
  };

  const _applyMove = (blockId, style) => {
    const block = document.getElementById(blockId);
    if (!block) return;
    _applyingRemote = true;
    try { block.setAttribute('style', style); } finally { _applyingRemote = false; }
  };

  const _applyText = (blockId, html) => {
    const block = document.getElementById(blockId);
    if (!block) return;
    const editMe = block.querySelector('.edit_me');
    if (!editMe) return;
    // Don't overwrite a block the local user is currently typing in.
    if (editMe.contentEditable === 'true') return;
    _applyingRemote = true;
    try { editMe.innerHTML = html; } finally { _applyingRemote = false; }
  };

  const _applyLock = (blockId, user) => {
    _lockedBy.set(blockId, user);
    const block = document.getElementById(blockId);
    if (!block) return;
    if (block.querySelector('.cs-sync-lock')) return;
    const ov = document.createElement('div');
    ov.className = 'cs-sync-lock';
    ov.style.cssText = `position:absolute;inset:0;background:${user.color}18;border:2px solid ${user.color};
      border-radius:4px;pointer-events:none;z-index:500;display:flex;
      align-items:flex-start;justify-content:flex-end;padding:3px;box-sizing:border-box;`;
    ov.innerHTML = `<span style="background:${user.color};color:#fff;font:600 10px/1.4 Inter,sans-serif;
      padding:1px 5px;border-radius:3px;white-space:nowrap;">✏ ${user.name}</span>`;
    block.style.position = block.style.position || 'relative';
    block.appendChild(ov);
  };

  const _applyUnlock = (blockId) => {
    _lockedBy.delete(blockId);
    document.getElementById(blockId)?.querySelector('.cs-sync-lock')?.remove();
  };

  const _applySnapshot = (html, senderId) => {
    if (senderId === me.id) return; // ignore my own snapshot echo
    const root = _canvas();
    if (!root) return;
    // Don't overwrite a block the local user is actively editing right now.
    if (document.querySelector('.cs_block_s.cs-editing')) return;
    // Snapshots are ONLY for initial catch-up of a freshly (re)joined tab. Apply
    // it only when THIS canvas is still empty — never clobber local content.
    // This prevents data loss / snapshot flip-flop when two tabs each hold
    // content; ongoing edits stay in sync via the incremental block:*/row:*
    // messages, not via wholesale snapshot replacement.
    if (_blockCount(root) > 0) return;
    _applyingRemote = true;
    try { root.innerHTML = html; } finally { _applyingRemote = false; }
  };

  // Debounced full-canvas snapshot: sent 600ms after any structural change.
  // This is the catch-all that guarantees both tabs stay in sync even when
  // block-level messages miss due to DOM structure differences (row-item wrapping).
  let _snapshotDebounce = null;
  const _scheduleSnapshot = () => {
    if (_applyingRemote) return;
    clearTimeout(_snapshotDebounce);
    _snapshotDebounce = setTimeout(_sendSnapshot, 600);
  };

  // ---- MutationObserver: watch the canvas for local changes ----

  let _canvasObserver = null;
  let _lockObserver   = null;
  let _lastEditingId  = null;

  const _initCanvasObserver = () => {
    const root = _canvas();
    if (!root || _canvasObserver) return;

    _canvasObserver = new MutationObserver((mutations) => {
      if (_applyingRemote) return;
      for (const mut of mutations) {
        // Nodes added — handle both direct cs_block_s and row-item wrappers.
        // When a block is dropped onto the canvas, the canvas JS creates a
        // .row-item that already contains the .cs_block_s, then inserts that
        // row-item into .cs_margin in one DOM operation. The MutationObserver
        // only fires for the row-item insertion (not the inner block) because
        // the block was already inside the row-item before it hit the DOM.
        for (const node of mut.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.classList.contains('cs_block_s')) {
            // Bare block added directly (e.g. free-move cover canvas).
            _sendBlockAdd(node);
            _scheduleSnapshot();
          } else if (node.classList.contains('row-item') || node.classList.contains('col-item')) {
            // Row/col wrapper added — sync the whole row-item so structure is preserved.
            const innerBlocks = node.querySelectorAll(':scope .cs_block_s');
            if (innerBlocks.length) {
              _ensureId(node); // give the row-item a stable id
              const parentId = _ensureParentId(node);
              const nextId = (node.nextElementSibling && node.nextElementSibling.id) || '';
              // Send the row-item itself as the sync unit so the remote tab
              // gets the full DOM structure (row-item + inner block).
              send({ type: 'row:add', rowId: node.id, html: node.outerHTML, parentId, nextId });
              _scheduleSnapshot();
            }
          }
        }
        // Nodes removed.
        for (const node of mut.removedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.classList.contains('cs_block_s') && node.id) {
            _sendBlockRemove(node.id);
            _scheduleSnapshot();
          } else if ((node.classList.contains('row-item') || node.classList.contains('col-item')) && node.id) {
            send({ type: 'row:remove', rowId: node.id });
            _scheduleSnapshot();
          }
        }
        // Position / size / style attribute changed on a block.
        if (mut.type === 'attributes' && mut.attributeName === 'style') {
          if (mut.target.nodeType === 1 && mut.target.classList.contains('cs_block_s')) {
            _sendBlockMove(mut.target);
          }
        }
        // Text content changed inside a block.
        if (mut.type === 'childList' || mut.type === 'characterData') {
          const target = mut.target;
          const editMe = (target.nodeType === 1)
            ? target.closest?.('.edit_me')
            : target.parentElement?.closest?.('.edit_me');
          if (editMe) {
            const block = editMe.closest('.cs_block_s');
            if (block) _sendBlockText(block);
          }
        }
      }
    });

    _canvasObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style'],
      characterData: true,
    });
  };

  // Watch cs-editing class to broadcast lock / unlock when local user edits text.
  const _initLockObserver = () => {
    const root = _canvas();
    if (!root || _lockObserver) return;

    _lockObserver = new MutationObserver(() => {
      if (_applyingRemote) return;
      const editing = document.querySelector('.cs_block_s.cs-editing');
      const currentId = editing ? _ensureId(editing) : null;
      if (currentId === _lastEditingId) return;
      if (_lastEditingId) _sendUnlock(_lastEditingId);
      if (currentId)      _sendLock(currentId);
      _lastEditingId = currentId;
    });

    _lockObserver.observe(root, { subtree: true, attributes: true, attributeFilter: ['class'] });
  };

  /* --------------------------- incoming messages --------------------------- */
  onMsg((m) => {
    if (m.type === 'presence:hello') {
      const existingPeer = peers.get(m.user.id);
      // Detect re-join: same userId but different joinedAt (user refreshed their tab).
      const isNew = !existingPeer;
      const isRejoin = existingPeer && existingPeer.joinedAt !== (m.joinedAt || 0);
      if (cfg.presence) touchPeer(m.user, m.joinedAt);
      // Answer a (re)joining peer with the current canvas — but only if I HOLD
      // content. CONTENT-POSSESSION (not join order) decides the source of
      // truth, so it works no matter which tab opened first. The receiver only
      // applies a snapshot when its own canvas is empty (see _applySnapshot), so
      // an empty peer can never wipe a tab that has content, and two tabs that
      // each hold content never clobber each other (they stay in sync via the
      // incremental block:*/row:* messages instead).
      if ((isNew || isRejoin) && _blockCount(_canvas()) > 0) {
        setTimeout(_sendSnapshot, 600);
      }
    }
    else if (m.type === 'presence:cursor') { if (cfg.presence) { touchPeer(m.user); showCursor(m.user, fromPageFrac(m.pos)); } }
    else if (m.type === 'presence:select') { if (cfg.presence) { touchPeer(m.user); showRemoteSelection(m.user, m.blockId); } }
    else if (m.type === 'presence:leave') {
      dropPeer(m.userId);
      // Clean up any lock overlays from the user who left.
      _lockedBy.forEach((user, blockId) => { if (user.id === m.userId) _applyUnlock(blockId); });
    }
    else if (m.type === 'comment:add' || m.type === 'comment:reply') {
      if (!comments.find((c) => c.id === m.comment.id)) { comments.push(m.comment); persistComments(); renderPins(); notifyMentions(m.comment); if (openThreadId && (m.comment.parentId === openThreadId)) openThread(openThreadId); }
    }
    else if (m.type === 'comment:resolve') { const c = comments.find((x) => x.id === m.id); if (c) { c.resolved = m.resolved; persistComments(); renderPins(); } }
    else if (m.type === 'comment:delete') { comments = comments.filter((c) => c.id !== m.id && c.parentId !== m.id); persistComments(); renderPins(); if (openThreadId === m.id) closePopover(); }
    // ---- canvas sync ----
    else if (m.type === 'block:add')    { _applyAdd(m.blockId, m.html, m.parentId, m.nextId); }
    else if (m.type === 'block:remove') { _applyRemove(m.blockId); }
    else if (m.type === 'block:move')   { _applyMove(m.blockId, m.style); }
    else if (m.type === 'block:text')   { _applyText(m.blockId, m.html); }
    else if (m.type === 'block:lock')   { _applyLock(m.blockId, m.user); }
    else if (m.type === 'block:unlock') { _applyUnlock(m.blockId); }
    // Row-level sync (row-item wrapper + inner block sent as one unit).
    else if (m.type === 'row:add')    { _applyAdd(m.rowId, m.html, m.parentId, m.nextId); }
    else if (m.type === 'row:remove') { _applyRemove(m.rowId); }
    else if (m.type === 'canvas:snapshot') { _applySnapshot(m.html, m.senderId); }
    else if (m.type === 'canvas:snapshot:request') { _sendSnapshot(); }
  });

  /* --------------------------------- toolbar ------------------------------- */
  let commentBtn = null;
  let bar = null;
  const setCommentMode = (on) => {
    commentMode = cfg.comments && !!on;
    if (commentBtn) commentBtn.classList.toggle('on', commentMode);
    document.body.classList.toggle('cs-comment-mode', commentMode); // iframe body → crosshair
  };

  const clearRemoteVisuals = () => {
    cursorEls.forEach((e) => e.remove()); cursorEls.clear();
    selEls.forEach((e) => e.remove()); selEls.clear();
  };

  // Apply host settings: show/hide comments + presence UI.
  const applyConfig = (c) => {
    cfg = Object.assign({}, cfg, c || {});
    if (commentBtn) commentBtn.style.display = cfg.comments ? '' : 'none';
    if (!cfg.comments) { setCommentMode(false); closePopover(); }
    if (avatarsEl) avatarsEl.style.display = cfg.presence ? '' : 'none';
    if (!cfg.presence) clearRemoteVisuals();
    if (bar) bar.style.display = (cfg.comments || cfg.presence) ? '' : 'none';
    renderPins();
  };

  // Exposed so the host topbar button + settings toggles can drive collab.
  window.Collab = window.Collab || {};
  window.Collab.toggleCommentMode = () => { if (cfg.comments) setCommentMode(!commentMode); };
  window.Collab.applyConfig = applyConfig;

  const buildBar = () => {
    // Remove any stale bars/toasts left in the HOST by a previous iframe load
    // (the iframe reloads, but host-appended elements persist → duplicates).
    hostDoc.querySelectorAll('.cs-collab-bar, .cs-collab-toast').forEach((e) => e.remove());
    bar = hostDoc.createElement('div'); bar.className = 'cs-collab-bar';
    bar.innerHTML = `
      <span class="cs-collab-avatars"></span>
      <button data-c="comment" title="Comment mode — click the canvas to drop a comment">💬 Comment</button>
      <button data-c="me" title="Rename yourself">You: <b>${escapeHtml(me.name)}</b></button>`;
    hostDoc.body.appendChild(bar);
    avatarsEl = bar.querySelector('.cs-collab-avatars');
    const meBtn = bar.querySelector('[data-c="me"]');
    commentBtn = bar.querySelector('[data-c="comment"]');
    commentBtn.addEventListener('click', () => setCommentMode(!commentMode));
    meBtn.addEventListener('click', () => {
      const nm = prompt('Your display name', me.name);
      if (nm && nm.trim()) { me.name = nm.trim(); saveUser(); meBtn.innerHTML = `You: <b>${escapeHtml(me.name)}</b>`; renderAvatars(); hello(); }
    });
    renderAvatars();
  };

  // Click on the canvas in comment mode → start a new comment thread.
  const onCanvasClick = (e) => {
    if (!commentMode) return;
    if (e.target.closest('.cs-collab-pop, .cs-collab-pin, .cs-collab-bar')) return;
    const anchor = blockAnchor(e.clientX, e.clientY);
    if (!anchor) return;
    e.preventDefault(); e.stopPropagation();
    // Create an empty draft thread by opening a composer popover at the point.
    openDraft(anchor, e.clientX, e.clientY);
    setCommentMode(false);
  };
  const openDraft = (anchor, x, y) => {
    closePopover();
    popEl = document.createElement('div'); popEl.className = 'cs-collab-pop';
    popEl.style.left = Math.min(window.innerWidth - 312, x + 12) + 'px';
    popEl.style.top = Math.min(window.innerHeight - 200, y) + 'px';
    popEl.innerHTML = `
      <div class="cs-collab-pop__hd"><span>New comment</span><button class="cs-collab-btn-ghost" data-act="close" style="border:none;border-radius:5px;cursor:pointer;padding:4px 8px">✕</button></div>
      <div class="cs-collab-comp">
        <textarea placeholder="Comment… use @ to mention"></textarea>
        <div class="cs-collab-comp__row">
          <button class="cs-collab-btn-ghost" data-act="close">Cancel</button>
          <button class="cs-collab-btn-primary" data-act="add">Comment</button>
        </div>
      </div>`;
    document.body.appendChild(popEl);
    const ta = popEl.querySelector('textarea'); ta.focus();
    wireMentions(ta, popEl.querySelector('.cs-collab-comp'));
    popEl.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') return closePopover();
      if (act === 'add') { const body = ta.value.trim(); if (body) addComment(anchor, body, null); }
    });
  };

  // Reposition pins + remote selection outlines on scroll & resize (their
  // fixed/viewport coords otherwise drift as the canvas moves).
  const reposition = () => {
    renderPins();
    selEls.forEach((el, id) => { const p = peers.get(id); if (p && el._blockId) showRemoteSelection(p.user, el._blockId); });
  };

  /* --------------------------------- wiring -------------------------------- */
  const init = () => {
    injectStyle();
    loadComments();
    buildBar();
    initTransport();
    fetchServerComments();
    renderPins();

    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('click', onCanvasClick, true);
    document.addEventListener('scroll', () => requestAnimationFrame(reposition), true);
    window.addEventListener('resize', () => requestAnimationFrame(reposition));

    // Broadcast which block I have selected (presence).
    if (window.EditorManager) {
      let last = null;
      setInterval(() => {
        if (!cfg.presence) return;
        const b = window.EditorManager.getSelected?.();
        const id = b ? (b.id || (b.id = uid('block_'))) : null;
        if (id !== last) { last = id; send({ type: 'presence:select', user: me, blockId: id }); }
      }, 400);
    }
    hello();
    // Wire up canvas mutation observers after DOM is stable.
    setTimeout(() => { _initCanvasObserver(); _initLockObserver(); }, 800);
    // When THIS iframe instance goes away, remove its host-appended UI so the
    // next load doesn't stack a duplicate bar/toast.
    window.addEventListener('pagehide', () => { try { bar && bar.remove(); toastEl && toastEl.remove(); } catch (e) { /* */ } });
    // Tell the host we're ready so it can push the current settings (collab:config).
    try { window.parent && window.parent.postMessage({ source: 'custom-form-twig', type: 'collab:ready' }, '*'); } catch (e) { /* */ }
  };

  const collabEnabled = () => {
    const f = (typeof window !== 'undefined' && window.EditorFeatures) ? window.EditorFeatures : null;
    return !f || f.collab !== false;
  };

  if (collabEnabled()) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
