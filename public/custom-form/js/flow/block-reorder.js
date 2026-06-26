/**
 * @fileoverview Internal block drag-and-drop using pointer events.
 *
 * Why not HTML5 native drag? Native drag conflicts with Froala / inline-editor
 * pointerdown handlers on text content and has quirky drag-image behavior. We
 * use raw pointer events on dedicated chrome handles for reliability.
 *
 * UX:
 *   - Every top-level flow block gets a `.cs-block-grip` (⋮⋮) handle in its
 *     top-left corner (visible on hover).
 *   - Mouse-down on the grip or selected-state `.cs-block-badge` starts a
 *     tracked drag. The block goes 40%
 *     transparent and we show the same blue drop indicator used by sidebar
 *     drops (powered by drop-zones.js).
 *   - On pointerup, the block is detached and re-inserted at the computed
 *     drop target. Cleanup observer prunes empty columns.
 *
 * Supports all four drop zone kinds (between-rows, col-edge, in-col, in-section).
 *
 * Exposes:
 *   window.FlowCanvas.initBlockReorder(canvas, doc)
 */
(function () {
  window.FlowCanvas = window.FlowCanvas || {};

  const isFlowBlock = (el) => {
    return el && el.matches?.('.cs_block_s, .canvas-block') &&
      el.closest('.cs-flow-canvas') &&
      !el.dataset.csInSection &&
      el.parentElement?.matches?.('.col-item');
  };

  const ensureGrip = (block) => {
    if (block.querySelector(':scope > .cs-block-grip')) return;
    const grip = document.createElement('div');
    grip.className = 'cs-block-grip';
    grip.setAttribute('data-cs-chrome', '');
    grip.setAttribute('title', 'Drag to reorder');
    // 6-dot grip pattern — the universal "drag to move" affordance.
    grip.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
        <circle cx="4" cy="3" r="1.4"/>
        <circle cx="10" cy="3" r="1.4"/>
        <circle cx="4" cy="7" r="1.4"/>
        <circle cx="10" cy="7" r="1.4"/>
        <circle cx="4" cy="11" r="1.4"/>
        <circle cx="10" cy="11" r="1.4"/>
      </svg>`;
    block.appendChild(grip);
  };

  const ensureGripsOnAll = (doc) => {
    doc.querySelectorAll('.col-item > .cs_block_s, .col-item > .canvas-block').forEach(ensureGrip);
  };

  const findReorderHandle = (target) => {
    // Badge action buttons (move/duplicate/delete) live inside the badge but
    // are clicks, not drag handles — never start a reorder on them.
    if (target?.closest?.('[data-cs-action]')) return null;
    return target?.closest?.('.cs-block-grip, .cs-block-badge') || null;
  };

  window.FlowCanvas.initBlockReorder = function (canvas, doc) {
    ensureGripsOnAll(doc);
    // Observe canvas (the stable element whose innerHTML undo/redo swaps) rather
    // than doc — undo replaces canvas.innerHTML which detaches doc, so a
    // doc-level observer goes blind after the first undo.
    const observer = new MutationObserver(() => ensureGripsOnAll(canvas));
    observer.observe(canvas, { childList: true, subtree: true });

    const FC = window.FlowCanvas;
    let drag = null;   // { block, grip, pointerId }

    // ---- pointerdown on a reorder handle ----
    canvas.addEventListener('pointerdown', (event) => {
      const handle = findReorderHandle(event.target);
      if (!handle) return;
      const block = handle.closest?.('.cs_block_s, .canvas-block');
      if (!block || !isFlowBlock(block)) return;

      // Lone block on the page → nowhere to drop. Don't start a drag (and don't
      // swallow the event) so no pointless blue drop-indicator line appears.
      if (FC.canReorder && !FC.canReorder(block)) return;

      event.preventDefault();
      event.stopPropagation();

      drag = { block, grip: handle, pointerId: event.pointerId };
      block.classList.add('cs-block--dragging');
      handle.setPointerCapture?.(event.pointerId);
      canvas.style.cursor = 'grabbing';
    }, true);

    // ---- pointermove: compute drop target and show indicator ----
    canvas.addEventListener('pointermove', (event) => {
      if (!drag) return;
      // Resolve the live doc each move — canvas.innerHTML may have been replaced
      // by undo, making the closure's `doc` a stale detached element.
      const liveDocForMove = drag.block.closest('.cs_margin, .custom-form-design') || doc;
      const result = FC.findDropTarget?.(liveDocForMove, canvas, event.clientX, event.clientY);
      if (result) {
        FC.showIndicator?.(result.indicator);
        canvas._pendingReorderTarget = result.target;
      } else {
        FC.hideIndicator?.();
        canvas._pendingReorderTarget = null;
      }
    });

    // ---- pointerup: place block at target ----
    const finishDrag = (event) => {
      if (!drag) return;
      const { block, grip, pointerId } = drag;
      try { grip.releasePointerCapture?.(pointerId); } catch (e) { }
      block.classList.remove('cs-block--dragging');
      canvas.style.cursor = '';
      FC.hideIndicator?.();

      const target = canvas._pendingReorderTarget;
      canvas._pendingReorderTarget = null;
      drag = null;

      if (!target) return;

      // Resolve the live page doc from the block being dragged — the closure's
      // `doc` may be a stale reference after undo replaced canvas.innerHTML.
      const liveDoc = block.closest('.cs_margin, .custom-form-design') || doc;

      // Suspend cleanup so the vacated column is not pruned between
      // block.remove() and placeBlock() — that timing window caused the
      // block to disappear when the cleanup observer ran in between.
      (FC.withCleanupSuspended || ((fn) => fn()))(() => {
        block.remove();
        FC.placeBlock?.(liveDoc, block, target);
      }, canvas);
    };

    canvas.addEventListener('pointerup', finishDrag);
    canvas.addEventListener('pointercancel', finishDrag);

    // ---- cancel on Escape ----
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !drag) return;
      drag.block.classList.remove('cs-block--dragging');
      canvas.style.cursor = '';
      FC.hideIndicator?.();
      canvas._pendingReorderTarget = null;
      drag = null;
    });
  };

  // ---------------------------------------------------------------------------
  // Programmatic move (used by the block badge "move up / down" actions).
  //
  //   - If the block shares its column with siblings → reorder within the column.
  //   - Otherwise (single block in the column) → move the whole ROW up / down
  //     among its sibling rows. This matches the common single-column document
  //     flow where each block sits on its own row.
  // ---------------------------------------------------------------------------
  const directBlocks = (col) => (
    col ? Array.from(col.children).filter((c) => c.matches?.('.cs_block_s, .canvas-block')) : []
  );

  const siblingRows = (parent) => (
    parent ? Array.from(parent.children).filter(
      (c) => c.matches?.('.row-item') && !c.matches('.cs-page-header, .cs-page-footer')
    ) : []
  );

  const siblingCols = (row) => (
    row ? Array.from(row.children).filter((c) => c.matches?.('.col-item')) : []
  );

  window.FlowCanvas.moveBlock = function (block, dir) {
    if (!block || (dir !== 'up' && dir !== 'down')) return false;
    const col = block.closest('.col-item');
    if (!col) return false;

    const blocks = directBlocks(col);
    let moved = false;

    if (blocks.length > 1) {
      // Reorder within the column.
      const i = blocks.indexOf(block);
      if (dir === 'up' && i > 0) { blocks[i - 1].before(block); moved = true; }
      if (dir === 'down' && i < blocks.length - 1) { blocks[i + 1].after(block); moved = true; }
    } else {
      // Move the whole row among its siblings.
      const row = block.closest('.row-item');
      const parent = row?.parentElement;
      const rows = siblingRows(parent);
      const i = rows.indexOf(row);
      if (dir === 'up' && i > 0) { rows[i - 1].before(row); moved = true; }
      if (dir === 'down' && i >= 0 && i < rows.length - 1) { rows[i + 1].after(row); moved = true; }
    }

    if (moved) {
      block.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    return moved;
  };

  // True when there is somewhere to drag the block TO:
  //   - the column holds more than one block (reorder within the column), OR
  //   - the row has more than one column (drag between columns), OR
  //   - there is more than one movable row (drag between rows).
  // ONLY a lone block — one row, one column, one block — has none of these, so
  // the drag handler skips starting a drag (no drop-indicator highlight). A row
  // with multiple columns DOES allow reorder, so the column highlight shows.
  window.FlowCanvas.canReorder = function (block) {
    if (!block) return false;
    const col = block.closest('.col-item');
    if (!col) return false;
    if (directBlocks(col).length > 1) return true;
    const row = block.closest('.row-item');
    if (siblingCols(row).length > 1) return true;
    return siblingRows(row?.parentElement).length > 1;
  };
})();
