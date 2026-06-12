/**
 * @fileoverview "List" block — synchronised parallel columns of free-floating
 * blocks.
 *
 * Three selectable tiers:
 *   List      (.cs-synclist-block)  — the outer block.
 *   Container (.cs-synclist__col)   — each column; selectable + resizable, and a
 *                                     FREE canvas (like a Flexible block): the
 *                                     blocks inside are absolutely positioned and
 *                                     drag/resize freely, bounded to the column.
 *   Block     (.cs-synclist__col > .cs_block_s) — the actual content.
 *
 * Cross-column sync: every block belongs to a GROUP (dataset.slGroup) shared by
 * the matching block in each column. Add / delete / duplicate act on the whole
 * group (one block per column); move / resize on one block are mirrored live to
 * its group siblings (so the columns stay identical), while each block's text /
 * image / table CONTENT is edited individually.
 *
 * Only a fixed set of block types may be added (see ALLOWED). Add and column
 * controls live on a floating toolbar (in <body>, like the Table block).
 *
 * Exposes: window.SyncList.createBlock(cols), .handlePaste(anchor, newBlock)
 */
(function () {
  window.SyncList = window.SyncList || {};

  const hash = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2));
  const FC = () => window.FlowCanvas || {};

  // Auto-height: the shared column height grows so the tallest block in any
  // column always clears the bottom by BOTTOM_GAP. DEFAULT_COL_H matches the
  // CSS `--cs-col-h` fallback and acts as the minimum height.
  const BOTTOM_GAP = 20;
  const DEFAULT_COL_H = 240;

  const ALLOWED = [
    { type: 'heading', label: 'Heading' },
    { type: 'body-text', label: 'Body Text' },
    { type: 'image', label: 'Image' },
    { type: 'video', label: 'Video' },
    { type: 'table', label: 'Table' },
    { type: 'button', label: 'Button' },
    { type: 'label-tag', label: 'Label / Tag' },
    { type: 'spacer', label: 'Spacer' },
    { type: 'divider', label: 'Divider' },
  ];

  /* ------------------------------ DOM helpers ------------------------------ */

  const gridOf = (block) => block.querySelector(':scope > .cs-synclist');
  const colEls = (grid) => Array.from(grid.querySelectorAll(':scope > .cs-synclist__col'));
  const contentBlocks = (root) => Array.from(root.querySelectorAll('.cs-synclist__col > .cs_block_s'));

  // A column is itself a `.cs_block_s` so the inline-editor selects it as its
  // own "Container", and a position:relative free canvas for its blocks.
  const makeCol = () => {
    const col = document.createElement('div');
    col.className = 'cs_block_s cs-synclist__col';
    col.setAttribute('data', 'Container');
    col.setAttribute('custom-name', 'Container');
    col.dataset.blockType = 'sync-list-col';
    col.id = `block_${hash()}`;
    return col;
  };

  // A free-floating content block: absolutely positioned + csInSection so the
  // inline-editor's free drag/resize kicks in, tagged with its sync group.
  const makeBlock = (type, group, left, top) => {
    const inner = FC().createBlock?.(type);
    if (!inner) return null;
    FC().normalizeForFlow?.(inner);   // strip the factory's absolute placement
    inner.dataset.csInSection = '1';
    inner.dataset.slGroup = group;
    inner.style.position = 'absolute';
    inner.style.left = `${left}px`;
    inner.style.top = `${top}px`;
    return inner;
  };

  // No divider element — columns sit side by side (separated by CSS) and are
  // resized with the Container's own handles. This only strips any stale
  // dividers left over from older documents.
  const dropDividers = (grid) => {
    grid.querySelectorAll(':scope > .cs-synclist__col-divider').forEach((d) => d.remove());
  };

  // Strip any stale inline sizing off the columns; the grid template drives
  // their size uniformly (the grid keeps its --cs-col-w/--cs-col-h vars).
  const resetColWidths = (grid) => colEls(grid).forEach((c) => {
    c.style.width = ''; c.style.height = ''; c.style.maxWidth = ''; c.style.flex = '';
  });

  const createBlock = (cols = 3) => {
    const block = document.createElement('div');
    block.className = 'cs_block_s cs-synclist-block';
    block.setAttribute('data', 'List');
    block.setAttribute('custom-name', 'List');
    block.dataset.blockType = 'sync-list';
    block.id = `block_${hash()}`;

    const grid = document.createElement('div');
    grid.className = 'cs-synclist';
    grid.id = `dynamic_${hash()}`;

    const group = hash();
    for (let c = 0; c < cols; c++) {
      const col = makeCol();
      const blk = makeBlock('heading', group, 0, 0);
      if (blk) col.appendChild(blk);
      grid.appendChild(col);
    }
    dropDividers(grid);
    block.appendChild(grid);
    return block;
  };

  /* --------------------------- clone / id helpers -------------------------- */

  const regenIds = (root) => {
    const bump = (el) => {
      if (!el.id) return;
      const us = el.id.lastIndexOf('_');
      el.id = `${us > -1 ? el.id.slice(0, us) : el.id}_${hash()}`;
    };
    bump(root);
    root.querySelectorAll('[id]').forEach(bump);
  };

  // Strip chrome / selection + re-id a cloned block (keeps dataset.slGroup,
  // csInSection and inline position so the copy stays a valid free block).
  const cleanInner = (inner) => {
    inner.querySelectorAll('[data-cs-chrome], .cs-block-grip, .cs-block-badge, .cs-resize-handle').forEach((e) => e.remove());
    inner.classList.remove('cs-selected', 'cs-editing');
    inner.querySelectorAll('.cs-selected, .cs-editing').forEach((e) => e.classList.remove('cs-selected', 'cs-editing'));
    regenIds(inner);
  };

  /* ----------------------------- list contexts ----------------------------- */

  // Context for a CONTENT block (not the column / list itself).
  const ctxFromBlock = (block) => {
    if (!block || !block.classList || !block.classList.contains('cs_block_s')) return null;
    if (block.classList.contains('cs-synclist__col') || block.classList.contains('cs-synclist-block')) return null;
    const col = block.closest('.cs-synclist__col');
    if (!col) return null;
    const list = col.closest('.cs-synclist-block');
    const grid = list && gridOf(list);
    if (!grid) return null;
    return { block, list, grid, col, colIndex: colEls(grid).indexOf(col), group: block.dataset.slGroup };
  };
  const isInList = (block) => !!ctxFromBlock(block);

  // Context when the block IS a column (the "Container" tier).
  const colCtx = (block) => {
    if (!block?.classList?.contains('cs-synclist__col')) return null;
    const list = block.closest('.cs-synclist-block');
    const grid = list && gridOf(list);
    if (!grid) return null;
    return { list, grid, index: colEls(grid).indexOf(block) };
  };

  const groupMembers = (list, group) => contentBlocks(list).filter((b) => b.dataset.slGroup === group);

  /* --------------------------- cross-column sync --------------------------- */

  // Keep a block inside its column: never wider/taller than the column, never
  // positioned past its edges. This stops a block spilling into the next column
  // and caps resize at the container's width/height. Idempotent (only writes
  // when a value changes) so the style observer that calls it can't loop.
  const clampToCol = (block) => {
    const col = block.closest('.cs-synclist__col');
    if (!col) return;
    const cw = col.clientWidth;
    if (!cw) return;
    const set = (p, v) => { if (block.style[p] !== v) block.style[p] = v; };
    let w = block.offsetWidth;
    // Horizontal only: keep the block from spilling sideways. Vertically the
    // block is free to grow taller than the column — autoSizeList() then grows
    // the (shared) column height to fit it (text overflow → taller container),
    // so we deliberately don't cap height or bottom here anymore.
    if (w > cw) { set('width', `${cw}px`); w = cw; }
    let left = parseFloat(block.style.left) || 0;
    let top = parseFloat(block.style.top) || 0;
    if (left < 0) { left = 0; set('left', '0px'); }
    if (top < 0) { top = 0; set('top', '0px'); }
    if (left + w > cw) set('left', `${Math.max(0, cw - w)}px`);
  };

  // Grow the List's shared column height so the lowest block bottom across ALL
  // columns clears the bottom edge by BOTTOM_GAP. Columns share --cs-col-h, so
  // a tall block in one column lifts every column to the same height (and the
  // 20px gap is preserved below the tallest block). A manual height-resize is
  // remembered on the grid (dataset.slFloorH) and used as the minimum so the
  // user can still make a List taller than its content. Only writes when the
  // value changes, so the ResizeObserver that calls it can't loop.
  const autoSizeList = (list) => {
    if (!list) return;
    const grid = gridOf(list);
    if (!grid) return;
    let maxBottom = 0;
    contentBlocks(list).forEach((b) => {
      const bottom = b.offsetTop + b.offsetHeight;
      if (bottom > maxBottom) maxBottom = bottom;
    });
    // Minimum height = the user's manual resize if there is one, else the
    // default. Content can always push beyond it, but never gets clipped.
    const manual = parseFloat(grid.dataset.slFloorH);
    const floor = Number.isFinite(manual) ? manual : DEFAULT_COL_H;
    const needed = Math.max(floor, Math.ceil(maxBottom + BOTTOM_GAP));
    const cur = parseFloat(grid.style.getPropertyValue('--cs-col-h')) || DEFAULT_COL_H;
    if (needed !== cur) grid.style.setProperty('--cs-col-h', `${needed}px`);
  };

  // Copy a block's geometry (position + size) onto its group siblings in the
  // other columns. Only writes when a value actually differs, so the style
  // MutationObserver that calls this can't loop.
  const mirrorGeometry = (block) => {
    const group = block.dataset.slGroup;
    const list = block.closest('.cs-synclist-block');
    if (!group || !list) return;
    const vals = { left: block.style.left, top: block.style.top, width: block.style.width, height: block.style.height };
    groupMembers(list, group).forEach((sib) => {
      if (sib === block) return;
      Object.keys(vals).forEach((p) => { if (sib.style[p] !== vals[p]) sib.style[p] = vals[p]; });
    });
  };

  const afterChange = () => { try { window.generate?.(); } catch (e) { /* */ } };

  // Re-assert selection on the List after a structural change (the inline-editor
  // observer tears down selection when new blocks appear).
  const finishStructural = (list) => {
    afterChange();
    if (!list || !list.isConnected) return;
    requestAnimationFrame(() => {
      try { window.EditorManager?.select?.(list); } catch (e) { /* */ }
      activate(list);
      autoSizeList(list);
    });
  };

  /* ----------------------------- group operations -------------------------- */

  // New block in every column (a new synced group) at a given position.
  const addBlockAt = (list, type, left, top) => {
    const group = hash();
    colEls(gridOf(list)).forEach((col) => {
      const blk = makeBlock(type, group, left, top);
      if (blk) col.appendChild(blk);
    });
    finishStructural(list);
  };

  // Toolbar "+ Add block" — stagger new groups below the last.
  const addRow = (list, type) => {
    const groupCount = new Set(contentBlocks(list).map((b) => b.dataset.slGroup)).size;
    addBlockAt(list, type, 8, 8 + groupCount * 64);
  };

  const deleteGroup = (block) => {
    const ctx = ctxFromBlock(block);
    if (!ctx) return;
    groupMembers(ctx.list, ctx.group).forEach((b) => b.remove());
    finishStructural(ctx.list);
  };

  const duplicateGroup = (block) => {
    const ctx = ctxFromBlock(block);
    if (!ctx) return null;
    const { list, grid, group } = ctx;
    const cols = colEls(grid);
    const newGroup = hash();
    const byCol = new Map();
    groupMembers(list, group).forEach((b) => byCol.set(b.closest('.cs-synclist__col'), b));
    cols.forEach((col) => {
      const src = byCol.get(col);
      if (!src) return;
      const clone = src.cloneNode(true);
      cleanInner(clone);
      clone.dataset.csInSection = '1';
      clone.dataset.slGroup = newGroup;
      clone.style.position = 'absolute';
      clone.style.left = `${(parseFloat(src.style.left) || 0) + 20}px`;
      clone.style.top = `${(parseFloat(src.style.top) || 0) + 20}px`;
      col.appendChild(clone);
    });
    finishStructural(list);
    return null;
  };

  // Badge ▲/▼ on a content block nudges it up/down; the style observer mirrors.
  const nudgeGroup = (block, dir) => {
    const ctx = ctxFromBlock(block);
    if (!ctx) return false;
    const top = Math.max(0, (parseFloat(block.style.top) || 0) + (dir === 'up' ? -20 : 20));
    block.style.top = `${top}px`;
    afterChange();
    return true;
  };

  // Paste → a new group offset from the anchor (into the anchor's column +
  // clones in the others).
  const handlePaste = (anchor, newBlock) => {
    const ctx = ctxFromBlock(anchor);
    if (!ctx || !newBlock) return null;
    const { list, grid, colIndex } = ctx;
    const cols = colEls(grid);
    const group = hash();
    const left = (parseFloat(anchor.style.left) || 0) + 20;
    const top = (parseFloat(anchor.style.top) || 0) + 20;
    let placed = null;
    cols.forEach((col, ci) => {
      const blk = (ci === colIndex) ? newBlock : newBlock.cloneNode(true);
      if (ci !== colIndex) cleanInner(blk);
      blk.dataset.csInSection = '1';
      blk.dataset.slGroup = group;
      blk.style.position = 'absolute';
      blk.style.left = `${left}px`;
      blk.style.top = `${top}px`;
      col.appendChild(blk);
      if (ci === colIndex) placed = blk;
    });
    finishStructural(list);
    return placed;
  };

  /* ---------------------------- column operations -------------------------- */

  const addColumn = (block) => {
    const grid = gridOf(block);
    const cols = colEls(grid);
    const src = cols[cols.length - 1];
    const newCol = makeCol();
    // Clone the last column's blocks, KEEPING each block's slGroup so the new
    // column joins the existing groups (regenIds only re-ids elements).
    (src ? Array.from(src.querySelectorAll(':scope > .cs_block_s')) : []).forEach((b) => {
      const clone = b.cloneNode(true);
      cleanInner(clone);
      clone.dataset.csInSection = '1';
      newCol.appendChild(clone);
    });
    if (!newCol.querySelector(':scope > .cs_block_s')) {
      const blk = makeBlock('heading', hash(), 8, 8);
      if (blk) newCol.appendChild(blk);
    }
    grid.appendChild(newCol);
    dropDividers(grid);
    resetColWidths(grid);
    finishStructural(block);
  };

  const deleteColumn = (block, colIndex) => {
    const grid = gridOf(block);
    const cols = colEls(grid);
    if (cols.length <= 1) return;
    const target = (colIndex == null || colIndex < 0 || colIndex >= cols.length) ? cols.length - 1 : colIndex;
    cols[target].remove();
    dropDividers(grid);
    resetColWidths(grid);
    finishStructural(block);
  };

  const cleanColumnClone = (col) => {
    col.classList.remove('cs-selected', 'cs-editing');
    // Clear inline sizing so the grid's uniform var rule (or default flex) drives it.
    col.style.width = ''; col.style.height = ''; col.style.maxWidth = ''; col.style.flex = '';
    col.querySelectorAll('[data-cs-chrome], .cs-block-grip, .cs-block-badge, .cs-resize-handle').forEach((e) => e.remove());
    col.querySelectorAll('.cs-selected, .cs-editing').forEach((e) => e.classList.remove('cs-selected', 'cs-editing'));
    regenIds(col);
  };

  // Copy/paste of a whole Container: append it as a NEW column. Its child blocks
  // keep their slGroup, so they join the existing sync groups (drag / resize /
  // delete then apply across this new column too).
  const handleColumnPaste = (anchorCol, newCol) => {
    const list = anchorCol?.closest?.('.cs-synclist-block');
    const grid = list && gridOf(list);
    if (!grid || !newCol) return null;
    newCol.classList.add('cs_block_s', 'cs-synclist__col');
    newCol.setAttribute('data', 'Container');
    newCol.setAttribute('custom-name', 'Container');
    newCol.dataset.blockType = 'sync-list-col';
    cleanColumnClone(newCol);
    // Keep children absolute + csInSection (and their slGroup) so they sync.
    Array.from(newCol.querySelectorAll(':scope > .cs_block_s')).forEach((b) => {
      b.dataset.csInSection = '1';
      if (!b.style.position) b.style.position = 'absolute';
    });
    grid.appendChild(newCol);
    resetColWidths(grid);
    finishStructural(list);
    return newCol;
  };

  const duplicateColumn = (block, index) => {
    const grid = gridOf(block);
    const src = colEls(grid)[index];
    if (!src) return null;
    const clone = src.cloneNode(true);
    cleanColumnClone(clone);
    src.after(clone);
    dropDividers(grid);
    resetColWidths(grid);
    finishStructural(block);
    return null;
  };

  const moveColumn = (block, index, dir) => {
    const grid = gridOf(block);
    const cols = colEls(grid);
    const to = dir === 'up' ? index - 1 : index + 1;
    if (to < 0 || to >= cols.length) return false;
    if (dir === 'up') cols[to].before(cols[index]); else cols[to].after(cols[index]);
    dropDividers(grid);
    finishStructural(block);
    return true;
  };

  /* ------------------------------ floating UI ------------------------------ */

  let active = null;
  let menuEl = null;

  const closeMenu = () => { if (menuEl) { menuEl.remove(); menuEl = null; } };

  const openAddMenu = (btn, list) => {
    closeMenu();
    const m = document.createElement('div');
    m.className = 'cs-tbl-menu cs-synclist-menu';
    m.setAttribute('data-cs-chrome', '');
    ALLOWED.forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cs-tbl-menu__item';
      b.dataset.type = a.type;
      b.textContent = a.label;
      m.appendChild(b);
    });
    m.addEventListener('mousedown', (e) => e.preventDefault());
    m.addEventListener('click', (e) => {
      const t = e.target.closest('[data-type]')?.dataset.type;
      if (!t) return;
      addRow(list, t);
      closeMenu();
    });
    document.body.appendChild(m);
    const r = btn.getBoundingClientRect();
    let left = r.left;
    if (left + m.offsetWidth > window.innerWidth - 8) left = window.innerWidth - m.offsetWidth - 8;
    m.style.left = `${Math.max(8, left)}px`;
    m.style.top = `${r.bottom + 4}px`;
    menuEl = m;
  };

  const buildToolbar = (list) => {
    const tb = document.createElement('div');
    tb.className = 'cs-tbl-toolbar cs-synclist-toolbar';
    tb.setAttribute('data-cs-chrome', '');
    tb.innerHTML = `
      <div class="cs-tbl-group">
        <button data-sl="add-row" title="Add a block to every column">＋ Add block</button>
      </div>
      <div class="cs-tbl-group">
        <button data-sl="add-col" title="Add a column">＋ Column</button>
        <button data-sl="del-col" title="Remove last column">－ Column</button>
      </div>`;
    tb.addEventListener('mousedown', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
    tb.addEventListener('click', (e) => {
      const op = e.target.closest('[data-sl]')?.dataset.sl;
      if (!op) return;
      e.preventDefault();
      if (op === 'add-row') return openAddMenu(e.target.closest('button'), list);
      if (op === 'add-col') return addColumn(list);
      if (op === 'del-col') return deleteColumn(list, null);
    });
    document.body.appendChild(tb);
    return tb;
  };

  const positionToolbar = () => {
    if (!active) return;
    const r = active.block.getBoundingClientRect();
    const tb = active.toolbar;
    let top = r.top - tb.offsetHeight - 8;
    if (top < 8) top = r.bottom + 8;
    // Anchor the toolbar's RIGHT edge to the list's right edge (width-independent,
    // so it stays put even as the toolbar's own width settles / fonts load).
    // Use clientWidth (excludes the scrollbar) so `right` lines up with the
    // list's right edge from getBoundingClientRect (which also excludes it).
    const vw = document.documentElement.clientWidth || window.innerWidth;
    tb.style.left = 'auto';
    tb.style.right = `${Math.max(8, Math.round(vw - r.right))}px`;
    tb.style.top = `${Math.max(8, top)}px`;
  };

  const activate = (list) => {
    if (active && active.block === list) { positionToolbar(); return; }
    if (active) deactivate();
    active = { block: list, toolbar: buildToolbar(list) };
    active._reflow = () => positionToolbar();
    window.addEventListener('scroll', active._reflow, true);
    window.addEventListener('resize', active._reflow);
    positionToolbar();
    // Re-read once layout has settled (the list's rect can shift right after
    // it's created/selected); right-anchoring makes this stable.
    requestAnimationFrame(() => positionToolbar());
  };

  const deactivate = () => {
    if (!active) return;
    closeMenu();
    window.removeEventListener('scroll', active._reflow, true);
    window.removeEventListener('resize', active._reflow);
    active.toolbar.remove();
    active = null;
  };

  const activeListFromSelection = () => {
    const sel = document.querySelector('.cs_block_s.cs-selected, .cs_block_s.cs-editing');
    if (!sel) return null;
    return sel.classList.contains('cs-synclist-block') ? sel : sel.closest('.cs-synclist-block');
  };

  let syncQueued = false;
  const syncActive = () => {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(() => {
      syncQueued = false;
      const list = activeListFromSelection();
      if (list) activate(list); else deactivate();
    });
  };

  /* -------------------------------- wiring --------------------------------- */

  const wrapOverrides = () => {
    const fc = window.FlowCanvas;
    if (!fc || fc._synclistWrapped) return;
    fc._synclistWrapped = true;

    const origDelete = fc.deleteBlock;
    window.SyncList._origDelete = origDelete;
    fc.deleteBlock = function (block) {
      const cc = colCtx(block);
      if (cc) return deleteColumn(cc.list, cc.index);
      if (isInList(block)) return deleteGroup(block);
      return origDelete ? origDelete.call(this, block) : undefined;
    };

    const origMove = fc.moveBlock;
    fc.moveBlock = function (block, dir) {
      const cc = colCtx(block);
      if (cc) return moveColumn(cc.list, cc.index, dir);
      if (isInList(block)) return nudgeGroup(block, dir);
      return origMove ? origMove.call(this, block, dir) : false;
    };

    const origDup = fc.duplicateBlock;
    fc.duplicateBlock = function (block) {
      const cc = colCtx(block);
      if (cc) return duplicateColumn(cc.list, cc.index);
      if (isInList(block)) return duplicateGroup(block);
      return origDup ? origDup.call(this, block) : null;
    };
  };

  // Typing into a text block changes its CONTENT (not its `style`), so the
  // style observer never sees it. A ResizeObserver watches each content block's
  // box instead: when text makes it grow/shrink we re-fit the List's height.
  const observedBlocks = new WeakSet();
  let ro = null;
  let roQueue = new Set();
  let roRaf = 0;
  const flushRo = () => {
    roRaf = 0;
    const lists = Array.from(roQueue);
    roQueue.clear();
    lists.forEach((l) => { if (l.isConnected) autoSizeList(l); });
  };
  const observeBlock = (b) => {
    if (!ro || observedBlocks.has(b)) return;
    observedBlocks.add(b);
    ro.observe(b);
  };
  const observeAll = (root) => contentBlocks(root).forEach(observeBlock);

  const init = () => {
    wrapOverrides();

    const surface = document.querySelector('.custom-form-design') || document.body;

    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver((entries) => {
        for (const e of entries) {
          const list = e.target.closest?.('.cs-synclist-block');
          if (list) roQueue.add(list);
        }
        if (!roRaf) roRaf = requestAnimationFrame(flushRo);
      });
    }

    // Observe existing content blocks and fit each list once on load.
    document.querySelectorAll('.cs-synclist-block').forEach((list) => {
      observeAll(list);
      autoSizeList(list);
    });

    // Observe content blocks added later (drop, paste, add-row, add-column …)
    // and re-fit the list they land in.
    new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (n.matches?.('.cs-synclist__col > .cs_block_s')) observeBlock(n);
          n.querySelectorAll?.('.cs-synclist__col > .cs_block_s').forEach(observeBlock);
          const list = n.closest?.('.cs-synclist-block') || n.querySelector?.('.cs-synclist-block');
          if (list) autoSizeList(list);
        });
      }
    }).observe(surface, { childList: true, subtree: true });

    // Toolbar visibility follows selection in/out of a List.
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.attributeName === 'class' && m.target.classList?.contains('cs_block_s')) { syncActive(); return; }
      }
    }).observe(surface, { attributes: true, attributeFilter: ['class'], subtree: true });

    // Style changes drive two syncs:
    //  - a column's inline width → flex-basis (so the resize sticks);
    //  - a content block's position/size → mirrored to its group siblings.
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.attributeName !== 'style') continue;
        const el = m.target;
        if (!(el instanceof HTMLElement) || !el.classList.contains('cs_block_s')) continue;
        if (el.classList.contains('cs-synclist__col')) {
          // Resizing a column feeds the shared --cs-col-w/--cs-col-h, so EVERY
          // column takes that exact px size (smooth, 1:1 with the drag); width
          // adds .cs-synclist--sized which switches columns from "fill the row
          // equally" to fixed px + wrap. Clear inline sizing so the var rule wins.
          const grid = el.closest('.cs-synclist');
          if (grid && (el.style.width || el.style.height)) {
            if (el.style.width) {
              grid.style.setProperty('--cs-col-w', el.style.width);
              grid.classList.add('cs-synclist--sized');
            }
            // A manual height-resize becomes the new minimum (floor) for the
            // auto-height; autoSizeList then enforces max(floor, content+gap).
            if (el.style.height) grid.dataset.slFloorH = String(parseFloat(el.style.height) || 0);
            colEls(grid).forEach((c) => { c.style.width = ''; c.style.height = ''; c.style.maxWidth = ''; c.style.flex = ''; });
            if (el.style.height) autoSizeList(grid.closest('.cs-synclist-block'));
          }
          continue;
        }
        if (el.classList.contains('cs-synclist-block')) continue;
        if (el.closest('.cs-synclist__col')) { clampToCol(el); mirrorGeometry(el); autoSizeList(el.closest('.cs-synclist-block')); }
      }
    }).observe(surface, { attributes: true, attributeFilter: ['style'], subtree: true });

    // Close the add menu on any outside press.
    document.addEventListener('pointerdown', (e) => {
      if (menuEl && !e.target.closest('.cs-synclist-menu') && !e.target.closest('.cs-synclist-toolbar')) closeMenu();
    }, true);

    // Persist after a free drag / resize ends.
    document.addEventListener('pointerup', () => { if (active) afterChange(); });

    // Drag a block from the sidebar INTO a Container → drop it as a new synced
    // group at the cursor position (cloned across columns). Capture phase so we
    // beat the canvas drop handler (which would place it in the page flow).
    const overCol = (e) => e.target.closest?.('.cs-synclist__col');
    // Remove every drop highlight (ours + the canvas's blue indicator line).
    const clearDropHighlight = () => {
      document.querySelectorAll('.cs-synclist__col--dropping').forEach((c) => c.classList.remove('cs-synclist__col--dropping'));
      window.FlowCanvas?.hideIndicator?.();
    };
    document.addEventListener('dragover', (e) => {
      const col = overCol(e);
      if (!col) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      // Only the column under the cursor is highlighted.
      document.querySelectorAll('.cs-synclist__col--dropping').forEach((c) => { if (c !== col) c.classList.remove('cs-synclist__col--dropping'); });
      col.classList.add('cs-synclist__col--dropping');
    }, true);
    document.addEventListener('drop', (e) => {
      const col = overCol(e);
      if (!col) { clearDropHighlight(); return; }
      const payload = readDropPayload(e);
      const type = payload?.blockType;
      clearDropHighlight();
      if (!type || !ALLOWED.some((a) => a.type === type)) return;
      e.preventDefault();
      e.stopPropagation();
      const list = col.closest('.cs-synclist-block');
      const r = col.getBoundingClientRect();
      addBlockAt(list, type, Math.max(0, e.clientX - r.left - 20), Math.max(0, e.clientY - r.top - 10));
    }, true);
    // If the drag is cancelled (Esc / dropped off-canvas), clear any highlight.
    document.addEventListener('dragend', clearDropHighlight, true);
  };

  // Read a sidebar drag payload (same sources flow-canvas.js uses).
  const readDropPayload = (e) => {
    const dt = e.dataTransfer;
    const parse = (s) => { try { return JSON.parse(s); } catch (err) { return null; } };
    const direct = (dt && (parse(dt.getData('application/x-brochure-block')) || parse(dt.getData('text/plain'))));
    if (direct?.blockType) return direct;
    try {
      const fb = window.parent?.['__BROCHURE_FLOW_DRAG__'];
      if (fb?.blockType) return fb;
    } catch (err) { /* cross-origin */ }
    return null;
  };

  Object.assign(window.SyncList, { createBlock, handlePaste, handleColumnPaste, activate, deactivate });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
