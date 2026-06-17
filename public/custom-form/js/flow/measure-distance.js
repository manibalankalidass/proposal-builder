/**
 * @fileoverview Figma-style distance measurement overlay.
 *
 * Select a free-move block, hold Ctrl (⌘ on Mac), then hover another free
 * block: an animated overlay draws the gap between the two blocks with px
 * labels — exactly like Figma's measure mode. The selected block gets a solid
 * outline (the reference), the hovered block a dashed marching-ants outline,
 * and the distance is rendered as red measurement lines + value badges.
 *
 * Smart geometry, per axis:
 *   • side-by-side  → one horizontal gap line
 *   • stacked       → one vertical gap line
 *   • diagonal      → both gaps + dotted extension lines (the classic case)
 *   • overlapping   → four edge-inset distances (left/right/top/bottom)
 *
 * Editor-only chrome: the overlay lives in <body> with data-cs-chrome and is
 * transient (only exists while measuring), so it never reaches export. Works
 * regardless of scroll/zoom because every render reads live getBoundingClientRect.
 *
 * Public API: window.MeasureDistance.{ enable, disable, isActive }.
 * Self-contained — injects its own CSS; the only host edit is the <script> tag.
 */
(function () {
  // Manager kill-switch (defaults on when the flag is absent).
  if (window.EditorFeatures && window.EditorFeatures.measureDistance === false) return;

  window.MeasureDistance = window.MeasureDistance || {};

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const TICK = 4;          // half-length of an end-cap tick (px)
  const MIN_EDGE = 1;      // ignore sub-pixel edge offsets in the overlap case
  // Styling lives in custom-form.css under the ".cs-measure" section.

  // ------------------------------------------------------------------ state
  const DWELL = 250;                       // ms the modifier must be held before
                                           // drawing — so Ctrl+C/V/D don't flash it
  let enabled = true;
  let armed = false;                       // modifier key held
  let dwellTimer = 0;                      // suppression window (0 = elapsed)
  let overlay = null, svg = null;          // DOM handles
  let lastSrc = null, lastTgt = null;      // currently drawn pair
  let raf = 0;
  const pointer = { x: 0, y: 0 };

  // ------------------------------------------------------------------ helpers
  const modifier = (e) => e.ctrlKey || e.metaKey;

  // Restrict to free-positioned blocks (cover page / section / flexible) — the
  // only place free-canvas distance is meaningful. Mirrors inline-editor's
  // isFreeFormBlock.
  const isFree = (b) => !!b && b.classList && b.classList.contains('cs_block_s') &&
    (b.dataset.csInSection === '1' ||
     b.classList.contains('cs-flexible-block') ||
     !!(b.closest && b.closest('[data-cs-cover="1"]')));

  const getSource = () => {
    const sel = (window.EditorManager && window.EditorManager.getSelected &&
      window.EditorManager.getSelected()) ||
      document.querySelector('.cs_block_s.cs-selected');
    return isFree(sel) ? sel : null;
  };

  const blockUnderPointer = (src) => {
    const el = document.elementFromPoint(pointer.x, pointer.y);
    const block = el && el.closest && el.closest('.cs_block_s');
    if (!block || block === src || !isFree(block)) return null;
    // Don't measure a block against its own ancestor/descendant — that's the
    // chrome of the same thing, not a sibling gap.
    if (src && (src.contains(block) || block.contains(src))) return null;
    return block;
  };

  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom,
      w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  };

  const busy = () => (window.EditorManager &&
    ((window.EditorManager.isInteracting && window.EditorManager.isInteracting()) ||
     (window.EditorManager.getEditing && window.EditorManager.getEditing())));

  // ------------------------------------------------------------------ drawing
  const line = (x1, y1, x2, y2, cls) => {
    const l = document.createElementNS(SVG_NS, 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('pathLength', '1');           // normalise so draw anim works at any length
    l.setAttribute('class', cls);
    svg.appendChild(l);
  };
  const rect = (r, cls) => {
    const el = document.createElementNS(SVG_NS, 'rect');
    el.setAttribute('x', r.left); el.setAttribute('y', r.top);
    el.setAttribute('width', Math.max(0, r.w)); el.setAttribute('height', Math.max(0, r.h));
    el.setAttribute('rx', '2'); el.setAttribute('class', cls);
    svg.appendChild(el);
  };
  const label = (x, y, value) => {
    const d = document.createElement('div');
    d.className = 'cs-measure__label';
    d.style.left = `${x}px`; d.style.top = `${y}px`;
    d.textContent = `${Math.round(value)}px`;
    overlay.appendChild(d);
  };

  // A measured span between two parallel edges, with caps and (when the line
  // overshoots a block) dotted extension lines anchoring it to that edge.
  const hMeasure = (x1, x2, yLine, aSpan, bSpan) => {
    line(x1, yLine, x2, yLine, 'cs-measure__line');
    line(x1, yLine - TICK, x1, yLine + TICK, 'cs-measure__cap');
    line(x2, yLine - TICK, x2, yLine + TICK, 'cs-measure__cap');
    // extension: if yLine sits outside a block's vertical span, dot it to the edge
    if (yLine < aSpan[0]) line(x1, aSpan[0], x1, yLine, 'cs-measure__ext');
    else if (yLine > aSpan[1]) line(x1, aSpan[1], x1, yLine, 'cs-measure__ext');
    if (yLine < bSpan[0]) line(x2, bSpan[0], x2, yLine, 'cs-measure__ext');
    else if (yLine > bSpan[1]) line(x2, bSpan[1], x2, yLine, 'cs-measure__ext');
    label((x1 + x2) / 2, yLine, x2 - x1);
  };
  const vMeasure = (y1, y2, xLine, aSpan, bSpan) => {
    line(xLine, y1, xLine, y2, 'cs-measure__line');
    line(xLine - TICK, y1, xLine + TICK, y1, 'cs-measure__cap');
    line(xLine - TICK, y2, xLine + TICK, y2, 'cs-measure__cap');
    if (xLine < aSpan[0]) line(aSpan[0], y1, xLine, y1, 'cs-measure__ext');
    else if (xLine > aSpan[1]) line(aSpan[1], y1, xLine, y1, 'cs-measure__ext');
    if (xLine < bSpan[0]) line(bSpan[0], y2, xLine, y2, 'cs-measure__ext');
    else if (xLine > bSpan[1]) line(bSpan[1], y2, xLine, y2, 'cs-measure__ext');
    label(xLine, (y1 + y2) / 2, y2 - y1);
  };

  const measure = (S, T) => {
    // horizontal relationship
    let hGap = null;                       // {x1,x2, aSpan,bSpan}
    if (T.left >= S.right) hGap = { x1: S.right, x2: T.left, aSpan: [S.top, S.bottom], bSpan: [T.top, T.bottom] };
    else if (T.right <= S.left) hGap = { x1: T.right, x2: S.left, aSpan: [T.top, T.bottom], bSpan: [S.top, S.bottom] };
    // vertical relationship. aSpan must be the horizontal span of the block that
    // owns y1, bSpan the one that owns y2 — so the dotted extension lines anchor
    // to the correct block. (When T is above S, y1 belongs to T, not S.)
    let vGap = null;                       // {y1,y2, aSpan,bSpan}
    if (T.top >= S.bottom) vGap = { y1: S.bottom, y2: T.top, aSpan: [S.left, S.right], bSpan: [T.left, T.right] };
    else if (T.bottom <= S.top) vGap = { y1: T.bottom, y2: S.top, aSpan: [T.left, T.right], bSpan: [S.left, S.right] };

    if (hGap) {
      const yOverlap = vGap ? null : [Math.max(S.top, T.top), Math.min(S.bottom, T.bottom)];
      const yLine = yOverlap ? (yOverlap[0] + yOverlap[1]) / 2 : S.cy;  // anchor to source when diagonal
      hMeasure(hGap.x1, hGap.x2, yLine, hGap.aSpan, hGap.bSpan);
    }
    if (vGap) {
      const xOverlap = hGap ? null : [Math.max(S.left, T.left), Math.min(S.right, T.right)];
      const xLine = xOverlap ? (xOverlap[0] + xOverlap[1]) / 2 : S.cx;
      vMeasure(vGap.y1, vGap.y2, xLine, vGap.aSpan, vGap.bSpan);
    }

    // Overlapping on both axes → show the four edge-inset distances.
    if (!hGap && !vGap) {
      const yMid = (Math.max(S.top, T.top) + Math.min(S.bottom, T.bottom)) / 2;
      const xMid = (Math.max(S.left, T.left) + Math.min(S.right, T.right)) / 2;
      if (Math.abs(T.left - S.left) >= MIN_EDGE)
        hMeasure(Math.min(S.left, T.left), Math.max(S.left, T.left), yMid, [S.top, S.bottom], [T.top, T.bottom]);
      if (Math.abs(T.right - S.right) >= MIN_EDGE)
        hMeasure(Math.min(S.right, T.right), Math.max(S.right, T.right), yMid, [S.top, S.bottom], [T.top, T.bottom]);
      if (Math.abs(T.top - S.top) >= MIN_EDGE)
        vMeasure(Math.min(S.top, T.top), Math.max(S.top, T.top), xMid, [S.left, S.right], [T.left, T.right]);
      if (Math.abs(T.bottom - S.bottom) >= MIN_EDGE)
        vMeasure(Math.min(S.bottom, T.bottom), Math.max(S.bottom, T.bottom), xMid, [S.left, S.right], [T.left, T.right]);
    }
  };

  // ------------------------------------------------------------------ overlay
  const ensureOverlay = () => {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'cs-measure';
    overlay.setAttribute('data-cs-chrome', '');
    svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'cs-measure__svg');
    overlay.appendChild(svg);
    document.body.appendChild(overlay);
  };
  const clear = () => {
    if (overlay) { overlay.remove(); overlay = null; svg = null; }
    lastSrc = lastTgt = null;
  };

  const arm = () => {
    if (armed) return;
    armed = true;
    if (dwellTimer) clearTimeout(dwellTimer);
    dwellTimer = setTimeout(() => { dwellTimer = 0; schedule(); }, DWELL);
  };
  const disarm = () => {
    armed = false;
    if (dwellTimer) { clearTimeout(dwellTimer); dwellTimer = 0; }
    clear();
  };

  const showHint = (src) => {
    clear();
    ensureOverlay();
    const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
    const hint = document.createElement('div');
    hint.className = 'cs-measure__hint';
    hint.style.left = `${pointer.x}px`; hint.style.top = `${pointer.y}px`;
    hint.innerHTML = `<b>${isMac ? '⌘' : 'Ctrl'}</b> · hover a block to measure`;
    overlay.appendChild(hint);
    lastSrc = src; lastTgt = 'hint';
  };

  // Full rebuild — only called when the measured pair changes (positions are
  // stable while merely hovering, so same-pair moves are a cheap no-op).
  const render = () => {
    raf = 0;
    if (!enabled || !armed) { clear(); return; }
    if (dwellTimer) return;                // still inside the suppression window
    if (busy()) { clear(); return; }
    const src = getSource();
    if (!src) { clear(); return; }
    const tgt = blockUnderPointer(src);

    if (!tgt) {
      if (lastSrc !== src || lastTgt !== 'hint') showHint(src);
      else if (overlay) {                  // keep hint glued to the cursor
        const h = overlay.querySelector('.cs-measure__hint');
        if (h) { h.style.left = `${pointer.x}px`; h.style.top = `${pointer.y}px`; }
      }
      return;
    }
    if (src === lastSrc && tgt === lastTgt) return;   // already drawn, geometry unchanged

    clear();
    ensureOverlay();
    const W = window.innerWidth, H = window.innerHeight;
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    const S = rectOf(src), T = rectOf(tgt);
    rect(S, 'cs-measure__box cs-measure__box--src');
    rect(T, 'cs-measure__box cs-measure__box--tgt');
    measure(S, T);
    lastSrc = src; lastTgt = tgt;
  };

  const schedule = () => { if (!raf) raf = requestAnimationFrame(render); };

  // ------------------------------------------------------------------ events
  const onKeyDown = (e) => {
    if (!enabled) return;
    if (e.key === 'Escape' && armed) { disarm(); return; }
    if (modifier(e)) arm();
  };
  const onKeyUp = (e) => {
    // Disarm only once no modifier remains held (releasing some other key while
    // Ctrl is still down must not tear the overlay down).
    if (armed && !modifier(e)) disarm();
  };
  const onMove = (e) => {
    pointer.x = e.clientX; pointer.y = e.clientY;
    if (!enabled) return;
    if (modifier(e)) { arm(); schedule(); }
    else if (armed) disarm();
  };
  const onScrollResize = () => { if (armed) { lastTgt = null; schedule(); } };
  const onBlur = () => { if (armed) disarm(); };
  const onDown = () => { if (armed) clear(); };   // a drag/click starts → get out of the way

  const init = () => {
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScrollResize, true);
    window.addEventListener('resize', onScrollResize, true);
    window.addEventListener('blur', onBlur);
  };

  Object.assign(window.MeasureDistance, {
    enable: () => { enabled = true; },
    disable: () => { enabled = false; armed = false; clear(); },
    isActive: () => !!overlay,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
