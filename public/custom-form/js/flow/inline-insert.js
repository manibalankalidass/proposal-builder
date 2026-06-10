/**
 * @fileoverview Hover-based inline insert control for the flow canvas.
 *
 * Shows a small "+" button on the left edge of the current insertion line.
 * Clicking it opens a block picker and inserts the selected block using the
 * same createBlock/placeBlock path as sidebar drag/drop.
 *
 * Exposes:
 *   window.FlowCanvas.initInlineInsert(canvas)
 */
(function () {
  window.FlowCanvas = window.FlowCanvas || {};

  // Menu sections come straight from the shared block registry — add a block
  // there with `inInlineMenu: true` and it appears here automatically.
  const getInlineSections = () => (
    window.FormBlockRegistry?.sections('inInlineMenu') || []
  );

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  // How close to a column's left/right edge the pointer must be before we offer
  // a "new column beside this block" drop instead of an in-column insert.
  const COL_EDGE_GAP = (window.CanvasConfig?.dropZone?.colEdgeGap) ?? 24;

  // When the pointer is directly over a block's content the user almost always
  // wants an in-column insert, so we only flip to the vertical "new column"
  // mode within a much tighter band of the true edge. This stops the indicator
  // from jumping to vertical while casually hovering blocks in a multi-column
  // row (the full COL_EDGE_GAP still applies over a column's empty area).
  const COL_EDGE_GAP_OVER_BLOCK = 6;

  const directChildren = (root, selector) => {
    if (!root) return [];
    return Array.from(root.children).filter((child) => child.matches?.(selector));
  };

  const blockChildrenOfCol = (col) => (
    directChildren(col, '.cs_block_s, .canvas-block')
  );

  const rowChildrenOfRoot = (root) => (
    directChildren(root, '.cs-row')
  );

  const isContentRoot = (node) => (
    !!node && (
      node.classList?.contains('cs-doc') ||
      node.classList?.contains('body-main-content') ||
      node.classList?.contains('section-container-content')
    )
  );

  const isInteractiveChrome = (target) => (
    !!target?.closest?.(
      '.cs-block-grip, .cs-col-divider, [data-cs-chrome], .fr-toolbar, .fr-popup, .fr-modal, .fr-tooltip'
    )
  );

  const resolveInColTarget = (col, clientY) => {
    const blocks = blockChildrenOfCol(col);
    if (!blocks.length) {
      return { target: { kind: 'in-col', col, beforeBlock: null } };
    }

    for (let i = 0; i < blocks.length; i++) {
      const rect = blocks[i].getBoundingClientRect();
      const mid = (rect.top + rect.bottom) / 2;
      if (clientY < mid) {
        return { target: { kind: 'in-col', col, beforeBlock: blocks[i] } };
      }
    }

    return { target: { kind: 'in-col', col, beforeBlock: null } };
  };

  // When the pointer sits near the left/right edge of a column, offer a
  // "new column beside this block" drop (col-edge) instead of an in-column
  // insert. Returns null when the pointer is comfortably inside the column.
  const resolveColEdge = (col, clientX, gap = COL_EDGE_GAP) => {
    const row = col.closest('.cs-row');
    if (!row) return null;
    const rect = col.getBoundingClientRect();
    const cols = directChildren(row, '.cs-col');

    if (clientX <= rect.left + gap) {
      return { target: { kind: 'col-edge', row, beforeCol: col } };
    }
    if (clientX >= rect.right - gap) {
      const idx = cols.indexOf(col);
      return { target: { kind: 'col-edge', row, beforeCol: cols[idx + 1] || null } };
    }
    return null;
  };

  const computeGeometry = (target, doc, clientX, clientY) => {
    if (!target || !doc) return null;

    if (target.kind === 'col-edge' && target.row) {
      const rowRect = target.row.getBoundingClientRect();
      const cols = directChildren(target.row, '.cs-col');
      let x;
      if (target.beforeCol) {
        x = target.beforeCol.getBoundingClientRect().left;
      } else if (cols.length) {
        x = cols[cols.length - 1].getBoundingClientRect().right;
      } else {
        x = rowRect.left;
      }
      // The line spans the whole row height, but the "+" handle tracks the
      // pointer's Y (clamped inside the row) so it stays next to the cursor —
      // just like the horizontal/in-column case. Without this the handle pins
      // to the row's top corner and appears to jump away the moment the hover
      // switches from an in-column (horizontal) to a new-column (vertical)
      // insert.
      return {
        vertical: true,
        x,
        top: rowRect.top,
        bottom: rowRect.bottom,
        y: clamp(clientY, rowRect.top + 16, rowRect.bottom - 16),
      };
    }

    if (target.kind === 'in-col' && target.col) {
      const rect = target.col.getBoundingClientRect();
      const blocks = blockChildrenOfCol(target.col);
      let lineY = clamp(clientY, rect.top + 12, rect.bottom - 12);
      if (blocks.length) {
        if (target.beforeBlock) {
          lineY = target.beforeBlock.getBoundingClientRect().top;
        } else {
          lineY = blocks[blocks.length - 1].getBoundingClientRect().bottom;
        }
      }
      return {
        left: rect.left,
        right: rect.right,
        y: lineY,
      };
    }

    if (target.kind === 'between-rows') {
      const root = isContentRoot(target.parent) ? target.parent : doc;
      const rootRect = root.getBoundingClientRect();
      const rows = rowChildrenOfRoot(root).filter((row) => {
        return !row.matches('.cs-page-header, .cs-page-footer');
      });

      let lineY;
      if (!rows.length) {
        // Empty page: the very first insert always pins to the page top,
        // regardless of where the pointer is (so a hover in the centre still
        // drops the first block at the top). Once a block exists this branch
        // is skipped and the line follows the pointer / sits between rows.
        lineY = rootRect.top + 14;
      } else if (target.beforeRow) {
        lineY = target.beforeRow.getBoundingClientRect().top;
      } else {
        lineY = rows[rows.length - 1].getBoundingClientRect().bottom;
      }

      return {
        left: rootRect.left,
        right: rootRect.right,
        y: lineY,
      };
    }

    return null;
  };

  const renderMenuSections = (menuEl, onChoose) => {
    menuEl.innerHTML = '';
    getInlineSections().forEach((section) => {
      const sectionEl = document.createElement('div');
      sectionEl.className = 'cs-inline-insert-menu__section';

      const titleEl = document.createElement('div');
      titleEl.className = 'cs-inline-insert-menu__title';
      titleEl.textContent = section.title;
      sectionEl.appendChild(titleEl);

      section.items.forEach((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cs-inline-insert-menu__item';
        button.dataset.blockType = item.type;
        button.innerHTML = `
          <span class="cs-inline-insert-menu__icon">${item.icon}</span>
          <span class="cs-inline-insert-menu__label">${item.label}</span>
        `;
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          onChoose(item);
        });
        sectionEl.appendChild(button);
      });

      menuEl.appendChild(sectionEl);
    });
  };

  window.FlowCanvas.initInlineInsert = function (canvas) {
    if (!canvas || canvas.dataset.inlineInsertInit === '1') return;
    canvas.dataset.inlineInsertInit = '1';

    const FC = window.FlowCanvas || {};
    const paper = canvas.closest('.cs_paper') || canvas;
    let enabled = window.CanvasConfig?.inlineInsert?.enabled !== false;

    const plusEl = document.createElement('button');
    plusEl.type = 'button';
    plusEl.className = 'cs-inline-insert';
    plusEl.setAttribute('aria-label', 'Add content');
    plusEl.setAttribute('title', 'Add content');
    plusEl.innerHTML = '<span>+</span>';

    const lineEl = document.createElement('div');
    lineEl.className = 'cs-inline-insert-line';

    const menuEl = document.createElement('div');
    menuEl.className = 'cs-inline-insert-menu';

    document.body.appendChild(lineEl);
    document.body.appendChild(plusEl);
    document.body.appendChild(menuEl);

    const state = {
      doc: null,
      target: null,
      clientX: 0,
      clientY: 0,
      geometry: null,
      open: false,
      visible: false,
    };

    const hideVisuals = () => {
      state.visible = false;
      lineEl.classList.remove('is-visible');
      lineEl.classList.remove('is-active');
      plusEl.classList.remove('is-visible', 'is-open');
    };

    const closeMenu = ({ keepVisuals = false } = {}) => {
      state.open = false;
      menuEl.classList.remove('is-open');
      plusEl.classList.remove('is-open');
      lineEl.classList.remove('is-active');
      if (!keepVisuals) hideVisuals();
    };

    const showVisuals = (geometry) => {
      if (!enabled) return;
      state.visible = true;
      lineEl.classList.add('is-visible');
      plusEl.classList.add('is-visible');

      if (geometry.vertical) {
        // New-column indicator: vertical line on the block's left/right edge.
        lineEl.classList.add('cs-inline-insert-line--vertical');
        plusEl.classList.add('cs-inline-insert--vertical');
        lineEl.style.left = `${geometry.x}px`;
        lineEl.style.top = `${geometry.top}px`;
        lineEl.style.width = '';
        lineEl.style.height = `${Math.max(32, geometry.bottom - geometry.top)}px`;

        plusEl.style.left = `${geometry.x}px`;
        plusEl.style.top = `${geometry.y ?? geometry.top}px`;
      } else {
        // New-row / in-column indicator: horizontal line.
        lineEl.classList.remove('cs-inline-insert-line--vertical');
        plusEl.classList.remove('cs-inline-insert--vertical');
        lineEl.style.left = `${geometry.left}px`;
        lineEl.style.top = `${geometry.y}px`;
        lineEl.style.height = '';
        lineEl.style.width = `${Math.max(32, geometry.right - geometry.left)}px`;

        plusEl.style.left = `${geometry.left - 14}px`;
        plusEl.style.top = `${geometry.y}px`;
      }
    };

    const positionMenu = () => {
      if (!state.geometry) return;
      const g = state.geometry;
      const anchorY = g.y ?? g.top;
      const anchorX = g.vertical ? g.x : g.left;
      const menuHeight = Math.min(420, menuEl.offsetHeight || 420);
      const maxTop = Math.max(12, window.innerHeight - menuHeight - 12);
      const maxLeft = Math.max(12, window.innerWidth - 288);
      const top = clamp(anchorY - 12, 12, maxTop);
      const left = clamp(anchorX + 18, 12, maxLeft);
      menuEl.style.top = `${top}px`;
      menuEl.style.left = `${left}px`;
    };

    const findActiveDoc = (clientX, clientY) => {
      const docs = Array.from(paper.querySelectorAll('.cs-doc'));
      for (const doc of docs) {
        const rect = doc.getBoundingClientRect();
        if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
          return doc;
        }
      }
      return docs[0] || null;
    };

    const resolveTarget = (doc, clientX, clientY, eventTarget) => {
      const hoveredCol = eventTarget?.closest?.('.cs-col');
      if (hoveredCol && doc.contains(hoveredCol)) {
        // Near the column's left/right edge → offer a new column beside it.
        // Tighten that edge band while hovering a block so an in-column insert
        // stays the default and the indicator doesn't flip to vertical mid-column.
        const overBlock = !!eventTarget?.closest?.('.cs_block_s, .canvas-block');
        const gap = overBlock ? COL_EDGE_GAP_OVER_BLOCK : COL_EDGE_GAP;
        const edge = resolveColEdge(hoveredCol, clientX, gap);
        if (edge) return edge;
        return resolveInColTarget(hoveredCol, clientY);
      }
      if (!doc || typeof FC.findDropTarget !== 'function') return null;
      const result = FC.findDropTarget(doc, paper, clientX, clientY);
      if (!result?.target) return null;
      // Keep col-edge as a real new-column drop (vertical indicator).
      return result;
    };

    const refreshHover = (clientX, clientY, eventTarget) => {
      if (!enabled) {
        hideVisuals();
        return;
      }
      if (state.open) return;
      if (canvas.querySelector('.cs-block--dragging')) {
        hideVisuals();
        return;
      }
      if (eventTarget?.closest?.('.cs-inline-insert, .cs-inline-insert-menu')) {
        if (state.geometry) showVisuals(state.geometry);
        return;
      }
      if (isInteractiveChrome(eventTarget)) {
        hideVisuals();
        return;
      }

      const doc = findActiveDoc(clientX, clientY);
      if (!doc) {
        hideVisuals();
        return;
      }

      const insideCanvas = eventTarget?.closest?.('.custom-form-design');
      if (!insideCanvas) {
        hideVisuals();
        return;
      }

      const result = resolveTarget(doc, clientX, clientY, eventTarget);
      if (!result?.target) {
        hideVisuals();
        return;
      }

      const geometry = computeGeometry(result.target, doc, clientX, clientY);
      if (!geometry) {
        hideVisuals();
        return;
      }

      state.doc = doc;
      state.target = result.target;
      state.clientX = clientX;
      state.clientY = clientY;
      state.geometry = geometry;
      showVisuals(geometry);
    };

    const chooseItem = (item) => {
      if (!enabled) return;
      if (!state.doc || !state.target) return;
      FC.insertPayloadAtTarget?.({
        payload: {
          blockType: item.type,
          label: item.label,
        },
        activeDoc: state.doc,
        target: state.target,
        clientX: state.clientX,
        clientY: state.clientY,
      });
      closeMenu();
    };

    renderMenuSections(menuEl, chooseItem);

    plusEl.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!enabled) return;
      if (!state.target || !state.geometry) return;
      state.open = !state.open;
      plusEl.classList.toggle('is-open', state.open);
      menuEl.classList.toggle('is-open', state.open);
      lineEl.classList.toggle('is-active', state.open);
      if (state.open) {
        positionMenu();
      }
    });

    plusEl.addEventListener('mouseenter', () => {
      if (!enabled) return;
      lineEl.classList.add('is-active');
    });

    plusEl.addEventListener('mouseleave', () => {
      if (!enabled || state.open) return;
      lineEl.classList.remove('is-active');
    });

    document.addEventListener('pointermove', (event) => {
      if (!enabled || state.open) return;
      refreshHover(event.clientX, event.clientY, event.target);
    }, true);

    document.addEventListener('scroll', () => {
      if (state.open) positionMenu();
      else hideVisuals();
    }, true);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    });

    document.addEventListener('pointerdown', (event) => {
      const clickedInsideMenu = event.target.closest?.('.cs-inline-insert-menu, .cs-inline-insert');
      if (clickedInsideMenu) return;
      if (state.open) closeMenu();
    }, true);

    document.addEventListener('dragstart', () => closeMenu(), true);
    document.addEventListener('dragenter', () => closeMenu(), true);
    document.addEventListener('drop', () => closeMenu(), true);

    const docsObserver = new MutationObserver(() => {
      if (!document.contains(state.doc)) {
        closeMenu();
      }
    });
    docsObserver.observe(paper, { childList: true, subtree: true });

    const applyEnabledState = (nextEnabled) => {
      enabled = !!nextEnabled;
      if (window.CanvasConfig?.inlineInsert) {
        window.CanvasConfig.inlineInsert.enabled = enabled;
      }
      if (!enabled) {
        closeMenu();
        hideVisuals();
      }
    };

    applyEnabledState(enabled);

    Object.assign(window.FlowCanvas, {
      isInlineInsertEnabled: () => enabled,
      setInlineInsertEnabled: (nextEnabled) => {
        applyEnabledState(nextEnabled);
        return enabled;
      },
    });
  };
})();
