/**
 * @fileoverview Group / ungroup for free-move (cover page) blocks — model + UI.
 *
 * Scoped entirely to cover pages (`.cs_page[data-cs-cover="1"]`) so normal flow
 * pages and the single-block selection in inline-editor.js are untouched.
 *
 * UI:
 *   - Drag a rubber-band rectangle over empty cover-page area → every block it
 *     touches becomes `.cs-multi-selected`; a floating "Group" button appears.
 *   - Click a group → inline-editor selects the whole group (via the
 *     `FlowCanvas.resolveSelectable` hook); a floating "Ungroup" button appears.
 *   - Click again (drill in) → the inner child is selected; its "Ungroup" pops
 *     just that child out.
 *   - Ctrl+G groups the marquee selection, Ctrl+Shift+G ungroups.
 *
 * Model (on window.FlowCanvas):
 *   groupBlocks(blocks)  → group element (or null)  — bundle 2+ free blocks
 *   ungroupBlocks(group)                            — dissolve, all kids loose
 *   ungroupOne(child)    → child                    — pop one kid out of a group
 *
 * A "group" is a normal free-form `.cs_block_s.cs-group-block` (`position:absolute`,
 * `data-cs-in-section="1"`) whose children are absolute blocks positioned relative
 * to the group box, so moving the group moves them together — reusing the existing
 * free-move machinery. Because a group is just a `.cs_block_s`, duplicate / delete /
 * export work on it as-is.
 */
