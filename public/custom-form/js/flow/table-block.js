/**
 * @fileoverview Static Table block — a Canva-style editable table.
 *
 * A plain <table> inside a .cs_block_s. Unlike the data-bound Table Repeater,
 * this is a STATIC table the user builds by hand: type into cells, add/remove
 * rows & columns, merge/split cells, resize columns/rows, and style cells
 * (fill / border / alignment / text format).
 *
 * It exports cleanly: the <table> is plain DOM the Twig generator clones; the
 * floating toolbar lives in <body> with [data-cs-chrome] so it's never
 * exported and never starts a drag. Cell `contenteditable` is stripped on
 * deactivate.
 *
 * Editing turns on when the block enters `.cs-editing` (the same state machine
 * inline-editor.js drives for every block). Because the table has no `.edit_me`
 * target, inline-editor's text-editor init no-ops and we own all interaction.
 *
 * Internals use a rectangular ID-matrix (read() ⇄ render()) so merges,
 * inserts and deletes stay correct even with col/row spans.
 *
 * Exposes: window.TableBlock.createBlock(rows, cols)
 */
(function () {
  window.TableBlock = window.TableBlock || {};

  const hash = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2));

  /* ------------------------------ block markup ----------------------------- */

  const buildTableEl = (rows, cols) => {
    const table = document.createElement('table');
    table.className = 'cs-table';
    table.id = `dynamic_${hash()}`;

    const cg = document.createElement('colgroup');
    for (let c = 0; c < cols; c++) {
      const col = document.createElement('col');
      col.style.width = `${(100 / cols).toFixed(4)}%`;
      cg.appendChild(col);
    }
    table.appendChild(cg);

    const tbody = document.createElement('tbody');
    for (let r = 0; r < rows; r++) {
      const tr = document.createElement('tr');
      for (let c = 0; c < cols; c++) {
        const td = document.createElement('td');
        td.className = 'cs-cell' + (r === 0 ? ' cs-cell--head' : '');
        td.innerHTML = r === 0 ? `` : '';
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  };

  const createBlock = (rows = 3, cols = 3) => {
    const block = document.createElement('div');
    block.className = 'cs_block_s cs-table-block';
    block.setAttribute('data', 'Table');
    block.setAttribute('custom-name', 'Table');
    block.dataset.blockType = 'table';
    block.id = `block_${hash()}`;

    const table = buildTableEl(rows, cols);

    // Froala mode: wrap the table in an `.edit_me` so inline-editor.js inits
    // Froala on it (giving Froala's built-in table cell editing) — same pattern
    // as the Table Repeater, just without data binding. Custom mode: bare table
    // so our own engine drives it.
    if ((typeof window.isFroalaEditor === 'function') && window.isFroalaEditor()) {
      const wrap = document.createElement('div');
      wrap.className = 'edit_me cs-table-edit fr-element fr-view';
      wrap.id = `dynamic_${hash()}`;
      wrap.appendChild(table);
      block.appendChild(wrap);
    } else {
      block.appendChild(table);
    }
    return block;
  };

  /* ------------------------- matrix read / render -------------------------- */

  // Build an ID-matrix M[r][c] -> cellId, plus a cells{} map of cell data.
  // Spanned slots all point at the same id; the cell's bounding rect (derived
  // at render time) yields its colspan/rowspan.
  const read = (table) => {
    const body = table.tBodies[0];
    const trs = Array.from(body ? body.rows : []);
    const M = [];
    const cells = {};
    let nextId = 1;
    trs.forEach((tr, r) => {
      M[r] = M[r] || [];
      let c = 0;
      Array.from(tr.cells).forEach((td) => {
        while (M[r][c] !== undefined) c++;
        const id = nextId++;
        cells[id] = { html: td.innerHTML, style: td.getAttribute('style') || '', head: td.classList.contains('cs-cell--head') };
        const cs = td.colSpan || 1, rs = td.rowSpan || 1;
        for (let i = 0; i < rs; i++) { M[r + i] = M[r + i] || []; for (let j = 0; j < cs; j++) M[r + i][c + j] = id; }
        c += cs;
      });
    });
    const cols = M.reduce((m, row) => Math.max(m, row.length), 0);
    // Fill ragged gaps with fresh empty cells so the matrix is rectangular.
    M.forEach((row) => { for (let c = 0; c < cols; c++) if (row[c] === undefined) { const id = nextId++; cells[id] = { html: '', style: '', head: false }; row[c] = id; } });
    return { M, cells, rows: M.length, cols };
  };

  const colWidthsOf = (table) => Array.from(table.querySelectorAll('colgroup > col')).map((c) => c.style.width || '');

  /**
   * Legacy Froala mode only: Froala's built-in "insert column/row" creates plain
   * <td>s that are missing our `cs-cell` class (so they get no border) and often
   * carry a junk `style="null; width:…"` attribute. Re-stamp every cell so it
   * looks like a real table cell again. A freshly inserted cell mirrors the
   * header state of its row's already-stamped siblings, so a column inserted
   * into the header row stays a header. Returns true if anything changed.
   */
  const normalizeCells = (table) => {
    if (!table) return false;
    let changed = false;
    Array.from(table.rows).forEach((tr) => {
      // Captured before we stamp anything: do this row's existing cells read as
      // header cells? Column inserts should match their row.
      const rowIsHead = Array.from(tr.cells).some((c) => c.classList.contains('cs-cell--head'));
      Array.from(tr.cells).forEach((td) => {
        if (!td.classList.contains('cs-cell')) {
          td.classList.add('cs-cell');
          if (rowIsHead) td.classList.add('cs-cell--head');
          changed = true;
        }
        // Drop the literal "null" Froala prepends to copied style attributes.
        const style = td.getAttribute('style');
        if (style && /(^|;)\s*null\s*(;|$)/.test(style)) {
          const cleaned = style.replace(/(^|;)\s*null\s*(;|$)/g, '$1').replace(/^;+/, '').trim();
          if (cleaned) td.setAttribute('style', cleaned);
          else td.removeAttribute('style');
          changed = true;
        }
      });
    });
    return changed;
  };

  // Re-render <colgroup> + <tbody> from a matrix. Each cell is emitted once at
  // the top-left of its bounding rect with the right colspan/rowspan.
  const render = (table, state, colWidths) => {
    const { M, cells, rows, cols } = state;
    const rect = {};
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const id = M[r][c];
      const b = rect[id] || (rect[id] = { r0: r, c0: c, r1: r, c1: c });
      b.r0 = Math.min(b.r0, r); b.c0 = Math.min(b.c0, c); b.r1 = Math.max(b.r1, r); b.c1 = Math.max(b.c1, c);
    }
    const tbody = document.createElement('tbody');
    for (let r = 0; r < rows; r++) {
      const tr = document.createElement('tr');
      for (let c = 0; c < cols; c++) {
        const id = M[r][c];
        const b = rect[id];
        if (b.r0 !== r || b.c0 !== c) continue; // skip non top-left slots
        const td = document.createElement('td');
        td.className = 'cs-cell' + (cells[id].head ? ' cs-cell--head' : '');
        if (cells[id].style) td.setAttribute('style', cells[id].style);
        const cspan = b.c1 - b.c0 + 1, rspan = b.r1 - b.r0 + 1;
        if (cspan > 1) td.colSpan = cspan;
        if (rspan > 1) td.rowSpan = rspan;
        td.innerHTML = cells[id].html || '';
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    const oldCg = table.querySelector('colgroup');
    if (oldCg) oldCg.remove();
    const cg = document.createElement('colgroup');
    for (let c = 0; c < cols; c++) {
      const col = document.createElement('col');
      const w = (colWidths && colWidths[c]) || `${(100 / cols).toFixed(4)}%`;
      col.style.width = w;
      cg.appendChild(col);
    }
    if (table.tBodies[0]) { table.insertBefore(cg, table.tBodies[0]); table.tBodies[0].replaceWith(tbody); }
    else { table.appendChild(cg); table.appendChild(tbody); }
  };

  /* ------------------------------ coordinates ------------------------------ */

  // The matrix top-left (r,c) of a rendered <td>. A row's DOM cells are exactly
  // the cells whose top-left is on that row (rowspan cells from above don't
  // appear in the row), so we map the td's DOM index to the n-th column that
  // starts a cell on this row.
  const cellRect = (table, td) => {
    const state = read(table);
    const tr = td.parentElement;
    const r0 = Array.from(table.tBodies[0].rows).indexOf(tr);
    const idx = Array.from(tr.cells).indexOf(td);
    const starts = [];
    for (let c = 0; c < state.cols; c++) {
      const id = state.M[r0][c];
      const topLeftHere = (r0 === 0 || state.M[r0 - 1][c] !== id) && (c === 0 || state.M[r0][c - 1] !== id);
      if (topLeftHere) starts.push(c);
    }
    const c0 = starts[idx] != null ? starts[idx] : 0;
    return { r: r0, c: c0, state };
  };

  /* --------------------------------- engine -------------------------------- */

  let S = null; // { block, table, toolbar, selected:Set<td>, anchor, ... }

  const getColWidths = () => colWidthsOf(S.table);

  // The rendered <td> that owns matrix slot (r,c) — used to re-find the active
  // cell after a re-render so follow-up ops still target the right cell.
  const tdAt = (r, c) => {
    const state = read(S.table);
    if (!state.M[r] || state.M[r][c] == null) return null;
    const id = state.M[r][c];
    let found = null;
    S.table.querySelectorAll('td.cs-cell').forEach((td) => {
      if (found) return;
      const rc = cellRect(S.table, td);
      if (state.M[rc.r][rc.c] === id) found = td;
    });
    return found;
  };

  // Run a structural op: read → mutate(state) → render → re-wire cells. The
  // active cell is re-resolved by coordinate so the next op keeps targeting it.
  const apply = (mutate) => {
    const ac = (S.activeCell && S.table.contains(S.activeCell)) ? cellRect(S.table, S.activeCell) : null;
    const state = read(S.table);
    const widths = getColWidths();
    const next = mutate(state, widths) || {};
    render(S.table, state, next.widths || widths);
    wireCells();
    clearSelection();
    if (ac) {
      const d = read(S.table);
      S.activeCell = tdAt(Math.min(ac.r, d.rows - 1), Math.min(ac.c, d.cols - 1));
      S.anchorCell = S.activeCell;
    } else { S.activeCell = null; S.anchorCell = null; }
    updateOverlay();
    emitChange();
  };

  const activeCoord = () => {
    const td = S.activeCell && S.table.contains(S.activeCell) ? S.activeCell : S.table.querySelector('.cs-cell');
    if (!td) return { r: 0, c: 0 };
    return cellRect(S.table, td);
  };

  /* structural operations -------------------------------------------------- */

  const insertRow = (where) => apply((st) => {
    const { r } = activeCoord();
    const at = where === 'above' ? r : r + 1;
    const row = [];
    for (let c = 0; c < st.cols; c++) {
      // If a vertical span crosses the insert boundary, extend it.
      if (at > 0 && at < st.rows && st.M[at - 1][c] === st.M[at][c]) row[c] = st.M[at][c];
      else { const id = freshId(st); row[c] = id; }
    }
    st.M.splice(at, 0, row);
    st.rows++;
  });

  const insertCol = (where) => apply((st, widths) => {
    const { c } = activeCoord();
    const at = where === 'left' ? c : c + 1;
    for (let r = 0; r < st.rows; r++) {
      if (at > 0 && at < st.cols && st.M[r][at - 1] === st.M[r][at]) st.M[r].splice(at, 0, st.M[r][at]); // inside a horizontal span
      else st.M[r].splice(at, 0, freshId(st, r === 0));
    }
    st.cols++;
    const nw = widths.slice(); nw.splice(at, 0, `${(100 / st.cols).toFixed(4)}%`);
    return { widths: nw };
  });

  const deleteRow = () => apply((st) => {
    if (st.rows <= 1) return;
    const { r } = activeCoord();
    st.M.splice(r, 1); st.rows--;
  });

  const deleteCol = () => apply((st, widths) => {
    if (st.cols <= 1) return;
    const { c } = activeCoord();
    st.M.forEach((row) => row.splice(c, 1)); st.cols--;
    const nw = widths.slice(); nw.splice(c, 1);
    return { widths: nw };
  });

  // A fresh empty cell id added to a state mid-mutation.
  const freshId = (st, head = false) => {
    const id = (st._next || (st._next = Object.keys(st.cells).length + 1000)) + 1;
    st._next = id;
    st.cells[id] = { html: '', style: '', head };
    return id;
  };

  /* merge / split ---------------------------------------------------------- */

  // Bounding rect of the current selection + whether it COMPLETELY fills that
  // rect (no gaps). Merge is allowed only for a full rectangle of ≥2 cells —
  // otherwise a diagonal/sparse pick would swallow unselected cells.
  const selectionRectInfo = () => {
    const tds = S.selected.size ? Array.from(S.selected) : (S.activeCell ? [S.activeCell] : []);
    if (!tds.length) return null;
    const state = read(S.table);
    const ids = new Set();
    tds.forEach((td) => { const rc = cellRect(S.table, td); ids.add(state.M[rc.r][rc.c]); });
    let r0 = Infinity, c0 = Infinity, r1 = -1, c1 = -1, slots = 0;
    for (let r = 0; r < state.rows; r++) for (let c = 0; c < state.cols; c++) {
      if (ids.has(state.M[r][c])) { slots++; r0 = Math.min(r0, r); c0 = Math.min(c0, c); r1 = Math.max(r1, r); c1 = Math.max(c1, c); }
    }
    const area = (r1 - r0 + 1) * (c1 - c0 + 1);
    return { r0, c0, r1, c1, filled: slots === area, cellCount: ids.size };
  };

  // Merge offered only when the picked cells form a complete rectangle (≥2).
  const canMerge = () => { const i = selectionRectInfo(); return !!i && i.filled && i.cellCount > 1; };
  // Split offered only for an already-merged cell.
  const canSplit = () => { const td = S.activeCell; return !!td && ((td.colSpan || 1) > 1 || (td.rowSpan || 1) > 1); };

  const mergeCells = () => {
    const info = selectionRectInfo();
    if (!info || !info.filled || info.cellCount < 2) return;
    const { r0, c0, r1, c1 } = info;
    apply((st) => {
      const keep = st.M[r0][c0];
      const parts = [];
      const done = new Set();
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const id = st.M[r][c];
        if (!done.has(id)) { done.add(id); const h = (st.cells[id].html || '').trim(); if (h && id !== keep) parts.push(h); }
        st.M[r][c] = keep;
      }
      if (parts.length) st.cells[keep].html = [(st.cells[keep].html || '').trim(), ...parts].filter(Boolean).join(' ');
    });
  };

  const splitCell = () => {
    if (!canSplit()) return;
    const { r, c } = activeCoord();
    apply((st) => {
      const id = st.M[r][c];
      let first = true;
      for (let rr = 0; rr < st.rows; rr++) for (let cc = 0; cc < st.cols; cc++) {
        if (st.M[rr][cc] === id) {
          if (first) { first = false; } // keep master slot as-is
          else st.M[rr][cc] = freshId(st, st.cells[id].head);
        }
      }
    });
  };

  /* cell styling ----------------------------------------------------------- */

  const eachSelected = (fn) => {
    const tds = S.selected.size ? Array.from(S.selected) : (S.activeCell ? [S.activeCell] : []);
    tds.forEach(fn);
    emitChange();
  };

  const setCellStyle = (prop, value) => eachSelected((td) => { td.style[prop] = value; });
  const toggleHeader = () => eachSelected((td) => td.classList.toggle('cs-cell--head'));

  const setBorder = (color, on) => eachSelected((td) => {
    if (on === false) { td.style.border = 'none'; return; }
    td.style.border = `1px solid ${color || '#d0d5e2'}`;
  });

  // Text format inside the focused cell via execCommand.
  const textCmd = (cmd, val) => {
    if (S.activeCell) S.activeCell.focus();
    try { document.execCommand('styleWithCSS', false, true); } catch (e) { /* */ }
    try { document.execCommand(cmd, false, val == null ? null : val); } catch (e) { /* */ }
    emitChange();
  };

  /* ------------------------------- selection ------------------------------- */

  const clearSelection = (silent = false) => {
    if (!S) return;
    S.table.querySelectorAll('.cs-cell--selected').forEach((td) => td.classList.remove('cs-cell--selected'));
    S.selected.clear();
    updateOverlay();
    if (!silent) onTableSelChange();
  };

  const selectRange = (a, b) => {
    clearSelection(true);
    const ra = cellRect(S.table, a), rb = cellRect(S.table, b);
    const r0 = Math.min(ra.r, rb.r), r1 = Math.max(ra.r, rb.r);
    const c0 = Math.min(ra.c, rb.c), c1 = Math.max(ra.c, rb.c);
    const state = read(S.table);
    const ids = new Set();
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) ids.add(state.M[r][c]);
    // map ids back to rendered tds
    S.table.querySelectorAll('td.cs-cell').forEach((td) => {
      const rc = cellRect(S.table, td);
      if (ids.has(state.M[rc.r][rc.c])) { td.classList.add('cs-cell--selected'); S.selected.add(td); }
    });
    updateOverlay();
    onTableSelChange();
  };

  // Single Canva-style rectangle drawn over the union of the selected cells
  // (a body-level fixed box so it isn't clipped and needs no block positioning).
  const updateOverlay = () => {
    if (!S) return;
    if (!S.overlay) { S.overlay = document.createElement('div'); S.overlay.className = 'cs-tbl-selrect'; S.overlay.setAttribute('data-cs-chrome', ''); document.body.appendChild(S.overlay); }
    if (!S.selected.size) { S.overlay.style.display = 'none'; return; }
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    S.selected.forEach((td) => { const q = td.getBoundingClientRect(); l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); });
    S.overlay.style.display = 'block';
    S.overlay.style.left = `${l}px`;
    S.overlay.style.top = `${t}px`;
    S.overlay.style.width = `${r - l}px`;
    S.overlay.style.height = `${b - t}px`;
  };

  /* ------------------------------- toolbar --------------------------------- */

  // Self-explanatory inline-SVG icons so each table tool reads at a glance:
  // a green band + "＋" means INSERT a row/column on that side, a red band + "✕"
  // means DELETE, etc. Tooltips (title=) still spell every button out.
  const svg = (inner, vb = '0 0 18 18') =>
    `<svg width="15" height="15" viewBox="${vb}" fill="none" aria-hidden="true">${inner}</svg>`;
  const PLUS = (cx, cy) =>
    `<path d="M${cx} ${cy - 1.15}V${cy + 1.15}M${cx - 1.15} ${cy}H${cx + 1.15}" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>`;
  const CROSS = (cx, cy) =>
    `<path d="M${cx - 1.1} ${cy - 1.1}L${cx + 1.1} ${cy + 1.1}M${cx + 1.1} ${cy - 1.1}L${cx - 1.1} ${cy + 1.1}" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>`;

  const ICON = {
    // existing table outlined in the current colour + a green "new" band w/ ＋
    rowAbove: svg(`<rect x="2.5" y="8" width="13" height="7.5" rx="1.2" stroke="currentColor" stroke-width="1.3"/><line x1="9" y1="8" x2="9" y2="15.5" stroke="currentColor" stroke-width="1"/><rect x="2.5" y="2" width="13" height="4.4" rx="1.2" fill="#34c759"/>${PLUS(9, 4.2)}`),
    rowBelow: svg(`<rect x="2.5" y="2.5" width="13" height="7.5" rx="1.2" stroke="currentColor" stroke-width="1.3"/><line x1="9" y1="2.5" x2="9" y2="10" stroke="currentColor" stroke-width="1"/><rect x="2.5" y="11.6" width="13" height="4.4" rx="1.2" fill="#34c759"/>${PLUS(9, 13.8)}`),
    colLeft: svg(`<rect x="8" y="2.5" width="7.5" height="13" rx="1.2" stroke="currentColor" stroke-width="1.3"/><line x1="8" y1="9" x2="15.5" y2="9" stroke="currentColor" stroke-width="1"/><rect x="2" y="2.5" width="4.4" height="13" rx="1.2" fill="#34c759"/>${PLUS(4.2, 9)}`),
    colRight: svg(`<rect x="2.5" y="2.5" width="7.5" height="13" rx="1.2" stroke="currentColor" stroke-width="1.3"/><line x1="2.5" y1="9" x2="10" y2="9" stroke="currentColor" stroke-width="1"/><rect x="11.6" y="2.5" width="4.4" height="13" rx="1.2" fill="#34c759"/>${PLUS(13.8, 9)}`),
    // full table + the doomed row/column tinted red w/ ✕
    delRow: svg(`<rect x="2.5" y="2.5" width="13" height="13" rx="1.2" stroke="currentColor" stroke-width="1.3"/><line x1="2.5" y1="7.2" x2="15.5" y2="7.2" stroke="currentColor" stroke-width="1"/><line x1="2.5" y1="10.8" x2="15.5" y2="10.8" stroke="currentColor" stroke-width="1"/><rect x="3" y="7.4" width="12" height="3.2" fill="#ff5a5a"/>${CROSS(9, 9)}`),
    delCol: svg(`<rect x="2.5" y="2.5" width="13" height="13" rx="1.2" stroke="currentColor" stroke-width="1.3"/><line x1="7.2" y1="2.5" x2="7.2" y2="15.5" stroke="currentColor" stroke-width="1"/><line x1="10.8" y1="2.5" x2="10.8" y2="15.5" stroke="currentColor" stroke-width="1"/><rect x="7.4" y="3" width="3.2" height="12" fill="#ff5a5a"/>${CROSS(9, 9)}`),
    // two cells → one (arrows in) / one cell → two (arrows out)
    merge: svg(`<rect x="2.5" y="4.5" width="13" height="9" rx="1.2" stroke="currentColor" stroke-width="1.3"/><line x1="9" y1="4.5" x2="9" y2="13.5" stroke="currentColor" stroke-width="1" stroke-dasharray="1.6 1.6"/><path d="M5.4 7.6 L7.8 9 L5.4 10.4 Z" fill="currentColor"/><path d="M12.6 7.6 L10.2 9 L12.6 10.4 Z" fill="currentColor"/>`),
    split: svg(`<rect x="2.5" y="4.5" width="13" height="9" rx="1.2" stroke="currentColor" stroke-width="1.3"/><line x1="9" y1="4.5" x2="9" y2="13.5" stroke="currentColor" stroke-width="1.3"/><path d="M7.4 7.6 L5 9 L7.4 10.4 Z" fill="currentColor"/><path d="M10.6 7.6 L13 9 L10.6 10.4 Z" fill="currentColor"/>`),
    // table with a filled top row = header
    header: svg(`<rect x="2.5" y="2.5" width="13" height="13" rx="1.2" stroke="currentColor" stroke-width="1.3"/><rect x="3" y="3" width="12" height="3.4" fill="currentColor"/><line x1="9" y1="6.4" x2="9" y2="15.5" stroke="currentColor" stroke-width="1"/><line x1="2.5" y1="11" x2="15.5" y2="11" stroke="currentColor" stroke-width="1"/>`),
    // filled square = fill, outline square = border, dashed+slash = no border
    fill: svg(`<rect x="2.7" y="2.7" width="12.6" height="12.6" rx="1.6" fill="currentColor" opacity="0.55"/><rect x="2.7" y="2.7" width="12.6" height="12.6" rx="1.6" stroke="currentColor" stroke-width="1.2"/>`),
    border: svg(`<rect x="2.7" y="2.7" width="12.6" height="12.6" rx="1.4" stroke="currentColor" stroke-width="1.8"/>`),
    borderOff: svg(`<rect x="2.7" y="2.7" width="12.6" height="12.6" rx="1.4" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2.2 1.8"/><line x1="3.5" y1="14.5" x2="14.5" y2="3.5" stroke="#ff5a5a" stroke-width="1.4" stroke-linecap="round"/>`),
  };

  // The table-ONLY controls. Appended to the END of the shared text toolbar so a
  // table shows "[every text-block option] + [these]", while a plain text block
  // shows just the text options. Insert/delete row-col · merge/split/header ·
  // cell border. (Cell fill = the shared "highlight" colour; text colour = the
  // shared "A".) Same green-band-＋ / red-band-✕ icons as before.
  const tableGroupHTML = () => `
    <div class="cre-group">
      <button type="button" data-op="row-above" title="Insert row above">${ICON.rowAbove}</button>
      <button type="button" data-op="row-below" title="Insert row below">${ICON.rowBelow}</button>
      <button type="button" data-op="col-left" title="Insert column left">${ICON.colLeft}</button>
      <button type="button" data-op="col-right" title="Insert column right">${ICON.colRight}</button>
      <button type="button" data-op="del-row" title="Delete row">${ICON.delRow}</button>
      <button type="button" data-op="del-col" title="Delete column">${ICON.delCol}</button>
    </div>
    <div class="cre-group">
      <button type="button" data-op="merge" title="Merge selected cells">${ICON.merge}</button>
      <button type="button" data-op="split" title="Split cell">${ICON.split}</button>
      <button type="button" data-op="header" title="Toggle header row">${ICON.header}</button>
      <label class="cre-color" title="Cell border colour">${ICON.border}<input type="color" data-border value="#d0d5e2"></label>
      <button type="button" data-op="border-off" title="Remove cell border">${ICON.borderOff}</button>
    </div>`;

  // Heading at cell level = size + bold; "Normal" clears both back to default.
  const HEADING_PX = { h1: '32px', h2: '24px', h3: '19px', h4: '16px', h5: '13px', h6: '11px' };
  const applyCellHeading = (level) => eachSelected((td) => {
    if (HEADING_PX[level]) { td.style.fontSize = HEADING_PX[level]; td.style.fontWeight = '700'; }
    else { td.style.fontSize = ''; td.style.fontWeight = ''; }
  });

  // Text case via CSS text-transform (non-destructive).
  const applyCellCase = (value) => { if (value) setCellStyle('textTransform', value); };

  const buildToolbar = () => {
    const tb = document.createElement('div');
    // Same class as the text-block bar → identical look + placement + docked
    // behaviour. The extra `cre-toolbar--table` marker lets the click-away guard
    // recognise our bar. Toolbar starts hidden; shown only on text/cell selection.
    tb.className = 'cre-toolbar cre-toolbar--table';
    tb.setAttribute('data-cs-chrome', '');
    const richHTML = (window.CustomRichEditor && window.CustomRichEditor.toolbarInnerHTML)
      ? window.CustomRichEditor.toolbarInnerHTML(window.FROALA_FONTS || null, null)
      : '';
    tb.innerHTML = richHTML + tableGroupHTML();

    // Keep cell focus/selection when pressing a control (selects + colour inputs
    // need focus to open, so don't preventDefault those).
    tb.addEventListener('mousedown', (e) => { if (!e.target.closest('input, select')) e.preventDefault(); });
    tb.addEventListener('click', onToolbarClick);
    tb.addEventListener('change', onToolbarChange);
    tb.addEventListener('input', onToolbarInput);
    document.body.appendChild(tb);
    return tb;
  };

  // Route the SHARED text toolbar's controls to the table's cell operations, so
  // the same bar drives both. (data-cmd/-act/-sel/-color come from the rich
  // markup; data-op/-border are our appended table group.)
  const ALIGN_CMD = { justifyLeft: 'left', justifyCenter: 'center', justifyRight: 'right', justifyFull: 'justify' };
  const _withTbInteract = (fn) => (...args) => { if (S) S._toolbarInteracting = true; fn(...args); setTimeout(() => { if (S) S._toolbarInteracting = false; }, 100); };
  const onToolbarClick = _withTbInteract((e) => {
    const opBtn = e.target.closest('[data-op]');
    if (opBtn) { e.preventDefault(); return runOp(opBtn.dataset.op); }
    const actBtn = e.target.closest('[data-act]');
    if (actBtn) {
      e.preventDefault();
      if (actBtn.dataset.act === 'link') { const u = window.prompt('Link URL:', 'https://'); if (u) textCmd('createLink', u); }
      return;
    }
    const cmdBtn = e.target.closest('[data-cmd]');
    if (cmdBtn) {
      e.preventDefault();
      const cmd = cmdBtn.dataset.cmd;
      if (ALIGN_CMD[cmd]) return setCellStyle('textAlign', ALIGN_CMD[cmd]);
      return textCmd(cmd);
    }
  });
  const onToolbarChange = _withTbInteract((e) => {
    const sel = e.target.closest('[data-sel]');
    if (!sel) return;
    const v = sel.value;
    switch (sel.dataset.sel) {
      case 'format': return applyCellHeading(v);
      case 'font': return v && setCellStyle('fontFamily', v);
      case 'size': return v && setCellStyle('fontSize', /px|em|rem|%/.test(v) ? v : v + 'px');
      case 'lineheight': return v && setCellStyle('lineHeight', v);
      case 'letterspacing': return v && setCellStyle('letterSpacing', v);
      case 'textcase': return v && applyCellCase(v);
    }
  });
  const onToolbarInput = _withTbInteract((e) => {
    const t = e.target;
    if (t.matches('[data-color="fore"]')) return setCellStyle('color', t.value);
    if (t.matches('[data-color="back"]')) return setCellStyle('backgroundColor', t.value); // highlight → cell fill
    if (t.matches('[data-border]')) return setBorder(t.value, true);
  });

  const runOp = (op) => {
    switch (op) {
      case 'row-above': return insertRow('above');
      case 'row-below': return insertRow('below');
      case 'col-left': return insertCol('left');
      case 'col-right': return insertCol('right');
      case 'del-row': return deleteRow();
      case 'del-col': return deleteCol();
      case 'merge': return mergeCells();
      case 'split': return splitCell();
      case 'header': return toggleHeader();
      case 'border-off': return setBorder(null, false);
      case 'link': {
        const url = window.prompt('Link URL:', 'https://');
        if (url) textCmd('createLink', url);
        return;
      }
      case 'rows-equal': return rowsEqual();
      case 'cols-equal': return colsEqual();
      case 'rows-content': return rowsContent();
      case 'cols-content': return colsContent();
      case 'mv-row-up': return moveRow('up');
      case 'mv-row-down': return moveRow('down');
      case 'mv-col-left': return moveCol('left');
      case 'mv-col-right': return moveCol('right');
      case 'del-table': { const b = S.block; deactivate(); try { window.EditorManager?.clearAll?.(); } catch (e) { /* */ } b.remove(); return; }
    }
  };

  // Make every row the same height (= the current tallest row).
  const rowsEqual = () => {
    const rows = Array.from(S.table.tBodies[0].rows);
    let max = 0;
    rows.forEach((tr) => { max = Math.max(max, tr.getBoundingClientRect().height); });
    rows.forEach((tr) => { tr.style.height = `${Math.round(max)}px`; });
    emitChange();
  };

  // Make every column an equal share of the table width.
  const colsEqual = () => {
    const cols = Array.from(S.table.querySelectorAll('colgroup > col'));
    const w = `${(100 / cols.length).toFixed(4)}%`;
    cols.forEach((c) => { c.style.width = w; });
    emitChange();
  };

  // Let every row shrink to its content height.
  const rowsContent = () => {
    Array.from(S.table.tBodies[0].rows).forEach((tr) => { tr.style.height = ''; });
    emitChange();
  };

  // Fit every column to its widest cell (measured under auto layout — fixed
  // layout would just report the set width).
  const colsContent = () => {
    const cols = Array.from(S.table.querySelectorAll('colgroup > col'));
    const prevLayout = S.table.style.tableLayout;
    S.table.style.tableLayout = 'auto';
    cols.forEach((c) => { c.style.width = ''; });
    const widths = cols.map((_, ci) => {
      let m = 24;
      Array.from(S.table.tBodies[0].rows).forEach((tr) => Array.from(tr.cells).forEach((cell) => {
        if ((cell.colSpan || 1) === 1 && cellRect(S.table, cell).c === ci) m = Math.max(m, cell.getBoundingClientRect().width);
      }));
      return m;
    });
    S.table.style.tableLayout = prevLayout || '';
    const tableW = S.table.getBoundingClientRect().width || 1;
    cols.forEach((c, ci) => { c.style.width = `${(Math.ceil(widths[ci] + 8) / tableW * 100).toFixed(2)}%`; });
    emitChange();
  };

  // Move the active row up/down (swaps adjacent matrix rows).
  const moveRow = (dir) => apply((st) => {
    const { r } = activeCoord();
    const to = r + (dir === 'down' ? 1 : -1);
    if (to < 0 || to >= st.rows) return;
    const tmp = st.M[r]; st.M[r] = st.M[to]; st.M[to] = tmp;
  });

  // Move the active column left/right (swaps adjacent matrix columns + widths).
  const moveCol = (dir) => apply((st, widths) => {
    const { c } = activeCoord();
    const to = c + (dir === 'right' ? 1 : -1);
    if (to < 0 || to >= st.cols) return;
    st.M.forEach((row) => { const t = row[c]; row[c] = row[to]; row[to] = t; });
    const nw = widths.slice(); const t = nw[c]; nw[c] = nw[to]; nw[to] = t;
    return { widths: nw };
  });

  /* --------------------------- right-click menu ---------------------------- */

  let cmenu = null;
  // Built fresh each open so Merge/Split only appear when they apply.
  const menuItems = () => {
    const items = [
      { op: 'row-above', label: '＋  Add row above' },
      { op: 'row-below', label: '＋  Add row below' },
      { op: 'col-left', label: '＋  Add column left' },
      { op: 'col-right', label: '＋  Add column right' },
      { sep: true },
    ];
    if (canMerge()) items.push({ op: 'merge', label: '⊞  Merge cells' }, { sep: true });
    if (canSplit()) items.push({ op: 'split', label: '⤲  Unmerge cell' }, { sep: true });
    items.push(
      { op: 'rows-equal', label: '▤  Size rows equally' },
      { op: 'cols-equal', label: '▥  Size columns equally' },
      { op: 'rows-content', label: '↕  Size rows to content' },
      { op: 'cols-content', label: '↔  Size columns to content' },
      { sep: true },
    );

    // Move items appear only in the directions the active cell can actually
    // move (no "up" on the first row, no "left" on the first column, etc.).
    const pos = (() => {
      if (!S.activeCell || !S.table.contains(S.activeCell)) return null;
      const rc = cellRect(S.table, S.activeCell);
      const d = read(S.table);
      return { r: rc.r, c: rc.c, rows: d.rows, cols: d.cols };
    })();
    if (pos) {
      const mv = [];
      if (pos.r > 0) mv.push({ op: 'mv-row-up', label: '↑  Move row up' });
      if (pos.r < pos.rows - 1) mv.push({ op: 'mv-row-down', label: '↓  Move row down' });
      if (pos.c > 0) mv.push({ op: 'mv-col-left', label: '←  Move column left' });
      if (pos.c < pos.cols - 1) mv.push({ op: 'mv-col-right', label: '→  Move column right' });
      if (mv.length) items.push(...mv, { sep: true });
    }

    items.push(
      { op: 'del-row', label: '🗑  Delete row', danger: true },
      { op: 'del-col', label: '🗑  Delete column', danger: true },
      { op: 'del-table', label: '🗑  Delete table', danger: true },
    );
    return items;
  };

  const clearPreview = () => {
    if (!S) return;
    S.table.querySelectorAll('.cs-cell--danger').forEach((td) => td.classList.remove('cs-cell--danger'));
  };

  // Mark every rendered cell whose matrix area satisfies `pred(r,c)` red.
  const markCells = (pred) => {
    if (!S) return;
    const state = read(S.table);
    S.table.querySelectorAll('td.cs-cell').forEach((td) => {
      const rc = cellRect(S.table, td);
      const id = state.M[rc.r][rc.c];
      let hit = false;
      for (let r = 0; r < state.rows && !hit; r++) for (let c = 0; c < state.cols; c++) { if (state.M[r][c] === id && pred(r, c)) { hit = true; break; } }
      if (hit) td.classList.add('cs-cell--danger');
    });
  };

  // Hover-preview of what a delete item will remove (Canva-style red highlight).
  const previewOp = (op) => {
    clearPreview();
    if (!S) return;
    if (op === 'del-table') { S.table.querySelectorAll('td.cs-cell').forEach((td) => td.classList.add('cs-cell--danger')); return; }
    if (op === 'del-row') { const { r } = activeCoord(); markCells((rr) => rr === r); return; }
    if (op === 'del-col') { const { c } = activeCoord(); markCells((rr, cc) => cc === c); return; }
  };

  const hideContextMenu = () => {
    clearPreview();
    if (cmenu) { cmenu.remove(); cmenu = null; }
  };

  const showContextMenu = (x, y) => {
    hideContextMenu();
    const m = document.createElement('div');
    m.className = 'cs-tbl-menu';
    m.setAttribute('data-cs-chrome', '');
    menuItems().forEach((it) => {
      if (it.sep) { const s = document.createElement('div'); s.className = 'cs-tbl-menu__sep'; m.appendChild(s); return; }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cs-tbl-menu__item' + (it.danger ? ' cs-tbl-menu__item--danger' : '');
      b.dataset.op = it.op;
      b.textContent = it.label;
      if (/^del-/.test(it.op)) {
        b.addEventListener('mouseenter', () => previewOp(it.op));
        b.addEventListener('mouseleave', clearPreview);
      }
      m.appendChild(b);
    });
    m.addEventListener('mousedown', (e) => e.preventDefault());
    m.addEventListener('click', (e) => {
      const op = e.target.closest('[data-op]')?.dataset.op;
      if (op) { clearPreview(); runOp(op); hideContextMenu(); }
    });
    document.body.appendChild(m);
    const mw = m.offsetWidth, mh = m.offsetHeight;
    let left = x, top = y;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    if (top + mh > window.innerHeight - 8) top = window.innerHeight - mh - 8;
    m.style.left = `${Math.max(8, left)}px`;
    m.style.top = `${Math.max(8, top)}px`;
    cmenu = m;
  };

  const positionToolbar = () => {
    if (!S || !S.toolbar) return;
    const tb = S.toolbar;
    // Docked mode (Page Settings → "Inline text toolbar" OFF): pin the table
    // bar to the top of the canvas, full-width — the same place the rich-text
    // bar docks — so a single bar shows instead of the placeholder + a floating
    // one. CSS owns the placement; clear any leftover inline coords.
    const docked = (typeof window.isRichToolbarDocked === 'function') ? window.isRichToolbarDocked() : false;
    tb.classList.toggle('cre-toolbar--docked', docked);
    if (docked) {
      // Follow the host scroll (the iframe grows + host scrolls, so a fixed bar
      // would scroll off-screen). Same tracker the text bar uses.
      tb.style.left = '';
      window.CustomRichEditor?.trackDockedBar?.(tb);
      return;
    }
    window.CustomRichEditor?.untrackDockedBar?.(tb);

    const rect = S.block.getBoundingClientRect();
    const tw = tb.offsetWidth, th = tb.offsetHeight;
    let top = rect.top - th - 8;
    if (top < 8) top = rect.bottom + 8;
    let left = rect.left;
    if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
    if (left < 8) left = 8;
    tb.style.top = `${top}px`;
    tb.style.left = `${left}px`;
  };

  const showToolbar = () => {
    if (!S || !S.toolbar) return;
    S.toolbar.classList.add('is-visible');
    positionToolbar();
  };

  const hideToolbar = () => {
    if (!S || !S.toolbar) return;
    S.toolbar.classList.remove('is-visible');
  };

  // Show toolbar when text is selected inside a cell OR when multiple cells are selected.
  const onTableSelChange = () => {
    if (!S) return;
    const sel = window.getSelection();
    const hasTextSel = sel && !sel.isCollapsed && S.table.contains(sel.anchorNode);
    const hasMultiCell = S.selected && S.selected.size > 0;
    if (hasTextSel || hasMultiCell) {
      showToolbar();
    } else if (!S._toolbarInteracting) {
      const docked = (typeof window.isRichToolbarDocked === 'function') ? window.isRichToolbarDocked() : false;
      if (!docked) hideToolbar();
    }
  };

  /* ------------------------------ cell wiring ------------------------------ */

  const wireCells = () => {
    if (!S) return;
    S.table.querySelectorAll('td.cs-cell').forEach((td) => {
      td.setAttribute('contenteditable', 'true');
    });
  };

  const unwireCells = (table) => {
    table.querySelectorAll('td.cs-cell').forEach((td) => {
      td.removeAttribute('contenteditable');
      td.classList.remove('cs-cell--selected');
    });
  };

  const emitChange = () => {
    try { S.block.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { /* */ }
  };

  // Put the caret at the end of a cell (used by Tab navigation).
  const focusCell = (td) => {
    if (!td) return;
    td.focus();
    const range = document.createRange();
    range.selectNodeContents(td); range.collapse(false);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    clearSelection();
    S.activeCell = td; S.anchorCell = td;
  };

  // Tab / Shift+Tab move between cells (Tab on the last cell adds a row).
  const onTableKey = (e) => {
    if (e.key !== 'Tab') return;
    const td = e.target.closest && e.target.closest('td.cs-cell');
    if (!td) return;
    e.preventDefault();
    const all = Array.from(S.table.querySelectorAll('td.cs-cell'));
    const i = all.indexOf(td);
    if (e.shiftKey) { if (i > 0) focusCell(all[i - 1]); return; }
    if (i < all.length - 1) { focusCell(all[i + 1]); return; }
    // Last cell → grow the table, then land in the new row's first cell.
    S.activeCell = td;
    insertRow('below');
    const d = read(S.table);
    focusCell(tdAt(d.rows - 1, 0));
  };

  // Paste as PLAIN TEXT so cells don't inherit messy external markup.
  const onPaste = (e) => {
    const td = e.target.closest && e.target.closest('td.cs-cell');
    if (!td) return;
    e.preventDefault();
    const text = ((e.clipboardData || window.clipboardData)?.getData('text/plain') || '').replace(/\r/g, '');
    try { document.execCommand('insertText', false, text); } catch (err) { /* */ }
  };

  /* ------------------------------ activate --------------------------------- */

  const onTablePointerDown = (e) => {
    if (!S) return;
    // Right-click is handled by the contextmenu listener — DON'T touch the
    // selection here (otherwise the multi-cell pick is wiped before the menu).
    if (e.button === 2) return;
    hideContextMenu();
    const td = e.target.closest('td.cs-cell');
    if (!td) return;
    // Column / row resize when grabbing a cell edge.
    const edge = edgeAt(td, e);
    if (edge) { startResize(edge, td, e); return; }

    // Ctrl/Cmd-click → toggle this cell in the multi-selection (no caret).
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      const sel = window.getSelection(); if (sel) sel.removeAllRanges();
      if (S.selected.has(td)) { S.selected.delete(td); td.classList.remove('cs-cell--selected'); }
      else { S.selected.add(td); td.classList.add('cs-cell--selected'); }
      S.activeCell = td; S.anchorCell = td;
      updateOverlay();
      onTableSelChange();
      return;
    }
    // Shift-click → rectangular range from the anchor cell.
    if (e.shiftKey && S.anchorCell) {
      e.preventDefault();
      const sel = window.getSelection(); if (sel) sel.removeAllRanges();
      selectRange(S.anchorCell, td);
      S.activeCell = td;
      return;
    }
    // Plain press → caret for typing; clear any multi-selection; arm drag-select.
    clearSelection();
    S.activeCell = td;
    S.anchorCell = td;
    S.dragStart = td;
  };

  const onTablePointerMove = (e) => {
    if (!S || !S.dragStart) return;
    const td = e.target.closest('td.cs-cell');
    if (!td || td === S.dragStart) {
      if (td === S.dragStart && S.selected.size) { /* keep */ }
      return;
    }
    // Dragged onto a different cell → range-select (and stop caret text-select).
    e.preventDefault();
    const sel = window.getSelection(); if (sel) sel.removeAllRanges();
    selectRange(S.dragStart, td);
  };

  const onTablePointerUp = () => { if (S) S.dragStart = null; };

  // Detect if the pointer is near a cell's right (col) or bottom (row) edge.
  const edgeAt = (td, e) => {
    const r = td.getBoundingClientRect();
    if (Math.abs(e.clientX - r.right) <= 5) return 'col';
    if (Math.abs(e.clientY - r.bottom) <= 5) return 'row';
    return null;
  };

  const startResize = (kind, td, e) => {
    e.preventDefault();
    const rc = cellRect(S.table, td);
    const startX = e.clientX, startY = e.clientY;
    if (kind === 'col') {
      const cols = Array.from(S.table.querySelectorAll('colgroup > col'));
      // The boundary being dragged sits at the RIGHT of the cell's last spanned
      // column. Widen that column and shrink the NEXT one by the same amount so
      // the table's total width stays fixed (Canva-style boundary drag).
      const i = rc.c + ((td.colSpan || 1) - 1);
      const tableW = S.table.getBoundingClientRect().width || 1;
      const startWi = cols[i] ? cols[i].getBoundingClientRect().width : 80;
      const hasNext = i + 1 < cols.length;
      const startWn = hasNext ? cols[i + 1].getBoundingClientRect().width : 0;
      const MINW = 24;
      const move = (ev) => {
        let d = ev.clientX - startX;
        if (hasNext) {
          d = Math.max(-(startWi - MINW), Math.min(d, startWn - MINW));
          cols[i].style.width = `${((startWi + d) / tableW * 100).toFixed(3)}%`;
          cols[i + 1].style.width = `${((startWn - d) / tableW * 100).toFixed(3)}%`;
        } else if (cols[i]) {
          cols[i].style.width = `${(Math.max(MINW, startWi + d) / tableW * 100).toFixed(3)}%`;
        }
      };
      const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); emitChange(); };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    } else {
      const tr = td.parentElement;
      const startH = tr.getBoundingClientRect().height;
      const move = (ev) => { tr.style.height = `${Math.max(18, startH + (ev.clientY - startY))}px`; };
      const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); emitChange(); };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    }
  };

  const onCursorHint = (e) => {
    const td = e.target.closest && e.target.closest('td.cs-cell');
    if (!td) return;
    const edge = edgeAt(td, e);
    td.style.cursor = edge === 'col' ? 'col-resize' : edge === 'row' ? 'row-resize' : 'text';
  };

  // Engine switch: in legacy Froala mode the custom table engine stays off
  // (the static Table block is a new-mode-only feature). See canvas-config.js.
  const froalaMode = () => (typeof window.isFroalaEditor === 'function') && window.isFroalaEditor();

  const activate = (block) => {
    if (froalaMode()) return;
    if (S && S.block === block) return;
    if (S) deactivate();
    const table = block.querySelector('table.cs-table');
    if (!table) return;
    S = { block, table, selected: new Set(), activeCell: null, anchorCell: null, dragStart: null };
    S.toolbar = buildToolbar();
    wireCells();

    S._pd = onTablePointerDown; S._pm = onTablePointerMove; S._pu = onTablePointerUp; S._mm = onCursorHint;
    table.addEventListener('pointerdown', S._pd);
    table.addEventListener('pointermove', S._pm);
    document.addEventListener('pointerup', S._pu);
    table.addEventListener('mousemove', S._mm);
    table.addEventListener('keydown', onTableKey);
    table.addEventListener('paste', onPaste);

    // Deselect when the user presses outside the table (and not on our toolbar
    // / context menu), or hits Escape. Belt-and-suspenders over inline-editor.
    S._down = (e) => {
      if (!S) return;
      const t = e.target;
      if (t.closest && (t.closest('.cre-toolbar') || t.closest('.cs-tbl-menu'))) return;
      if (t.closest && t.closest('.cs_block_s') === block) return;
      hideContextMenu();
      try { window.EditorManager?.clearAll?.(); } catch (err) { /* */ }
      deactivate();
    };
    S._key = (e) => {
      if (e.key !== 'Escape') return;
      hideContextMenu();
      // First Escape clears a multi-cell selection; second exits the table.
      if (S.selected.size) { clearSelection(); return; }
      try { window.EditorManager?.clearAll?.(); } catch (err) { /* */ }
      deactivate();
    };
    document.addEventListener('pointerdown', S._down, true);
    document.addEventListener('keydown', S._key, true);

    S._reflow = () => { if (S.toolbar && S.toolbar.classList.contains('is-visible')) positionToolbar(); updateOverlay(); };
    window.addEventListener('scroll', S._reflow, true);
    window.addEventListener('resize', S._reflow);

    // Single bar at the top in docked mode: hide the rich-text placeholder while
    // our bar is up, and re-place ours if docked mode is toggled mid-edit.
    window.CustomRichEditor?.setExternalDockedActive?.(true);
    S._mode = () => { if (S.toolbar && S.toolbar.classList.contains('is-visible')) positionToolbar(); };
    document.addEventListener('canvas:rich-toolbar-mode', S._mode);

    // Show toolbar only on text selection inside a cell.
    S._selChange = () => onTableSelChange();
    document.addEventListener('selectionchange', S._selChange);
  };

  const deactivate = () => {
    if (!S) return;
    const { table, toolbar } = S;
    table.removeEventListener('pointerdown', S._pd);
    table.removeEventListener('pointermove', S._pm);
    document.removeEventListener('pointerup', S._pu);
    table.removeEventListener('mousemove', S._mm);
    table.removeEventListener('keydown', onTableKey);
    table.removeEventListener('paste', onPaste);
    window.removeEventListener('scroll', S._reflow, true);
    window.removeEventListener('resize', S._reflow);
    if (S._mode) document.removeEventListener('canvas:rich-toolbar-mode', S._mode);
    if (S._selChange) document.removeEventListener('selectionchange', S._selChange);
    if (toolbar) window.CustomRichEditor?.untrackDockedBar?.(toolbar);
    window.CustomRichEditor?.setExternalDockedActive?.(false);
    document.removeEventListener('pointerdown', S._down, true);
    document.removeEventListener('keydown', S._key, true);
    hideContextMenu();
    unwireCells(table);
    if (toolbar) toolbar.remove();
    if (S.overlay) S.overlay.remove();
    S = null;
  };

  /* --------------------------------- init ---------------------------------- */

  const init = () => {
    const surface = document.querySelector('.custom-form-design') || document.body;
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.attributeName !== 'class') continue;
        const el = m.target;
        if (!el.classList || el.dataset.blockType !== 'table') continue;
        if (el.classList.contains('cs-editing')) activate(el);
        else if (S && S.block === el) deactivate();
      }
    });
    obs.observe(surface, { attributes: true, attributeFilter: ['class'], subtree: true });

    // Right-click anywhere on a table block → our context menu (table only).
    document.addEventListener('contextmenu', (e) => {
      if (froalaMode()) return;
      const block = e.target.closest && e.target.closest('.cs_block_s[data-block-type="table"]');
      if (!block) { hideContextMenu(); return; }
      e.preventDefault();
      if (!S || S.block !== block) {
        try { window.EditorManager?.select?.(block); } catch (err) { /* */ }
        activate(block);
      }
      const td = e.target.closest('td.cs-cell');
      if (td) S.activeCell = td;
      showContextMenu(e.clientX, e.clientY);
    });
  };

  Object.assign(window.TableBlock, { createBlock, activate, deactivate, normalizeCells });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
