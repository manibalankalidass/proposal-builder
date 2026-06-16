/**
 * @fileoverview Column resize via draggable divider.
 *
 * Attaches pointer handlers to the canvas (capture phase, so they run before
 * inline-editor.js's bubble-phase handlers). Drag a .cs-line-divider to resize
 * the two adjacent columns; their combined width is preserved.
 *
 * Exposes:
 *   window.FlowCanvas.initColResize(canvas)
 */
(function () {
  window.FlowCanvas = window.FlowCanvas || {};

  const COL_MIN_WIDTH = (window.CanvasConfig?.column?.minWidth) ?? 60;

  window.FlowCanvas.initColResize = function (canvas) {
    let colResize = null;

    canvas.addEventListener('pointerdown', (event) => {
      const divider = event.target.closest?.('.cs-line-divider');
      if (!divider) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const prevCol = divider.previousElementSibling;
      const nextCol = divider.nextElementSibling;
      if (!prevCol || !nextCol || !prevCol.matches('.col-item') || !nextCol.matches('.col-item')) return;

      const prevRect = prevCol.getBoundingClientRect();
      const nextRect = nextCol.getBoundingClientRect();
      const totalWidth = prevRect.width + nextRect.width;
      const startX = event.clientX;
      const prevStartWidth = prevRect.width;

      const row = divider.closest('.row-item');
      if (row) {
        const cols = Array.from(row.querySelectorAll(':scope > .col-item'));
        cols.forEach(c => c.dataset.startWidth = c.getBoundingClientRect().width);
        cols.forEach(c => c.style.flex = `${c.dataset.startWidth} 0 0`);
      }

      divider.classList.add('cs-line-divider--active');
      try { divider.setPointerCapture?.(event.pointerId); } catch (e) { }

      colResize = { prevCol, nextCol, totalWidth, startX, prevStartWidth, divider, pointerId: event.pointerId };
    }, true);

    canvas.addEventListener('pointermove', (event) => {
      if (!colResize) return;
      const { prevCol, nextCol, totalWidth, startX, prevStartWidth } = colResize;
      const dx = event.clientX - startX;

      const prevW = Math.max(COL_MIN_WIDTH, Math.min(totalWidth - COL_MIN_WIDTH, prevStartWidth + dx));
      const nextW = totalWidth - prevW;

      prevCol.style.flex = `${prevW} 0 0`;
      nextCol.style.flex = `${nextW} 0 0`;
    }, true);

    const endResize = () => {
      if (!colResize) return;
      colResize.divider.classList.remove('cs-line-divider--active');
      try { colResize.divider.releasePointerCapture?.(colResize.pointerId); } catch (e) { }
      colResize = null;
    };
    canvas.addEventListener('pointerup', endResize, true);
    canvas.addEventListener('pointercancel', endResize, true);
  };
})();
