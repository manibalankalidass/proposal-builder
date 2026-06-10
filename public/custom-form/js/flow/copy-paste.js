/**
 * @fileoverview Block copy / paste for the flow canvas (Ctrl+C / Ctrl+V).
 *
 * UX:
 *   - Select a block (single click → selected state, not editing).
 *   - Ctrl+C  → the selected block (markup + content + styles) is copied to an
 *               internal clipboard.
 *   - Ctrl+V  → a fresh copy is inserted into the SAME column, right after the
 *               currently selected block — the same place a freshly added block
 *               would land. The new copy then becomes the selected block.
 *
 * If there is no selected block at paste time, the copy is appended as a new row
 * at the end of the active document.
 *
 * While the user is editing text inside a block (Froala active) we defer to the
 * browser's native copy/paste so normal text editing keeps working.
 *
 * Exposes:
 *   window.FlowCanvas.initCopyPaste(canvas)
 */
(function () {
  window.FlowCanvas = window.FlowCanvas || {};

  // Internal clipboard. Holds the cleaned outerHTML of the last copied block so
  // each paste is an independent, fully-detached copy.
  let clipboardHtml = null;

  const hash = () => (window.FlowCanvas.generateHash
    ? window.FlowCanvas.generateHash()
    : Math.random().toString(16).slice(2));

  // Strip editor chrome + transient state from a clone so the pasted block
  // starts clean. Chrome (grips, badges, resize handles) is re-added on demand.
  const cleanClone = (clone) => {
    clone
      .querySelectorAll('[data-cs-chrome], .cs-block-grip, .cs-block-badge, .cs-resize-handle, .cs-overflow-mark')
      .forEach((el) => el.remove());

    const scrub = (el) => {
      el.classList?.remove('cs-selected', 'cs-editing', 'cs-block--dragging');
      // Drop contenteditable so the copy isn't stuck in an editing state, but
      // KEEP Froala's fr-view / fr-element classes — they carry the rendering
      // styles (e.g. table borders/layout) the block needs to display.
      if (el.hasAttribute?.('contenteditable')) el.removeAttribute('contenteditable');
    };
    scrub(clone);
    clone.querySelectorAll('*').forEach(scrub);
    return clone;
  };

  // Give the clone (and every descendant carrying an id) a brand-new id so we
  // never end up with duplicate ids in the DOM. The prefix is preserved so the
  // twig generator / style code keeps recognising the element kind.
  const regenerateIds = (root) => {
    const reassign = (el) => {
      if (!el.id) return;
      const prefix = el.id.includes('_') ? el.id.slice(0, el.id.lastIndexOf('_')) : el.id;
      el.id = `${prefix}_${hash()}`;
    };
    reassign(root);
    root.querySelectorAll('[id]').forEach(reassign);
  };

  const isFlowBlock = (el, canvas) => (
    el && el.matches?.('.cs_block_s, .canvas-block') &&
    canvas.contains(el) &&
    !el.dataset.csInSection &&
    el.parentElement?.matches?.('.cs-col')
  );

  // A block that lives INSIDE a flexible container (absolutely positioned). Its
  // paste/duplicate should land back inside the same flexible box.
  const isFlexibleChild = (el, canvas) => (
    el && el.matches?.('.cs_block_s, .canvas-block') &&
    canvas.contains(el) &&
    !!el.closest?.('.cs-flexible-content')
  );

  const copySelected = () => {
    const EM = window.EditorManager;
    const block = EM?.getSelected?.();
    if (!block) return false;

    const clone = cleanClone(block.cloneNode(true));
    clipboardHtml = clone.outerHTML;
    return true;
  };

  // Build a detached block element from the stored clipboard markup.
  const buildPasteBlock = () => {
    if (!clipboardHtml) return null;
    const tmp = document.createElement('div');
    tmp.innerHTML = clipboardHtml;
    const block = tmp.firstElementChild;
    if (!block) return null;
    regenerateIds(block);
    return block;
  };

  const colsOfRow = (row) => (
    row ? Array.from(row.children).filter((c) => c.matches?.('.cs-col')) : []
  );

  // Where should a new block land, relative to an anchor block?
  //   - anchor's row has MULTIPLE columns → place in the same column, right
  //     after the anchor (keeps the multi-column layout).
  //   - anchor's row has a SINGLE column   → create a brand-new row right after
  //     the current one (like adding a fresh block to a row).
  // Fall back to a new row at the end of the doc when there is no anchor.
  const resolvePasteTarget = (canvas, anchor) => {
    // Anchor inside a flexible container → paste back into that flexible box.
    const flexContent = anchor?.closest?.('.cs-flexible-content');
    if (flexContent && canvas.contains(flexContent)) {
      const doc = anchor.closest('.cs-doc') || canvas.querySelector('.cs-doc');
      return { doc, flexContent, target: { kind: 'in-flexible', parent: flexContent } };
    }

    if (isFlowBlock(anchor, canvas)) {
      const col = anchor.closest('.cs-col');
      const row = anchor.closest('.cs-row');
      const doc = anchor.closest('.cs-doc');
      if (col && row && doc) {
        if (colsOfRow(row).length > 1) {
          return { doc, target: { kind: 'in-col', col, beforeBlock: anchor.nextElementSibling || null } };
        }
        return {
          doc,
          target: { kind: 'between-rows', parent: row.parentElement || doc, beforeRow: row.nextElementSibling || null },
        };
      }
    }

    const doc = canvas.querySelector('.cs-doc');
    if (!doc) return null;
    return { doc, target: { kind: 'between-rows', parent: doc, beforeRow: null } };
  };

  // Place a ready-built block next to an anchor, then select it (immediate
  // feedback + becomes the next paste/duplicate anchor).
  const placeAndSelect = (canvas, newBlock, anchor) => {
    if (!newBlock) return null;
    const placement = resolvePasteTarget(canvas, anchor);
    if (!placement) return null;

    if (placement.flexContent) {
      // Append directly as an absolutely-positioned flexible child, offset a
      // little from the original so the copy is visible (not exactly stacked).
      const flex = placement.flexContent;
      newBlock.dataset.csInSection = '1';
      newBlock.style.position = 'absolute';
      const left = parseFloat(newBlock.style.left) || 0;
      const top = parseFloat(newBlock.style.top) || 0;
      newBlock.style.left = `${left + 24}px`;
      newBlock.style.top = `${top + 24}px`;
      flex.appendChild(newBlock);
      const wrapper = flex.closest('.cs-flexible-block') || flex.parentElement;
      window.FlowCanvas?.syncFlexibleContentBounds?.(wrapper);
    } else {
      window.FlowCanvas?.placeBlock?.(placement.doc, newBlock, placement.target);
    }

    requestAnimationFrame(() => {
      if (!canvas.contains(newBlock)) return;
      newBlock.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      newBlock.click();
    });
    return newBlock;
  };

  const pasteBlock = (canvas) => {
    const anchor = window.EditorManager?.getSelected?.();
    const useAnchor = (isFlowBlock(anchor, canvas) || isFlexibleChild(anchor, canvas)) ? anchor : null;
    return !!placeAndSelect(canvas, buildPasteBlock(), useAnchor);
  };

  // Public: duplicate a specific block (used by the badge "duplicate" action).
  // Clones the live block (content + styles) and drops the copy next to it.
  window.FlowCanvas.duplicateBlock = (block) => {
    if (!block) return null;
    const canvas = block.closest('.cs-flow-canvas') || document.querySelector('.cs-flow-canvas');
    if (!canvas) return null;
    const clone = cleanClone(block.cloneNode(true));
    regenerateIds(clone);
    const anchor = (isFlowBlock(block, canvas) || isFlexibleChild(block, canvas)) ? block : null;
    return placeAndSelect(canvas, clone, anchor);
  };

  /* ----------------------- reusable component library ----------------------- */
  // Capture/insert reuse the exact clone/clean/regenerate/place pipeline so a
  // saved component behaves like a freshly-dropped block (single OR a container
  // block such as a section/flexible that groups several children).
  const getCanvasEl = () =>
    document.querySelector('.cs-flow-canvas') || document.querySelector('.custom-form-design');

  // Build a fresh, id-unique block element from stored component HTML.
  window.FlowCanvas.buildComponentBlock = (html) => {
    if (!html) return null;
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const block = tmp.firstElementChild;
    if (!block) return null;
    regenerateIds(block);
    return block;
  };

  // Snapshot the currently selected block as a reusable component.
  window.FlowCanvas.captureComponent = () => {
    const block = window.EditorManager?.getSelected?.();
    if (!block) return null;
    const clone = cleanClone(block.cloneNode(true));
    const isGroup = !!clone.querySelector('.cs_block_s, .canvas-block, .cs-row');
    const thumbnail = (block.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40)
      || block.getAttribute('custom-name') || block.dataset.blockType || 'Component';
    return { html: clone.outerHTML, kind: isGroup ? 'group' : 'single', thumbnail };
  };

  // Insert a component (click path) next to the current selection.
  window.FlowCanvas.insertComponentHtml = (html) => {
    const canvas = getCanvasEl();
    const block = window.FlowCanvas.buildComponentBlock(html);
    if (!canvas || !block) return false;
    const anchor = window.EditorManager?.getSelected?.();
    const useAnchor = (isFlowBlock(anchor, canvas) || isFlexibleChild(anchor, canvas)) ? anchor : null;
    return !!placeAndSelect(canvas, block, useAnchor);
  };

  window.FlowCanvas.initCopyPaste = function (canvas) {
    if (!canvas || canvas.dataset.copyPasteInit === '1') return;
    canvas.dataset.copyPasteInit = '1';

    document.addEventListener('keydown', (event) => {
      const ctrl = event.ctrlKey || event.metaKey;
      if (!ctrl) return;

      const key = event.key.toLowerCase();
      if (key !== 'c' && key !== 'v') return;

      // While editing text inside a block, defer to native copy/paste.
      if (window.EditorManager?.getEditing?.()) return;

      const target = event.target;
      const inEditable = target?.isContentEditable ||
                         target?.tagName === 'INPUT' ||
                         target?.tagName === 'TEXTAREA';
      if (inEditable) return;

      if (key === 'c') {
        // Only hijack copy when a block is actually selected; otherwise let the
        // browser copy any plain text selection normally.
        if (copySelected()) event.preventDefault();
      } else if (key === 'v') {
        if (clipboardHtml && pasteBlock(canvas)) event.preventDefault();
      }
    });
  };
})();
