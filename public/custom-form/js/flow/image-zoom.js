/**
 * @fileoverview Zoom + pan for image blocks while they're being edited.
 *
 * When an image block is in edit mode (`.cs-image-block.cs-editing`):
 *   - Mouse wheel / trackpad scroll over the image zooms in/out, anchored to
 *     the pointer (focal zoom).
 *   - Once zoomed past 1x, dragging the image pans it within the block.
 *
 * The image stays clipped by `.image-container { overflow: hidden }`; we never
 * resize the block — we only scale/translate the <img> via a CSS transform.
 * State is written back to the <img> (inline `transform` + `data-cs-zoom/-pan-*`)
 * so it survives re-render, persists when editing stops, and serializes on
 * export (the inline style is cloned with the DOM).
 *
 * Exposes:
 *   window.FlowCanvas.initImageZoom(canvas)
 */
(function () {
  window.FlowCanvas = window.FlowCanvas || {};

  const MIN_ZOOM = 1;     // 1x = the default object-fit: cover framing
  const MAX_ZOOM = 5;     // hard cap so users can't lose the image entirely
  const ZOOM_STEP = 0.0015; // wheel delta → multiplicative zoom sensitivity

  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

  // Resolve the editable image under an event target, or null. Requires the
  // block to actually be in edit mode and to hold a real <img> (not the upload
  // placeholder button), so a fresh/empty image block is left alone.
  const resolveEditingImg = (target) => {
    const container = target?.closest?.('.image-container');
    if (!container) return null;
    const block = container.closest('.cs-image-block');
    if (!block || !block.classList.contains('cs-editing')) return null;
    const img = container.querySelector('img');
    if (!img) return null;
    return { block, container, img };
  };

  const readState = (img) => ({
    zoom: parseFloat(img.dataset.csZoom) || MIN_ZOOM,
    x: parseFloat(img.dataset.csPanX) || 0,
    y: parseFloat(img.dataset.csPanY) || 0,
  });

  // Clamp + write the transform. Pan is bounded so the scaled image always
  // keeps covering the container (no empty gaps at the edges). Returns the
  // values actually applied so callers can chain off the clamped result.
  const applyState = (img, container, next) => {
    const block = container.closest('.cs-image-block');
    const zoom = clamp(next.zoom, MIN_ZOOM, MAX_ZOOM);
    const rect = container.getBoundingClientRect();
    const maxX = (rect.width * (zoom - 1)) / 2;
    const maxY = (rect.height * (zoom - 1)) / 2;
    const x = clamp(next.x || 0, -maxX, maxX);
    const y = clamp(next.y || 0, -maxY, maxY);

    img.dataset.csZoom = zoom.toFixed(4);
    img.dataset.csPanX = x.toFixed(2);
    img.dataset.csPanY = y.toFixed(2);
    img.style.transformOrigin = 'center center';
    img.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    img.draggable = false; // kill the native image drag-ghost while interacting
    if (block) block.classList.toggle('cs-img-zoomed', zoom > MIN_ZOOM + 0.001);
    return { zoom, x, y };
  };

  // Re-apply (and re-clamp) the stored zoom/pan for a container's image. Called
  // after the frame shape changes, since a new shape can change the container's
  // size/aspect-ratio and therefore the valid pan range.
  window.FlowCanvas.refreshImageZoom = function (container) {
    const img = container?.querySelector?.('img');
    if (img) applyState(img, container, readState(img));
  };

  window.FlowCanvas.initImageZoom = function (canvas) {
    if (!canvas || canvas.dataset.imageZoomInit === '1') return;
    canvas.dataset.imageZoomInit = '1';

    /* ----------------------------- wheel = zoom ----------------------------- */
    const onWheel = (event) => {
      const ctx = resolveEditingImg(event.target);
      if (!ctx) return; // not over an editing image → let the page scroll
      event.preventDefault();
      event.stopPropagation();

      const { container, img } = ctx;
      const cur = applyState(img, container, readState(img)); // normalise first
      const rect = container.getBoundingClientRect();

      // Pointer offset from the container centre (the transform's origin).
      const u = event.clientX - (rect.left + rect.width / 2);
      const v = event.clientY - (rect.top + rect.height / 2);

      // The image-space point currently under the cursor — kept fixed so the
      // zoom grows/shrinks around the pointer instead of the centre.
      const focalX = (u - cur.x) / cur.zoom;
      const focalY = (v - cur.y) / cur.zoom;

      const factor = Math.exp(-event.deltaY * ZOOM_STEP);
      const zoom = clamp(cur.zoom * factor, MIN_ZOOM, MAX_ZOOM);

      applyState(img, container, {
        zoom,
        x: u - zoom * focalX,
        y: v - zoom * focalY,
      });
    };

    /* ------------------------------ drag = pan ------------------------------ */
    let pan = null;

    const onPointerDown = (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const ctx = resolveEditingImg(event.target);
      if (!ctx) return;
      const cur = applyState(ctx.img, ctx.container, readState(ctx.img));
      if (cur.zoom <= MIN_ZOOM + 0.001) return; // no room to pan until zoomed

      // Own the gesture: stop the inline-editor's block-move/resize handlers
      // from also reacting to this press.
      event.preventDefault();
      event.stopPropagation();

      pan = {
        block: ctx.block,
        img: ctx.img,
        container: ctx.container,
        startX: event.clientX,
        startY: event.clientY,
        baseX: cur.x,
        baseY: cur.y,
        pointerId: event.pointerId,
      };
      try { ctx.img.setPointerCapture(event.pointerId); } catch (e) { /* */ }
      ctx.block.classList.add('cs-img-panning');
    };

    const onPointerMove = (event) => {
      if (!pan) return;
      event.preventDefault();
      applyState(pan.img, pan.container, {
        zoom: readState(pan.img).zoom,
        x: pan.baseX + (event.clientX - pan.startX),
        y: pan.baseY + (event.clientY - pan.startY),
      });
    };

    const endPan = () => {
      if (!pan) return;
      try { pan.img.releasePointerCapture(pan.pointerId); } catch (e) { /* */ }
      pan.block.classList.remove('cs-img-panning');
      pan = null;
    };

    // Bind to the whole board (.cs_paper) — not just page 1's canvas — so image
    // zoom/pan also works for images on added pages and cover pages, which live
    // in their own sibling `.custom-form-design` wrappers.
    const board = canvas.closest('.cs_paper') || canvas;
    // wheel must be non-passive so preventDefault can stop page scroll.
    board.addEventListener('wheel', onWheel, { passive: false });
    // Capture phase so we claim the press before the block move/resize logic.
    board.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', endPan, true);
    document.addEventListener('pointercancel', endPan, true);
    // Belt-and-braces: suppress the browser's native image drag inside an
    // editing image (otherwise a pan can start a ghost-drag of the picture).
    board.addEventListener('dragstart', (event) => {
      if (resolveEditingImg(event.target)) event.preventDefault();
    }, true);
  };
})();
