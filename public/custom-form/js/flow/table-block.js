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

  // Table Repeater block — same structure as static Table but with
  // data-block-type="table-repeater" so the data-binding panel still works.
  const createRepeaterBlock = (rows = 4, cols = 4) => {
    const block = document.createElement('div');
    block.className = 'cs_block_s cs-table-block';
    block.setAttribute('data', 'Table');
    block.setAttribute('custom-name', 'Table Repeater');
    block.dataset.blockType = 'table-repeater';
    block.id = `block_${hash()}`;

    const table = buildTableEl(rows, cols);
    // Mark header row cells
    const firstRow = table.querySelector('tbody tr');
    if (firstRow) Array.from(firstRow.cells).forEach((td) => td.classList.add('cs-cell--head'));

    block.appendChild(table);
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

  const duplicateRow = () => apply((st) => {
    const { r } = activeCoord();
    const srcRow = st.M[r].slice();
    const newRow = srcRow.map((id) => {
      const src = st.cells[id] || { html: '', style: '', head: false };
      const nid = (st._next || (st._next = Object.keys(st.cells).length + 1000)) + 1;
      st._next = nid;
      st.cells[nid] = { html: src.html, style: src.style, head: false };
      return nid;
    });
    st.M.splice(r + 1, 0, newRow);
    st.rows++;
  });

  const duplicateCol = () => apply((st, widths) => {
    const { c } = activeCoord();
    for (let r = 0; r < st.rows; r++) {
      const id = st.M[r][c];
      const src = st.cells[id] || { html: '', style: '', head: false };
      const nid = (st._next || (st._next = Object.keys(st.cells).length + 1000)) + 1;
      st._next = nid;
      st.cells[nid] = { html: src.html, style: src.style, head: src.head };
      st.M[r].splice(c + 1, 0, nid);
    }
    st.cols++;
    const nw = widths.slice();
    nw.splice(c + 1, 0, widths[c]);
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

  // Returns true when there is a non-collapsed text selection inside a cell.
  const hasTextSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    return S.table.contains(sel.anchorNode);
  };

  // Apply a style via execCommand (operates on the current text selection).
  const applyToSelection = (cmd, value) => {
    try { document.execCommand('styleWithCSS', false, true); } catch (e) { /* */ }
    try { document.execCommand(cmd, false, value); } catch (e) { /* */ }
    emitChange();
  };

  // Wrap the current text selection in a <span> with the given CSS property set.
  const wrapSelectionWithStyle = (prop, value) => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const span = document.createElement('span');
    span.style[prop] = value;
    try { range.surroundContents(span); } catch (e) {
      // surroundContents fails when the selection crosses element boundaries;
      // fall back to extractContents+insert.
      span.appendChild(range.extractContents());
      range.insertNode(span);
    }
    // Re-select the wrapped content.
    sel.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    sel.addRange(newRange);
    emitChange();
  };

  // Apply style to selection if text is selected, otherwise to the whole cell(s).
  const setCellStyleSmart = (prop, value) => {
    if (hasTextSelection()) {
      if (prop === 'color') { applyToSelection('foreColor', value); return; }
      // font-family and font-size need span wrapping (execCommand sizes are 1-7 only).
      wrapSelectionWithStyle(prop, value);
      return;
    }
    eachSelected((td) => { td.style[prop] = value; });
    emitChange();
  };

  const setCellStyle = (prop, value) => eachSelected((td) => { td.style[prop] = value; });
  const toggleHeader = () => eachSelected((td) => td.classList.toggle('cs-cell--head'));

  const setBorder = (color, on) => eachSelected((td) => {
    if (on === false) { td.style.border = 'none'; return; }
    td.style.border = `1px solid ${color || '#d0d5e2'}`;
  });

  // Map execCommand names to CSS property toggles for multi-cell apply.
  const CMD_STYLE = {
    bold:          (td) => { const on = td.style.fontWeight === '700' || td.style.fontWeight === 'bold'; td.style.fontWeight = on ? '' : '700'; },
    italic:        (td) => { const on = td.style.fontStyle === 'italic'; td.style.fontStyle = on ? '' : 'italic'; },
    underline:     (td) => { const cur = td.style.textDecoration || ''; const on = /underline/.test(cur); td.style.textDecoration = on ? cur.replace('underline', '').trim() : (cur ? cur + ' underline' : 'underline'); },
    strikeThrough: (td) => { const cur = td.style.textDecoration || ''; const on = /line-through/.test(cur); td.style.textDecoration = on ? cur.replace('line-through', '').trim() : (cur ? cur + ' line-through' : 'line-through'); },
  };

  // Text format inside the focused cell via execCommand.
  // When multiple cells are selected, apply CSS directly to all of them.
  const textCmd = (cmd, val) => {
    const multiCells = S.selected.size > 1 ? Array.from(S.selected) : null;
    if (multiCells && CMD_STYLE[cmd]) {
      multiCells.forEach(CMD_STYLE[cmd]);
      emitChange();
      return;
    }
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
  const applyCellHeading = (level) => {
    if (hasTextSelection()) {
      if (HEADING_PX[level]) {
        // Wrap in a span with both font-size and font-weight set together.
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          const range = sel.getRangeAt(0);
          const span = document.createElement('span');
          span.style.fontSize = HEADING_PX[level];
          span.style.fontWeight = '700';
          try { range.surroundContents(span); } catch (e) {
            span.appendChild(range.extractContents()); range.insertNode(span);
          }
          sel.removeAllRanges();
          const nr = document.createRange(); nr.selectNodeContents(span); sel.addRange(nr);
          emitChange();
        }
      } else {
        // "Normal" — strip inline size+bold from the selection.
        try { document.execCommand('styleWithCSS', false, true); } catch (e) { /* */ }
        try { document.execCommand('removeFormat', false, null); } catch (e) { /* */ }
        emitChange();
      }
      return;
    }
    eachSelected((td) => {
      if (HEADING_PX[level]) { td.style.fontSize = HEADING_PX[level]; td.style.fontWeight = '700'; }
      else { td.style.fontSize = ''; td.style.fontWeight = ''; }
    });
  };

  // Text case via CSS text-transform (non-destructive).
  const applyCellCase = (value) => { if (value) setCellStyle('textTransform', value); };

  // Reflect the active cell's styles in the toolbar dropdowns so the user sees
  // the correct heading/font/size when they move between cells or select text.
  // When there is a text selection, read from the node at the selection anchor
  // (which may be a <span> inside the td) rather than the td itself.
  const syncToolbarToCell = (td) => {
    if (!S || !S.toolbar || !td) return;
    const tb = S.toolbar;

    // Resolve the element whose computed style we should read.
    // Prefer the node at the caret/selection anchor when it's inside this cell.
    let styleEl = td;
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const anchor = sel.anchorNode;
      if (anchor && td.contains(anchor)) {
        styleEl = (anchor.nodeType === 1 ? anchor : anchor.parentElement) || td;
      }
    }

    let cs = null;
    try { cs = window.getComputedStyle(styleEl); } catch (e) { /* */ }
    if (!cs) return;

    // Toggle-button active states (bold / italic / underline / strike /
    // sub / super). The shared text toolbar in CustomRichEditor does this via
    // _syncActiveStates(); the table bar reused that markup but never synced
    // these, so e.g. selecting bold table text left the B button un-highlighted
    // while the dropdowns updated. queryCommandState reflects the live
    // contenteditable selection inside the cell.
    const CMD_STATE = ['bold', 'italic', 'underline', 'strikeThrough', 'subscript', 'superscript'];
    CMD_STATE.forEach((cmd) => {
      const btn = tb.querySelector(`[data-cmd="${cmd}"]`);
      if (!btn) return;
      let on = false;
      try { on = document.queryCommandState(cmd); } catch (e) { /* */ }
      // Fallback for bold when applied as inline font-weight (headings/cells
      // set font-weight:700 rather than wrapping in <b>, which queryCommandState
      // misses): treat weight >= 600 as bold.
      if (cmd === 'bold' && !on) on = (parseInt(cs.fontWeight, 10) || 400) >= 600;
      btn.classList.toggle('is-active', on);
    });

    // Alignment buttons reflect the cell's computed text-align.
    const align = (cs.textAlign || 'left').replace('start', 'left').replace('end', 'right');
    const ALIGN_BTN = { justifyLeft: 'left', justifyCenter: 'center', justifyRight: 'right', justifyFull: 'justify' };
    Object.entries(ALIGN_BTN).forEach(([cmd, val]) => {
      const btn = tb.querySelector(`[data-cmd="${cmd}"]`);
      if (btn) btn.classList.toggle('is-active', align === val);
    });

    // Format (heading) dropdown — match by fontSize ALONE. Heading level and
    // bold are independent: a cell sized like H3 stays "H3" in the dropdown
    // even after the user removes bold (previously the detection required
    // bold, so un-bolding a heading wrongly flipped the dropdown to "Normal").
    const fmtSel = tb.querySelector('[data-sel="format"]');
    if (fmtSel) {
      const px = Math.round(parseFloat(cs.fontSize));
      let val = '';
      for (const [lvl, pxStr] of Object.entries(HEADING_PX)) {
        if (Math.round(parseFloat(pxStr)) === px) { val = lvl; break; }
      }
      fmtSel.value = val;
    }

    // Font family dropdown.
    const fontSel = tb.querySelector('[data-sel="font"]');
    if (fontSel) {
      const cur = cs.fontFamily.split(',')[0].trim().replace(/['"]/g, '').toLowerCase();
      let val = '';
      for (const opt of fontSel.options) {
        if (opt.value && opt.value.split(',')[0].trim().replace(/['"]/g, '').toLowerCase() === cur) { val = opt.value; break; }
      }
      fontSel.value = val;
    }

    // Font size dropdown.
    const sizeSel = tb.querySelector('[data-sel="size"]');
    if (sizeSel) {
      const px = Math.round(parseFloat(cs.fontSize));
      if (!isNaN(px)) {
        const val = String(px);
        if (!Array.from(sizeSel.options).some((o) => o.value === val)) {
          const opt = document.createElement('option');
          opt.value = val; opt.textContent = val; opt.dataset.dynamic = '1';
          sizeSel.appendChild(opt);
        }
        sizeSel.querySelectorAll('option[data-dynamic="1"]').forEach((o) => { if (o.value !== val) o.remove(); });
        sizeSel.value = val;
      } else {
        sizeSel.value = '';
      }
    }
  };

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

    // Remove buttons that don't apply to table cells (list/indent/link/undo/redo),
    // then prune any cre-group that became empty.
    const HIDE_CMDS = ['insertOrderedList', 'insertUnorderedList', 'outdent', 'indent', 'unlink', 'removeFormat', 'undo', 'redo'];
    HIDE_CMDS.forEach((cmd) => tb.querySelectorAll(`[data-cmd="${cmd}"]`).forEach((el) => el.remove()));
    tb.querySelectorAll('[data-act="link"]').forEach((el) => el.remove());
    tb.querySelectorAll('.cre-group').forEach((g) => { if (!g.children.length) g.remove(); });

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
      if (ALIGN_CMD[cmd]) setCellStyle('textAlign', ALIGN_CMD[cmd]);
      else textCmd(cmd);
      // Re-sync the toolbar immediately so the pressed button reflects its new
      // state right away. The selection doesn't change on a toggle, so the
      // selectionchange listener won't fire on its own — without this the B/I/U
      // highlight only updated after clicking away and back.
      if (S && S.activeCell) syncToolbarToCell(S.activeCell);
      return;
    }
  });
  const onToolbarChange = _withTbInteract((e) => {
    const sel = e.target.closest('[data-sel]');
    if (!sel) return;
    const v = sel.value;
    switch (sel.dataset.sel) {
      case 'format': return applyCellHeading(v);
      case 'font': return v && setCellStyleSmart('fontFamily', v);
      case 'size': return v && setCellStyleSmart('fontSize', /px|em|rem|%/.test(v) ? v : v + 'px');
      case 'lineheight': return v && setCellStyle('lineHeight', v);
      case 'letterspacing': return v && setCellStyle('letterSpacing', v);
      case 'textcase': return v && applyCellCase(v);
    }
  });
  const onToolbarInput = _withTbInteract((e) => {
    const t = e.target;
    if (t.matches('[data-color="fore"]')) return setCellStyleSmart('color', t.value);
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
      case 'dup-row': return duplicateRow();
      case 'dup-col': return duplicateCol();
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
      { op: 'dup-row', label: '⧉  Duplicate row', success: true },
      { op: 'dup-col', label: '⧉  Duplicate column', success: true },
      { sep: true },
      { op: 'del-row', label: '🗑  Delete row', danger: true },
      { op: 'del-col', label: '🗑  Delete column', danger: true },
      { op: 'del-table', label: '🗑  Delete table', danger: true },
    );
    return items;
  };

  const clearPreview = () => {
    if (!S) return;
    S.table.querySelectorAll('.cs-cell--danger').forEach((td) => td.classList.remove('cs-cell--danger'));
    S.table.querySelectorAll('.cs-cell--success').forEach((td) => td.classList.remove('cs-cell--success'));
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

  // Mark every rendered cell whose matrix area satisfies `pred(r,c)` green.
  const markCellsSuccess = (pred) => {
    if (!S) return;
    const state = read(S.table);
    S.table.querySelectorAll('td.cs-cell').forEach((td) => {
      const rc = cellRect(S.table, td);
      const id = state.M[rc.r][rc.c];
      let hit = false;
      for (let r = 0; r < state.rows && !hit; r++) for (let c = 0; c < state.cols; c++) { if (state.M[r][c] === id && pred(r, c)) { hit = true; break; } }
      if (hit) td.classList.add('cs-cell--success');
    });
  };

  // Hover-preview of what a delete item will remove (Canva-style red highlight).
  const previewOp = (op) => {
    clearPreview();
    if (!S) return;
    if (op === 'del-table') { S.table.querySelectorAll('td.cs-cell').forEach((td) => td.classList.add('cs-cell--danger')); return; }
    if (op === 'del-row') { const { r } = activeCoord(); markCells((rr) => rr === r); return; }
    if (op === 'del-col') { const { c } = activeCoord(); markCells((rr, cc) => cc === c); return; }
    if (op === 'dup-row') { const { r } = activeCoord(); markCellsSuccess((rr) => rr === r); return; }
    if (op === 'dup-col') { const { c } = activeCoord(); markCellsSuccess((rr, cc) => cc === c); return; }
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
      b.className = 'cs-tbl-menu__item' + (it.danger ? ' cs-tbl-menu__item--danger' : it.success ? ' cs-tbl-menu__item--success' : '');
      b.dataset.op = it.op;
      b.textContent = it.label;
      if (/^del-/.test(it.op) || /^dup-/.test(it.op)) {
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
    if (S?._cellInput) S._cellInput();
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

  // Upgrade a legacy table-repeater block (old Froala-style plain <table> with
  // <th>/<td> but no cs-cell/cs-table classes) so the engine can drive it.
  const upgradeLegacyTable = (block) => {
    let table = block.querySelector('table');
    if (!table) return null;
    if (!table.classList.contains('cs-table')) {
      table.classList.add('cs-table');
      if (!table.id) table.id = `dynamic_${hash()}`;
      // Stamp cs-cell on every cell; treat <th> as header cells.
      Array.from(table.rows).forEach((tr) => {
        Array.from(tr.cells).forEach((td) => {
          td.classList.add('cs-cell');
          if (td.tagName === 'TH' || tr.parentElement?.tagName === 'THEAD') td.classList.add('cs-cell--head');
        });
      });
      // Ensure a colgroup exists.
      if (!table.querySelector('colgroup')) {
        const cols = table.rows[0] ? table.rows[0].cells.length : 4;
        const cg = document.createElement('colgroup');
        for (let i = 0; i < cols; i++) {
          const col = document.createElement('col');
          col.style.width = `${(100 / cols).toFixed(4)}%`;
          cg.appendChild(col);
        }
        table.insertBefore(cg, table.firstChild);
      }
      // Flatten thead/tbody into a single tbody so the matrix engine works.
      const thead = table.querySelector('thead');
      if (thead) {
        const tbody = table.querySelector('tbody') || document.createElement('tbody');
        if (!table.querySelector('tbody')) table.appendChild(tbody);
        Array.from(thead.rows).forEach((tr) => tbody.insertBefore(tr, tbody.firstChild));
        thead.remove();
      }
    }
    return table;
  };

  const activate = (block) => {
    if (froalaMode()) return;
    if (S && S.block === block) return;
    if (S) deactivate();
    let table = block.querySelector('table.cs-table');
    // If no cs-table found (legacy table-repeater block), upgrade it in-place.
    if (!table && block.dataset.blockType === 'table-repeater') table = upgradeLegacyTable(block);
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

    // When cell content grows (typing, Enter, paste), expand the block height
    // to wrap the table — mirrors how text blocks auto-grow via height:auto.
    S._cellInput = () => {
      const tableH = table.offsetHeight;
      const blockH = block.offsetHeight;
      if (tableH > blockH) {
        block.style.height = `${tableH}px`;
        block.style.minHeight = `${tableH}px`;
      }
    };
    table.addEventListener('input', S._cellInput);

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
    S._selChange = () => {
      onTableSelChange();
      // Sync toolbar dropdowns to reflect the text at the caret/selection.
      if (S.activeCell) syncToolbarToCell(S.activeCell);
    };
    document.addEventListener('selectionchange', S._selChange);

    // Sync toolbar dropdowns to reflect the focused cell's styles.
    S._focusin = (e) => {
      const td = e.target.closest && e.target.closest('td.cs-cell');
      if (td) { S.activeCell = td; syncToolbarToCell(td); }
    };
    table.addEventListener('focusin', S._focusin);
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
    if (S._cellInput) table.removeEventListener('input', S._cellInput);
    window.removeEventListener('scroll', S._reflow, true);
    window.removeEventListener('resize', S._reflow);
    if (S._mode) document.removeEventListener('canvas:rich-toolbar-mode', S._mode);
    if (S._selChange) document.removeEventListener('selectionchange', S._selChange);
    if (S._focusin) table.removeEventListener('focusin', S._focusin);
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

  const TABLE_TYPES = new Set(['table', 'table-repeater']);

  const init = () => {
    const surface = document.querySelector('.custom-form-design') || document.body;
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.attributeName !== 'class') continue;
        const el = m.target;
        if (!el.classList || !TABLE_TYPES.has(el.dataset.blockType)) continue;
        if (el.classList.contains('cs-editing')) activate(el);
        else if (S && S.block === el) deactivate();
      }
    });
    obs.observe(surface, { attributes: true, attributeFilter: ['class'], subtree: true });

    // Right-click anywhere on a table or table-repeater block → our context menu.
    document.addEventListener('contextmenu', (e) => {
      if (froalaMode()) return;
      const block = e.target.closest && e.target.closest('.cs_block_s[data-block-type="table"], .cs_block_s[data-block-type="table-repeater"]');
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

  Object.assign(window.TableBlock, { createBlock, createRepeaterBlock, activate, deactivate, normalizeCells });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
