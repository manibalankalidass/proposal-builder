/**
 * @fileoverview Pen Shape block — a Photoshop-style vector pen tool.
 *
 * A draggable block whose content is an SVG vector shape the user draws with a
 * pen tool. The drawing/editing only activates when the block is in EDIT mode
 * (the `.cs-editing` class added by inline-editor.js after the second click).
 *
 *   click  → selected (badge)          – no pen UI
 *   click again → editing (.cs-editing) – pen UI + anchor markers active
 *   click outside / Esc → deselect      – pen UI removed
 *
 * Pen behaviour (mirrors Photoshop's Pen tool):
 *   - click on empty canvas → add a corner anchor
 *   - click-and-drag        → add a smooth anchor (drag sets the bézier handles)
 *   - Alt while dragging     → break the handle (independent / corner-ish)
 *   - click the first anchor → close the path → switch to direct-select mode
 *   - drag an anchor         → move it (handles move with it)
 *   - drag a handle endpoint → reshape the curve (mirrored unless Alt held)
 *   - Alt-click an anchor     → convert corner ↔ smooth
 *   - Ctrl/Cmd+Z / Shift+Z   → step-by-step undo / redo (anchor markers redraw)
 *   - Delete / Backspace      → remove the selected (or last) anchor
 *   - Enter                   → close the path
 *
 * Extras: solid / gradient / image fill, rotate (whole path), and a
 * smooth/round-corners pass.
 *
 * The drawn shape is stored two ways so it survives HTML export + reload:
 *   - rendered  : <path d="…" fill="…"> inside the block's SVG (exported as-is)
 *   - editable  : block.dataset.penPath = JSON({paths:[{anchors,closed},…]}) so
 *                 re-editing can rebuild every sub-path exactly. Multiple
 *                 sub-paths let one block hold several separate clip-shapes.
 *
 * Exposes window.PenShape.createBlock() (called by the block factory).
 */
