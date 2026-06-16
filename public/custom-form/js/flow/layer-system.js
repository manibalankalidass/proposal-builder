/**
 * @fileoverview Photoshop-style layer system for COVER PAGES only.
 *
 * Stacking is controlled purely by inline `z-index` on each block — never by
 * reordering the DOM — so List sync, Section flow and Group child structure are
 * never disturbed, and the order round-trips through twig export / reload (the
 * inline style is part of the serialized DOM).
 *
 * A block's "layer siblings" are the `.cs_block_s` elements that share its
 * immediate parent (cover root, a group, a section/list column, …). Within each
 * such container the siblings stack by z-index; because a positioned container
 * (group/section/list) forms its own stacking context, its children stack WITHIN
 * it — exactly Photoshop's nested-layer behaviour.
 *
 * Talks to the right-panel Layers tab over the existing postMessage bus:
 *   panel → iframe : layers:request | layers:op {blockId,op} | layers:reorder
 *                    {blockId,targetId,position}
 *   iframe → panel : layers:tree {data:{pageId, selectedId, nodes}}
 * Selection itself reuses the existing `block:select` message.
 */
(function () {
  window.FlowCanvas = window.FlowCanvas || {};
  const FC = window.FlowCanvas;
  const EM = () => window.EditorManager;

  const COVER_SEL = '[data-cs-cover="1"]';
  const isCoverBlock = (b) => !!b?.closest?.(COVER_SEL);

  const getZ = (el) => {
    const z = parseInt(el.style.zIndex || '', 10);
    return Number.isNaN(z) ? null : z;
  };

  // Current visual (paint) order of a set of sibling blocks, bottom → top.
  // No explicit z-index paints below any explicit one (treated as 0); ties break
  // by DOM order.
  const visualOrder = (sibs) => {
    const idx = new Map(sibs.map((el, i) => [el, i]));
    return sibs.slice().sort((a, b) => {
      const ea = getZ(a) ?? 0;
      const eb = getZ(b) ?? 0;
      if (ea !== eb) return ea - eb;
      return idx.get(a) - idx.get(b);
    });
  };

  // Blocks that share `block`'s immediate parent — the set we restack.
  const zSiblings = (block) =>
    Array.from(block.parentElement?.children || []).filter((c) => c.classList?.contains('cs_block_s'));

  // Immediate nested layer-children of a block (those whose nearest `.cs_block_s`
  // ancestor is this block) — used to build the tree for groups/sections/lists.
  const childBlocksOf = (el) =>
    Array.from(el.querySelectorAll('.cs_block_s')).filter(
      (b) => b.parentElement?.closest('.cs_block_s') === el
    );

  // Top-level blocks of a cover page (its direct .cs_block_s children).
  const topBlocksOf = (cover) =>
    Array.from(cover.children).filter((c) => c.classList?.contains('cs_block_s'));

  const applyOrder = (ordered) => ordered.forEach((el, i) => { el.style.zIndex = String(i + 1); });

  // Reorder one block among its siblings and re-stamp dense z-index 1..N.
  const op = (block, kind) => {
    const sibs = zSiblings(block);
    if (sibs.length < 2) return;
    const order = visualOrder(sibs);
    const i = order.indexOf(block);
    if (i < 0) return;
    if (kind === 'front') { order.splice(i, 1); order.push(block); }
    else if (kind === 'back') { order.splice(i, 1); order.unshift(block); }
    else if (kind === 'forward' && i < order.length - 1) { order.splice(i, 1); order.splice(i + 1, 0, block); }
    else if (kind === 'backward' && i > 0) { order.splice(i, 1); order.splice(i - 1, 0, block); }
    else return;
    applyOrder(order);
  };

  // Drag-reorder: move `block` next to `target` (same parent only). `position`
  // is in TREE order (top layer first), but `order` is bottom→top — so tree
  // 'before' (ABOVE target = higher layer) means insert AFTER target here, and
  // tree 'after' means insert BEFORE. (Getting this inverted is why a dropped
  // layer used to snap back to the end.)
  const reorderTo = (block, target, position) => {
    if (!block || !target || block === target) return;
    if (block.parentElement !== target.parentElement) return; // same container only
    const order = visualOrder(zSiblings(block));
    const from = order.indexOf(block);
    if (from < 0) return;
    order.splice(from, 1);
    let to = order.indexOf(target);
    if (to < 0) return;
    if (position === 'before') to += 1; // tree-above → after in bottom→top order
    order.splice(to, 0, block);
    applyOrder(order);
  };

  /* ----------------------------- tree → panel ----------------------------- */

  const labelOf = (b) =>
    b.getAttribute('custom-name') || b.dataset.blockType || b.getAttribute('data') || 'Block';
  const typeOf = (b) =>
    b.classList.contains('cs-group-block') ? 'group'
      : b.querySelector(':scope > .section-container-content') ? 'section'
        : b.classList.contains('cs-synclist__col') || b.querySelector(':scope .cs-synclist') ? 'list'
          : (b.dataset.blockType || 'block');

  const ensureId = (b) => {
    if (!b.id) (FC.assignNodeId ? FC.assignNodeId(b, 'block') : (b.id = 'block_' + Math.random().toString(16).slice(2)));
    return b.id;
  };

  const imageThumb = (b) => {
    const img = b.querySelector('.image-container img, img');
    return img?.getAttribute('src') || null;
  };

  const buildNode = (b, selectedId) => {
    ensureId(b);
    const kids = visualOrder(childBlocksOf(b)).reverse(); // top layer first
    return {
      id: b.id,
      label: labelOf(b),
      type: typeOf(b),
      selected: b.id === selectedId,
      hidden: b.dataset.csHidden === '1',
      locked: b.dataset.csLocked === '1',
      thumb: imageThumb(b),
      hasChildren: kids.length > 0,
      children: kids.map((c) => buildNode(c, selectedId)),
    };
  };

  // Photoshop "eye" — toggle a block's visibility. Use inline `!important` so it
  // beats the cover/group `display:block !important` rules, and round-trips
  // through export/reload (inline style is part of the serialized DOM).
  const toggleVisibility = (b) => {
    if (b.dataset.csHidden === '1') {
      delete b.dataset.csHidden;
      b.style.removeProperty('display');
    } else {
      b.dataset.csHidden = '1';
      b.style.setProperty('display', 'none', 'important');
    }
  };

  const toggleLock = (b) => {
    if (b.dataset.csLocked === '1') delete b.dataset.csLocked;
    else b.dataset.csLocked = '1';
  };

  const activeCover = () => {
    const sel = EM()?.getSelected?.() || EM()?.getEditing?.();
    return sel?.closest?.(COVER_SEL) || document.querySelector(COVER_SEL) || null;
  };

  const sendTree = () => {
    const cover = activeCover();
    const sel = EM()?.getSelected?.() || EM()?.getEditing?.();
    const selId = sel && cover && cover.contains(sel) ? sel.id || null : null;
    const tops = cover ? visualOrder(topBlocksOf(cover)).reverse() : [];
    const nodes = tops.map((b) => buildNode(b, selId));
    window.parent?.postMessage({
      source: 'custom-form-twig',
      type: 'layers:tree',
      data: { pageId: cover?.id || null, selectedId: selId, nodes },
    }, '*');
  };

  // Debounced refresh on any structural / selection / style change on the board.
  let scheduled = false;
  const scheduleSend = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; sendTree(); });
  };

  /* ----------------------------- wiring ----------------------------- */

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || msg.target !== 'custom-form-twig') return;
    if (msg.type === 'layers:request') {
      sendTree();
    } else if (msg.type === 'layers:op' && msg.blockId) {
      const b = document.getElementById(msg.blockId);
      if (b && isCoverBlock(b)) { op(b, msg.op); sendTree(); }
    } else if (msg.type === 'layers:reorder' && msg.blockId && msg.targetId) {
      const b = document.getElementById(msg.blockId);
      const t = document.getElementById(msg.targetId);
      if (b && t && isCoverBlock(b)) { reorderTo(b, t, msg.position); sendTree(); }
    } else if (msg.type === 'layers:visibility' && msg.blockId) {
      const b = document.getElementById(msg.blockId);
      if (b && isCoverBlock(b)) { toggleVisibility(b); sendTree(); }
    } else if (msg.type === 'layers:rename' && msg.blockId && typeof msg.name === 'string') {
      const b = document.getElementById(msg.blockId);
      if (b && isCoverBlock(b)) {
        b.setAttribute('custom-name', msg.name);
        // Keep the on-canvas badge label in sync if the block is selected.
        const lbl = b.querySelector(':scope > .cs-block-badge .cs-block-badge__label');
        if (lbl) lbl.textContent = msg.name;
        sendTree();
      }
    } else if (msg.type === 'layers:lock' && msg.blockId) {
      const b = document.getElementById(msg.blockId);
      if (b && isCoverBlock(b)) { toggleLock(b); sendTree(); }
    } else if (msg.type === 'layers:duplicate' && msg.blockId) {
      const b = document.getElementById(msg.blockId);
      if (b && isCoverBlock(b)) { FC.duplicateBlock?.(b); sendTree(); }
    } else if (msg.type === 'layers:delete' && msg.blockId) {
      const b = document.getElementById(msg.blockId);
      if (b && isCoverBlock(b)) {
        if (FC.deleteBlock) FC.deleteBlock(b); else b.remove();
        sendTree();
      }
    }
  });

  const init = () => {
    const board = document.querySelector('.cs_paper') || document.querySelector('.custom-form-design');
    if (board) {
      const obs = new MutationObserver(scheduleSend);
      obs.observe(board, {
        attributes: true,
        attributeFilter: ['class', 'style'],
        childList: true,
        subtree: true,
      });
    }
    sendTree();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
