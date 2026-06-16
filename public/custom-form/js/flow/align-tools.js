/**
 * @fileoverview Align / Distribute toolbar for free-move blocks.
 *
 * Shows a floating toolbar when one or more FREE-MOVE blocks (on a cover page,
 * or absolutely-positioned section/flexible children) are selected:
 *   - single block  → align to the PAGE (left / centre / right / top / middle / bottom)
 *   - 2+ blocks     → align to the SELECTION's bounding box
 *   - 3+ blocks     → also distribute horizontally / vertically (equal spacing)
 *
 * Pairs with the live smart-guides in inline-editor.js (drag/resize snapping).
 * Flow blocks (auto-laid-out in rows/cols) are ignored — alignment is a
 * free-canvas concept. The toolbar is editor-only chrome (lives in <body>, so
 * it never exports).
 */
(function () {
  window.FlowCanvas = window.FlowCanvas || {};

  const isFree = (b) => !!(b && b.classList && b.classList.contains('cs_block_s') &&
    (b.dataset.csInSection === '1' || b.classList.contains('cs-flexible-block') ||
      (b.closest && b.closest('[data-cs-cover="1"]'))));

  const ICON = {
    left:  '<svg viewBox="0 0 16 16"><line x1="2" y1="1.5" x2="2" y2="14.5"/><rect x="3.5" y="4" width="9" height="3"/><rect x="3.5" y="9" width="6" height="3"/></svg>',
    cx:    '<svg viewBox="0 0 16 16"><line x1="8" y1="1.5" x2="8" y2="14.5"/><rect x="3" y="4" width="10" height="3"/><rect x="4.5" y="9" width="7" height="3"/></svg>',
    right: '<svg viewBox="0 0 16 16"><line x1="14" y1="1.5" x2="14" y2="14.5"/><rect x="3.5" y="4" width="9" height="3"/><rect x="6.5" y="9" width="6" height="3"/></svg>',
    top:   '<svg viewBox="0 0 16 16"><line x1="1.5" y1="2" x2="14.5" y2="2"/><rect x="4" y="3.5" width="3" height="9"/><rect x="9" y="3.5" width="3" height="6"/></svg>',
    cy:    '<svg viewBox="0 0 16 16"><line x1="1.5" y1="8" x2="14.5" y2="8"/><rect x="4" y="3" width="3" height="10"/><rect x="9" y="4.5" width="3" height="7"/></svg>',
    bottom:'<svg viewBox="0 0 16 16"><line x1="1.5" y1="14" x2="14.5" y2="14"/><rect x="4" y="3.5" width="3" height="9"/><rect x="9" y="6.5" width="3" height="6"/></svg>',
    distH: '<svg viewBox="0 0 16 16"><rect x="1" y="4" width="2.5" height="8"/><rect x="6.75" y="4" width="2.5" height="8"/><rect x="12.5" y="4" width="2.5" height="8"/></svg>',
    distV: '<svg viewBox="0 0 16 16"><rect x="4" y="1" width="8" height="2.5"/><rect x="4" y="6.75" width="8" height="2.5"/><rect x="4" y="12.5" width="8" height="2.5"/></svg>',
  };

  const GROUPS = [
    [['left', 'Align left'], ['cx', 'Align centre'], ['right', 'Align right']],
    [['top', 'Align top'], ['cy', 'Align middle'], ['bottom', 'Align bottom']],
    [['distH', 'Distribute horizontally'], ['distV', 'Distribute vertically']],
  ];

  let bar = null;
  let current = null;     // { mode: 'single'|'multi', blocks: [] }
  let rafId = 0;

  const ensureBar = () => {
    if (bar) return;
    bar = document.createElement('div');
    bar.className = 'cs-align-bar';
    bar.setAttribute('data-cs-chrome', '');
    bar.style.display = 'none';
    let html = '';
    GROUPS.forEach((g, gi) => {
      if (gi) html += '<span class="cs-align-bar__sep"></span>';
      g.forEach(([cmd, title]) => {
        html += `<button type="button" data-align="${cmd}" title="${title}">${ICON[cmd]}</button>`;
      });
    });
    bar.innerHTML = html;
    // Keep selection + caret; keep our clicks away from the editor's teardown.
    bar.addEventListener('mousedown', (e) => e.preventDefault(), true);
    bar.addEventListener('pointerdown', (e) => e.stopPropagation(), true);
    bar.addEventListener('click', (e) => {
      const cmd = e.target.closest('[data-align]')?.dataset.align;
      if (!cmd) return;
      e.preventDefault(); e.stopPropagation();
      if (cmd === 'distH') distribute('h');
      else if (cmd === 'distV') distribute('v');
      else doAlign(cmd);
    });
    document.body.appendChild(bar);
  };

  const selection = () => {
    const multi = (window.FlowCanvas.getMultiSelection ? window.FlowCanvas.getMultiSelection() : []).filter(isFree);
    if (multi.length >= 2) return { mode: 'multi', blocks: multi };
    const sel = window.EditorManager && window.EditorManager.getSelected && window.EditorManager.getSelected();
    if (isFree(sel)) return { mode: 'single', blocks: [sel] };
    return null;
  };

  const position = (blocks) => {
    if (!bar) return;
    let l = Infinity, t = Infinity, r = -Infinity;
    blocks.forEach((b) => { const c = b.getBoundingClientRect(); l = Math.min(l, c.left); t = Math.min(t, c.top); r = Math.max(r, c.right); });
    if (!isFinite(l)) return;
    bar.style.left = `${(l + r) / 2}px`;
    bar.style.top = `${Math.max(8, t - 46)}px`;
  };

  const update = () => {
    // Don't show mid-drag/resize (the bbox is moving); it reappears on release.
    if (window.EditorManager && window.EditorManager.isInteracting && window.EditorManager.isInteracting()) {
      if (bar) bar.style.display = 'none';
      return;
    }
    const s = selection();
    if (!s) { if (bar) bar.style.display = 'none'; current = null; return; }
    ensureBar();
    current = s;
    // Distribute only makes sense for 3+ blocks.
    const canDist = s.mode === 'multi' && s.blocks.length >= 3;
    bar.querySelectorAll('[data-align="distH"],[data-align="distV"]').forEach((b) => { b.style.display = canDist ? '' : 'none'; });
    bar.querySelectorAll('.cs-align-bar__sep').forEach((sep, i) => { if (i === 1) sep.style.display = canDist ? '' : 'none'; });
    position(s.blocks);
    bar.style.display = 'flex';
  };

  const scheduleUpdate = () => { if (rafId) return; rafId = requestAnimationFrame(() => { rafId = 0; update(); }); };

  /* -------------------------------- actions --------------------------------- */

  const doAlign = (cmd) => {
    if (!current) return;
    const blocks = current.blocks;
    const parent = blocks[0].offsetParent;
    if (!parent) return;
    let refL, refCX, refR, refT, refCY, refB;
    if (current.mode === 'single') {
      refL = 0; refR = parent.clientWidth; refCX = parent.clientWidth / 2;
      refT = 0; refB = parent.clientHeight; refCY = parent.clientHeight / 2;
    } else {
      let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
      blocks.forEach((b) => { minL = Math.min(minL, b.offsetLeft); minT = Math.min(minT, b.offsetTop); maxR = Math.max(maxR, b.offsetLeft + b.offsetWidth); maxB = Math.max(maxB, b.offsetTop + b.offsetHeight); });
      refL = minL; refR = maxR; refCX = (minL + maxR) / 2; refT = minT; refB = maxB; refCY = (minT + maxB) / 2;
    }
    blocks.forEach((b) => {
      const w = b.offsetWidth, h = b.offsetHeight;
      if (cmd === 'left') b.style.left = `${Math.round(refL)}px`;
      else if (cmd === 'cx') b.style.left = `${Math.round(refCX - w / 2)}px`;
      else if (cmd === 'right') b.style.left = `${Math.round(refR - w)}px`;
      else if (cmd === 'top') b.style.top = `${Math.round(refT)}px`;
      else if (cmd === 'cy') b.style.top = `${Math.round(refCY - h / 2)}px`;
      else if (cmd === 'bottom') b.style.top = `${Math.round(refB - h)}px`;
    });
    position(blocks);
  };

  const distribute = (axis) => {
    if (!current || current.blocks.length < 3) return;
    const blocks = current.blocks.slice();
    const c = (b) => axis === 'h' ? (b.offsetLeft + b.offsetWidth / 2) : (b.offsetTop + b.offsetHeight / 2);
    blocks.sort((a, b) => c(a) - c(b));
    const c0 = c(blocks[0]), c1 = c(blocks[blocks.length - 1]);
    const step = (c1 - c0) / (blocks.length - 1);
    blocks.forEach((b, i) => {
      if (i === 0 || i === blocks.length - 1) return;
      const target = c0 + step * i;
      if (axis === 'h') b.style.left = `${Math.round(target - b.offsetWidth / 2)}px`;
      else b.style.top = `${Math.round(target - b.offsetHeight / 2)}px`;
    });
    position(current.blocks);
  };

  /* --------------------------------- init ----------------------------------- */

  const init = () => {
    const root = document.querySelector('.cs_paper') || document.body;
    // Selection changes show up as class toggles (cs-selected / cs-multi-selected).
    new MutationObserver(scheduleUpdate).observe(root, { attributes: true, attributeFilter: ['class'], subtree: true });
    document.addEventListener('pointerup', scheduleUpdate, true);
    document.addEventListener('scroll', scheduleUpdate, true);
    window.addEventListener('resize', scheduleUpdate);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
