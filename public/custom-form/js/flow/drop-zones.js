/**
 * @fileoverview Drop-zone detection and visual indicator.
 *
 * Decides where a dragged block will land given the pointer position, and
 * shows a thin blue line indicating the drop target.
 *
 * Exposes:
 *   window.FlowCanvas.findDropTarget(doc, canvas, clientX, clientY) → { target, indicator } | null
 *   window.FlowCanvas.showIndicator(hint)
 *   window.FlowCanvas.hideIndicator()
 *
 * Drop target kinds:
 *   between-rows  — new row at gap
 *   col-edge      — new column inside an existing row
 *   in-col        — into an existing column (between blocks or empty col)
 *   in-section    — inside a section's content area (free placement)
 */
(function () {
  window.FlowCanvas = window.FlowCanvas || {};
  const cfg = (window.CanvasConfig && window.CanvasConfig.dropZone) || {};
  const ROW_EDGE_GAP = cfg.rowEdgeGap ?? 12;
  const COL_EDGE_GAP = cfg.colEdgeGap ?? 24;

  // A "free canvas" is any root that positions its children absolutely:
  // a flexible container, or a cover page (`.cs_page[data-cs-cover]`). Drops
  // into one are placed by cursor position, not woven into row/col flow.
  const isFreeCanvas = (el) =>
    !!el && (el.classList?.contains('cs-flexible-content') || el.matches?.('[data-cs-cover="1"]'));

  // ---------------------------------------------------------------------------
  // Section drop target — sections now act as nested row/col flow canvases
  // (same model as the document root). Returning null falls through to the
  // standard row/col logic, but with the section's content area passed in
  // as the scoped root via `findDropTargetIn`.
  //
  // Returns the innermost section content element under the cursor, or null
  // when the cursor isn't over any section.
  // ---------------------------------------------------------------------------
  const findSectionUnderCursor = (canvas, clientX, clientY) => {
    const sections = Array.from(canvas.querySelectorAll('.section-container-content, .cs-flexible-content'));
    // Walk in reverse so an inner section wins over an outer one when nested.
    for (let i = sections.length - 1; i >= 0; i--) {
      const section = sections[i];
      const rect = section.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right &&
        clientY >= rect.top && clientY <= rect.bottom) {
        return section;
      }
    }
    return null;
  };

  // ---------------------------------------------------------------------------
  // In-column target (between blocks or empty col)
  // ---------------------------------------------------------------------------
  const findInColTarget = (col, clientY) => {
    const blocks = Array.from(col.children).filter(c => !c.matches('.cs-line-divider'));
    const rect = col.getBoundingClientRect();

    if (blocks.length === 0) {
      return {
        target: { kind: 'in-col', col, beforeBlock: null },
        indicator: { type: 'horizontal', top: rect.top + rect.height / 2 - 1, left: rect.left, right: rect.right }
      };
    }

    for (let i = 0; i < blocks.length; i++) {
      const bRect = blocks[i].getBoundingClientRect();
      const mid = (bRect.top + bRect.bottom) / 2;
      if (clientY < mid) {
        return {
          target: { kind: 'in-col', col, beforeBlock: blocks[i] },
          indicator: { type: 'horizontal', top: bRect.top - 3, left: rect.left, right: rect.right }
        };
      }
    }

    const lastRect = blocks[blocks.length - 1].getBoundingClientRect();
    return {
      target: { kind: 'in-col', col, beforeBlock: null },
      indicator: { type: 'horizontal', top: lastRect.bottom + 1, left: rect.left, right: rect.right }
    };
  };

  // ---------------------------------------------------------------------------
  // Column-level routing inside a row
  // ---------------------------------------------------------------------------
  const findColTarget = (row, clientX, clientY) => {
    const cols = Array.from(row.querySelectorAll(':scope > .col-item'));
    if (cols.length === 0) {
      const rect = row.getBoundingClientRect();
      return {
        target: { kind: 'col-edge', row, beforeCol: null },
        indicator: { type: 'vertical', left: rect.left, top: rect.top, bottom: rect.bottom }
      };
    }

    const firstRect = cols[0].getBoundingClientRect();
    if (clientX < firstRect.left + COL_EDGE_GAP) {
      return {
        target: { kind: 'col-edge', row, beforeCol: cols[0] },
        indicator: { type: 'vertical', left: firstRect.left - 4, top: firstRect.top, bottom: firstRect.bottom }
      };
    }

    const lastRect = cols[cols.length - 1].getBoundingClientRect();
    if (clientX > lastRect.right - COL_EDGE_GAP) {
      return {
        target: { kind: 'col-edge', row, beforeCol: null },
        indicator: { type: 'vertical', left: lastRect.right + 1, top: lastRect.top, bottom: lastRect.bottom }
      };
    }

    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      const rect = col.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) {
        if (i < cols.length - 1) {
          const nextRect = cols[i + 1].getBoundingClientRect();
          if (clientX > rect.right - COL_EDGE_GAP && clientX < nextRect.left + COL_EDGE_GAP) {
            return {
              target: { kind: 'col-edge', row, beforeCol: cols[i + 1] },
              indicator: { type: 'vertical', left: (rect.right + nextRect.left) / 2 - 1, top: rect.top, bottom: rect.bottom }
            };
          }
        }
        return findInColTarget(col, clientY);
      }
    }
    return findInColTarget(cols[cols.length - 1], clientY);
  };

  // ---------------------------------------------------------------------------
  // Top-level: row-level routing
  //
  // When the cursor is over a section's content area we treat that area as
  // a nested doc: same row/col flow detection, just scoped to the section.
  // The dropped block becomes a real child of the section's row tree, so
  // the section's height grows with content (no more absolute positioning
  // that left tables hanging outside the section's box).
  // ---------------------------------------------------------------------------
  const findDropTarget = (doc, canvas, clientX, clientY, blockType) => {
    const section = findSectionUnderCursor(canvas, clientX, clientY);
    let root = section || doc;
    let isHeaderFooter = false;

    if (!section && root.classList.contains('cs_margin')) {
      // Check if cursor is over header or footer
      const header = root.querySelector(':scope > .cs-page-header');
      const footer = root.querySelector(':scope > .cs-page-footer');
      const main = root.querySelector(':scope > .body-main-content');

      if (header) {
        const headerRect = header.getBoundingClientRect();
        if (clientY >= headerRect.top && clientY <= headerRect.bottom) {
          root = header;
          isHeaderFooter = true;
        } else if (footer) {
          const footerRect = footer.getBoundingClientRect();
          if (clientY >= footerRect.top && clientY <= footerRect.bottom) {
            root = footer;
            isHeaderFooter = true;
          } else if (main) {
            root = main;
          }
        } else if (main) {
          root = main;
        }
      } else if (main) {
        root = main;
      }
    }

    // Header/footer are themselves rows with columns as direct children
    // Main content area contains rows as direct children
    let rows = [];
    if (isHeaderFooter) {
      // Header/footer is a single row, so use it directly for column targeting
      rows = [root];
    } else {
      rows = Array.from(root.querySelectorAll(':scope > .row-item'));
    }

    if (rows.length === 0) {
      const rootRect = root.getBoundingClientRect();
      // Don't show indicator for flexible containers, but show flexible bounds highlight
      const isFlexible = isFreeCanvas(root);
      let indicator = null;
      if (!isFlexible) {
        indicator = { type: 'horizontal', top: rootRect.top + 4, left: rootRect.left, right: rootRect.right };
      } else {
        // Show flexible container bounds as a subtle highlight
        indicator = {
          type: 'flexible-highlight',
          flexibleBounds: {
            left: rootRect.left,
            top: rootRect.top,
            width: rootRect.width,
            height: rootRect.height
          }
        };
      }
      return {
        target: { kind: 'between-rows', beforeRow: null, parent: root },
        indicator: indicator
      };
    }

    // For flexible containers, never show line indicator - only show bounds highlight
    const isFlexible = isFreeCanvas(root);
    const rootRect = root.getBoundingClientRect();

    const firstRect = rows[0].getBoundingClientRect();
    if (clientY < firstRect.top + ROW_EDGE_GAP) {
      let indicator = null;
      if (isFlexible) {
        indicator = {
          type: 'flexible-highlight',
          flexibleBounds: {
            left: rootRect.left,
            top: rootRect.top,
            width: rootRect.width,
            height: rootRect.height
          }
        };
      } else {
        indicator = { type: 'horizontal', top: firstRect.top - 4, left: firstRect.left, right: firstRect.right };
      }
      return {
        target: { kind: 'between-rows', beforeRow: rows[0], parent: root },
        indicator: indicator
      };
    }

    const lastRect = rows[rows.length - 1].getBoundingClientRect();
    if (clientY > lastRect.bottom - ROW_EDGE_GAP) {
      let indicator = null;
      if (isFlexible) {
        indicator = {
          type: 'flexible-highlight',
          flexibleBounds: {
            left: rootRect.left,
            top: rootRect.top,
            width: rootRect.width,
            height: rootRect.height
          }
        };
      } else {
        indicator = { type: 'horizontal', top: lastRect.bottom + 4, left: lastRect.left, right: lastRect.right };
      }
      return {
        target: { kind: 'between-rows', beforeRow: null, parent: root },
        indicator: indicator
      };
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rect = row.getBoundingClientRect();
      if (i < rows.length - 1) {
        const nextRect = rows[i + 1].getBoundingClientRect();
        if (clientY > rect.bottom - ROW_EDGE_GAP && clientY < nextRect.top + ROW_EDGE_GAP) {
          let indicator = null;
          if (isFlexible) {
            indicator = {
              type: 'flexible-highlight',
              flexibleBounds: {
                left: rootRect.left,
                top: rootRect.top,
                width: rootRect.width,
                height: rootRect.height
              }
            };
          } else {
            indicator = { type: 'horizontal', top: (rect.bottom + nextRect.top) / 2 - 2, left: rect.left, right: rect.right };
          }
          return {
            target: { kind: 'between-rows', beforeRow: rows[i + 1], parent: root },
            indicator: indicator
          };
        }
      }
      if (clientY >= rect.top && clientY <= rect.bottom) {
        return findColTarget(row, clientX, clientY);
      }
    }

    let indicator = null;
    if (isFlexible) {
      indicator = {
        type: 'flexible-highlight',
        flexibleBounds: {
          left: rootRect.left,
          top: rootRect.top,
          width: rootRect.width,
          height: rootRect.height
        }
      };
    } else {
      indicator = { type: 'horizontal', top: lastRect.bottom + 4, left: lastRect.left, right: lastRect.right };
    }
    return {
      target: { kind: 'between-rows', beforeRow: null, parent: root },
      indicator: indicator
    };
  };

  // ---------------------------------------------------------------------------
  // Visual indicator (single shared element)
  // ---------------------------------------------------------------------------
  let indicatorEl = null;

  let flexibleHighlightEl = null;

  const showIndicator = (hint) => {
    if (!hint) {
      if (indicatorEl) {
        indicatorEl.style.display = 'none';
        indicatorEl.style.visibility = 'hidden';
      }
      if (flexibleHighlightEl) {
        flexibleHighlightEl.style.display = 'none';
        flexibleHighlightEl.style.visibility = 'hidden';
      }
      return;
    }

    if (!indicatorEl) {
      indicatorEl = document.createElement('div');
      indicatorEl.className = 'cs-drop-indicator';
      indicatorEl.style.zIndex = '9999';
      document.body.appendChild(indicatorEl);
    }
    indicatorEl.classList.remove('cs-drop-indicator--horizontal', 'cs-drop-indicator--vertical');

    // For flexible highlight, hide the line indicator
    if (hint.type === 'flexible-highlight') {
      indicatorEl.style.display = 'none';
      indicatorEl.style.visibility = 'hidden';
    } else if (hint.type === 'horizontal') {
      indicatorEl.style.display = 'block';
      indicatorEl.style.visibility = 'visible';
      indicatorEl.classList.add('cs-drop-indicator--horizontal');
      indicatorEl.style.top = `${hint.top}px`;
      indicatorEl.style.left = `${hint.left}px`;
      indicatorEl.style.width = `${hint.right - hint.left}px`;
      indicatorEl.style.height = '1px';
      indicatorEl.style.overflow = 'hidden';
    } else {
      indicatorEl.style.display = 'block';
      indicatorEl.style.visibility = 'visible';
      indicatorEl.classList.add('cs-drop-indicator--vertical');
      indicatorEl.style.left = `${hint.left}px`;
      indicatorEl.style.top = `${hint.top}px`;
      indicatorEl.style.height = `${hint.bottom - hint.top}px`;
      indicatorEl.style.width = '1px';
      indicatorEl.style.overflow = 'hidden';
    }

    // Show subtle highlight for flexible container bounds if specified
    if (hint.flexibleBounds) {
      if (!flexibleHighlightEl) {
        flexibleHighlightEl = document.createElement('div');
        flexibleHighlightEl.className = 'cs-flexible-highlight';
        flexibleHighlightEl.style.position = 'fixed';
        flexibleHighlightEl.style.pointerEvents = 'none';
        flexibleHighlightEl.style.backgroundColor = 'rgba(92, 92, 255, 0.05)';
        flexibleHighlightEl.style.border = '1px solid rgba(92, 92, 255, 0.2)';
        flexibleHighlightEl.style.zIndex = '9998';
        flexibleHighlightEl.style.visibility = 'hidden';
        document.body.appendChild(flexibleHighlightEl);
      }
      const bounds = hint.flexibleBounds;
      flexibleHighlightEl.style.display = 'block';
      flexibleHighlightEl.style.visibility = 'visible';
      flexibleHighlightEl.style.left = `${bounds.left}px`;
      flexibleHighlightEl.style.top = `${bounds.top}px`;
      flexibleHighlightEl.style.width = `${bounds.width}px`;
      flexibleHighlightEl.style.height = `${bounds.height}px`;
    } else if (flexibleHighlightEl) {
      flexibleHighlightEl.style.display = 'none';
      flexibleHighlightEl.style.visibility = 'hidden';
    }
  };

  const hideIndicator = () => {
    if (indicatorEl) {
      indicatorEl.style.display = 'none';
      indicatorEl.style.visibility = 'hidden';
    }
    if (flexibleHighlightEl) {
      flexibleHighlightEl.style.display = 'none';
      flexibleHighlightEl.style.visibility = 'hidden';
    }
  };

  Object.assign(window.FlowCanvas, {
    findDropTarget,
    showIndicator,
    hideIndicator,
  });
})();
