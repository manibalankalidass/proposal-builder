/**
 * Block interaction state machine.
 *
 *   idle  ──click──▶  selected  ──click again──▶  editing
 *     ▲                  │                          │
 *     └──── click outside / Esc ────────────────────┘
 *
 * - selected: shows badge (move handle + menu), block is draggable via the handle
 * - editing : shows badge (label only) + 8 resize handles, Froala inline toolbar active
 */
(function () {
  const RESIZE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const blockEditors = new WeakMap();

  let selectedBlock = null;
  let editingBlock = null;
  // Set whenever clearAll runs. The very next surface click is forced to
  // enterSelected, regardless of DOM classes — prevents a single user click
  // from doing both teardown AND edit-mode entry in one gesture.
  let forceFreshSelect = false;

  const isFroalaAvailable = () => typeof FroalaEditor !== 'undefined';

  /**
   * Swallow Froala 4's async teardown error: "Cannot read properties of
   * undefined (reading 'top')". It fires from popup handlers that run after
   * destroy(), on detached DOM. Harmless, but pollutes the console.
   */
  window.addEventListener('error', (event) => {
    const msg = (event.message || '').toLowerCase();
    const src = (event.filename || '').toLowerCase();
    if (src.includes('froala') && msg.includes("reading 'top'")) {
      event.preventDefault();
      return false;
    }
  });

  /* ----------------------------- badge / chrome ----------------------------- */

  const buildBadge = (block) => {
    const label = block.getAttribute('custom-name') || block.getAttribute('data') || 'Block';
    const badge = document.createElement('div');
    badge.className = 'cs-block-badge';
    badge.setAttribute('data-cs-chrome', '');
    badge.innerHTML = `
      <span class="cs-block-badge__handle" data-cs-move title="Drag to move">&#x2725;</span>
      <span class="cs-block-badge__label">${label}</span>
      <span class="cs-block-badge__actions">
        <button type="button" class="cs-block-badge__btn" data-cs-action="move-up" title="Move up">&#x25B2;</button>
        <button type="button" class="cs-block-badge__btn" data-cs-action="move-down" title="Move down">&#x25BC;</button>
        <button type="button" class="cs-block-badge__btn" data-cs-action="duplicate" title="Duplicate">&#x2398;</button>
        <button type="button" class="cs-block-badge__btn cs-block-badge__btn--danger" data-cs-action="delete" title="Delete">&#x2715;</button>
      </span>
    `;
    return badge;
  };

  // Run a badge action button. The button carries data-cs-action; the owning
  // block is resolved from the badge's parent. All actions delegate to the
  // FlowCanvas helpers so behaviour stays consistent with keyboard shortcuts.
  const runBadgeAction = (action, block) => {
    if (!block) return;
    const FC = window.FlowCanvas || {};
    switch (action) {
      case 'move-up':   FC.moveBlock?.(block, 'up'); break;
      case 'move-down': FC.moveBlock?.(block, 'down'); break;
      case 'duplicate': FC.duplicateBlock?.(block); break;
      case 'delete':    clearAll(); FC.deleteBlock?.(block); break;
    }
  };

  const buildResizeHandles = () => {
    const frag = document.createDocumentFragment();
    RESIZE_DIRS.forEach((dir) => {
      const h = document.createElement('div');
      h.className = 'cs-resize-handle';
      h.setAttribute('data-dir', dir);
      h.setAttribute('data-cs-chrome', '');
      frag.appendChild(h);
    });
    return frag;
  };

  const removeChrome = (block) => {
    block.querySelectorAll('[data-cs-chrome]').forEach((el) => {
      // The pen-shape tool manages its own overlay lifecycle (it tags the
      // overlay data-cs-chrome only so export/insert logic treats it as chrome).
      // Leave it alone — otherwise the editing UI gets wiped on attachChrome.
      if (el.classList.contains('cs-pen-overlay')) return;
      el.remove();
    });
  };

  /* ----------------------------- editor lifecycle ----------------------------- */

  const findEditTarget = (block) =>
    block.querySelector('.edit_me') || block.querySelector('.canvas-block__content') || null;

  const startFroala = (block) => {
    const target = findEditTarget(block);
    if (!target) return;

    // Section containers use custom markup and should not be initialized with Froala.
    if (block.dataset.blockType === 'section-container') {
      target.setAttribute('contenteditable', 'true');
      target.focus();
      return;
    }

    // Scrub any stale Froala state before re-init (defensive: handles edge cases
    // where the user click-storms between blocks faster than destroy() finishes).
    hardCleanFroala(block);

    // Lock the block's WIDTH at its rendered value before Froala wraps things —
    // otherwise Froala's .fr-box can collapse the block. Height stays auto so
    // the block grows as the user types.
    const rect = block.getBoundingClientRect();
    block.style.width = `${rect.width}px`;
    block.style.maxWidth = 'none';

    // Froala needs the element to be contenteditable-friendly; it handles that itself.
    if (isFroalaAvailable()) {
      try {
        const editor = new FroalaEditor(target, {
          toolbarInline: true,
          toolbarVisibleWithoutSelection: false,
          charCounterCount: false,
          wordCounterCount: false,
          quickInsertEnabled: false,
          attribution: false,
          key: '',
          toolbarButtons: [
            ['bold', 'italic', 'underline', 'strikeThrough', 'subscript', 'superscript'],
            ['fontSize', 'fontFamily', 'textColor', 'backgroundColor'],
            ['align', 'formatOL', 'formatUL', 'outdent', 'indent'],
            ['insertLink', 'insertImage', 'insertTable', 'insertVideo'],
            ['removeFormat', 'clearFormatting', 'html'],
            ['undo', 'redo'],
            ['selectAll', 'copy', 'cut', 'paste'],
            ['quote', 'insertHR', 'lineHeight', 'letterSpacing', 'paragraphStyle'],
            ['spellChecker']
          ],
          fontSize: ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36', '40', '48', '56', '64', '72', '80', '88', '96', '100'],
          fontSizeSelection: true,
          // Font family configuration with Google Fonts + System fonts
          // Format: CSS value => Display name (keys shown in dropdown)
          fontFamily: window.FROALA_FONTS || {
            'Arial': 'Arial',
            "'Roboto', sans-serif": 'Roboto',
            "'Poppins', sans-serif": 'Poppins',
            "'Sora', sans-serif": 'Sora',
            "'Open Sans', sans-serif": 'Open Sans',
            "'Lato', sans-serif": 'Lato',
            "'Montserrat', sans-serif": 'Montserrat',
            "'Raleway', sans-serif": 'Raleway',
            "'Playfair Display', serif": 'Playfair Display',
            "'Inter', sans-serif": 'Inter',
          },
          paragraphStyles: {
            'font-weight-light': 'Light (300)',
            'font-weight-medium': 'Medium (500)',
            'font-weight-bold': 'Bold (700)'
          },
          placeholderText: target.getAttribute('placeholder') || 'Enter text here',
          events: {
            initialized: function () {
              this.events.focus();
            }
          }
        });
        blockEditors.set(block, editor);
        return;
      } catch (err) {
        console.warn('Froala init failed, falling back to contenteditable:', err);
      }
    }

    // Fallback
    target.setAttribute('contenteditable', 'true');
    target.focus();
  };

  /**
   * Strips every artifact Froala leaves behind so a future init starts clean.
   * Froala 4.x sometimes leaves the .fr-element class, contenteditable, and
   * (rarely) wrapper nodes. If we don't scrub these, the next `new FroalaEditor(target)`
   * silently no-ops and the block appears to "skip" the selected state.
   */
  const hardCleanFroala = (block) => {
    if (!block) return;

    // 1. Unwrap any .fr-box / .fr-wrapper Froala created around the edit target.
    //    On a clean destroy these are gone, but we belt-and-suspender it.
    block.querySelectorAll('.fr-box').forEach((box) => {
      const inner = box.querySelector('.fr-element');
      if (inner && box.parentNode) {
        box.parentNode.replaceChild(inner, box);
      }
    });

    // 2. Remove any Froala UI nodes accidentally left inside the block.
    block.querySelectorAll(
      '.fr-toolbar, .fr-popup, .fr-modal, .fr-overlay, .fr-second-toolbar, .fr-placeholder, .fr-tooltip'
    ).forEach((el) => el.remove());

    // 3. Reset the edit target back to a plain .edit_me div.
    const target = block.querySelector('.edit_me, .fr-element');
    if (target) {
      target.removeAttribute('contenteditable');
      target.removeAttribute('spellcheck');
      target.removeAttribute('dir');
      target.classList.remove('fr-element', 'fr-view', 'fr-box');
      if (!target.classList.contains('edit_me')) {
        target.classList.add('edit_me');
      }
      // Strip every Froala data-* attribute
      Array.from(target.attributes).forEach((attr) => {
        if (attr.name.startsWith('data-fr-') || attr.name.startsWith('fr-')) {
          target.removeAttribute(attr.name);
        }
      });
      // Strip Froala-injected inline sizing (min-height, height, padding etc.)
      // that otherwise survives destroy and squashes the block on re-edit.
      ['min-height', 'height', 'max-height', 'padding', 'padding-top', 'padding-bottom',
        'padding-left', 'padding-right', 'margin', 'overflow', 'display'].forEach((prop) => {
          target.style.removeProperty(prop);
        });
    }
  };

  const stopFroala = (block) => {
    const editor = blockEditors.get(block);
    if (editor) {
      // Hide UI before destroy so Froala's async popup-cleanup handlers don't
      // try to read .offset().top on a detached node (the 'top' of undefined error).
      try { editor.popups && editor.popups.hideAll && editor.popups.hideAll(); } catch (e) { }
      try { editor.toolbar && editor.toolbar.hide && editor.toolbar.hide(); } catch (e) { }
      try { editor.destroy(); } catch (e) { /* noop */ }
      blockEditors.delete(block);
    }
    // Let Froala finish its own DOM unwrap before we forcibly clean. If we
    // hardClean synchronously, we race with Froala's mouseup/blur handlers.
    hardCleanFroala(block);

    document.querySelectorAll(
      'body > .fr-toolbar, body > .fr-popup, body > .fr-modal, body > .fr-overlay, body > .fr-tooltip'
    ).forEach((el) => el.remove());
  };

  /* ----------------------------- state transitions ----------------------------- */

  const clearAll = ({ internal = false } = {}) => {
    const stoppedBlock = editingBlock;
    if (stoppedBlock) {
      stopFroala(stoppedBlock);
      editingBlock = null;
    }
    selectedBlock = null;
    // Only flag fresh-select for clearAlls triggered by user input (not for
    // internal calls from enterSelected/enterEditing).
    if (!internal) forceFreshSelect = true;

    // Sweep the DOM for any orphaned chrome (other blocks). Skip the one we just
    // stopped — hardCleanFroala already ran on it inside stopFroala, and running
    // it again can race with Froala's async popup teardown.
    document.querySelectorAll('.cs_block_s.cs-editing, .cs_block_s.cs-selected').forEach((b) => {
      b.classList.remove('cs-editing', 'cs-selected');
      removeChrome(b);
      if (b !== stoppedBlock) {
        hardCleanFroala(b);
      }
    });

    // Final safety: kill any Froala UI still floating in <body>. Catches the case
    // where destroy() threw before completing.
    document.querySelectorAll(
      'body > .fr-toolbar, body > .fr-popup, body > .fr-modal, body > .fr-overlay, body > .fr-tooltip'
    ).forEach((el) => el.remove());
  };

  const enterSelected = (block) => {
    if (selectedBlock === block && !editingBlock) return;
    clearAll({ internal: true });
    block.classList.add('cs-selected');
    block.appendChild(buildBadge(block));
    selectedBlock = block;
  };

  const enterEditing = (block) => {
    if (editingBlock === block) return;
    // Re-use the selected chrome; just upgrade it
    if (selectedBlock && selectedBlock !== block) {
      clearAll({ internal: true });
    }
    // Ensure badge exists (we kept .cs-selected on; remove it because cs-editing replaces it visually)
    removeChrome(block);
    block.classList.remove('cs-selected');
    block.classList.add('cs-editing');

    editingBlock = block;
    selectedBlock = null;

    // Init Froala FIRST. Add chrome AFTER an rAF tick so Froala's async init
    // (including its `initialized` event handler) finishes mutating DOM before
    // we append the badge + resize handles. Without this delay, Froala's
    // post-init DOM work can wipe siblings on the second edit cycle.
    startFroala(block);

    const attachChrome = () => {
      if (editingBlock !== block) return; // user already moved on
      removeChrome(block);
      block.appendChild(buildBadge(block));
      block.appendChild(buildResizeHandles());
    };
    requestAnimationFrame(() => requestAnimationFrame(attachChrome));
  };

  /* ----------------------------- drag / move (selected only) ----------------------------- */

  const dropSurface = () => document.querySelector('.custom-form-design');

  const syncFlexibleContentBounds = (block) => {
    window.FlowCanvas?.syncFlexibleContentBounds?.(block);
  };

  const getFlexibleMoveBounds = (parent, block) => {
    const parentWidth = parent?.clientWidth ?? 0;
    const parentHeight = parent?.clientHeight ?? 0;
    const blockWidth = block?.offsetWidth ?? 0;
    const blockHeight = block?.offsetHeight ?? 0;
    const minVisible = 40;
    const overflowX = blockWidth - parentWidth;
    const overflowY = blockHeight - parentHeight;

    return {
      minLeft: overflowX > 0 ? (minVisible - blockWidth) : 0,
      maxLeft: overflowX > 0 ? Math.max(0, parentWidth - minVisible) : Math.max(0, parentWidth - blockWidth),
      minTop: overflowY > 0 ? (minVisible - blockHeight) : 0,
      maxTop: overflowY > 0 ? Math.max(0, parentHeight - minVisible) : Math.max(0, parentHeight - blockHeight)
    };
  };

  const readRenderedPosition = (block, axis) => {
    const inlineValue = parseFloat(block.style[axis]);
    if (!Number.isNaN(inlineValue)) return inlineValue;

    const computedValue = parseFloat(window.getComputedStyle(block)[axis]);
    return Number.isNaN(computedValue) ? 0 : computedValue;
  };

  let move = null;
  let wasDragged = false;

  const onMoveDown = (event) => {
    wasDragged = false;
    // Let resize handles operate freely
    if (event.target.closest('.cs-resize-handle')) return;
    // Badge action buttons are clicks, not drags — never start a move on them.
    if (event.target.closest('[data-cs-action]')) return;

    const block = event.target.closest('.cs_block_s');
    if (!block) return;

    // Flow canvas owns layout for top-level blocks (in a row/col). Only
    // in-section children use absolute drag.
    if (block.closest('.cs-flow-canvas') && !block.dataset.csInSection) return;

    // Check if what they clicked was the badge handle directly
    const isHandle = !!event.target.closest('[data-cs-move]');

    // If block is selected, allow dragging from ANYWHERE inside.
    // If block is actively being edited, ONLY allow dragging from the dedicated move badge handle.
    if (block.classList.contains('cs-selected') || (block.classList.contains('cs-editing') && isHandle)) {
      event.preventDefault();
      event.stopPropagation();

      const parent = block.offsetParent || dropSurface();
      const parentRect = parent.getBoundingClientRect();
      const blockRect = block.getBoundingClientRect();

      move = {
        block,
        parent,
        parentRect,
        offsetX: event.clientX - blockRect.left,
        offsetY: event.clientY - blockRect.top,
        startX: event.clientX,
        startY: event.clientY
      };

      const captureNode = isHandle ? event.target.closest('[data-cs-move]') : block;
      captureNode.setPointerCapture?.(event.pointerId);
    }
  };

  const onMoveMove = (event) => {
    if (!move) return;
    const { block, parent, parentRect, offsetX, offsetY } = move;
    const { minLeft, maxLeft, minTop, maxTop } = getFlexibleMoveBounds(parent, block);

    // If the parent is a section container content, we might not want to strictly constrain the bottom edge if it grows
    // But for bounding logic, using the clientHeight prevents breaking out.

    if (Math.abs(event.clientX - move.startX) > 3 || Math.abs(event.clientY - move.startY) > 3) {
      wasDragged = true;
    }

    const left = Math.min(Math.max(event.clientX - parentRect.left - offsetX, minLeft), maxLeft);
    const top = Math.min(Math.max(event.clientY - parentRect.top - offsetY, minTop), maxTop);
    block.style.left = `${left}px`;
    block.style.top = `${top}px`;
  };

  const onMoveUp = () => {
    move = null;
    // Decay the drag flag after a split second so future regular clicks are guaranteed clean
    setTimeout(() => { wasDragged = false; }, 100);
  };

  /* ----------------------------- resize (editing only) ----------------------------- */

  let resize = null;

  const onResizeDown = (event) => {
    const handle = event.target.closest('.cs-resize-handle');
    if (!handle) return;
    const block = handle.closest('.cs_block_s');
    // Trust the DOM class, not the in-memory ref (which can drift after a
    // destroy race).
    if (!block || !block.classList.contains('cs-editing')) return;

    // Flow canvas owns block width for top-level blocks. Section containers
    // and in-section blocks still allow pixel resize (height adjust for sections,
    // free-position for in-section children).
    const isInSection = !!block.dataset.csInSection;
    const isSectionContainer = block.dataset.blockType === 'section-container' ||
      block.getAttribute('data') === 'Section Container';

    // We allow resize on normal flow blocks as well, so we do NOT early return here anymore.
    // The onResizeMove handler correctly constraints them (skipping absolute left/top).

    event.preventDefault();
    event.stopPropagation();

    const rect = block.getBoundingClientRect();
    const parent = block.offsetParent || dropSurface();
    const parentRect = parent.getBoundingClientRect();

    resize = {
      block,
      dir: handle.getAttribute('data-dir'),
      startX: event.clientX,
      startY: event.clientY,
      startW: rect.width,
      startH: rect.height,
      startLeft: rect.left - parentRect.left,
      startTop: rect.top - parentRect.top,
      parent,
      parentRect
    };

    handle.setPointerCapture?.(event.pointerId);
  };

  const onResizeMove = (event) => {
    if (!resize) return;
    const { block, dir, startX, startY, startW, startH, startLeft, startTop } = resize;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;

    let newW = startW;
    let newH = startH;
    let newLeft = startLeft;
    let newTop = startTop;

    const MIN = 40;
    // Free-form blocks (flexible containers + their absolutely-positioned
    // in-section children) can be sized much smaller than a normal flow block,
    // so use the configurable flexible minimums for both width and height.
    const isFlexibleBlock =
      block.dataset.blockType === 'flexible' || block.classList.contains('cs-flexible-block');
    const isFreeForm = isFlexibleBlock || !!block.dataset.csInSection;
    const flexCfg = window.CanvasConfig?.flexible || {};
    const MIN_W = isFreeForm ? (flexCfg.minWidth ?? 20) : MIN;
    const MIN_H = isFreeForm ? (flexCfg.minHeight ?? 20) : MIN;

    if (dir.includes('e')) newW = Math.max(MIN_W, startW + dx);
    if (dir.includes('s')) newH = Math.max(MIN_H, startH + dy);
    if (dir.includes('w')) {
      newW = Math.max(MIN_W, startW - dx);
      newLeft = startLeft + (startW - newW);
    }
    if (dir.includes('n')) {
      newH = Math.max(MIN_H, startH - dy);
      newTop = startTop + (startH - newH);
    }

    // Flow-mode blocks (sections in a column) aren't absolutely positioned —
    // skip left/top, cap width to parent column.
    const isFlowBlock = block.closest('.cs-flow-canvas') && !block.dataset.csInSection;
    if (isFlowBlock) {
      block.style.height = `${newH}px`;

      // Section containers and Flexible blocks rely on their inner content wrapper for visual height.
      // We must explicitly stretch the wrapper's minimum height to match the manual resize.
      const sectionContent = block.querySelector(':scope > .section-container-content, :scope > .cs-flexible-content');
      if (sectionContent) {
        sectionContent.style.minHeight = `${newH}px`;
      }

      if (dir.includes('e') || dir.includes('w')) {
        const parent = block.parentElement;
        const maxW = parent ? parent.clientWidth : newW;
        block.style.width = `${Math.min(newW, maxW)}px`;
      }
      syncFlexibleContentBounds(block);
    } else {
      block.style.width = `${newW}px`;
      block.style.height = `${newH}px`;
      // Only update left/top if the resize direction includes that corner
      // This preserves position for non-corner resizes
      if (dir.includes('w') || dir.includes('e')) {
        // Horizontal resize - may need to update left if from west
        if (dir.includes('w')) {
          block.style.left = `${newLeft}px`;
        }
      }
      if (dir.includes('n') || dir.includes('s')) {
        // Vertical resize - may need to update top if from north
        if (dir.includes('n')) {
          block.style.top = `${newTop}px`;
        }
      }
      syncFlexibleContentBounds(block);
    }
    // Drop the max-width cap so the block actually grows
    block.style.maxWidth = 'none';
  };

  const onResizeUp = () => {
    resize = null;
  };

  /* ----------------------------- click routing ----------------------------- */

  const onSurfaceClick = (event) => {
    if (wasDragged) {
      wasDragged = false;
      return;
    }

    // Ignore clicks on our own chrome (handled by their own listeners)
    if (event.target.closest('[data-cs-chrome]')) return;

    const block = event.target.closest('.cs_block_s');

    if (!block) {
      clearAll();
      return;
    }

    const domSaysEditing = block.classList.contains('cs-editing');
    const domSaysSelected = block.classList.contains('cs-selected');

    // If a teardown just happened in this same user gesture, force fresh-select.
    // Otherwise a single click could trigger both teardown + immediate edit-mode.
    if (forceFreshSelect) {
      forceFreshSelect = false;
      enterSelected(block);
      return;
    }

    if (domSaysEditing) return;
    if (domSaysSelected) {
      enterEditing(block);
      return;
    }
    enterSelected(block);
  };

  const isFroalaUi = (node) => {
    // Froala renders toolbars / popups / dropdowns into document.body. Any element
    // whose class starts with "fr-" should be treated as part of the active editor.
    for (let el = node; el && el !== document; el = el.parentElement) {
      if (el.classList && Array.from(el.classList).some((c) => c.startsWith('fr-'))) {
        return true;
      }
    }
    return false;
  };

  /**
   * Captures pointerdown/mousedown BEFORE Froala / other listeners. If the user
   * is pressing down on something that isn't the current editing block (and isn't
   * Froala UI), tear down so the subsequent click lands on a clean DOM. Uses
   * pointerdown AND mousedown: Froala doesn't capture pointerdown, so even if
   * its mousedown handler stops propagation, our pointerdown still runs.
   */
  const onCaptureMouseDown = (event) => {
    // selectedBlock OR editingBlock — both should tear down on outside click
    if (!editingBlock && !selectedBlock) return;

    const target = event.target;
    const activeBlock = editingBlock || selectedBlock;

    // Inside the currently active block — leave alone (Froala / move-handle owns it)
    if (activeBlock.contains(target)) return;

    // Inside our own chrome (resize handle, badge) — leave alone
    if (target.closest && target.closest('[data-cs-chrome]')) return;

    // Inside Froala's floating UI (toolbar/popup/dropdown rendered to body)
    if (isFroalaUi(target)) return;

    // Pressing on another block or empty canvas → tear down now
    clearAll();
  };

  const onDocumentClick = (event) => {
    // If the click target is still attached to the document, use it as-is.
    // Otherwise — Froala may have reparented/destroyed it during a state change
    // mid-click. In that case use clientX/clientY to hit-test where the click
    // ACTUALLY landed, so we don't false-positive an "outside" click.
    let target = event.target;
    const detached = !document.contains(target);
    if (detached && typeof event.clientX === 'number') {
      target = document.elementFromPoint(event.clientX, event.clientY) || target;
    }

    if (target.closest && target.closest('.custom-form-design, [data-cs-chrome]')) return;
    if (isFroalaUi(target)) return;
    clearAll();
  };

  const onKeydown = (event) => {
    if (event.key === 'Escape') {
      clearAll();
      return;
    }

    // Arrow-key nudge — only for in-flexible blocks in selected state
    const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (!arrowKeys.includes(event.key)) return;

    const block = selectedBlock;
    if (!block) return;

    // Shift + Up/Down on a flow block → reorder it up/down (same as the badge
    // move buttons). In-section (absolute) blocks keep the nudge behaviour below.
    if (event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !block.dataset.csInSection) {
      event.preventDefault();
      window.FlowCanvas?.moveBlock?.(block, event.key === 'ArrowUp' ? 'up' : 'down');
      return;
    }

    if (!block.dataset.csInSection) return;

    event.preventDefault();

    const step = event.shiftKey ? 10 : 1;
    const parent = block.offsetParent;
    const { minLeft, maxLeft, minTop, maxTop } = getFlexibleMoveBounds(parent, block);

    let left = readRenderedPosition(block, 'left');
    let top = readRenderedPosition(block, 'top');

    if (event.key === 'ArrowLeft') left -= step;
    if (event.key === 'ArrowRight') left += step;
    if (event.key === 'ArrowUp') top -= step;
    if (event.key === 'ArrowDown') top += step;

    block.style.left = `${Math.min(Math.max(left, minLeft), maxLeft)}px`;
    block.style.top = `${Math.min(Math.max(top, minTop), maxTop)}px`;
  };

  /* ----------------------------- init ----------------------------- */

  const init = () => {
    const surface = dropSurface();
    if (!surface) return;

    // Capture-phase: runs BEFORE Froala's own handlers. This is what lets us
    // tear down the editing block the moment the user presses on another block.
    // Use BOTH mousedown and pointerdown — Froala may intercept mousedown, but
    // it doesn't capture pointerdown, so this guarantees we always fire.
    document.addEventListener('mousedown', onCaptureMouseDown, true);
    document.addEventListener('pointerdown', onCaptureMouseDown, true);

    // HTML5 DnD from the parent sidebar never fires mousedown in this iframe.
    // Listen wide (document, capture) for dragenter/dragover/drop so we tear
    // down the active editor the moment a new block drag enters the canvas.
    // Use throttle flag — dragover fires many times per second.
    let dragTeardownDone = false;
    const onDragSignal = () => {
      if (dragTeardownDone) return;
      if (editingBlock || selectedBlock) {
        clearAll();
        dragTeardownDone = true;
      }
    };
    const resetDragFlag = () => { dragTeardownDone = false; };
    document.addEventListener('dragenter', onDragSignal, true);
    document.addEventListener('dragover', onDragSignal, true);
    document.addEventListener('drop', (e) => { onDragSignal(); resetDragFlag(); }, true);
    document.addEventListener('dragend', resetDragFlag, true);
    document.addEventListener('dragleave', resetDragFlag, true);

    // Bulletproof safety net: if a new .cs_block_s appears in the canvas while
    // an editor is active on a DIFFERENT block, tear down. Catches every path
    // that creates a block — drag/drop, programmatic insertion, paste, etc.
    const observer = new MutationObserver((mutations) => {
      if (!editingBlock && !selectedBlock) return;
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          const isBlock = node.classList && node.classList.contains('cs_block_s');
          const newBlock = isBlock ? node : (node.querySelector && node.querySelector('.cs_block_s'));
          if (newBlock && newBlock !== editingBlock && newBlock !== selectedBlock) {
            clearAll();
            return;
          }
        }
      }
    });
    observer.observe(surface, { childList: true, subtree: true });

    // Badge action buttons (move/duplicate/delete). Capture phase + stop
    // propagation so the click never reaches onSurfaceClick (which would toggle
    // edit mode) or starts a drag.
    document.addEventListener('click', (event) => {
      const btn = event.target.closest?.('[data-cs-action]');
      if (!btn) return;
      event.preventDefault();
      event.stopPropagation();
      const block = btn.closest('.cs_block_s');
      runBadgeAction(btn.dataset.csAction, block);
    }, true);

    surface.addEventListener('click', onSurfaceClick);
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onKeydown);

    // Pointer events for move + resize (delegated, captured at surface)
    surface.addEventListener('pointerdown', onMoveDown);
    document.addEventListener('pointermove', onMoveMove);
    document.addEventListener('pointerup', onMoveUp);
    document.addEventListener('pointercancel', onMoveUp);

    surface.addEventListener('pointerdown', onResizeDown);
    document.addEventListener('pointermove', onResizeMove);
    document.addEventListener('pointerup', onResizeUp);
    document.addEventListener('pointercancel', onResizeUp);
  };

  let lastSelectionRange = null;
  const updateSelectionRange = () => {
    const sel = document.getSelection();
    if (sel && sel.rangeCount > 0) {
      lastSelectionRange = sel.getRangeAt(0).cloneRange();
    }
  };

  document.addEventListener('selectionchange', updateSelectionRange);

  const insertTextAtCursor = (text) => {
    const doc = document;
    const selection = doc.getSelection();
    let range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (!range && lastSelectionRange) {
      range = lastSelectionRange.cloneRange();
    }
    if (!range) return false;

    range.deleteContents();
    range.insertNode(doc.createTextNode(text));
    range.collapse(false);
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return true;
  };

  window.EditorManager = {
    init,
    clearAll,
    // Programmatically select a block (used by the panel's "Choose parent"
    // buttons). Mirrors a fresh user click → idle → selected.
    select: (block) => {
      if (!block || !block.classList || !block.classList.contains('cs_block_s')) return;
      enterSelected(block);
      try { block.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* */ }
    },
    getSelected: () => selectedBlock,
    getEditing: () => editingBlock,
    getFroalaEditor: () => {
      if (!editingBlock) return null;
      return blockEditors.get(editingBlock) || null;
    },
    isInteracting: () => !!(move || resize),
    insertTextAtCursor,
    // Debug: prints what state the editor thinks it's in vs. the DOM.
    debug: () => {
      const selectedDom = document.querySelectorAll('.cs_block_s.cs-selected');
      const editingDom = document.querySelectorAll('.cs_block_s.cs-editing');
      const froalaUiInBody = document.querySelectorAll(
        'body > .fr-toolbar, body > .fr-popup, body > .fr-modal, body > .fr-overlay, body > .fr-tooltip'
      );
      const frElements = document.querySelectorAll('.fr-element, .fr-box');
      console.log('[EditorManager.debug]', {
        ref_selectedBlock: selectedBlock,
        ref_editingBlock: editingBlock,
        dom_selected: selectedDom.length,
        dom_editing: editingDom.length,
        froala_ui_in_body: froalaUiInBody.length,
        leftover_fr_elements: frElements.length
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