(function () {
  window.FlowCanvas = window.FlowCanvas || {};
  const FC = window.FlowCanvas;
  const EM = () => window.EditorManager;

  const num = (v) => { const n = parseFloat(v); return Number.isNaN(n) ? 0 : n; };

  // Position/size of a free block relative to its positioned parent
  // (the cover page, or — for a child — the group box).
  const posOf = (block) => ({
    left: block.style.left ? num(block.style.left) : block.offsetLeft,
    top: block.style.top ? num(block.style.top) : block.offsetTop,
    width: block.offsetWidth,
    height: block.offsetHeight,
  });

  const coverOf = (el) => el?.closest?.('[data-cs-cover="1"]') || null;
  const childBlocksOf = (group) =>
    Array.from(group.children).filter((c) => c.classList?.contains('cs_block_s'));
  const coverChildBlocks = (cover) =>
    Array.from(cover.children).filter((c) => c.classList?.contains('cs_block_s'));

  const markFree = (block) => {
    block.style.position = 'absolute';
    block.dataset.csInSection = '1';
  };

  /* ============================== MODEL ============================== */

  FC.groupBlocks = function (blocks) {
    blocks = (blocks || []).filter((b) => b && b.classList?.contains('cs_block_s'));
    if (blocks.length < 2) return null;
    const cover = coverOf(blocks[0]);
    if (!cover) return null;

    // Bounding box in cover-page coordinates.
    let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
    const meta = blocks.map((b) => {
      const p = posOf(b);
      minL = Math.min(minL, p.left);
      minT = Math.min(minT, p.top);
      maxR = Math.max(maxR, p.left + p.width);
      maxB = Math.max(maxB, p.top + p.height);
      return { block: b, p };
    });

    const group = document.createElement('div');
    group.className = 'cs_block_s cs-group-block';
    group.dataset.blockType = 'group';
    group.dataset.csInSection = '1';
    group.setAttribute('data', 'Group');
    group.setAttribute('custom-name', 'Group');
    FC.assignNodeId?.(group, 'group');
    group.style.position = 'absolute';
    group.style.left = `${minL}px`;
    group.style.top = `${minT}px`;
    group.style.width = `${maxR - minL}px`;
    group.style.height = `${maxB - minT}px`;
    cover.appendChild(group);

    // Reparent children, repositioning relative to the group origin (DOM order
    // preserved by iterating the original list).
    meta.forEach(({ block, p }) => {
      markFree(block);
      block.style.left = `${p.left - minL}px`;
      block.style.top = `${p.top - minT}px`;
      block.classList.remove('cs-multi-selected', 'cs-selected', 'cs-editing');
      group.appendChild(block);
    });

    return group;
  };

  FC.ungroupBlocks = function (group) {
    if (!group || !group.classList?.contains('cs-group-block')) return;
    const cover = coverOf(group) || group.parentElement;
    if (!cover) return;
    const gp = posOf(group);
    childBlocksOf(group).forEach((child) => {
      const c = posOf(child);
      markFree(child);
      child.style.left = `${gp.left + c.left}px`;
      child.style.top = `${gp.top + c.top}px`;
      cover.appendChild(child);
    });
    group.remove();
  };

  // Recompute a group's box to tightly fit its remaining children, adjusting
  // child offsets so they keep their on-screen position.
  const refitGroup = (group) => {
    const kids = childBlocksOf(group);
    if (!kids.length) { group.remove(); return; }
    const gp = posOf(group);
    let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
    const meta = kids.map((k) => {
      const p = posOf(k);
      minL = Math.min(minL, p.left);
      minT = Math.min(minT, p.top);
      maxR = Math.max(maxR, p.left + p.width);
      maxB = Math.max(maxB, p.top + p.height);
      return { k, p };
    });
    group.style.left = `${gp.left + minL}px`;
    group.style.top = `${gp.top + minT}px`;
    group.style.width = `${maxR - minL}px`;
    group.style.height = `${maxB - minT}px`;
    meta.forEach(({ k, p }) => {
      k.style.left = `${p.left - minL}px`;
      k.style.top = `${p.top - minT}px`;
    });
  };

  // Public: grow/shrink a group so its box always wraps every child (called
  // after a child is moved, resized, or pasted in).
  FC.refitGroupToChildren = (group) => {
    if (group && group.classList?.contains('cs-group-block')) refitGroup(group);
  };

  FC.ungroupOne = function (child) {
    if (!child) return null;
    const group = child.closest('.cs-group-block');
    if (!group) return null;
    const cover = coverOf(group) || group.parentElement;
    if (!cover) return null;

    const gp = posOf(group);
    const c = posOf(child);
    markFree(child);
    child.style.left = `${gp.left + c.left}px`;
    child.style.top = `${gp.top + c.top}px`;
    cover.appendChild(child);

    // A group of one is pointless — dissolve it (releasing the last child too).
    const remaining = childBlocksOf(group);
    if (remaining.length <= 1) {
      FC.ungroupBlocks(group);
    } else {
      refitGroup(group);
    }
    return child;
  };

  /* ============================== SELECTION + UI ============================== */

  /* ---- multi-select state ---- */
  const multi = new Set();
  const clearMulti = () => {
    multi.forEach((b) => b.classList.remove('cs-multi-selected'));
    multi.clear();
    hideToolbar();
    hideBounds();
  };
  const setMulti = (blocks) => {
    multi.forEach((b) => b.classList.remove('cs-multi-selected'));
    multi.clear();
    blocks.forEach((b) => { multi.add(b); b.classList.add('cs-multi-selected'); });
  };
  FC.getMultiSelection = () => [...multi];
  FC.clearMultiSelection = clearMulti;

  /* ---- floating toolbar ---- */
  let toolbar = null;
  const ensureToolbar = () => {
    if (toolbar) return toolbar;
    toolbar = document.createElement('div');
    toolbar.className = 'cs-group-toolbar';
    toolbar.setAttribute('data-cs-chrome', '');
    document.body.appendChild(toolbar);
    return toolbar;
  };
  const hideToolbar = () => { if (toolbar) toolbar.style.display = 'none'; };

  const placeToolbar = (anchorRect, html, below = false) => {
    const tb = ensureToolbar();
    tb.innerHTML = html;
    tb.style.display = 'inline-flex';
    tb.style.position = 'fixed';
    tb.style.zIndex = '10001';
    tb.style.left = `${Math.max(4, anchorRect.left)}px`;
    tb.style.top = below ? `${anchorRect.bottom + 6}px` : `${Math.max(4, anchorRect.top - 34)}px`;
  };

  const bboxOf = (els) => {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    els.forEach((el) => {
      const q = el.getBoundingClientRect();
      l = Math.min(l, q.left); t = Math.min(t, q.top);
      r = Math.max(r, q.right); b = Math.max(b, q.bottom);
    });
    return { left: l, top: t, right: r, bottom: b };
  };

  /* ---- dotted bounding box around the whole multi-selection (group preview) ---- */
  let boundsEl = null;
  const hideBounds = () => { if (boundsEl) boundsEl.style.display = 'none'; };
  const showBounds = (els) => {
    if (!els || els.length < 2) { hideBounds(); return; }
    if (!boundsEl) {
      boundsEl = document.createElement('div');
      boundsEl.className = 'cs-group-bounds';
      boundsEl.setAttribute('data-cs-chrome', '');
      document.body.appendChild(boundsEl);
    }
    const r = bboxOf(els);
    boundsEl.style.display = 'block';
    boundsEl.style.position = 'fixed';
    boundsEl.style.zIndex = '9999';
    boundsEl.style.left = `${r.left}px`;
    boundsEl.style.top = `${r.top}px`;
    boundsEl.style.width = `${r.right - r.left}px`;
    boundsEl.style.height = `${r.bottom - r.top}px`;
  };

  /* ---- align / distribute the multi-selection ---- */
  const A_ICON = {
    left: '<svg viewBox="0 0 16 16"><line x1="2" y1="1.5" x2="2" y2="14.5"/><rect x="3.5" y="4" width="9" height="3"/><rect x="3.5" y="9" width="6" height="3"/></svg>',
    cx: '<svg viewBox="0 0 16 16"><line x1="8" y1="1.5" x2="8" y2="14.5"/><rect x="3" y="4" width="10" height="3"/><rect x="4.5" y="9" width="7" height="3"/></svg>',
    right: '<svg viewBox="0 0 16 16"><line x1="14" y1="1.5" x2="14" y2="14.5"/><rect x="3.5" y="4" width="9" height="3"/><rect x="6.5" y="9" width="6" height="3"/></svg>',
    top: '<svg viewBox="0 0 16 16"><line x1="1.5" y1="2" x2="14.5" y2="2"/><rect x="4" y="3.5" width="3" height="9"/><rect x="9" y="3.5" width="3" height="6"/></svg>',
    cy: '<svg viewBox="0 0 16 16"><line x1="1.5" y1="8" x2="14.5" y2="8"/><rect x="4" y="3" width="3" height="10"/><rect x="9" y="4.5" width="3" height="7"/></svg>',
    bottom: '<svg viewBox="0 0 16 16"><line x1="1.5" y1="14" x2="14.5" y2="14"/><rect x="4" y="3.5" width="3" height="9"/><rect x="9" y="6.5" width="3" height="6"/></svg>',
    distH: '<svg viewBox="0 0 16 16"><rect x="1" y="4" width="2.5" height="8"/><rect x="6.75" y="4" width="2.5" height="8"/><rect x="12.5" y="4" width="2.5" height="8"/></svg>',
    distV: '<svg viewBox="0 0 16 16"><rect x="4" y="1" width="8" height="2.5"/><rect x="4" y="6.75" width="8" height="2.5"/><rect x="4" y="12.5" width="8" height="2.5"/></svg>',
  };
  const aBtn = (action, ic, title) =>
    `<button type="button" class="cs-group-toolbar__ico" data-cs-group-action="${action}" title="${title}">${A_ICON[ic]}</button>`;

  // Align every selected block to the SELECTION's bounding box (free-move blocks
  // are absolutely positioned, so we set inline left/top — export-safe).
  const alignSelection = (cmd) => {
    const blocks = [...multi].filter((b) => b.offsetParent);
    if (blocks.length < 2) return;
    let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
    blocks.forEach((b) => {
      minL = Math.min(minL, b.offsetLeft); minT = Math.min(minT, b.offsetTop);
      maxR = Math.max(maxR, b.offsetLeft + b.offsetWidth); maxB = Math.max(maxB, b.offsetTop + b.offsetHeight);
    });
    const cx = (minL + maxR) / 2, cy = (minT + maxB) / 2;
    blocks.forEach((b) => {
      const w = b.offsetWidth, h = b.offsetHeight;
      if (cmd === 'left') b.style.left = `${Math.round(minL)}px`;
      else if (cmd === 'cx') b.style.left = `${Math.round(cx - w / 2)}px`;
      else if (cmd === 'right') b.style.left = `${Math.round(maxR - w)}px`;
      else if (cmd === 'top') b.style.top = `${Math.round(minT)}px`;
      else if (cmd === 'cy') b.style.top = `${Math.round(cy - h / 2)}px`;
      else if (cmd === 'bottom') b.style.top = `${Math.round(maxB - h)}px`;
    });
    showGroupButton(); showBounds(blocks);
  };

  const distributeSelection = (axis) => {
    const blocks = [...multi].filter((b) => b.offsetParent);
    if (blocks.length < 3) return;
    const c = (b) => axis === 'h' ? (b.offsetLeft + b.offsetWidth / 2) : (b.offsetTop + b.offsetHeight / 2);
    blocks.sort((a, b) => c(a) - c(b));
    const c0 = c(blocks[0]), c1 = c(blocks[blocks.length - 1]), step = (c1 - c0) / (blocks.length - 1);
    blocks.forEach((b, i) => {
      if (i === 0 || i === blocks.length - 1) return;
      const target = c0 + step * i;
      if (axis === 'h') b.style.left = `${Math.round(target - b.offsetWidth / 2)}px`;
      else b.style.top = `${Math.round(target - b.offsetHeight / 2)}px`;
    });
    showGroupButton(); showBounds(blocks);
  };

  const showGroupButton = () => {
    const blocks = [...multi];
    if (blocks.length < 2) { hideToolbar(); return; }
    let html = aBtn('align-left', 'left', 'Align left') + aBtn('align-cx', 'cx', 'Align centre') + aBtn('align-right', 'right', 'Align right')
      + `<span class="cs-group-toolbar__sep"></span>`
      + aBtn('align-top', 'top', 'Align top') + aBtn('align-cy', 'cy', 'Align middle') + aBtn('align-bottom', 'bottom', 'Align bottom');
    if (blocks.length >= 3) {
      html += `<span class="cs-group-toolbar__sep"></span>` + aBtn('dist-h', 'distH', 'Distribute horizontally') + aBtn('dist-v', 'distV', 'Distribute vertically');
    }
    html += `<span class="cs-group-toolbar__sep"></span>`
      + `<button type="button" class="cs-group-toolbar__btn" data-cs-group-action="group">&#x29C9; Group</button>`;
    placeToolbar(bboxOf(blocks), html);
  };

  // Show "Ungroup" when a single group (or a child inside a group) is selected.
  const refreshUngroupButton = () => {
    if (multi.size >= 2) return; // group button wins
    const sel = EM()?.getSelected?.();
    if (!sel) { hideToolbar(); return; }
    const isGroup = sel.classList.contains('cs-group-block');
    const inGroup = !isGroup && sel.closest('.cs-group-block');
    if (!isGroup && !inGroup) { hideToolbar(); return; }
    placeToolbar(sel.getBoundingClientRect(),
      `<button type="button" class="cs-group-toolbar__btn" data-cs-group-action="ungroup">&#x29C8; ${isGroup ? 'Ungroup' : 'Ungroup this'}</button>`,
      true);
  };

  const doGroup = () => {
    if (multi.size < 2) return;
    const group = FC.groupBlocks([...multi]);
    clearMulti();
    if (group) EM()?.select?.(group);
  };

  const doUngroup = () => {
    const sel = EM()?.getSelected?.();
    if (!sel) return;
    const isGroup = sel.classList.contains('cs-group-block');
    const inGroup = !isGroup && sel.closest('.cs-group-block');
    if (!isGroup && !inGroup) return;
    EM()?.clearAll?.();
    hideToolbar();
    if (isGroup) FC.ungroupBlocks(sel);
    else FC.ungroupOne(sel);
  };

  // Suppress the click that follows a multi-block drag so inline-editor doesn't
  // collapse the selection to a single block.
  let suppressClick = false;

  // Toolbar button clicks (capture phase, stop before inline-editor sees them).
  document.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; e.stopPropagation(); e.preventDefault(); return; }
    const btn = e.target.closest?.('[data-cs-group-action]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const act = btn.dataset.csGroupAction;
    if (act === 'group') doGroup();
    else if (act === 'ungroup') doUngroup();
    else if (act.indexOf('align-') === 0) alignSelection(act.slice(6));
    else if (act.indexOf('dist-') === 0) distributeSelection(act.slice(5));
  }, true);

  /* ---- drag the whole selection (marquee multi-select OR a group) ----
   * Becomes an ACTIVE drag only after the pointer moves past a small threshold,
   * so a clean press-release still reaches inline-editor as a click (needed to
   * drill into / select an inner block). No pointer capture is used — the
   * trailing click target stays intact, which is what makes drill-in work. */
  let drag = null;

  const snapshot = (blocks) => blocks.map((b) => ({
    block: b,
    left: b.style.left ? num(b.style.left) : b.offsetLeft,
    top: b.style.top ? num(b.style.top) : b.offsetTop,
  }));

  const beginPending = (e, blocks, kind) => {
    drag = { startX: e.clientX, startY: e.clientY, active: false, kind, items: snapshot(blocks) };
  };

  const pointInBox = (x, y, blocks) => {
    if (!blocks.length) return false;
    const r = bboxOf(blocks);
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };

  /* ---- marquee ---- */
  let band = null;
  let overlay = null;
  const drawOverlay = (x0, y0, x1, y1) => {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'cs-marquee';
      overlay.setAttribute('data-cs-chrome', '');
      document.body.appendChild(overlay);
    }
    overlay.style.display = 'block';
    overlay.style.position = 'fixed';
    overlay.style.zIndex = '10000';
    overlay.style.left = `${Math.min(x0, x1)}px`;
    overlay.style.top = `${Math.min(y0, y1)}px`;
    overlay.style.width = `${Math.abs(x1 - x0)}px`;
    overlay.style.height = `${Math.abs(y1 - y0)}px`;
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    // Ignore our chrome — except the badge move handle, which should still be
    // able to drag a selected group (handled by case 2 below).
    if (e.target.closest('[data-cs-chrome]') && !e.target.closest('[data-cs-move]')) return;

    const hitBlock = e.target.closest('.cs_block_s');
    const sel = EM()?.getSelected?.();
    const group = sel && sel.classList.contains('cs-group-block') ? sel : null;
    const cover = e.target.closest('[data-cs-cover="1"]');

    // (1) Drag a 2+ marquee selection — from any selected block OR from empty
    //     space inside the selection's bounding box.
    if (multi.size >= 2) {
      const onSelBlock = hitBlock && [...multi].some((b) => b === hitBlock || b.contains(e.target));
      const lockedHit = hitBlock && hitBlock.closest('[data-cs-locked="1"]');
      if (!lockedHit && (onSelBlock || (cover && pointInBox(e.clientX, e.clientY, [...multi])))) {
        beginPending(e, [...multi], 'multi');                         // threshold drag; click still drills/collapses
        return;
      }
    }

    // (2) Drag a selected GROUP from anywhere inside it (a clean click drills in).
    //     Locked groups aren't draggable (but stay clickable to drill in).
    if (group && group.dataset.csLocked !== '1' && (e.target === group || group.contains(e.target))) {
      beginPending(e, [group], 'group');
      return;
    }

    // (3) Pressed another block → inline-editor owns selection/move.
    if (hitBlock) { if (multi.size) clearMulti(); hideToolbar(); return; }

    // (4) Empty cover area → start a marquee.
    if (!cover) return;
    e.preventDefault();
    clearMulti();
    EM()?.clearAll?.();
    band = { cover, x0: e.clientX, y0: e.clientY };
    drawOverlay(e.clientX, e.clientY, e.clientX, e.clientY);
  };

  const onPointerMove = (e) => {
    if (drag) {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.active) {
        if (Math.abs(dx) <= 3 && Math.abs(dy) <= 3) return;           // below threshold: still a click
        drag.active = true;
        hideToolbar();
      }
      e.preventDefault();
      window.getSelection?.()?.removeAllRanges?.();                    // don't text-select while dragging
      drag.items.forEach(({ block, left, top }) => {
        block.style.left = `${left + dx}px`;
        block.style.top = `${top + dy}px`;
      });
      // Keep the selection box visible and following the drag (border stays on).
      if (drag.kind === 'multi') showBounds(drag.items.map((i) => i.block));
      return;
    }
    if (!band) return;
    drawOverlay(band.x0, band.y0, e.clientX, e.clientY);
    const box = {
      left: Math.min(band.x0, e.clientX), top: Math.min(band.y0, e.clientY),
      right: Math.max(band.x0, e.clientX), bottom: Math.max(band.y0, e.clientY),
    };
    const hits = coverChildBlocks(band.cover).filter((c) => {
      const r = c.getBoundingClientRect();
      return !(r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom);
    });
    setMulti(hits);
  };

  const onPointerUp = () => {
    if (drag) {
      const { active, kind, items } = drag;
      drag = null;
      if (active) {
        // A real drag — keep the selection; swallow the trailing click so
        // inline-editor doesn't collapse/re-select.
        suppressClick = true;
        if (kind === 'multi') { showBounds(items.map((i) => i.block)); showGroupButton(); }
        else requestAnimationFrame(refreshUngroupButton); // group moved → reposition Ungroup
      } else if (kind === 'multi') {
        // Plain click on a selected block → collapse to single-select; the
        // trailing click lands on inline-editor as usual.
        clearMulti();
      }
      // kind 'group' + no drag → do nothing; the trailing click drills into a child.
      return;
    }
    if (band) {
      band = null;
      if (overlay) overlay.style.display = 'none';
      // Only now (on release) draw the dotted bounding box + Group button.
      showBounds([...multi]);
      showGroupButton();
      return;
    }
    requestAnimationFrame(refreshUngroupButton); // selection may have changed via a block click
  };

  const onKeydown = (e) => {
    // Multi-select delete: Delete/Backspace removes every marquee-selected block.
    if ((e.key === 'Delete' || e.key === 'Backspace') && multi.size >= 1) {
      const ae = document.activeElement;
      if (ae && (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      const blocks = [...multi];
      clearMulti();
      const del = window.FlowCanvas?.deleteBlock || ((b) => b.remove());
      blocks.forEach((b) => del(b));
      return;
    }

    const g = (e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G');
    if (!g) return;
    if (e.shiftKey) {
      const sel = EM()?.getSelected?.();
      if (sel && (sel.classList.contains('cs-group-block') || sel.closest('.cs-group-block'))) {
        e.preventDefault();
        doUngroup();
      }
    } else if (multi.size >= 2) {
      e.preventDefault();
      doGroup();
    }
  };

  const init = () => {
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
    document.addEventListener('keydown', onKeydown);

    // Keep the Ungroup button in sync with inline-editor's selection changes.
    const surface = document.querySelector('.cs_paper') || document.querySelector('.custom-form-design');
    if (surface) {
      let scheduled = false;
      const obs = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; if (!band) refreshUngroupButton(); });
      });
      obs.observe(surface, { attributes: true, attributeFilter: ['class'], subtree: true });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
