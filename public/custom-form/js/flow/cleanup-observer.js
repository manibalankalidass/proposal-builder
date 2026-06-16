/**
 * @fileoverview Auto-cleanup of empty columns and rows.
 *
 * When a block is removed (Delete key, postMessage, manual remove, etc.),
 * walk the document and:
 *   - Remove any column with no block content.
 *   - Redistribute remaining columns' flex so survivors reclaim the freed width.
 *   - Remove any row with no columns.
 *
 * Exposes:
 *   window.FlowCanvas.cleanupEmpty(doc)        — run cleanup pass (idempotent)
 *   window.FlowCanvas.initCleanupObserver(doc) — start watching for removals
 */
(function () {
  window.FlowCanvas = window.FlowCanvas || {};

  let running = false;

  const colHasContent = (col) => {
    return !!col.querySelector('.cs_block_s, .canvas-block');
  };

  // Clean every flow root in the tree: the doc itself plus each
  // .section-container-content (sections now act as nested flow
  // canvases, so they accumulate empty rows/cols the same way).
  const cleanupOneRoot = (root) => {
    let changed = false;
    const rows = Array.from(root.querySelectorAll(':scope > .row-item'));
    for (const row of rows) {
      if (row.matches('.cs-page-header, .cs-page-footer')) continue;

      const cols = Array.from(row.querySelectorAll(':scope > .col-item'));
      let removedAny = false;

      // Remove empty columns
      for (const col of cols) {
        if (!colHasContent(col)) {
          col.remove();
          removedAny = true;
          changed = true;
        }
      }

      // If columns were removed, rebuild dividers and flex layout
      if (removedAny) {
        window.FlowCanvas.rebuildDividers?.(row);
        window.FlowCanvas.resetColFlex?.(row);
      }

      // After cleanup, remove orphaned dividers (shouldn't happen but be safe)
      const remainingCols = row.querySelectorAll(':scope > .col-item');
      if (remainingCols.length === 0) {
        // No columns left - remove all dividers and the row
        row.querySelectorAll(':scope > .cs-line-divider').forEach(d => d.remove());
        row.remove();
        changed = true;
      } else if (removedAny) {
        // Double-check that divider count matches column count (n-1 dividers for n columns)
        const dividerCount = row.querySelectorAll(':scope > .cs-line-divider').length;
        const columnCount = remainingCols.length;
        const expectedDividerCount = Math.max(0, columnCount - 1);
        if (dividerCount !== expectedDividerCount) {
          // Divider count mismatch - rebuild again
          window.FlowCanvas.rebuildDividers?.(row);
          changed = true;
        }
      }
    }
    return changed;
  };

  const cleanupEmpty = (doc) => {
    if (running) return false;
    running = true;
    let changed = false;
    try {
      changed = cleanupOneRoot(doc) || changed;
      // Every flow root in the tree needs its own pass. Rows live directly
      // under a `.cs_margin` page wrapper, so when cleanup is invoked with the
      // canvas (`.custom-form-design`) as `doc` — as the Delete-key / badge
      // path does via getCanvas() — `cleanupOneRoot(doc)` finds no `:scope >
      // .row-item` and top-level empty columns would survive (showing the
      // "Drop block here" placeholder). Include `.cs_margin` here so that path
      // reaches them too. (When `doc` is already a `.cs_margin`, querySelectorAll
      // only matches descendants, so there's no double pass.)
      doc.querySelectorAll('.cs_margin, .body-main-content, .section-container-content').forEach((container) => {
        changed = cleanupOneRoot(container) || changed;
      });
    } finally {
      running = false;
    }
    return changed;
  };

  const initCleanupObserver = (doc) => {
    const observer = new MutationObserver((mutations) => {
      let blockRemoved = false;
      for (const m of mutations) {
        if (m.type !== 'childList') continue;
        for (const node of m.removedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches?.('.cs_block_s, .canvas-block') ||
            node.querySelector?.('.cs_block_s, .canvas-block')) {
            blockRemoved = true;
            break;
          }
        }
        if (blockRemoved) break;
      }
      if (blockRemoved) cleanupEmpty(doc);
    });
    observer.observe(doc, { childList: true, subtree: true });
    return observer;
  };

  Object.assign(window.FlowCanvas, {
    cleanupEmpty,
    initCleanupObserver,
  });
})();
