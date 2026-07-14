/**
 * @fileoverview Row / column DOM scaffolding and block placement.
 *
 * Exposes:
 *   window.FlowCanvas.makeRow()
 *   window.FlowCanvas.makeCol(flexGrow?)
 *   window.FlowCanvas.makeDivider()
 *   window.FlowCanvas.rebuildDividers(row)        — re-inserts dividers between cols
 *   window.FlowCanvas.resetColFlex(row)           — equalize col widths
 *   window.FlowCanvas.normalizeForFlow(block)     — strip inline absolute styles
 *   window.FlowCanvas.placeBlock(doc, block, target) — handles 'between-rows', 'col-edge', 'in-col'
 *
 * In-section placement (target.kind === 'in-section') lives in section-canvas.js.
 */
(function () {
  window.FlowCanvas = window.FlowCanvas || {};

  const generateHash = () => {
    if (typeof BlockCreator !== 'undefined') {
      const protoHash = BlockCreator.prototype?.generateHash;
      if (typeof protoHash === 'function') {
        return protoHash.call({});
      }
    }
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return Math.random().toString(16).slice(2) + '-' + Math.random().toString(16).slice(2);
  };

  const assignNodeId = (el, type) => {
    if (!el || el.id) return el;
    el.id = `${type}_${generateHash()}`;
    return el;
  };

  const makeRow = () => {
    const row = document.createElement('div');
    row.className = 'row-item';
    return assignNodeId(row, 'row');
  };

  const makeCol = (flexGrow = 1) => {
    const col = document.createElement('div');
    col.className = 'col-item';
    col.style.flex = `${flexGrow} 1 0`;
    return assignNodeId(col, 'col');
  };

  const makeDivider = () => {
    const div = document.createElement('div');
    div.className = 'cs-line-divider';
    return div;
  };

  const rebuildDividers = (row) => {
    row.querySelectorAll(':scope > .cs-line-divider').forEach(d => d.remove());
    const cols = Array.from(row.querySelectorAll(':scope > .col-item'));
    for (let i = 0; i < cols.length - 1; i++) {
      cols[i].after(makeDivider());
    }
  };

  const resetColFlex = (row) => {
    row.querySelectorAll(':scope > .col-item').forEach(col => {
      col.style.flex = '1 1 0';
    });
  };

  const normalizeForFlow = (block) => {
    block.style.position = '';
    block.style.left = '';
    block.style.top = '';
    block.style.width = '';
    block.style.height = '';
    block.style.minHeight = '';
    block.style.maxWidth = '';
    block.style.minWidth = '';
    delete block.dataset.csInSection;
  };

  const syncFlexibleContentBounds = (block) => {
    if (!block) return;
    const isFlexibleBlock =
      block.dataset.blockType === 'flexible' ||
      block.classList.contains('cs-flexible-block');
    if (!isFlexibleBlock) return;

    const content = block.querySelector(':scope > .cs-flexible-content');
    if (!content) return;

    const floor = window.CanvasConfig?.flexible?.minHeight ?? 20;

    if (block.style.height) {
      // Manual resize: the inner content must match the exact height the user
      // dragged to. Read it straight from the block's inline height instead of
      // clientHeight (which can lag/diverge and leaves content taller than the
      // block — e.g. block 20px but content stuck at 30px).
      const h = Math.max(floor, Math.round(parseFloat(block.style.height) || 0));
      content.style.minHeight = `${h}px`;
      content.style.height = `${h}px`;
    } else {
      // Auto height: keep a visible floor, otherwise grow with content.
      const h = Math.max(floor, Math.round(block.clientHeight || block.getBoundingClientRect().height || 0));
      content.style.minHeight = `${h}px`;
      content.style.height = '';
    }
  };

  /**
   * Insert a block into the document tree at the specified target.
   *
   * @param {HTMLElement} doc - the .cs_margin container
   * @param {HTMLElement} block - block element to insert
   * @param {Object} target - { kind, ... } from drop-zone detection
   */
  const placeBlock = (doc, block, target, clientX, clientY, blockType) => {
    if (!target) return;

    // Preserve styles of nested flexible blocks during drop
    // This prevents nested flexible containers from losing their position/size
    const preservedFlexibleStyles = new Map();
    doc.querySelectorAll('.cs-flexible-content').forEach(flexContainer => {
      const wrapper = flexContainer.closest('.cs_block_s');
      if (wrapper) {
        preservedFlexibleStyles.set(wrapper, {
          position: wrapper.style.position,
          left: wrapper.style.left,
          top: wrapper.style.top,
          width: wrapper.style.width,
          height: wrapper.style.height,
          maxWidth: wrapper.style.maxWidth,
          minWidth: wrapper.style.minWidth,
          csInSection: wrapper.dataset.csInSection
        });
      }
    });


    if (/^predefine-template-\d+$/.test(blockType) && $(target.parent).hasClass('cs_margin')) {
      $(target.parent).append(block);
      return;
    }


    if (target.kind === 'between-rows') {
      const parent = target.parent || doc;

      // Check if parent is a free canvas (flexible container OR a cover page) -
      // if so, use absolute positioning. A cover page (.cs_page[data-cs-cover])
      // hosts its blocks as absolutely-positioned DIRECT children, with no
      // flexible-content wrapper.
      const isFreeCanvasParent = parent &&
        (parent.classList.contains('cs-flexible-content') || parent.dataset?.csCover === '1');
      if (isFreeCanvasParent) {
        // Restrict certain block types from being placed in flexible containers.
        // Exception: a cover page is a free-move canvas where ALL block types
        // are allowed, so the restriction is bypassed when the flexible
        // container lives inside a `data-cs-cover` page.
        const inCoverPage = !!parent.closest('[data-cs-cover="1"]');
        const RESTRICTED_TYPES = window.FormBlockRegistry?.restrictedInFlexibleTypes() ||
          ['section-container', 'table-repeater', 'list-repeater'];
        if (!inCoverPage && RESTRICTED_TYPES.includes(blockType)) {
          // Fallback: place in doc root instead
          normalizeForFlow(block);
          const row = makeRow();
          const col = makeCol();
          col.appendChild(block);
          row.appendChild(col);
          doc.appendChild(row);
          return;
        }

        block.dataset.csInSection = '1';
        block.style.position = 'absolute';

        // Check if this is an existing flexible block being moved (already has width/height)
        // If so, preserve its size but update position based on cursor
        const isExistingFlexibleBlock = block.dataset.csInSection === '1' &&
          (block.style.width || block.style.height);

        // Insert FIRST so a new block can be measured — offsetWidth/Height are 0
        // while detached, which made the centring + clamp wrong and let the
        // block hang off the page edge (worst at the right edge).
        if (target.beforeRow) {
          target.beforeRow.before(block);
        } else {
          parent.appendChild(block);
        }

        if (!isExistingFlexibleBlock) {
          // New block - drop it where the cursor is RELEASED: the cursor maps to
          // the block's top-left corner (not its centre, which pulled a wide
          // default block ~half-its-width to the left). Account for the parent's
          // border so the math matches the absolute-positioning origin (the
          // padding edge), then clamp so the whole block stays inside the page,
          // respecting the configured page padding so blocks never land on the edge.
          const parentRect = parent.getBoundingClientRect();
          const cs = getComputedStyle(parent);
          const borderL = parseFloat(cs.borderLeftWidth) || 0;
          const borderT = parseFloat(cs.borderTopWidth) || 0;

          // Use CanvasConfig page padding for cover pages; CSS computed padding
          // for flexible-content sections (which may have their own padding).
          const isCoverPage = parent.dataset?.csCover === '1';
          const pageCfg = window.CanvasConfig?.page || {};
          const padL = isCoverPage ? (pageCfg.paddingLeft  || 0) : (parseFloat(cs.paddingLeft)   || 0);
          const padT = isCoverPage ? (pageCfg.paddingTop   || 0) : (parseFloat(cs.paddingTop)    || 0);
          const padR = isCoverPage ? (pageCfg.paddingRight || 0) : (parseFloat(cs.paddingRight)  || 0);
          const padB = isCoverPage ? (pageCfg.paddingBottom|| 0) : (parseFloat(cs.paddingBottom) || 0);

          const bw = block.offsetWidth || 0;
          const bh = block.offsetHeight || 0;
          let left = clientX - parentRect.left - borderL - padL;
          let top = clientY - parentRect.top - borderT - padT;

          const innerW = parent.clientWidth - padL - padR;
          const innerH = parent.clientHeight - padT - padB;
          left = Math.max(0, Math.min(left, Math.max(0, innerW - bw)));
          top = Math.max(0, Math.min(top, Math.max(0, innerH - bh)));

          block.style.left = `${left}px`;
          block.style.top = `${top}px`;
        }
        syncFlexibleContentBounds(block);
        return;
      }

      normalizeForFlow(block);
      const row = makeRow();
      const col = makeCol();
      col.appendChild(block);
      row.appendChild(col);
      // The drop-zone may have decided this drop belongs inside a section's
      // content area instead of the doc root. `target.parent` carries that
      // scope when present.
      if (target.beforeRow) {
        target.beforeRow.before(row);
      } else {
        parent.appendChild(row);
      }
      syncFlexibleContentBounds(block);
      return;
    }

    if (target.kind === 'col-edge') {
      normalizeForFlow(block);
      const col = makeCol();
      col.appendChild(block);
      if (target.beforeCol) {
        target.beforeCol.before(col);
      } else {
        target.row.appendChild(col);
      }
      rebuildDividers(target.row);
      syncFlexibleContentBounds(block);
      return;
    }

    if (target.kind === 'in-col') {
      normalizeForFlow(block);
      if (target.beforeBlock) {
        target.beforeBlock.before(block);
      } else {
        target.col.appendChild(block);
      }
    }

    syncFlexibleContentBounds(block);

    // Restore preserved flexible block styles
    preservedFlexibleStyles.forEach((styles, wrapper) => {
      wrapper.style.position = styles.position;
      wrapper.style.left = styles.left;
      wrapper.style.top = styles.top;
      wrapper.style.width = styles.width;
      wrapper.style.height = styles.height;
      wrapper.style.maxWidth = styles.maxWidth;
      wrapper.style.minWidth = styles.minWidth;
      if (styles.csInSection) {
        wrapper.dataset.csInSection = styles.csInSection;
      }
      syncFlexibleContentBounds(wrapper);
    });
  };

  Object.assign(window.FlowCanvas, {
    generateHash,
    assignNodeId,
    makeRow,
    makeCol,
    makeDivider,
    rebuildDividers,
    resetColFlex,
    normalizeForFlow,
    syncFlexibleContentBounds,
    placeBlock,
  });
})();
