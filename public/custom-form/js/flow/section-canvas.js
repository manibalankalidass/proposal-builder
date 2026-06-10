/**
 * @fileoverview Section content area — one-time migration.
 *
 * Sections used to render as absolute-positioning mini-canvases (every
 * dropped child got `position: absolute`). They now render as row/col
 * flow containers like the doc root, so the section height grows
 * naturally as content stretches (eg. a table picking up more rows
 * from a {% for %} loop). Drop placement is handled centrally in
 * `drop-zones.js` + `row-col-builder.js`.
 *
 * This file now only contains a startup migration: any old block left
 * over with `position: absolute` inside a section is rehomed into a
 * fresh row/col pair and stripped of its inline coordinates. Without
 * this, previously-saved documents would render with their old
 * absolute layout sticking out of the new flow box.
 *
 * Exposes:  window.FlowCanvas.migrateLegacySectionLayouts()
 */
(function () {
  window.FlowCanvas = window.FlowCanvas || {};

  const makeRow = () => {
    if (typeof window.FlowCanvas.makeRow === 'function') {
      return window.FlowCanvas.makeRow();
    }
    const row = document.createElement('div');
    row.className = 'cs-row';
    window.FlowCanvas.assignNodeId?.(row, 'row');
    return row;
  };
  const makeCol = () => {
    if (typeof window.FlowCanvas.makeCol === 'function') {
      return window.FlowCanvas.makeCol();
    }
    const col = document.createElement('div');
    col.className = 'cs-col';
    col.style.flex = '1 1 0';
    window.FlowCanvas.assignNodeId?.(col, 'col');
    return col;
  };

  const stripAbsolute = (block) => {
    block.style.position = '';
    block.style.left = '';
    block.style.top = '';
    block.style.width = '';
    block.style.maxWidth = '';
    delete block.dataset.csInSection;
  };

  window.FlowCanvas.migrateLegacySectionLayouts = function () {
    document.querySelectorAll('.section-container-content').forEach((section) => {
      // Clear any leftover minHeight/position from the absolute era — flow
      // layout sizes the section by content alone.
      section.style.position = '';
      section.style.minHeight = '';
      section.style.height = '';

      // The outer .cs_block_s wrapper used to store a fixed height back
      // when sections rendered as absolute mini-canvases (so the user's
      // last manual resize was preserved). With flow layout the wrapper
      // must size with its child rows — strip any inline height/min-
      // height so the table can push the section down naturally.
      const wrapper = section.closest('.cs_block_s');
      if (wrapper) {
        wrapper.style.height = '';
        wrapper.style.minHeight = '';
      }

      // Pull every legacy absolute child, sort by visual top so the
      // resulting flow preserves the user's vertical intent, then rebuild
      // as one block per row inside the section.
      const legacy = Array.from(section.children).filter((c) => {
        return c.classList?.contains('cs_block_s') &&
               (c.dataset?.csInSection === '1' || c.style?.position === 'absolute');
      });
      if (!legacy.length) return;

      legacy.sort((a, b) => (parseFloat(a.style.top) || 0) - (parseFloat(b.style.top) || 0));
      legacy.forEach((block) => {
        stripAbsolute(block);
        const row = makeRow();
        const col = makeCol();
        col.appendChild(block);
        row.appendChild(col);
        section.appendChild(row);
      });
    });
  };

  // Run once at startup; the cleanup observer (initCleanupObserver) handles
  // ongoing structural maintenance.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.FlowCanvas.migrateLegacySectionLayouts);
  } else {
    window.FlowCanvas.migrateLegacySectionLayouts();
  }
})();