(function () {
  window.PenShape = window.PenShape || {};

  const NS = 'http://www.w3.org/2000/svg';
  // SVG user-space the path coords live in. The SVG stretches to fill the block
  // (preserveAspectRatio="none") so resizing the block scales the shape — coords
  // stay stable, which keeps editing math simple and export deterministic.
  const VB = 1000;
  const CX = VB / 2, CY = VB / 2;
  const HIT_PX = 9;          // pointer pick radius in screen px
  const DEFAULT_FILL = '#248567';

  const hash = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const ns = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); return el; };

  // Rotate a point by `deg` around the viewBox centre.
  const rot = (x, y, deg) => {
    if (!deg) return { x, y };
    const a = deg * Math.PI / 180, dx = x - CX, dy = y - CY;
    return { x: CX + dx * Math.cos(a) - dy * Math.sin(a), y: CY + dx * Math.sin(a) + dy * Math.cos(a) };
  };

  /* --------------------------- path serialisation --------------------------- */

  // One segment p→c: cubic bézier if either side carries a handle, else a line.
  const seg = (p, c) => {
    const hasOut = p.outX != null, hasIn = c.inX != null;
    if (hasOut || hasIn) {
      const c1x = hasOut ? p.outX : p.x, c1y = hasOut ? p.outY : p.y;
      const c2x = hasIn ? c.inX : c.x, c2y = hasIn ? c.inY : c.y;
      return ` C ${c1x} ${c1y} ${c2x} ${c2y} ${c.x} ${c.y}`;
    }
    return ` L ${c.x} ${c.y}`;
  };

  const buildSubD = (anchors, closed) => {
    if (!anchors.length) return '';
    let d = `M ${anchors[0].x} ${anchors[0].y}`;
    for (let i = 1; i < anchors.length; i++) d += seg(anchors[i - 1], anchors[i]);
    if (closed && anchors.length > 2) { d += seg(anchors[anchors.length - 1], anchors[0]); d += ' Z'; }
    return d;
  };

  // The block holds MANY independent sub-paths (state.paths), each drawn as its
  // own <path> with its own per-path style — see renderShape().

  /* ------------------------------ state / style ----------------------------- */

  const DEFAULT_STYLE = {
    fillType: 'solid', fill: DEFAULT_FILL, fillOpacity: 1,
    gradFrom: '#5c5cff', gradTo: '#a855f7', gradAngle: 90,
    gradKind: 'linear',   // 'linear' | 'radial'
    gradStops: null,      // optional [color, color, …] (evenly spaced); falls back to from/to
    imageSrc: '',
    stroke: '', strokeWidth: 0,
    rotate: 0,
    blend: 'normal',      // CSS mix-blend-mode for layered translucent shapes
  };

  // The colour stops for a gradient: an explicit gradStops list (≥2) wins,
  // else the legacy from/to pair. Offsets are spread evenly across 0→100%.
  const gradStopColors = (s) => (
    Array.isArray(s.gradStops) && s.gradStops.length >= 2
      ? s.gradStops.slice()
      : [s.gradFrom || '#5c5cff', s.gradTo || '#a855f7']
  );

  const readStyle = (block) => { try { return Object.assign({}, DEFAULT_STYLE, JSON.parse(block.dataset.penStyle)); } catch { return Object.assign({}, DEFAULT_STYLE); } };
  const writeStyle = (block, style) => { block.dataset.penStyle = JSON.stringify(style); };
  const readState = (block) => {
    try {
      const s = JSON.parse(block.dataset.penPath);
      if (s && Array.isArray(s.paths)) return s;
      if (s && Array.isArray(s.anchors)) return { paths: [{ anchors: s.anchors, closed: !!s.closed }] }; // migrate old single-path
    } catch { /* */ }
    return { paths: [] };
  };
  const writeState = (block, state) => { block.dataset.penPath = JSON.stringify(state); };

  const buildGradient = (id, s) => {
    let g;
    if (s.gradKind === 'radial') {
      g = ns('radialGradient', { id, 'data-pen-def': '', cx: 0.5, cy: 0.5, r: 0.5 });
    } else {
      const a = (s.gradAngle ?? 90) * Math.PI / 180;
      g = ns('linearGradient', {
        id, 'data-pen-def': '',
        x1: (0.5 - Math.cos(a) / 2), y1: (0.5 - Math.sin(a) / 2),
        x2: (0.5 + Math.cos(a) / 2), y2: (0.5 + Math.sin(a) / 2),
      });
    }
    const stops = gradStopColors(s), n = stops.length;
    stops.forEach((c, i) => g.appendChild(ns('stop', {
      offset: `${n > 1 ? (i / (n - 1)) * 100 : 0}%`, 'stop-color': c,
    })));
    return g;
  };

  const buildPattern = (id, s) => {
    const p = ns('pattern', { id, 'data-pen-def': '', patternUnits: 'userSpaceOnUse', width: VB, height: VB });
    const img = ns('image', { width: VB, height: VB, preserveAspectRatio: 'xMidYMid slice', href: s.imageSrc });
    img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', s.imageSrc); // legacy fallback
    p.appendChild(img);
    return p;
  };

  // A path's geometry rings. A normal shape is a single ring (its anchors); a
  // MERGED shape flattens several originals into `rings` (anchors stays empty).
  const ringsOf = (p) => (
    p && p.rings && p.rings.length ? p.rings : [{ anchors: p.anchors || [], closed: p.closed }]
  );

  // Resolve the effective style for one sub-path: its own per-path style when
  // present, else the block-level style (back-compat for shapes drawn before
  // per-path styling existed).
  const pathStyleOf = (p, blockStyle) => (
    p && p.style ? Object.assign({}, DEFAULT_STYLE, p.style) : blockStyle
  );

  // Render every sub-path as its OWN <path class="cs-pen-fill" data-pi="i">
  // element with its OWN fill/gradient/image/stroke/rotate. This is what lets
  // each clip-path carry a different colour/style. defs get per-path unique ids.
  const renderShape = (block) => {
    const svg = block.querySelector('.cs-pen-svg');
    if (!svg) return;
    const state = readState(block);
    const blockStyle = readStyle(block);
    const uid = (block.querySelector('.cs-pen-shape')?.id || 'pen');

    let defs = svg.querySelector('defs');
    if (!defs) { defs = ns('defs', {}); svg.insertBefore(defs, svg.firstChild); }
    defs.querySelectorAll('[data-pen-def]').forEach((e) => e.remove());
    svg.querySelectorAll('.cs-pen-fill').forEach((e) => e.remove());

    state.paths.forEach((p, i) => {
      if (p.hidden) return;
      const d = ringsOf(p).map((r) => buildSubD(r.anchors, r.closed)).filter(Boolean).join(' ');
      if (!d) return;
      const style = pathStyleOf(p, blockStyle);
      const pathEl = ns('path', { class: 'cs-pen-fill', 'data-pi': String(i) });

      let fill = style.fill || DEFAULT_FILL;
      if (style.fillType === 'gradient') { const id = `grad_${uid}_${i}`; defs.appendChild(buildGradient(id, style)); fill = `url(#${id})`; }
      else if (style.fillType === 'image' && style.imageSrc) { const id = `pat_${uid}_${i}`; defs.appendChild(buildPattern(id, style)); fill = `url(#${id})`; }

      pathEl.setAttribute('d', d);
      pathEl.setAttribute('fill', fill);
      pathEl.setAttribute('fill-opacity', style.fillOpacity ?? 1);
      if (style.stroke && (style.strokeWidth || 0) > 0) {
        pathEl.setAttribute('stroke', style.stroke);
        pathEl.setAttribute('stroke-width', style.strokeWidth);
        pathEl.setAttribute('vector-effect', 'non-scaling-stroke');
        pathEl.setAttribute('stroke-linejoin', 'round');
      }
      if (style.rotate) pathEl.setAttribute('transform', `rotate(${style.rotate} ${CX} ${CY})`);
      // Blend mode for layered translucent shapes (inline style → survives export).
      if (style.blend && style.blend !== 'normal') pathEl.style.mixBlendMode = style.blend;
      svg.appendChild(pathEl);
    });
  };

  /* ------------------------------ block factory ----------------------------- */

  // Start empty — the user draws their own shape(s) with the pen tool.
  const defaultState = () => ({ paths: [] });

  window.PenShape.createBlock = function () {
    const bc = (typeof BlockCreator !== 'undefined') ? new BlockCreator() : null;
    const block = bc ? bc.getCsBlockSmall('Pen Shape', 'cs-pen-shape-block')
      : Object.assign(document.createElement('div'), { className: 'cs_block_s cs-pen-shape-block' });
    block.dataset.blockType = 'pen-shape';
    block.setAttribute('custom-name', 'Pen Shape');

    const inner = document.createElement('div');
    inner.className = 'cs-pen-shape';
    inner.id = `pen_${hash()}`;

    const svg = ns('svg', { class: 'cs-pen-svg', viewBox: `0 0 ${VB} ${VB}`, preserveAspectRatio: 'none' });
    svg.appendChild(ns('path', { class: 'cs-pen-fill' }));
    inner.appendChild(svg);
    block.appendChild(inner);
    // Default height comes from CSS (.cs-pen-shape-block) so it survives
    // normalizeForFlow()'s inline-style strip on drop. A manual resize sets an
    // inline height that overrides the CSS default.

    writeState(block, defaultState());
    writeStyle(block, Object.assign({}, DEFAULT_STYLE));
    renderShape(block);
    return block;
  };

  /* ------------------------------ edit session ------------------------------ */
  // Only one block edits at a time (mirrors EditorManager). `S` holds its state.
  let S = null;
  // Module-level clip-path clipboard for copy/paste (persists across blocks).
  let penClip = null;

  const innerRect = () => S.inner.getBoundingClientRect();

  // viewBox coord → screen px (within the overlay), rotating by `deg` (defaults
  // to the active path's rotation S.rotate).
  const vbToPxR = (vx, vy, deg) => {
    const r = innerRect();
    const p = rot(vx, vy, deg);
    // Markers are drawn into the overlay SVG. In the page designer the overlay
    // is enlarged BEYOND the block (so points can be placed off-page), so its
    // top-left no longer matches the block's. Offset by that delta to keep the
    // anchor/handle markers aligned with the rendered shape. (inline blocks:
    // overlay === block → delta is 0, unchanged.)
    let ox = 0, oy = 0;
    if (S.overlay) { const o = S.overlay.getBoundingClientRect(); ox = r.left - o.left; oy = r.top - o.top; }
    return { x: ox + p.x / VB * r.width, y: oy + p.y / VB * r.height };
  };
  const vbToPx = (vx, vy) => vbToPxR(vx, vy, S.rotate);
  // client px → viewBox coord (un-rotated to the active path's model space).
  const clientToVb = (cx, cy) => {
    const r = innerRect();
    const raw = { x: (cx - r.left) / r.width * VB, y: (cy - r.top) / r.height * VB };
    return rot(raw.x, raw.y, -S.rotate);
  };
  // client px → viewBox coord WITHOUT un-rotating (true rendered position).
  // Used for picking which sub-path the pointer is over (each path may carry a
  // different rotation, so we test against each path's own rotated geometry).
  const clientToVbRaw = (cx, cy) => {
    const r = innerRect();
    return { x: (cx - r.left) / r.width * VB, y: (cy - r.top) / r.height * VB };
  };
  const hitVb = () => { const r = innerRect(); return HIT_PX / ((r.width + r.height) / 2) * VB; };

  const snapshot = () => { S.undo.push(clone(S.state)); if (S.undo.length > 100) S.undo.shift(); S.redo.length = 0; };

  const notifyBboxChange = () => { if (S && S.onBboxChange) S.onBboxChange(getActivePathBbox()); };
  const commit = () => { writeState(S.block, S.state); renderShape(S.block); drawOverlay(); renderLayers(); notifyBboxChange(); };

  // Index of the sub-path currently open (still being drawn), else the last
  // path (so edits/undo target something sensible).
  const openPathIndex = () => {
    if (!S) return -1;
    const i = S.state.paths.findIndex((p) => !p.closed);
    return i >= 0 ? i : S.state.paths.length - 1;
  };

  // Hit-test anchors/handles of the ACTIVE sub-path only. Selecting a different
  // sub-path is done separately (pickPath) so each clip-path is edited/styled in
  // isolation. Returns { type, p, i } (p = path index = activePath).
  const pick = (vb) => {
    const t = hitVb(), pi = S.activePath, path = S.state.paths[pi];
    if (!path) return null;
    if (S.sel && S.sel.p === pi) {
      const sp = path.anchors[S.sel.i];
      if (sp) {
        if (sp.inX != null && Math.hypot(sp.inX - vb.x, sp.inY - vb.y) <= t) return { type: 'in', p: pi, i: S.sel.i };
        if (sp.outX != null && Math.hypot(sp.outX - vb.x, sp.outY - vb.y) <= t) return { type: 'out', p: pi, i: S.sel.i };
      }
    }
    const a = path.anchors;
    for (let i = 0; i < a.length; i++) if (Math.hypot(a[i].x - vb.x, a[i].y - vb.y) <= t) return { type: 'anchor', p: pi, i };
    return null;
  };

  // Even-odd point-in-polygon, used to pick which sub-path the pointer is over.
  const pointInPolygon = (pt, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if (((a.y > pt.y) !== (b.y > pt.y)) &&
        (pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x)) inside = !inside;
    }
    return inside;
  };

  // Is the (un-rotated) pointer inside a sub-path's filled, rendered area?
  // Samples the béziers into a polygon and applies the path's own rotation so
  // the test matches what the user actually sees.
  const pointInPath = (vbRaw, path) => {
    if (!path) return false;
    const deg = (path.style && path.style.rotate) || 0;
    return ringsOf(path).some((r) => {
      if (!r.closed || r.anchors.length < 3) return false;
      const a = r.anchors, n = a.length, poly = [];
      for (let i = 0; i < n; i++) {
        const p = a[i], c = a[(i + 1) % n];
        for (let t = 0; t < 1; t += 0.1) { const s = sampleSeg(p, c, t); poly.push(rot(s.x, s.y, deg)); }
      }
      return pointInPolygon(vbRaw, poly);
    });
  };

  // Topmost sub-path (last drawn paints on top) whose fill the pointer is over.
  // Skips hidden + locked layers (those are only selectable from the panel).
  const pickPath = (vbRaw) => {
    for (let i = S.state.paths.length - 1; i >= 0; i--) {
      const p = S.state.paths[i];
      if (p.hidden || p.locked) continue;
      if (pointInPath(vbRaw, p)) return i;
    }
    return -1;
  };

  /* --------------------------- per-path style ------------------------------- */

  // The active sub-path's style (its own when set, else the block default).
  const getActiveStyle = () => {
    const p = S.state.paths[S.activePath];
    if (p && p.style) return Object.assign({}, DEFAULT_STYLE, p.style);
    return readStyle(S.block);
  };
  // Write the style onto the active sub-path AND remember it as the block
  // default so the NEXT new sub-path inherits it. Persist the per-path style to
  // dataset.penPath immediately — renderShape() re-reads from there, so without
  // this the colour wouldn't show until a later action flushed the state.
  const setActiveStyle = (style) => {
    const p = S.state.paths[S.activePath];
    if (p) p.style = style;
    writeStyle(S.block, style);
    writeState(S.block, S.state);
  };

  // Make `pi` the active sub-path: sync rotation + the toolbar style inputs to
  // it so the next edits affect that clip-path only.
  const selectPath = (pi) => {
    if (!S || pi < 0 || pi >= S.state.paths.length) return;
    S.activePath = pi;
    S.sel = null;
    const st = getActiveStyle();
    S.rotate = st.rotate || 0;
    writeStyle(S.block, st); // new paths inherit the selected path's look
    S.applyStyleValues?.();
    syncToolbar();
    notifyBboxChange();
  };

  const setSmooth = (p, ox, oy) => { p.outX = ox; p.outY = oy; p.inX = 2 * p.x - ox; p.inY = 2 * p.y - oy; };
  // Keep anchors inside the block — EXCEPT in the page designer (freeDraw), where
  // points may sit off-page (a one-page bleed margin each side) so the user can
  // design past the page edge. Off-page geometry simply clips to the page on save.
  const clampVb = (v) => (S && S.freeDraw)
    ? Math.max(-VB, Math.min(2 * VB, v))
    : Math.max(0, Math.min(VB, v));

  /* ------------------------------- pointer ops ------------------------------ */

  // Resize mode: re-show the block's resize handles (hidden during shape editing
  // so they don't cover the corner anchors) and stop the overlay from grabbing
  // pointer events meant for those handles.
  const setResizeMode = (on) => {
    if (!S) return;
    S.resizeMode = !!on;
    S.block.classList.toggle('cs-pen-resizing', S.resizeMode);
    S.sel = null;
    drawOverlay();
  };

  // Start a bbox-scale drag. corner = 'nw'|'ne'|'se'|'sw'|'n'|'s'|'e'|'w'.
  const startBboxScale = (corner, vb) => {
    const path = S.state.paths[S.activePath];
    if (!path) return;
    const bb = getActivePathBbox();
    if (!bb) return;
    snapshot();
    S.dragPivot = { cx: bb.x + bb.w / 2, cy: bb.y + bb.h / 2 };
    S.drag = { kind: 'bbox-scale', p: S.activePath, corner,
      origBb: { ...bb }, orig: clone(ringsOf(path)) };
    drawOverlay();
  };

  // Return which bbox handle (if any) the raw client point is over.
  const pickBboxHandle = (cx, cy) => {
    const el = S.ovSvg.querySelector(':hover') ||
      [...S.ovSvg.querySelectorAll('[data-bbox-handle]')].find((h) => {
        const r = h.getBoundingClientRect();
        return cx >= r.left - 4 && cx <= r.right + 4 && cy >= r.top - 4 && cy <= r.bottom + 4;
      });
    return el?.dataset?.bboxHandle || null;
  };

  const onDown = (e) => {
    if (!S || S.resizeMode) return; // let the block resize handles work
    e.preventDefault(); e.stopPropagation();
    S.overlay.setPointerCapture?.(e.pointerId);
    const vb = clientToVb(e.clientX, e.clientY);

    // Bbox scale handle check (only in scale mode) — before anchor pick so handles win.
    if (S.bboxScaleMode) {
      const bboxHit = pickBboxHandle(e.clientX, e.clientY);
      if (bboxHit) { startBboxScale(bboxHit, vb); return; }
    }

    // Space held → "move whole clip-path" override: a drag anywhere relocates the
    // active shape, even over an anchor/handle (works in pen AND edit mode).
    if (S.spaceHeld) { startShapeDrag(vb); return; }
    const hit = pick(vb);
    const alt = e.altKey;

    if (S.mode === 'pen') {
      const ap = S.state.paths[S.activePath];
      const open = ap && !ap.closed;

      if (open) {
        // --- drawing ---
        // close the active open sub-path by clicking its first anchor
        if (hit && hit.type === 'anchor' && hit.p === S.activePath && hit.i === 0 && ap.anchors.length > 2) {
          snapshot(); ap.closed = true; S.sel = null; S.penHover = null; commit(); return;
        }
        // grab an existing anchor/handle to tweak while drawing (drag = handle)
        if (hit) { if (hit.type === 'anchor') S.sel = { p: hit.p, i: hit.i }; startDrag(hit, vb); return; }
        // add the next point (smart-guide aligned)
        snapshot();
        { const s = alignSnap(snapV(vb.x), snapV(vb.y), null); ap.anchors.push({ x: clampVb(s.x), y: clampVb(s.y) }); }
        S.sel = { p: S.activePath, i: ap.anchors.length - 1 };
        S.drag = { kind: 'new', p: S.activePath, i: S.sel.i };
        commit();
        return;
      }

      // --- editing a COMPLETED shape with the pen ---
      // Drag a handle dot of the selected point → curve. Drag a point → MOVE it.
      // Alt-click a point → remove it (delete is Alt-gated). Click outline → ADD.
      if (ap && ap.closed) {
        // A handle (in/out) of the currently-selected anchor → reshape the curve.
        const hp = pick(vb);
        if (hp && (hp.type === 'in' || hp.type === 'out')) {
          S.sel = { p: hp.p, i: hp.i };
          startDrag(hp, vb);
          return;
        }
        const ai = hitAnchor(vb, ap);
        if (ai >= 0) {
          if (alt) {
            // Alt-click a point → remove it (so a stray click can't drop a point).
            snapshot();
            const path = S.state.paths[S.activePath];
            path.anchors.splice(ai, 1);
            if (path.anchors.length < 3) path.closed = false;
            S.sel = null; S.penHover = null; commit();
            return;
          }
          // No Alt → select the point and drag to MOVE it (a clean click just
          // selects, which reveals its handle dots — drag those to curve).
          snapshot();
          S.sel = { p: S.activePath, i: ai };
          S.penHover = null;
          S.drag = { kind: 'anchor', p: S.activePath, i: ai, ox: vb.x, oy: vb.y };
          drawOverlay();
          return;
        }
        const seg = findSegmentInsertion(vb, ap);
        if (seg) {
          snapshot();
          ap.anchors.splice(seg.i + 1, 0, { x: seg.pt.x, y: seg.pt.y });
          S.sel = { p: S.activePath, i: seg.i + 1 }; S.penHover = null; commit();
          return;
        }
      }
      // Over a DIFFERENT closed shape → select it (so its points become editable).
      const overPath = pickPath(clientToVbRaw(e.clientX, e.clientY));
      if (overPath >= 0) { S.selected?.clear(); selectPath(overPath); return; }
      // Empty space → start a BRAND-NEW shape (its own style copy).
      snapshot();
      const fp = alignSnap(snapV(vb.x), snapV(vb.y), null);
      const path = { anchors: [{ x: clampVb(fp.x), y: clampVb(fp.y) }], closed: false, name: nextPathName(), style: Object.assign({}, readStyle(S.block)) };
      S.state.paths.push(path); S.activePath = S.state.paths.length - 1;
      S.sel = { p: S.activePath, i: 0 };
      S.drag = { kind: 'new', p: S.activePath, i: 0 };
      S.penHover = null;
      commit();
      return;
    }

    // EDIT (direct-select) mode. A locked active layer can't be anchor-edited
    // or dragged (you can still select a DIFFERENT layer to switch away).
    const activeLocked = !!S.state.paths[S.activePath]?.locked;
    if (hit && !activeLocked) {
      if (hit.type === 'anchor' && alt) {
        snapshot();
        const p = S.state.paths[hit.p].anchors[hit.i];
        if (p.inX != null || p.outX != null) { delete p.inX; delete p.inY; delete p.outX; delete p.outY; }
        else setSmooth(p, p.x + 80, p.y);
        S.sel = { p: hit.p, i: hit.i }; commit(); return;
      }
      S.sel = { p: hit.p, i: hit.i };
      startDrag(hit, vb);
      return;
    }
    // MOVE (hand) tool — move ONLY (no point inserting; that's the pen's job):
    //   • over a DIFFERENT sub-path → select it
    //   • over the ACTIVE shape → drag the whole shape
    //   • empty space → deselect
    const vbRaw = clientToVbRaw(e.clientX, e.clientY);
    const overPath = pickPath(vbRaw);
    if (overPath >= 0 && overPath !== S.activePath) { S.selected?.clear(); selectPath(overPath); return; }
    if (overPath === S.activePath && !activeLocked) {
      startShapeDrag(vb);
      return;
    }
    S.sel = null; drawOverlay();
  };

  const startDrag = (hit, vb) => { snapshot(); S.drag = { kind: hit.type, p: hit.p, i: hit.i, ox: vb.x, oy: vb.y }; drawOverlay(); };

  const onMove = (e) => {
    if (!S) return;
    const vb = clientToVb(e.clientX, e.clientY);
    if (!S.drag) {
      const ap = S.state.paths[S.activePath];
      S.cursor = null; S.penHover = null; S.guides = null;
      if (S.mode === 'pen' && ap) {
        if (!ap.closed && ap.anchors.length) {
          const snap = alignSnap(snapV(vb.x), snapV(vb.y), null); // smart-guide the next point
          S.cursor = { x: clampVb(snap.x), y: clampVb(snap.y) };
        } else if (ap.closed) {
          // Hovering a completed shape: over a point, show the × REMOVE marker
          // ONLY while Alt is held (delete is Alt-gated) — without Alt the point
          // is draggable to curve it. Over the outline, show the + ADD marker.
          const ai = hitAnchor(vb, ap);
          if (ai >= 0) { if (e.altKey) S.penHover = { kind: 'remove', i: ai }; }
          else { const seg = findSegmentInsertion(vb, ap); if (seg) S.penHover = { kind: 'add', x: seg.pt.x, y: seg.pt.y }; }
        }
      }
      drawOverlay();
      return;
    }
    const d = S.drag, a = S.state.paths[d.p].anchors;
    if (d.kind === 'bbox-scale') {
      const ob = d.origBb;
      const corner = d.corner;
      const isN = corner.includes('n'), isS = corner.includes('s');
      const isW = corner.includes('w'), isE = corner.includes('e');
      const isCorner = (isN || isS) && (isE || isW);
      // How far the dragged handle moved from its original position.
      const origHx = isW ? ob.x : (isE ? ob.x + ob.w : ob.x + ob.w / 2);
      const origHy = isN ? ob.y : (isS ? ob.y + ob.h : ob.y + ob.h / 2);
      const dxDrag = vb.x - origHx, dyDrag = vb.y - origHy;
      // New size: only the relevant axes change.
      let newW = ob.w + (isE ? dxDrag : (isW ? -dxDrag : 0));
      let newH = ob.h + (isS ? dyDrag : (isN ? -dyDrag : 0));
      newW = Math.max(10, newW); newH = Math.max(10, newH);
      // Corner handles: always proportional (lock to axis that moved more).
      if (isCorner) {
        const ratio = ob.w / ob.h;
        if (newW / ob.w >= newH / ob.h) newH = newW / ratio; else newW = newH * ratio;
      }
      // Scale about bbox centre (stays fixed).
      const cx = ob.x + ob.w / 2, cy = ob.y + ob.h / 2;
      const sx = newW / ob.w, sy = newH / ob.h;
      const path = S.state.paths[d.p];
      const scaled = d.orig.map((r) => ({
        closed: r.closed,
        anchors: r.anchors.map((o) => {
          const na = { x: cx + (o.x - cx) * sx, y: cy + (o.y - cy) * sy };
          if (o.inX != null) { na.inX = cx + (o.inX - cx) * sx; na.inY = cy + (o.inY - cy) * sy; }
          if (o.outX != null) { na.outX = cx + (o.outX - cx) * sx; na.outY = cy + (o.outY - cy) * sy; }
          return na;
        }),
      }));
      if (path.rings && path.rings.length) path.rings = scaled;
      else { path.anchors = scaled[0].anchors; path.closed = scaled[0].closed; }
      writeState(S.block, S.state); renderShape(S.block); drawOverlay();
      return;
    }
    if (d.kind === 'shape') {
      // Translate every ring of the shape; snap the delta when snap is on.
      const dx = snapDelta(vb.x - d.ox), dy = snapDelta(vb.y - d.oy);
      const path = S.state.paths[d.p];
      const moved = d.orig.map((r) => ({
        closed: r.closed,
        anchors: r.anchors.map((o) => {
          const np = { x: o.x + dx, y: o.y + dy };
          if (o.inX != null) { np.inX = o.inX + dx; np.inY = o.inY + dy; }
          if (o.outX != null) { np.outX = o.outX + dx; np.outY = o.outY + dy; }
          return np;
        }),
      }));
      if (path.rings && path.rings.length) path.rings = moved;
      else { path.anchors = moved[0].anchors; path.closed = moved[0].closed; }
    } else if (d.kind === 'new') {
      const p = a[d.i];
      if (e.altKey) { p.outX = vb.x; p.outY = vb.y; } else setSmooth(p, vb.x, vb.y);
    } else if (d.kind === 'anchor') {
      const snap = alignSnap(snapV(vb.x), snapV(vb.y), { p: d.p, i: d.i });
      const p = a[d.i], nx = clampVb(snap.x), nyv = clampVb(snap.y), dx = nx - p.x, dy = nyv - p.y;
      p.x = nx; p.y = nyv;
      if (p.inX != null) { p.inX += dx; p.inY += dy; }
      if (p.outX != null) { p.outX += dx; p.outY += dy; }
    } else {
      const p = a[d.i];
      if (d.kind === 'out') { p.outX = vb.x; p.outY = vb.y; if (!e.altKey && p.inX != null) { p.inX = 2 * p.x - vb.x; p.inY = 2 * p.y - vb.y; } }
      else { p.inX = vb.x; p.inY = vb.y; if (!e.altKey && p.outX != null) { p.outX = 2 * p.x - vb.x; p.outY = 2 * p.y - vb.y; } }
    }
    writeState(S.block, S.state); renderShape(S.block); drawOverlay();
  };

  const onUp = () => {
    if (!S || !S.drag) return;
    // Pen-mode point delete is now immediate on Alt-click (onDown); a plain
    // click/drag here either moved the point or just selected it.
    S.drag = null;
    S.guides = null;
    commit();
  };

  const sampleSeg = (p, c, t) => {
    const hasOut = p.outX != null, hasIn = c.inX != null;
    if (!hasOut && !hasIn) return { x: p.x + (c.x - p.x) * t, y: p.y + (c.y - p.y) * t };
    const c1x = hasOut ? p.outX : p.x, c1y = hasOut ? p.outY : p.y;
    const c2x = hasIn ? c.inX : c.x, c2y = hasIn ? c.inY : c.y, u = 1 - t;
    return {
      x: u * u * u * p.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * c.x,
      y: u * u * u * p.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * c.y,
    };
  };

  // Index of an anchor of `path` under `vb`, or -1. Used by the pen tool's
  // hover add/remove affordances.
  const hitAnchor = (vb, path) => {
    if (!path) return -1;
    const t = hitVb();
    for (let i = 0; i < path.anchors.length; i++) {
      if (Math.hypot(path.anchors[i].x - vb.x, path.anchors[i].y - vb.y) <= t) return i;
    }
    return -1;
  };

  // The candidate insertion point on `path`'s outline nearest `vb` (within the
  // hit tolerance), or null. { i, pt } — insert after anchor i.
  const findSegmentInsertion = (vb, path) => {
    if (!path) return null;
    let best = null;
    const a = path.anchors, n = a.length;
    for (let i = 0; i < n; i++) {
      if (i === n - 1 && !path.closed) break;
      const p = a[i], c = a[(i + 1) % n];
      for (let t = 0.05; t < 1; t += 0.05) {
        const pt = sampleSeg(p, c, t), dist = Math.hypot(pt.x - vb.x, pt.y - vb.y);
        if (!best || dist < best.dist) best = { dist, i, pt };
      }
    }
    return (best && best.dist <= hitVb() * 1.8) ? best : null;
  };

  // Begin dragging the whole active shape (translate all its rings).
  const startShapeDrag = (vb) => {
    const path = S.state.paths[S.activePath];
    if (!path) return;
    snapshot();
    S.drag = { kind: 'shape', p: S.activePath, ox: vb.x, oy: vb.y, orig: clone(ringsOf(path)) };
    drawOverlay();
  };

  /* ------------------------------ overlay draw ------------------------------ */

  const drawOverlay = () => {
    if (!S) return;
    const r = innerRect(), ov = S.ovSvg;
    ov.setAttribute('width', r.width); ov.setAttribute('height', r.height);
    ov.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
    ov.replaceChildren();
    if (S.resizeMode) return; // box-resize mode: anchors hidden, handles drive
    const paths = S.state.paths;
    const ap = paths[S.activePath];
    // In scale mode: only show the bbox outline + scale handles, no anchor dots.
    const showMarks = S.mode !== 'edit' && !S.bboxScaleMode;

    // Smart alignment guides (full-bleed dashed lines through the snapped x / y).
    // Span the FULL overlay, not just the block: in the page designer the overlay
    // extends past the page, and vbToPx places markers relative to the overlay —
    // so a line drawn only 0..blockWidth would land shifted into the bleed margin.
    if (S.guides) {
      const orect = S.overlay ? S.overlay.getBoundingClientRect() : r;
      const ow = orect.width, oh = orect.height;
      if (S.guides.gx != null) { const gx = vbToPx(S.guides.gx, 0).x; ov.appendChild(ns('line', { x1: gx, y1: 0, x2: gx, y2: oh, class: 'cs-pen-guide' })); }
      if (S.guides.gy != null) { const gy = vbToPx(0, S.guides.gy).y; ov.appendChild(ns('line', { x1: 0, y1: gy, x2: ow, y2: gy, class: 'cs-pen-guide' })); }
    }

    // rubber-band preview from the active open path's last anchor to the cursor
    if (S.cursor && S.mode === 'pen' && ap && !ap.closed && ap.anchors.length) {
      const last = ap.anchors[ap.anchors.length - 1], p1 = vbToPx(last.x, last.y), p2 = vbToPx(S.cursor.x, S.cursor.y);
      ov.appendChild(ns('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, class: 'cs-pen-rubber' }));
    }
    // handles for the selected anchor
    if (showMarks && S.sel && paths[S.sel.p]?.anchors[S.sel.i]) {
      const p = paths[S.sel.p].anchors[S.sel.i], apx = vbToPx(p.x, p.y);
      [[p.inX, p.inY], [p.outX, p.outY]].forEach(([hx, hy]) => {
        if (hx == null) return;
        const hp = vbToPx(hx, hy);
        ov.appendChild(ns('line', { x1: apx.x, y1: apx.y, x2: hp.x, y2: hp.y, class: 'cs-pen-handle-line' }));
        ov.appendChild(ns('circle', { cx: hp.x, cy: hp.y, r: 4, class: 'cs-pen-handle' }));
      });
    }
    // anchors for every sub-path — drawn at each path's OWN rotation. Non-active
    // paths are dimmed so it's clear which clip-path the toolbar edits.
    if (showMarks) paths.forEach((path, pi) => {
      const active = pi === S.activePath;
      if (path.hidden && !active) return; // hidden layers show no anchors
      const deg = (path.style && path.style.rotate) || 0;
      path.anchors.forEach((p, i) => {
        const pp = vbToPxR(p.x, p.y, deg), size = active ? 8 : 6;
        const isSel = active && S.sel && S.sel.p === pi && S.sel.i === i;
        const isFirst = active && !path.closed && i === 0;
        const cls = 'cs-pen-anchor'
          + (isSel ? ' is-sel' : '')
          + (isFirst ? ' is-first' : '')
          + (active ? '' : ' is-dim');
        ov.appendChild(ns('rect', { x: pp.x - size / 2, y: pp.y - size / 2, width: size, height: size, class: cls }));
      });
    });

    // Bounding-box scale handles — 8 squares around the active closed path.
    // Dragging any handle scales the shape (proportional = corners, free = edges).
    if (S.bboxScaleMode && ap && ap.closed && ap.anchors.length >= 3 && !S.drag) {
      const bb = getActivePathBbox();
      if (bb && bb.w > 1 && bb.h > 1) {
        const tl = vbToPx(bb.x, bb.y), br = vbToPx(bb.x + bb.w, bb.y + bb.h);
        const mx = (tl.x + br.x) / 2, my = (tl.y + br.y) / 2;
        // Dashed bounding box outline.
        ov.appendChild(ns('rect', { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y,
          class: 'cs-pen-bbox-outline' }));
        const corners = new Set(['nw', 'ne', 'se', 'sw']);
        const handles = [
          { id: 'nw', x: tl.x, y: tl.y }, { id: 'n', x: mx, y: tl.y }, { id: 'ne', x: br.x, y: tl.y },
          { id: 'e',  x: br.x, y: my  },  { id: 'se', x: br.x, y: br.y },
          { id: 's',  x: mx,   y: br.y }, { id: 'sw', x: tl.x, y: br.y }, { id: 'w', x: tl.x, y: my  },
        ];
        const SZ = 8;
        handles.forEach(({ id, x, y }) => {
          const isCorner = corners.has(id);
          const attrs = { x: x - SZ / 2, y: y - SZ / 2, width: SZ, height: SZ,
            class: 'cs-pen-bbox-handle', 'data-bbox-handle': id };
          if (isCorner) { attrs.rx = SZ / 2; attrs.ry = SZ / 2; } // circle for corners
          ov.appendChild(ns('rect', attrs));
        });
      }
    }

    // Pen-tool hover affordances on a completed shape: + to add a point on the
    // outline, × to remove the point under the cursor.
    if (S.mode === 'pen' && S.penHover && !S.drag && ap) {
      const deg = (ap.style && ap.style.rotate) || 0;
      if (S.penHover.kind === 'add') {
        const c = vbToPxR(S.penHover.x, S.penHover.y, deg);
        ov.appendChild(ns('circle', { cx: c.x, cy: c.y, r: 8, class: 'cs-pen-add' }));
        ov.appendChild(ns('line', { x1: c.x - 4, y1: c.y, x2: c.x + 4, y2: c.y, class: 'cs-pen-add-mark' }));
        ov.appendChild(ns('line', { x1: c.x, y1: c.y - 4, x2: c.x, y2: c.y + 4, class: 'cs-pen-add-mark' }));
      } else if (S.penHover.kind === 'remove') {
        const an = ap.anchors[S.penHover.i];
        if (an) {
          const c = vbToPxR(an.x, an.y, deg);
          ov.appendChild(ns('circle', { cx: c.x, cy: c.y, r: 8, class: 'cs-pen-remove' }));
          ov.appendChild(ns('line', { x1: c.x - 4, y1: c.y - 4, x2: c.x + 4, y2: c.y + 4, class: 'cs-pen-remove-mark' }));
          ov.appendChild(ns('line', { x1: c.x - 4, y1: c.y + 4, x2: c.x + 4, y2: c.y - 4, class: 'cs-pen-remove-mark' }));
        }
      }
    }
  };

  /* ------------------------------- operations ------------------------------- */

  // --- preset geometry helpers (all in the 0..1000 viewBox, centred ~500,500) ---
  const poly = (pts) => ({ anchors: pts.map(([x, y]) => ({ x, y })), closed: true });
  // Regular n-gon. rot = angle of the first vertex (default top).
  const ngon = (n, R, rot) => {
    const cx = 500, cy = 500, a0 = (rot == null ? -Math.PI / 2 : rot), pts = [];
    for (let i = 0; i < n; i++) { const a = a0 + i * 2 * Math.PI / n; pts.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) }); }
    return { anchors: pts, closed: true };
  };
  // p-pointed star alternating outer R / inner r radius.
  const starPoly = (p, R, r) => {
    const cx = 500, cy = 500, a0 = -Math.PI / 2, pts = [];
    for (let i = 0; i < p * 2; i++) { const a = a0 + i * Math.PI / p; const rad = i % 2 ? r : R; pts.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) }); }
    return { anchors: pts, closed: true };
  };
  // Rounded rectangle via cubic-bézier corners.
  const roundedRect = (L, T, R, B, rr) => {
    const k = rr * 0.5523;
    return {
      closed: true, anchors: [
        { x: L + rr, y: T, inX: L + rr - k, inY: T },
        { x: R - rr, y: T, outX: R - rr + k, outY: T },
        { x: R, y: T + rr, inX: R, inY: T + rr - k },
        { x: R, y: B - rr, outX: R, outY: B - rr + k },
        { x: R - rr, y: B, inX: R - rr + k, inY: B },
        { x: L + rr, y: B, outX: L + rr - k, outY: B },
        { x: L, y: B - rr, inX: L, inY: B - rr + k },
        { x: L, y: T + rr, outX: L, outY: T + rr - k },
      ],
    };
  };

  const PRESETS = {
    rectangle: () => ({ anchors: [{ x: 80, y: 80 }, { x: 920, y: 80 }, { x: 920, y: 920 }, { x: 80, y: 920 }], closed: true }),
    square: () => poly([[140, 140], [860, 140], [860, 860], [140, 860]]),
    'rounded-rect': () => roundedRect(110, 180, 890, 820, 150),
    pill: () => roundedRect(90, 360, 910, 640, 140),
    triangle: () => ({ anchors: [{ x: 500, y: 80 }, { x: 920, y: 920 }, { x: 80, y: 920 }], closed: true }),
    'triangle-down': () => poly([[120, 120], [880, 120], [500, 880]]),
    'right-triangle': () => poly([[150, 140], [150, 860], [870, 860]]),
    diamond: () => poly([[500, 70], [930, 500], [500, 930], [70, 500]]),
    pentagon: () => ngon(5, 440),
    hexagon: () => {
      const pts = [], cx = 500, cy = 500, R = 440;
      for (let i = 0; i < 6; i++) { const ang = -Math.PI / 2 + i * Math.PI / 3; pts.push({ x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) }); }
      return { anchors: pts, closed: true };
    },
    heptagon: () => ngon(7, 440),
    octagon: () => ngon(8, 460, -Math.PI / 2 + Math.PI / 8),
    parallelogram: () => poly([[280, 200], [940, 200], [720, 800], [60, 800]]),
    trapezoid: () => poly([[300, 200], [700, 200], [900, 800], [100, 800]]),
    ellipse: () => {
      const k = 0.5523 * 420, cx = 500, cy = 500, rr = 420;
      return {
        anchors: [
          { x: cx, y: cy - rr, inX: cx - k, inY: cy - rr, outX: cx + k, outY: cy - rr },
          { x: cx + rr, y: cy, inX: cx + rr, inY: cy - k, outX: cx + rr, outY: cy + k },
          { x: cx, y: cy + rr, inX: cx + k, inY: cy + rr, outX: cx - k, outY: cy + rr },
          { x: cx - rr, y: cy, inX: cx - rr, inY: cy + k, outX: cx - rr, outY: cy - k },
        ], closed: true
      };
    },
    star: () => {
      const pts = [], cx = 500, cy = 510, R = 440, r = 180;
      for (let i = 0; i < 10; i++) { const ang = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r : R; pts.push({ x: cx + rad * Math.cos(ang), y: cy + rad * Math.sin(ang) }); }
      return { anchors: pts, closed: true };
    },
    'star-4': () => starPoly(4, 470, 150),
    'star-6': () => starPoly(6, 450, 210),
    'star-12': () => starPoly(12, 450, 330),
    burst: () => starPoly(16, 470, 380),
    'arrow-right': () => poly([[100, 360], [560, 360], [560, 200], [920, 500], [560, 800], [560, 640], [100, 640]]),
    'arrow-left': () => poly([[900, 360], [440, 360], [440, 200], [80, 500], [440, 800], [440, 640], [900, 640]]),
    'arrow-up': () => poly([[360, 900], [360, 440], [200, 440], [500, 80], [800, 440], [640, 440], [640, 900]]),
    'arrow-down': () => poly([[360, 100], [360, 560], [200, 560], [500, 920], [800, 560], [640, 560], [640, 100]]),
    'arrow-h': () => poly([[80, 500], [300, 300], [300, 420], [700, 420], [700, 300], [920, 500], [700, 700], [700, 580], [300, 580], [300, 700]]),
    'arrow-v': () => poly([[500, 80], [300, 300], [420, 300], [420, 700], [300, 700], [500, 920], [700, 700], [580, 700], [580, 300], [700, 300]]),
    chevron: () => poly([[120, 200], [520, 200], [900, 500], [520, 800], [120, 800], [500, 500]]),
    plus: () => poly([[380, 100], [620, 100], [620, 380], [900, 380], [900, 620], [620, 620], [620, 900], [380, 900], [380, 620], [100, 620], [100, 380], [380, 380]]),
    heart: () => ({
      closed: true, anchors: [
        { x: 500, y: 300 },                                                   // top centre dip (cusp)
        { x: 200, y: 0, inX: 400, inY: 0, outX: 0, outY: 0 },
        { x: 0, y: 250, outX: 0, outY: 400 },
        { x: 500, y: 760, inX: 250, inY: 600, outX: 750, outY: 600 },         // bottom tip
        { x: 1000, y: 250, inX: 1000, inY: 400 },
        { x: 800, y: 0, inX: 1000, inY: 0, outX: 600, outY: 0 },
      ],
    }),
    speech: () => poly([[120, 130], [880, 130], [880, 620], [430, 620], [290, 850], [300, 620], [120, 620]]),
    banner: () => poly([[100, 300], [900, 300], [780, 510], [900, 720], [100, 720], [220, 510]]),
    cloud: () => ({
      closed: true, anchors: [
        { x: 280, y: 720, inX: 160, inY: 690 },                          // bottom-left (flat bottom to next)
        { x: 720, y: 720, outX: 860, outY: 710 },                        // bottom-right
        { x: 840, y: 560, inX: 870, inY: 660, outX: 870, outY: 470 },    // right bump
        { x: 660, y: 420, inX: 800, inY: 420, outX: 700, outY: 360 },    // upper-right bump
        { x: 500, y: 380, inX: 610, inY: 330, outX: 390, outY: 330 },    // top bump
        { x: 340, y: 430, inX: 300, inY: 360, outX: 200, outY: 430 },    // upper-left bump
        { x: 160, y: 560, inX: 130, inY: 470, outX: 120, outY: 680 },    // left bump → closes to A0
      ],
    }),
    // Page-background shapes that bleed to the edges (great for invoices).
    corner: () => ({ anchors: [{ x: 0, y: 0 }, { x: 540, y: 0 }, { x: 0, y: 540 }], closed: true }),
    diagonal: () => ({ anchors: [{ x: 0, y: 260 }, { x: 1000, y: 0 }, { x: 1000, y: 260 }, { x: 0, y: 520 }], closed: true }),
    header: () => ({ anchors: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 170 }, { x: 0, y: 170 }], closed: true }),
    footer: () => ({ anchors: [{ x: 0, y: 830 }, { x: 1000, y: 830 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }], closed: true }),
  };

  // Basic shapes can be dropped at a chosen size; the edge-bleed background
  // presets keep their full-page layout.
  // Everything except the edge-bleed page backgrounds is sized to the W/H box.
  const SIZABLE_PRESETS = {
    rectangle: 1, square: 1, 'rounded-rect': 1, pill: 1, ellipse: 1,
    triangle: 1, 'triangle-down': 1, 'right-triangle': 1, diamond: 1,
    pentagon: 1, hexagon: 1, heptagon: 1, octagon: 1, parallelogram: 1, trapezoid: 1,
    star: 1, 'star-4': 1, 'star-6': 1, 'star-12': 1, burst: 1,
    'arrow-right': 1, 'arrow-left': 1, 'arrow-up': 1, 'arrow-down': 1,
    'arrow-h': 1, 'arrow-v': 1, chevron: 1, plus: 1, heart: 1, speech: 1, banner: 1, cloud: 1,
  };

  // Scale a ring's anchors (and handles) so its bounding box becomes w×h
  // (viewBox units), centred on the page.
  const fitAnchorsToBox = (anchors, w, h) => {
    if (!anchors.length) return;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    anchors.forEach((a) => { minx = Math.min(minx, a.x); maxx = Math.max(maxx, a.x); miny = Math.min(miny, a.y); maxy = Math.max(maxy, a.y); });
    const bw = (maxx - minx) || 1, bh = (maxy - miny) || 1;
    const sx = w / bw, sy = h / bh, ox = CX - w / 2, oy = CY - h / 2;
    const mapX = (x) => ox + (x - minx) * sx, mapY = (y) => oy + (y - miny) * sy;
    anchors.forEach((a) => {
      if (a.inX != null) { a.inX = mapX(a.inX); a.inY = mapY(a.inY); }
      if (a.outX != null) { a.outX = mapX(a.outX); a.outY = mapY(a.outY); }
      a.x = mapX(a.x); a.y = mapY(a.y);
    });
  };

  // A preset ADDS a new closed sub-path (so the user can stack several shapes),
  // with its OWN copy of the current style so it can be recoloured separately.
  // opts.w / opts.h (viewBox units) drop a sizable shape at that size, centred.
  const loadPreset = (name, opts) => {
    if (!S || !PRESETS[name]) return;
    snapshot();
    const path = PRESETS[name]();
    if (opts && opts.w > 0 && opts.h > 0 && SIZABLE_PRESETS[name]) {
      fitAnchorsToBox(path.anchors, Math.min(VB, opts.w), Math.min(VB, opts.h));
    }
    path.name = nextPathName();
    path.style = Object.assign({}, readStyle(S.block));
    S.state.paths.push(path);
    S.activePath = S.state.paths.length - 1;
    S.mode = 'edit'; S.sel = null; S.selected?.clear();
    S.rotate = (path.style.rotate) || 0;
    S.applyStyleValues?.();
    commit();
  };

  // Clicking the Pen tool finishes the current open shape so the next click on
  // empty canvas begins a brand-new sub-path.
  const startNewPath = () => {
    if (!S) return;
    const ap = S.state.paths[S.activePath];
    if (ap && !ap.closed && ap.anchors.length > 2) { snapshot(); ap.closed = true; }
    S.sel = null; commit();
  };

  const clearAllPaths = () => {
    if (!S) return;
    snapshot();
    S.state.paths = []; S.activePath = -1; S.mode = 'pen'; S.sel = null; S.selected?.clear();
    commit();
  };

  // Return the bounding box (in viewBox units) of the active path, or null.
  const getActivePathBbox = () => {
    const path = S && S.state.paths[S.activePath];
    if (!path) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    ringsOf(path).forEach((r) => r.anchors.forEach(({ x, y }) => {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }));
    if (!isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  };

  // Scale the active path so its bounding box becomes newW × newH (viewBox
  // units), keeping the bbox center in place.
  const scaleActivePath = (newW, newH) => {
    const path = S && S.state.paths[S.activePath];
    if (!path || path.locked) return;
    const bb = getActivePathBbox();
    if (!bb || bb.w < 1 || bb.h < 1) return;
    snapshot();
    const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
    const sx = newW / bb.w, sy = newH / bb.h;
    const mapPt = (x, y) => ({ x: cx + (x - cx) * sx, y: cy + (y - cy) * sy });
    ringsOf(path).forEach((r) => r.anchors.forEach((a) => {
      const mp = mapPt(a.x, a.y); a.x = mp.x; a.y = mp.y;
      if (a.inX != null) { const ip = mapPt(a.inX, a.inY); a.inX = ip.x; a.inY = ip.y; }
      if (a.outX != null) { const op = mapPt(a.outX, a.outY); a.outX = op.x; a.outY = op.y; }
    }));
    commit();
  };

  // Flip the ACTIVE sub-path only (all its rings), in isolation.
  const flip = (axis) => {
    if (!S) return;
    const path = S.state.paths[S.activePath];
    if (!path || path.locked) return;
    snapshot();
    const f = (v) => VB - v;
    ringsOf(path).forEach((r) => r.anchors.forEach((p) => {
      if (axis === 'h') { p.x = f(p.x); if (p.inX != null) p.inX = f(p.inX); if (p.outX != null) p.outX = f(p.outX); }
      else { p.y = f(p.y); if (p.inY != null) p.inY = f(p.inY); if (p.outY != null) p.outY = f(p.outY); }
    }));
    commit();
  };

  // Smooth / round corners on the ACTIVE sub-path: give every anchor symmetric
  // handles tangent to its neighbours (Catmull-Rom). Open-path endpoints stay
  // corners. Repeatable.
  // Give every anchor of `path` symmetric handles tangent to its neighbours
  // (Catmull-Rom). Open-path endpoints stay corners. No snapshot/commit — the
  // caller owns those.
  const smoothAnchors = (path) => {
    const k = 0.16;
    const a = path.anchors, n = a.length, closed = path.closed, next = [];
    for (let i = 0; i < n; i++) {
      const cur = a[i];
      if (!closed && (i === 0 || i === n - 1)) { next.push({ x: cur.x, y: cur.y }); continue; }
      const prev = a[(i - 1 + n) % n], nx = a[(i + 1) % n];
      const tx = nx.x - prev.x, ty = nx.y - prev.y;
      next.push({ x: cur.x, y: cur.y, outX: cur.x + tx * k, outY: cur.y + ty * k, inX: cur.x - tx * k, inY: cur.y - ty * k });
    }
    path.anchors = next;
  };

  // Smooth / round corners on the ACTIVE sub-path. Repeatable.
  const smoothAll = () => {
    if (!S) return;
    const path = S.state.paths[S.activePath];
    if (!path) return;
    snapshot();
    smoothAnchors(path);
    commit();
  };

  const deleteSelected = () => {
    if (!S) return;
    let sel = S.sel;
    if (!sel && S.mode === 'pen') { const ap = S.state.paths[S.activePath]; if (ap && ap.anchors.length) sel = { p: S.activePath, i: ap.anchors.length - 1 }; }
    const path = sel && S.state.paths[sel.p];
    if (!path || !path.anchors[sel.i]) return;
    snapshot();
    path.anchors.splice(sel.i, 1);
    if (path.anchors.length < 3) path.closed = false;
    if (path.anchors.length === 0) { S.state.paths.splice(sel.p, 1); S.activePath = openPathIndex(); }
    S.sel = null; commit();
  };

  const undo = () => { if (!S || !S.undo.length) return; S.redo.push(clone(S.state)); S.state = S.undo.pop(); S.sel = null; S.activePath = openPathIndex(); commit(); };
  const redo = () => { if (!S || !S.redo.length) return; S.undo.push(clone(S.state)); S.state = S.redo.pop(); S.sel = null; S.activePath = openPathIndex(); commit(); };

  /* -------------------------- shape management ------------------------------ */

  // A fresh "Shape N" name (N = highest existing number + 1) so names are stable
  // and don't renumber when layers are reordered.
  const nextPathName = () => {
    let max = 0;
    (S?.state.paths || []).forEach((p) => { const m = /(\d+)/.exec(p.name || ''); if (m) max = Math.max(max, +m[1]); });
    return `Shape ${max + 1}`;
  };

  // Duplicate the active sub-path (offset a little so it's visible) and select it.
  const offsetAnchors = (anchors, dx, dy) => anchors.forEach((a) => {
    a.x += dx; a.y += dy;
    if (a.inX != null) { a.inX += dx; a.inY += dy; }
    if (a.outX != null) { a.outX += dx; a.outY += dy; }
  });

  const duplicateActivePath = () => {
    if (!S) return;
    const p = S.state.paths[S.activePath];
    if (!p) return;
    snapshot();
    const copy = clone(p);
    copy.name = `${p.name || 'Shape'} copy`;
    offsetAnchors(copy.anchors, 40, 40);
    S.state.paths.push(copy);
    S.activePath = S.state.paths.length - 1;
    S.sel = null; S.selected?.clear(); commit();
  };

  // Copy / paste the ACTIVE sub-path. The clipboard is module-level, so a shape
  // copied in one block (or the page-shape designer) can be pasted into another.
  // Pasting selects the copy in edit mode so it can be moved / flipped right
  // away (e.g. copy the right-corner shape, paste, flip-H, drag to the left).
  const copyActivePath = () => {
    if (!S) return;
    const p = S.state.paths[S.activePath];
    if (p) penClip = clone(p);
  };

  const pastePath = () => {
    if (!S || !penClip) return;
    snapshot();
    const copy = clone(penClip);
    copy.name = `${penClip.name || 'Shape'} copy`;
    if (Array.isArray(copy.anchors)) offsetAnchors(copy.anchors, 40, 40);
    if (Array.isArray(copy.rings)) copy.rings.forEach((r) => offsetAnchors(r.anchors, 40, 40));
    S.state.paths.push(copy);
    S.activePath = S.state.paths.length - 1;
    S.mode = 'edit';
    S.sel = null; S.selected?.clear();
    commit();
  };

  // Delete the whole active sub-path (not just one anchor).
  const deleteActivePath = () => {
    if (!S || !S.state.paths[S.activePath]) return;
    snapshot();
    S.state.paths.splice(S.activePath, 1);
    S.activePath = Math.min(S.activePath, S.state.paths.length - 1);
    S.sel = null; S.selected?.clear(); commit();
  };

  // Z-order: later paths paint on top, so swap with the neighbour. dir +1 =
  // bring forward, -1 = send backward.
  const reorderActivePath = (dir) => {
    if (!S) return;
    const i = S.activePath, j = i + dir, arr = S.state.paths;
    if (i < 0 || j < 0 || j >= arr.length) return;
    snapshot();
    [arr[i], arr[j]] = [arr[j], arr[i]];
    S.activePath = j; commit();
  };

  /* ------------------------------ snapping ---------------------------------- */

  const SNAP_GRID = VB / 40;        // ~25 vb units
  const SNAP_EDGE_TOL = 18;         // snap-to-edge/centre tolerance
  // Snap a coordinate to the page edges / centre, else to the grid.
  const snapV = (v) => {
    if (!S || !S.snap) return v;
    for (const t of [0, CX, VB]) if (Math.abs(v - t) <= SNAP_EDGE_TOL) return t;
    return Math.round(v / SNAP_GRID) * SNAP_GRID;
  };
  // Snap a translation delta to the grid (for whole-shape moves).
  const snapDelta = (d) => (S && S.snap ? Math.round(d / SNAP_GRID) * SNAP_GRID : d);

  // Smart alignment guides: snap (x,y) to line up with ANY other anchor's x or
  // y (so edges come out straight and left/right points sit at the same height,
  // or share a width). Always on — it only engages within a small tolerance, so
  // free placement isn't disturbed. Records the guide lines in S.guides for the
  // overlay. `skip` = the anchor being moved (don't align to itself).
  const ALIGN_TOL = 2; // vb units — smaller = less "sticky" snapping to other anchors
  const alignSnap = (x, y, skip) => {
    let gx = null, gy = null, dx = ALIGN_TOL, dy = ALIGN_TOL;
    (S?.state.paths || []).forEach((path, pi) => {
      path.anchors.forEach((a, i) => {
        if (skip && skip.p === pi && skip.i === i) return;
        const ax = Math.abs(a.x - x); if (ax < dx) { dx = ax; gx = a.x; }
        const ay = Math.abs(a.y - y); if (ay < dy) { dy = ay; gy = a.y; }
      });
    });
    if (S) S.guides = (gx != null || gy != null) ? { gx, gy } : null;
    return { x: gx != null ? gx : x, y: gy != null ? gy : y };
  };

  /* ------------------------------ layers ------------------------------------ */

  const swatchOf = (st) => {
    const stops = gradStopColors(st);
    return st.fillType === 'gradient'
      ? `linear-gradient(135deg, ${stops[0]}, ${stops[stops.length - 1]})`
      : (st.fillType === 'image' ? '#9aa0ff' : (st.fill || DEFAULT_FILL));
  };

  // A mini SVG preview of a single sub-path (Photoshop-style layer thumbnail).
  const pathThumb = (p, st, uid) => {
    const svg = ns('svg', { viewBox: `0 0 ${VB} ${VB}`, class: 'cs-pen-layer-thumb__svg', preserveAspectRatio: 'xMidYMid meet' });
    const d = ringsOf(p).map((r) => buildSubD(r.anchors, r.closed)).filter(Boolean).join(' ');
    if (d) {
      const pe = ns('path', { d, 'fill-opacity': st.fillOpacity ?? 1 });
      if (st.fillType === 'gradient') {
        const defs = ns('defs', {}); const id = `lt_${uid}`; defs.appendChild(buildGradient(id, st)); svg.appendChild(defs);
        pe.setAttribute('fill', `url(#${id})`);
      } else { pe.setAttribute('fill', st.fillType === 'image' ? '#9aa0ff' : (st.fill || DEFAULT_FILL)); }
      if (st.rotate) pe.setAttribute('transform', `rotate(${st.rotate} ${CX} ${CY})`);
      svg.appendChild(pe);
    }
    return svg;
  };

  // Rebuild the compact toolbar chips AND, when a side panel is attached, the
  // full Photoshop-style layer list (top row = front-most). Drag a row to
  // reorder = change z-index.
  const renderLayers = () => {
    if (!S) return;
    // 1) Compact chips in the toolbar (used by the in-canvas block).
    if (S.layersEl) {
      S.layersEl.replaceChildren();
      S.state.paths.forEach((p, i) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'cs-pen-layer' + (i === S.activePath ? ' is-active' : '');
        chip.title = `Shape ${i + 1}`;
        const st = p.style ? Object.assign({}, DEFAULT_STYLE, p.style) : readStyle(S.block);
        chip.style.background = swatchOf(st);
        chip.addEventListener('click', (e) => { e.stopPropagation(); S.mode = 'edit'; selectPath(i); });
        S.layersEl.appendChild(chip);
      });
    }
    // 2) Rich side panel (used by the page-background designer modal).
    if (!S.panelEl) return;
    const panel = S.panelEl;
    panel.replaceChildren();
    const uidBase = (S.block.querySelector('.cs-pen-shape')?.id || 'pen');
    // Render front-to-back: last path paints on top → show it at the TOP.
    for (let i = S.state.paths.length - 1; i >= 0; i--) {
      const p = S.state.paths[i];
      const st = p.style ? Object.assign({}, DEFAULT_STYLE, p.style) : readStyle(S.block);
      const row = document.createElement('div');
      row.className = 'cs-pen-layer-row'
        + (i === S.activePath ? ' is-active' : '')
        + (S.selected && S.selected.has(i) ? ' is-multi' : '')
        + (p.hidden ? ' is-hidden' : '')
        + (p.locked ? ' is-locked' : '');
      row.draggable = !p.locked;
      row.dataset.pi = String(i);

      // const eye = document.createElement('button');
      // eye.type = 'button'; eye.className = 'cs-pen-layer-row__eye'; eye.title = 'Show / hide';
      // eye.textContent = p.hidden ? '🚫' : '👁';
      // eye.addEventListener('click', (e) => { e.stopPropagation(); snapshot(); p.hidden = !p.hidden; commit(); });

      const lock = document.createElement('button');
      lock.type = 'button'; lock.className = 'cs-pen-layer-row__eye'; lock.title = p.locked ? 'Unlock' : 'Lock';
      lock.textContent = p.locked ? '🔒' : '🔓';
      lock.addEventListener('click', (e) => { e.stopPropagation(); snapshot(); p.locked = !p.locked; commit(); });

      const thumbWrap = document.createElement('span');
      thumbWrap.className = 'cs-pen-layer-row__thumb';
      thumbWrap.appendChild(pathThumb(p, st, `${uidBase}_${i}`));

      const name = document.createElement('span');
      name.className = 'cs-pen-layer-row__name';
      name.textContent = p.name || `Shape ${i + 1}`;
      name.title = 'Rename (✎ or double-click)';

      // Inline rename. The row is draggable, which would otherwise swallow the
      // input's mousedown (can't type), so we turn drag off while editing.
      const startRename = () => {
        const input = document.createElement('input');
        input.className = 'cs-pen-layer-row__rename';
        input.value = p.name || `Shape ${i + 1}`;
        row.draggable = false;
        name.replaceWith(input);
        input.focus(); input.select();
        let done = false;
        const finish = (save) => {
          if (done) return; done = true;
          if (save) { const v = input.value.trim(); if (v) { p.name = v; writeState(S.block, S.state); } }
          renderLayers();
        };
        input.addEventListener('mousedown', (ev) => ev.stopPropagation());
        input.addEventListener('click', (ev) => ev.stopPropagation());
        input.addEventListener('blur', () => finish(true));
        input.addEventListener('keydown', (ev) => {
          ev.stopPropagation();
          if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
          else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
        });
      };
      name.addEventListener('dblclick', (e) => { e.stopPropagation(); startRename(); });

      const ren = document.createElement('button');
      ren.type = 'button'; ren.className = 'cs-pen-layer-row__act'; ren.title = 'Rename'; ren.textContent = '✎';
      ren.addEventListener('click', (e) => { e.stopPropagation(); startRename(); });

      const up = document.createElement('button');
      up.type = 'button'; up.className = 'cs-pen-layer-row__act'; up.title = 'Bring forward (up)'; up.textContent = '▲';
      up.disabled = i === S.state.paths.length - 1;
      up.addEventListener('click', (e) => { e.stopPropagation(); moveLayer(i, 1); });

      const down = document.createElement('button');
      down.type = 'button'; down.className = 'cs-pen-layer-row__act'; down.title = 'Send backward (down)'; down.textContent = '▼';
      down.disabled = i === 0;
      down.addEventListener('click', (e) => { e.stopPropagation(); moveLayer(i, -1); });

      const dup = document.createElement('button');
      dup.type = 'button'; dup.className = 'cs-pen-layer-row__act'; dup.title = 'Duplicate'; dup.textContent = '⧉';
      dup.addEventListener('click', (e) => { e.stopPropagation(); selectPath(i); duplicateActivePath(); syncToolbar(); });

      const del = document.createElement('button');
      del.type = 'button'; del.className = 'cs-pen-layer-row__act'; del.title = 'Delete'; del.textContent = '🗑';
      del.addEventListener('click', (e) => { e.stopPropagation(); selectPath(i); deleteActivePath(); syncToolbar(); });

      //incase if you need one more block append please add lock variable before showing hide/show icon 
      row.append(lock, thumbWrap, name, up, down, ren, dup, del);
      row.addEventListener('click', (e) => {
        S.mode = 'edit';
        if (e.ctrlKey || e.metaKey) {
          // Multi-select: keep the current active in the set, then toggle this.
          if (S.activePath >= 0) S.selected.add(S.activePath);
          if (S.selected.has(i)) S.selected.delete(i); else S.selected.add(i);
        } else {
          S.selected.clear();
        }
        selectPath(i);
      });

      // Drag-to-reorder (HTML5). dragstart stores the source path index.
      row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); row.classList.add('is-dragging'); });
      row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
      row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('is-drop'); });
      row.addEventListener('dragleave', () => row.classList.remove('is-drop'));
      row.addEventListener('drop', (e) => {
        e.preventDefault(); row.classList.remove('is-drop');
        const from = Number(e.dataTransfer.getData('text/plain'));
        const to = i;
        if (Number.isNaN(from) || from === to) return;
        reorderPathTo(from, to);
      });

      panel.appendChild(row);
    }
  };

  // Move sub-path at index `from` so it sits where `to` is (z-order change).
  const reorderPathTo = (from, to) => {
    if (!S) return;
    const arr = S.state.paths;
    if (from < 0 || from >= arr.length || to < 0 || to >= arr.length || from === to) return;
    snapshot();
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    S.activePath = arr.indexOf(moved);
    S.selected?.clear();
    commit(); syncToolbar();
  };

  // Nudge a layer one step up (dir +1 = bring forward) or down (-1 = backward).
  const moveLayer = (i, dir) => {
    if (!S) return;
    reorderPathTo(i, Math.max(0, Math.min(S.state.paths.length - 1, i + dir)));
  };

  /* ----------------------- multi-select / merge / lock ---------------------- */

  // The layers the next merge/lock acts on: the explicit multi-selection, or
  // just the active layer when nothing is multi-selected.
  const selectedIndices = () => {
    const set = S.selected && S.selected.size ? [...S.selected] : (S.activePath >= 0 ? [S.activePath] : []);
    return set.filter((i) => i >= 0 && i < S.state.paths.length).sort((a, b) => a - b);
  };

  // Flatten the selected layers into ONE layer (Photoshop "merge"). The merged
  // layer keeps the bottom-most selected layer's style/name; its geometry holds
  // every original ring (so it renders identically) but is no longer
  // anchor-editable — it can still be styled / moved / reordered as one unit.
  const mergeSelected = () => {
    if (!S) return;
    const idxs = selectedIndices();
    if (idxs.length < 2) return;
    snapshot();
    const paths = S.state.paths;
    const rings = [];
    idxs.forEach((i) => ringsOf(paths[i]).forEach((r) => rings.push(clone(r))));
    const host = paths[idxs[0]];
    const merged = {
      name: `${host.name || 'Shape'} (merged)`,
      closed: true, anchors: [], rings,
      style: clone(host.style || readStyle(S.block)),
    };
    for (let k = idxs.length - 1; k >= 0; k--) paths.splice(idxs[k], 1);
    paths.splice(idxs[0], 0, merged);
    S.activePath = idxs[0];
    S.selected.clear();
    commit(); syncToolbar();
  };

  // Toggle lock on the selected layers (lock prevents accidental edits).
  const toggleLockSelected = () => {
    if (!S) return;
    const idxs = selectedIndices();
    if (!idxs.length) return;
    snapshot();
    const lockAll = idxs.some((i) => !S.state.paths[i].locked);
    idxs.forEach((i) => { S.state.paths[i].locked = lockAll; });
    commit(); syncToolbar();
  };

  /* ------------------------------- toolbar ---------------------------------- */

  const TOOL_HTML = `
    <div class="cs-pen-toolbar">
      <div class="cs-pen-layers" data-pen-layers title="Shapes — click to select"></div>
      <span class="cs-pen-sep"></span>
      <button type="button" data-pen="pen"    title="Pen — draw a shape; on a finished shape hover an edge to add a point (+) or a point to remove it (×)">✒</button>
      <button type="button" data-pen="edit"   title="Move — drag points or the whole shape">✋</button>
      <button type="button" data-pen="scale"  title="Scale — drag corner/edge handles to resize shape">⤡</button>
      <button type="button" data-pen="snap"   title="Snap to grid / page edges">🧲</button>
      <button type="button" data-pen="smooth" title="Smooth / round corners">∿</button>
      <span class="cs-pen-sep"></span>
      <button type="button" data-pen="dup"    title="Duplicate shape">⧉</button>
      <button type="button" data-pen="del-shape" title="Delete this shape">✖</button>
      <button type="button" data-pen="fwd"    title="Bring forward">⤒</button>
      <button type="button" data-pen="back"   title="Send backward">⤓</button>
      <button type="button" data-pen="clear"  title="Clear all shapes">🗑</button>
      <span class="cs-pen-sep"></span>
      <button type="button" data-pen="preset-rectangle" title="Rectangle">▭</button>
      <button type="button" data-pen="preset-ellipse"   title="Ellipse">◯</button>
      <button type="button" data-pen="preset-triangle"  title="Triangle">△</button>
      <button type="button" data-pen="preset-star"      title="Star">★</button>
      <button type="button" data-pen="preset-hexagon"   title="Hexagon">⬡</button>
      <button type="button" data-pen="preset-corner"    title="Corner wedge">◣</button>
      <button type="button" data-pen="preset-diagonal"  title="Diagonal band">▰</button>
      <button type="button" data-pen="preset-header"    title="Header bar">▀</button>
      <button type="button" data-pen="preset-footer"    title="Footer bar">▄</button>
      <span class="cs-pen-sep"></span>
      <button type="button" data-pen="delete" title="Delete point (Del)">⛔</button>
      <button type="button" data-pen="undo"   title="Undo (Ctrl+Z)">↶</button>
      <button type="button" data-pen="redo"   title="Redo (Ctrl+Shift+Z)">↷</button>
      <div class="cs-pen-props" data-pen-props>
        <div class="cs-pen-props__group cs-pen-group--transform">
          <span class="cs-pen-props__label">Transform</span>
          <button type="button" data-pen="flip-h" title="Flip horizontal">⇆</button>
          <button type="button" data-pen="flip-v" title="Flip vertical">⇅</button>
          <label class="cs-pen-num" title="Rotate">↻<input type="range" min="0" max="360" step="1" data-pen="rotate"></label>
        </div>
        <div class="cs-pen-props__group cs-pen-group--fill">
          <span class="cs-pen-props__label">Fill</span>
          <select data-pen="fill-type" title="Fill type">
            <option value="solid">Solid</option>
            <option value="gradient">Gradient</option>
            <option value="image">Image</option>
          </select>
          <span class="cs-pen-fill-solid">
            <label class="cs-pen-swatch" title="Fill colour"><input type="color" data-pen="fill"></label>
          </span>
          <span class="cs-pen-fill-gradient">
            <select data-pen="grad-kind" title="Gradient type">
              <option value="linear">Linear</option>
              <option value="radial">Radial</option>
            </select>
            <span class="cs-pen-grad-stops" data-pen-stops></span>
            <button type="button" data-pen="stop-add" title="Add colour stop">＋</button>
            <button type="button" data-pen="stop-del" title="Remove colour stop">－</button>
            <label class="cs-pen-num" title="Angle">∠<input type="number" min="0" max="360" step="15" data-pen="grad-angle"></label>
          </span>
          <span class="cs-pen-fill-image">
            <button type="button" data-pen="image" title="Choose image">🖼 Image</button>
          </span>
        </div>
        <div class="cs-pen-props__group cs-pen-group--opacity">
          <span class="cs-pen-props__label">Opacity</span>
          <label class="cs-pen-num" title="Fill opacity (transparency)">◑<input type="range" min="0" max="1" step="0.05" data-pen="fill-opacity"></label>
          <select data-pen="blend" title="Blend mode">
            <option value="normal">Normal</option>
            <option value="multiply">Multiply</option>
            <option value="screen">Screen</option>
            <option value="overlay">Overlay</option>
            <option value="darken">Darken</option>
            <option value="lighten">Lighten</option>
          </select>
        </div>
        <div class="cs-pen-props__group cs-pen-group--stroke">
          <span class="cs-pen-props__label">Stroke</span>
          <label class="cs-pen-swatch" title="Stroke colour"><input type="color" data-pen="stroke"></label>
          <label class="cs-pen-num" title="Stroke width">W<input type="number" min="0" max="40" step="1" data-pen="stroke-width"></label>
        </div>
      </div>
    </div>`;

  const buildToolbar = () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = TOOL_HTML.trim();
    const bar = wrap.firstChild;
    // The style/transform controls live in a movable container so the modal can
    // relocate them into its right-hand panel (setLayersPanel's sibling).
    const propsEl = bar.querySelector('[data-pen-props]');
    S.propsEl = propsEl;
    const q = (sel) => propsEl.querySelector(sel);
    const set = (sel, v) => { const el = q(sel); if (el) el.value = v; };
    const stopsEl = q('[data-pen-stops]');
    S.layersEl = bar.querySelector('[data-pen-layers]');

    // Rebuild the gradient colour-stop swatches from the active style.
    const renderStops = () => {
      const cols = gradStopColors(getActiveStyle());
      stopsEl.replaceChildren();
      cols.forEach((c) => {
        const lbl = document.createElement('label');
        lbl.className = 'cs-pen-swatch';
        const inp = document.createElement('input');
        inp.type = 'color'; inp.dataset.pen = 'grad-stop'; inp.value = c;
        lbl.appendChild(inp);
        stopsEl.appendChild(lbl);
      });
    };

    // Push the ACTIVE sub-path's style into the toolbar inputs. Stored on S so
    // selecting another clip-path can refresh the controls to match it.
    const applyStyleValues = () => {
      const st = getActiveStyle();
      set('[data-pen="fill-type"]', st.fillType);
      set('[data-pen="fill"]', st.fill || DEFAULT_FILL);
      set('[data-pen="grad-kind"]', st.gradKind || 'linear');
      set('[data-pen="grad-angle"]', st.gradAngle);
      set('[data-pen="rotate"]', st.rotate || 0);
      set('[data-pen="fill-opacity"]', st.fillOpacity ?? 1);
      set('[data-pen="blend"]', st.blend || 'normal');
      set('[data-pen="stroke"]', st.stroke || '#000000');
      set('[data-pen="stroke-width"]', st.strokeWidth || 0);
      renderStops();
    };
    S.applyStyleValues = applyStyleValues;

    bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    propsEl.addEventListener('pointerdown', (e) => e.stopPropagation());

    // Tool actions live on the floating toolbar.
    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-pen]');
      if (!btn || !bar.contains(btn) || propsEl.contains(btn)) return;
      const cmd = btn.dataset.pen;
      if (cmd === 'pen') { setResizeMode(false); S.bboxScaleMode = false; S.mode = 'pen'; startNewPath(); }
      else if (cmd === 'edit') { setResizeMode(false); S.bboxScaleMode = false; S.mode = 'edit'; }
      else if (cmd === 'scale') { setResizeMode(false); S.bboxScaleMode = !S.bboxScaleMode; S.mode = 'edit'; }
      else if (cmd === 'resize') setResizeMode(!S.resizeMode);
      else if (cmd === 'snap') S.snap = !S.snap;
      else if (cmd === 'smooth') smoothAll();
      else if (cmd === 'clear') clearAllPaths();
      else if (cmd === 'dup') duplicateActivePath();
      else if (cmd === 'del-shape') deleteActivePath();
      else if (cmd === 'fwd') reorderActivePath(1);
      else if (cmd === 'back') reorderActivePath(-1);
      else if (cmd.startsWith('preset-')) loadPreset(cmd.slice(7));
      else if (cmd === 'delete') deleteSelected();
      else if (cmd === 'undo') undo();
      else if (cmd === 'redo') redo();
      else return;
      syncToolbar();
    });

    // Style / transform actions live on the (movable) props container.
    propsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-pen]');
      if (!btn) return;
      const cmd = btn.dataset.pen;
      if (cmd === 'flip-h') flip('h');
      else if (cmd === 'flip-v') flip('v');
      else if (cmd === 'image') pickImage();
      else if (cmd === 'stop-add') { const s = Object.assign({}, getActiveStyle()); const c = gradStopColors(s); c.push(c[c.length - 1]); s.gradStops = c; s.fillType = 'gradient'; setActiveStyle(s); renderShape(S.block); applyStyleValues(); }
      else if (cmd === 'stop-del') { const s = Object.assign({}, getActiveStyle()); const c = gradStopColors(s); if (c.length > 2) { c.pop(); s.gradStops = c; setActiveStyle(s); renderShape(S.block); applyStyleValues(); } }
      else return;
      syncToolbar();
    });

    const onStyle = () => {
      // Edit the ACTIVE sub-path's style (keeps the others untouched).
      const s = Object.assign({}, getActiveStyle());
      s.fillType = q('[data-pen="fill-type"]').value;
      s.fill = q('[data-pen="fill"]').value;
      s.gradKind = q('[data-pen="grad-kind"]').value;
      const stops = Array.from(propsEl.querySelectorAll('[data-pen="grad-stop"]')).map((i) => i.value);
      if (stops.length >= 2) { s.gradStops = stops; s.gradFrom = stops[0]; s.gradTo = stops[stops.length - 1]; }
      s.gradAngle = Number(q('[data-pen="grad-angle"]').value) || 0;
      s.rotate = Number(q('[data-pen="rotate"]').value) || 0;
      const fo = Number(q('[data-pen="fill-opacity"]').value);
      s.fillOpacity = isNaN(fo) ? 1 : fo;
      s.blend = q('[data-pen="blend"]').value;
      s.stroke = q('[data-pen="stroke"]').value;
      s.strokeWidth = Number(q('[data-pen="stroke-width"]').value) || 0;
      setActiveStyle(s);
      S.rotate = s.rotate;
      renderShape(S.block);
      updateFillControls();
      drawOverlay();
      renderLayers();
    };
    // Listeners on propsEl so they travel with it when moved to the side panel.
    // `input` updates live; `change` covers browsers whose colour dialog only
    // commits on close.
    propsEl.addEventListener('input', onStyle);
    propsEl.addEventListener('change', onStyle);

    applyStyleValues();
    renderLayers();
    return bar;
  };

  const updateFillControls = () => {
    if (!S || !S.propsEl) return;
    const p = S.propsEl;
    const t = p.querySelector('[data-pen="fill-type"]').value;
    p.querySelector('.cs-pen-fill-solid').style.display = (t === 'solid') ? '' : 'none';
    p.querySelector('.cs-pen-fill-gradient').style.display = (t === 'gradient') ? '' : 'none';
    p.querySelector('.cs-pen-fill-image').style.display = (t === 'image') ? '' : 'none';
    // Angle only matters for a linear gradient.
    const kind = p.querySelector('[data-pen="grad-kind"]').value;
    const angle = p.querySelector('[data-pen="grad-angle"]');
    if (angle?.parentElement) angle.parentElement.style.display = (kind === 'radial') ? 'none' : '';
  };

  const pickImage = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.addEventListener('change', () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const s = Object.assign({}, getActiveStyle());
        s.imageSrc = reader.result; s.fillType = 'image';
        setActiveStyle(s);
        const ft = S.propsEl?.querySelector('[data-pen="fill-type"]'); if (ft) ft.value = 'image';
        renderShape(S.block); updateFillControls();
      };
      reader.readAsDataURL(file);
    });
    inp.click();
  };

  const syncToolbar = () => {
    if (!S) return;
    S.toolbar.querySelectorAll('[data-pen="pen"],[data-pen="edit"],[data-pen="scale"],[data-pen="resize"],[data-pen="snap"]').forEach((b) => b.classList.remove('is-active'));
    if (S.resizeMode) S.toolbar.querySelector('[data-pen="resize"]')?.classList.add('is-active');
    else if (S.bboxScaleMode) S.toolbar.querySelector('[data-pen="scale"]')?.classList.add('is-active');
    else S.toolbar.querySelector(`[data-pen="${S.mode}"]`)?.classList.add('is-active');
    if (S.snap) S.toolbar.querySelector('[data-pen="snap"]')?.classList.add('is-active');
    // Keep the style controls + rotation in sync with whatever sub-path is now
    // active (e.g. after undo/redo/delete changed activePath).
    S.rotate = getActiveStyle().rotate || 0;
    S.applyStyleValues?.();
    updateFillControls();
    drawOverlay();
    renderLayers();
  };

  /* ------------------------------ keyboard ---------------------------------- */

  const onKey = (e) => {
    if (!S) return;
    // Don't hijack typing in form fields (rename input, stroke-width, etc.).
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
    // Hold Space → temporary "move whole clip-path" mode (drag relocates the
    // active shape). Swallow the key so the page/stage doesn't scroll.
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault(); e.stopPropagation();
      if (!S.spaceHeld) { S.spaceHeld = true; S.overlay?.classList.add('cs-pen-pan'); }
      return;
    }
    const z = (e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z');
    const y = (e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y');
    if (z) { e.preventDefault(); e.stopPropagation(); (e.shiftKey ? redo : undo)(); syncToolbar(); return; }
    if (y) { e.preventDefault(); e.stopPropagation(); redo(); syncToolbar(); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); e.stopPropagation(); copyActivePath(); return; }
    if (mod && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); e.stopPropagation(); pastePath(); syncToolbar(); return; }
    if (mod && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); e.stopPropagation(); duplicateActivePath(); syncToolbar(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault(); e.stopPropagation();
      // An anchor selected (or mid-draw) → delete just that point. Otherwise a
      // whole shape is selected → delete the entire shape (like the layer 🗑).
      if (S.sel || S.mode === 'pen') deleteSelected();
      else deleteActivePath();
      syncToolbar();
      return;
    }
    if (e.key === 'Enter' && S.mode === 'pen') {
      const ap = S.state.paths[S.activePath];
      if (ap && !ap.closed && ap.anchors.length > 2) { e.preventDefault(); e.stopPropagation(); snapshot(); ap.closed = true; commit(); syncToolbar(); }
      return;
    }
    // Arrow keys nudge the selected anchor, or the whole active shape if none
    // is selected. Shift = bigger step.
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault(); e.stopPropagation();
      const horiz = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
      const step = (e.shiftKey ? 20 : 4) * ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 1);
      const move = (a) => {
        if (horiz) { a.x += step; if (a.inX != null) a.inX += step; if (a.outX != null) a.outX += step; }
        else { a.y += step; if (a.inY != null) a.inY += step; if (a.outY != null) a.outY += step; }
      };
      snapshot();
      const selA = S.sel && S.state.paths[S.sel.p]?.anchors[S.sel.i];
      if (selA) move(selA);
      else { const p = S.state.paths[S.activePath]; if (p) p.anchors.forEach(move); }
      commit();
    }
  };

  // Releasing Space ends the temporary "move clip-path" mode.
  const onKeyUp = (e) => {
    if (!S) return;
    if (e.key === ' ' || e.code === 'Space') {
      S.spaceHeld = false;
      S.overlay?.classList.remove('cs-pen-pan');
    }
  };

  /* --------------------------- activate / deactivate ------------------------ */

  const activate = (block) => {
    if (S && S.block === block) return;
    if (S) deactivate();
    const inner = block.querySelector('.cs-pen-shape');
    if (!inner) return;

    const overlay = document.createElement('div');
    overlay.className = 'cs-pen-overlay';
    overlay.setAttribute('data-cs-chrome', '');
    const ovSvg = ns('svg', { class: 'cs-pen-overlay-svg' });
    overlay.appendChild(ovSvg);

    const state = readState(block);
    // Give any unnamed sub-path a stable name so the layers panel labels don't
    // renumber on reorder (older shapes were drawn before names existed).
    state.paths.forEach((p, i) => { if (!p.name) p.name = `Shape ${i + 1}`; });
    // Continue an open sub-path if one exists; else edit existing shapes; else
    // start fresh in pen mode.
    const openIdx = state.paths.findIndex((p) => !p.closed);
    const activePath = openIdx >= 0 ? openIdx : (state.paths.length - 1);
    const activeStyle = state.paths[activePath]?.style || readStyle(block);
    S = {
      block, inner, overlay, ovSvg, state, rotate: activeStyle.rotate || 0,
      mode: 'pen',
      // Page designer enlarges the overlay past the page → allow off-page points.
      freeDraw: block.classList.contains('cs-page-shape-block'),
      activePath,
      sel: null, drag: null, dragPivot: null, cursor: null, penHover: null, guides: null, resizeMode: false, bboxScaleMode: false, snap: false, spaceHeld: false, layersEl: null, panelEl: null, propsEl: null, selected: new Set(), undo: [], redo: []
    };
    S.toolbar = buildToolbar();
    overlay.appendChild(S.toolbar);
    inner.appendChild(overlay);

    overlay.addEventListener('pointerdown', onDown);
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerup', onUp);
    overlay.addEventListener('pointercancel', onUp);
    // Listen on the block's OWN document so shortcuts work even when the block
    // lives in the host document (the page-shape designer renders its modal at
    // the app root, outside this iframe).
    S.keyDoc = block.ownerDocument || document;
    S.keyDoc.addEventListener('keydown', onKey, true);
    S.keyDoc.addEventListener('keyup', onKeyUp, true);

    // inline-editor.js's attachChrome() runs removeChrome() ~2 frames after edit
    // mode starts, which deletes every [data-cs-chrome] — including our overlay.
    // Re-append it whenever it gets stripped while we're still editing.
    S.guard = new MutationObserver(() => {
      if (S && S.block === block && block.classList.contains('cs-editing') && !inner.contains(overlay)) {
        inner.appendChild(overlay);
        drawOverlay();
      }
    });
    S.guard.observe(inner, { childList: true });

    S.ro = new ResizeObserver(() => drawOverlay());
    S.ro.observe(inner);

    syncToolbar();
  };

  const deactivate = () => {
    if (!S) return;
    (S.keyDoc || document).removeEventListener('keydown', onKey, true);
    (S.keyDoc || document).removeEventListener('keyup', onKeyUp, true);
    S.guard?.disconnect();
    S.ro?.disconnect();
    S.overlay.remove();
    writeState(S.block, S.state);
    renderShape(S.block);
    S = null;
  };

  /* ------------------------- public engine surface -------------------------- */
  // Expose the reusable pen engine so other UIs (e.g. the full-page background
  // shape designer) can run the exact same drawing/editing session on any
  // block built by createBlock() — no code duplication.
  Object.assign(window.PenShape, {
    activate,            // activate(block) → start the pen session + toolbar overlay
    deactivate,          // deactivate()    → end the session, write state, render final
    renderShape,         // renderShape(block) → repaint <path>/<defs> from dataset
    readState, writeState,
    readStyle, writeStyle,
    clearAllPaths,       // clearAllPaths() → wipe the active session's shapes
    loadPreset,          // loadPreset(name) → add a preset shape (rectangle, corner, …)
    getActivePathBbox,   // → { x, y, w, h } viewBox units of the active path bbox
    scaleActivePath,     // scaleActivePath(newW, newH) → scale active path in-place
    // Register a callback fired after every commit + selectPath with the new bbox
    // (or null if no active path). Used by the page-shape designer to sync W/H inputs.
    onBboxChange: (fn) => { if (S) S.onBboxChange = fn; },
    mergeSelected,       // merge the multi-selected layers into one
    toggleLockSelected,  // lock / unlock the multi-selected layers
    getActiveBlock: () => (S ? S.block : null),
    // Attach (or detach with null) an external element to host the rich,
    // Photoshop-style layers panel. The engine fills + keeps it in sync.
    setLayersPanel: (el) => {
      if (!S) return;
      S.panelEl = el || null;
      S.toolbar?.classList.toggle('cs-pen-has-panel', !!el);
      renderLayers();
    },
    // Relocate the style/transform controls into an external host (the modal's
    // right-hand panel). They keep working because their listeners + queries are
    // bound to the props container itself, not the toolbar.
    setPropsPanel: (el) => {
      if (!S || !S.propsEl) return;
      if (el) { el.appendChild(S.propsEl); S.propsEl.classList.add('cs-pen-props--panel'); }
      else if (S.toolbar) { S.toolbar.appendChild(S.propsEl); S.propsEl.classList.remove('cs-pen-props--panel'); }
      S.toolbar?.classList.toggle('cs-pen-has-props-panel', !!el);
      updateFillControls();
    },
    VIEWBOX: VB,
  });

  /* --------------------------------- wiring --------------------------------- */
  const init = () => {
    // Watch the whole page board, not a single .custom-form-design: each cover
    // page is its OWN .custom-form-design surface (a sibling under .cs_paper),
    // so observing only the first one missed pen-shape blocks dropped on cover
    // pages — their cs-editing class change was never seen and activate() never
    // ran. .cs_paper contains every page (content wrappers + covers).
    const surface = document.querySelector('.cs_paper')
      || document.querySelector('.custom-form-design')
      || document.body;
    if (!surface) return;
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.attributeName !== 'class') continue;
        const el = m.target;
        if (!el.classList || el.dataset.blockType !== 'pen-shape') continue;
        if (el.classList.contains('cs-editing')) activate(el);
        else if (S && S.block === el) deactivate();
      }
    });
    obs.observe(surface, { attributes: true, attributeFilter: ['class'], subtree: true });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
