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
  // In-progress rename of a block's badge label (Ctrl+R). Holds the block, the
  // contenteditable label span, and its original text so we can save or cancel.
  let labelEdit = null;
  // True when the most recent press landed inside the active block. A drag to
  // select text can start inside the editor and release (mouseup) outside the
  // page; the browser then fires `click` on a common ancestor outside the
  // canvas, which would otherwise look like an "outside click" and tear down
  // editing mid-selection. We use this to skip that teardown.
  let pressStartedInActive = false;

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
    // Up/Down reorder is meaningless for free-move blocks (cover page /
    // flexible) — their position is absolute, not a flow order — so omit those
    // buttons there and keep just the move handle, duplicate and delete.
    const reorderBtns = isFreeFormBlock(block) ? '' : `
        <button type="button" class="cs-block-badge__btn" data-cs-action="move-up" title="Move up">&#x25B2;</button>
        <button type="button" class="cs-block-badge__btn" data-cs-action="move-down" title="Move down">&#x25BC;</button>`;
    badge.innerHTML = `
      <span class="cs-block-badge__handle" data-cs-move title="Drag to move">&#x2725;</span>
      <span class="cs-block-badge__label">${label}</span>
      <span class="cs-block-badge__actions">${reorderBtns}
        <button type="button" class="cs-block-badge__btn" data-cs-action="duplicate" title="Duplicate">&#x2398;</button>
        <button type="button" class="cs-block-badge__btn cs-block-badge__btn--danger" data-cs-action="delete" title="Delete">&#x2715;</button>
      </span>
    `;
    return badge;
  };

  /* ----------------------------- rename (Ctrl+R) ----------------------------- */
  // Renaming edits ONLY the friendly `custom-name` attribute (shown in the
  // badge). The `data` attribute — the block-type identifier the rest of the
  // app reads — is never touched.

  const onLabelKeydown = (event) => {
    // Keep the keystroke inside the label: don't trigger the block-level
    // shortcuts (Escape teardown, arrow nudge, Ctrl+R again, copy/paste).
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      commitLabelEdit(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      commitLabelEdit(false);
    }
  };

  const onLabelBlur = () => commitLabelEdit(true);

  // Finish an in-progress rename. save=true writes the new name to custom-name;
  // save=false (or empty input) restores the original. Idempotent — safe to call
  // from Enter, blur, or a teardown (clearAll) without double-applying.
  function commitLabelEdit(save) {
    if (!labelEdit) return;
    const { block, label, original } = labelEdit;
    labelEdit = null;

    label.removeEventListener('keydown', onLabelKeydown);
    label.removeEventListener('blur', onLabelBlur);
    label.removeAttribute('contenteditable');
    label.classList.remove('cs-block-badge__label--editing');

    const next = (label.textContent || '').replace(/\s+/g, ' ').trim();
    if (save && next) {
      block.setAttribute('custom-name', next); // data attribute stays untouched
      label.textContent = next;
    } else {
      label.textContent = original;
    }
  }

  // Make the selected block's badge label editable, focused, and fully selected.
  const startLabelEdit = (block) => {
    if (!block || labelEdit) return;
    const badge = block.querySelector(':scope > .cs-block-badge');
    const label = badge && badge.querySelector('.cs-block-badge__label');
    if (!label) return;

    labelEdit = { block, label, original: label.textContent };
    label.setAttribute('contenteditable', 'true');
    label.classList.add('cs-block-badge__label--editing');
    label.addEventListener('keydown', onLabelKeydown);
    label.addEventListener('blur', onLabelBlur);

    label.focus();
    const range = document.createRange();
    range.selectNodeContents(label);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  // Run a badge action button. The button carries data-cs-action; the owning
  // block is resolved from the badge's parent. All actions delegate to the
  // FlowCanvas helpers so behaviour stays consistent with keyboard shortcuts.
  const runBadgeAction = (action, block) => {
    if (!block) return;
    const FC = window.FlowCanvas || {};
    switch (action) {
      case 'move-up': FC.moveBlock?.(block, 'up'); break;
      case 'move-down': FC.moveBlock?.(block, 'down'); break;
      case 'duplicate': FC.duplicateBlock?.(block); break;
      case 'delete': clearAll(); FC.deleteBlock?.(block); break;
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
      // Aiden's in-block action bar / tone popup own their own lifecycle too
      // (removed when the AI session ends) — don't let chrome teardown wipe them
      // mid-session.
      if (el.classList.contains('cs-aiden-bar') || el.classList.contains('cs-aiden-pop')) return;
      el.remove();
    });
  };

  /* ----------------------------- editor lifecycle ----------------------------- */

  const findEditTarget = (block) =>
    block.querySelector('.edit_me') || block.querySelector('.canvas-block__content') || null;

  const startFroala = (block) => {
    // The List block and its columns are structural containers — they have no
    // text of their own, and any `.edit_me` matches belong to nested cells.
    // Never start an editor on them (that would hijack a cell's text editor).
    if (block.dataset.blockType === 'sync-list' || block.dataset.blockType === 'sync-list-col') return;

    // Table and Table Repeater blocks are driven entirely by table-block.js —
    // the table engine sets up contenteditable on cells and owns the toolbar.
    if (block.dataset.blockType === 'table' || block.dataset.blockType === 'table-repeater') return;

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

    // Lock the block's WIDTH at its rendered value before the editor wraps
    // things — otherwise the box can collapse. Force HEIGHT to auto (clearing
    // any pinned/resized height) so the block grows as the user types / hits
    // Enter, instead of overflowing a fixed-height box.
    const rect = block.getBoundingClientRect();
    block.style.width = `${rect.width}px`;
    block.style.maxWidth = 'none';
    block.style.height = 'auto';
    const editTarget = findEditTarget(block);
    if (editTarget) editTarget.style.height = 'auto';

    // Engine switch (CanvasConfig.editor.useFroala): false → our custom editor,
    // true → legacy Froala. See canvas-config.js.
    const useFroala = (typeof window.isFroalaEditor === 'function') ? window.isFroalaEditor() : false;

    // NEW custom editor (default). Dependency-free, edits in place, and exposes
    // the same `.commands.exec()` / `.destroy()` surface so froala-style-handler
    // + the style panel keep working.
    if (!useFroala && typeof window.CustomRichEditor === 'function') {
      try {
        const editor = new window.CustomRichEditor(target, {
          placeholder: target.getAttribute('placeholder') || 'Enter text here',
          fonts: window.FROALA_FONTS || null,
          fontSizes: ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36', '40', '48', '56', '64', '72', '80', '88', '96'],
        });
        blockEditors.set(block, editor);
        return;
      } catch (err) {
        console.warn('CustomRichEditor init failed, falling back:', err);
      }
    }

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
            },
            contentChanged: function () {
              // Froala's built-in table insert column/row creates bare <td>s
              // that lack our `cs-cell` class (→ no border) and a junk
              // `style="null;…"`. Re-stamp any static-table cells it touched.
              try {
                const root = this.el;
                if (root && window.TableBlock && typeof window.TableBlock.normalizeCells === 'function') {
                  root.querySelectorAll('table.cs-table').forEach((t) => window.TableBlock.normalizeCells(t));
                }
              } catch (err) { /* normalization is best-effort */ }
            }
          }
        });
        blockEditors.set(block, editor);
        return;
      } catch (err) {
        console.warn('Froala init failed, falling back to contenteditable:', err);
      }
    }

    // Last resort: if the preferred engine wasn't available (e.g. Froala mode
    // but Froala didn't load), use the custom editor before bare contenteditable.
    if (typeof window.CustomRichEditor === 'function') {
      try {
        const editor = new window.CustomRichEditor(target, {
          placeholder: target.getAttribute('placeholder') || 'Enter text here',
          fonts: window.FROALA_FONTS || null,
        });
        blockEditors.set(block, editor);
        return;
      } catch (err) { /* fall through */ }
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
      // Strip Froala-injected inline sizing that survives destroy and squashes
      // the block on re-edit. Button/label-tag blocks own their padding/display
      // as real styles, so skip stripping those properties for them.
      const isShrinkBlock = block.classList.contains('cs-button-block') ||
        block.classList.contains('cs-label-block');
      const stripProps = isShrinkBlock
        ? ['min-height', 'height', 'max-height', 'margin-top', 'margin-bottom', 'overflow']
        : ['min-height', 'height', 'max-height', 'padding', 'padding-top', 'padding-bottom',
            'padding-left', 'padding-right', 'margin-top', 'margin-bottom', 'overflow'];
      stripProps.forEach((prop) => { target.style.removeProperty(prop); });
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
    // Save an in-progress rename before the badge (and its label) is removed —
    // a blur event isn't guaranteed once the focused node is detached.
    commitLabelEdit(true);

    const stoppedBlock = editingBlock;
    if (stoppedBlock) {
      stopFroala(stoppedBlock);
      editingBlock = null;
    }
    selectedBlock = null;
    lastSelectionRange = null;
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
    // On a cover page the inline "+" line only shows while idle, so hide it the
    // instant a block is selected instead of waiting for the next pointermove
    // (refreshHover also guards on .cs-selected, but only on the next move).
    if (block.closest?.('[data-cs-cover="1"]')) {
      window.FlowCanvas?.hideInlineInsert?.();
    }
  };

  // Drop the caret at viewport coords (x, y) inside the block's edit target.
  // Entering editing makes the element contenteditable only AFTER the click was
  // dispatched, so the browser never placed a native caret from that click and
  // the editor's focus() leaves it at the very start. We re-create the caret the
  // user aimed at from the click coordinates. No-op if the point misses the
  // editable text (e.g. the click landed on padding).
  const placeCaretFromPoint = (block, x, y) => {
    const target = findEditTarget(block);
    if (!target) return;

    let range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y); // WebKit / Blink
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y); // Firefox
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
      }
    }
    if (!range || !target.contains(range.startContainer)) return;

    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const enterEditing = (block, caretPoint = null) => {
    if (editingBlock === block) return;
    // Re-use the selected chrome; just upgrade it
    if (selectedBlock && selectedBlock !== block) {
      clearAll({ internal: true });
    }
    // Ensure badge exists (we kept .cs-selected on; remove it because cs-editing replaces it visually)
    removeChrome(block);
    block.classList.remove('cs-selected');
    block.classList.add('cs-editing');

    // Drop the inline "+" insert indicator right away so it never overlaps the
    // editing surface (refreshHover also guards on .cs-editing, but that only
    // fires on the next pointermove — this hides it instantly on entry).
    window.FlowCanvas?.hideInlineInsert?.();

    editingBlock = block;
    selectedBlock = null;

    // Init Froala FIRST. Add chrome AFTER an rAF tick so Froala's async init
    // (including its `initialized` event handler) finishes mutating DOM before
    // we append the badge + resize handles. Without this delay, Froala's
    // post-init DOM work can wipe siblings on the second edit cycle.
    startFroala(block);

    // The editor focuses the target and parks the caret at the start. If the
    // user clicked into existing text, move it to where they clicked. Runs after
    // startFroala so the element is already contenteditable + focused.
    if (caretPoint) placeCaretFromPoint(block, caretPoint.x, caretPoint.y);

    const attachChrome = () => {
      if (editingBlock !== block) return; // user already moved on
      removeChrome(block);
      block.appendChild(buildBadge(block));
      block.appendChild(buildResizeHandles());
    };
    requestAnimationFrame(() => requestAnimationFrame(attachChrome));
  };

  /* ----------------------------- drag / move (selected only) ----------------------------- */

  // The editor surface hosts the click / move / resize listeners. Prefer the
  // multi-page board (.cs_paper) so EVERY page is covered — including added
  // pages and cover pages, which live in their own `.custom-form-design`
  // siblings rather than under page 1's wrapper. Falls back to the single
  // canvas when there's no multi-page board (e.g. embedded web component).
  const dropSurface = () =>
    document.querySelector('.cs_paper') || document.querySelector('.custom-form-design');

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

  // Block types that must NOT be reparented into a group when dragged over one.
  const GROUP_RESTRICTED_TYPES = new Set(['group', 'section-container', 'sync-list']);
  const canDropIntoGroup = (block) => {
    if (!block) return false;
    if (block.classList.contains('cs-group-block')) return false;
    if (block.classList.contains('cs-synclist-block')) return false;
    const bt = block.dataset.blockType;
    if (bt && GROUP_RESTRICTED_TYPES.has(bt)) return false;
    return true;
  };

  // When a free block (direct cover-page child) is released, check if its
  // centre overlaps a group block — if so, reparent it into the group.
  const tryReparentIntoGroup = (block, cover) => {
    if (!canDropIntoGroup(block)) return;
    const blockRect = block.getBoundingClientRect();
    const cx = (blockRect.left + blockRect.right) / 2;
    const cy = (blockRect.top + blockRect.bottom) / 2;

    const groups = Array.from(cover.querySelectorAll(':scope > .cs-group-block'));
    let targetGroup = null;
    for (const g of groups) {
      const gr = g.getBoundingClientRect();
      if (cx >= gr.left && cx <= gr.right && cy >= gr.top && cy <= gr.bottom) {
        targetGroup = g; break;
      }
    }
    if (!targetGroup) return;

    const groupRect = targetGroup.getBoundingClientRect();
    block.style.left = `${Math.round(blockRect.left - groupRect.left)}px`;
    block.style.top = `${Math.round(blockRect.top - groupRect.top)}px`;
    block.dataset.csInSection = '1';
    block.style.position = 'absolute';
    targetGroup.appendChild(block);
    window.FlowCanvas?.refitGroupToChildren?.(targetGroup);
  };

  /* --------- live position / size readout (free-move blocks only) ---------
   * While dragging or resizing a free-positioned block (cover page or flexible
   * container), show the live X/Y (move) or W/H (resize) right where the title
   * badge sits, then restore the title on release. */
  const metricState = { label: null, orig: null };

  const isFreeFormBlock = (block) =>
    !!block && (block.dataset.csInSection === '1'
      || block.classList.contains('cs-flexible-block')
      || !!block.closest?.('[data-cs-cover="1"]'));

  const showMetric = (block, text) => {
    const badge = block.querySelector(':scope > .cs-block-badge');
    const label = badge && badge.querySelector('.cs-block-badge__label');
    if (!label) return;
    // New gesture / different block: restore the previous one and snapshot this
    // label's real title so we can put it back when the gesture ends.
    if (metricState.label !== label) {
      restoreMetric();
      metricState.label = label;
      metricState.orig = label.textContent;
    }
    label.textContent = text;
    label.classList.add('cs-block-badge__label--metric');
  };

  const restoreMetric = () => {
    if (metricState.label && metricState.orig != null) {
      metricState.label.textContent = metricState.orig;
      metricState.label.classList.remove('cs-block-badge__label--metric');
    }
    metricState.label = null;
    metricState.orig = null;
  };

  /* --------- smart alignment guides for free-move (cover / section) blocks ----
   * While dragging or resizing a free block we snap its edges/centre to the
   * page edges/centre and to other blocks' edges/centres (within a few px) and
   * draw pink guide lines — so blocks line up straight, at equal heights, and
   * share widths without guesswork. The guide overlay is editor-only chrome. */
  const ALIGN_TOL = 3; // px

  // Candidate snap lines in the parent: page edges + centre, and every sibling
  // block's left/centre/right (vx) and top/middle/bottom (hy).
  const alignLines = (parent, block) => {
    const vx = [0, parent.clientWidth / 2, parent.clientWidth];
    const hy = [0, parent.clientHeight / 2, parent.clientHeight];
    Array.from(parent.children).forEach((c) => {
      if (c === block || !c.matches || !c.matches('.cs_block_s')) return;
      const l = c.offsetLeft, t = c.offsetTop, w = c.offsetWidth, h = c.offsetHeight;
      vx.push(l, l + w / 2, l + w);
      hy.push(t, t + h / 2, t + h);
    });
    return { vx, hy };
  };

  // Best snap for the moving box [left,top,w,h]; returns adjusted left/top plus
  // the guide coordinates to draw (or null). `edges` limits which of the box's
  // own anchors may snap (used by resize so only the dragged edge snaps).
  const snapAlign = (parent, block, left, top, w, h, edges) => {
    const { vx, hy } = alignLines(parent, block);
    const ex = edges || { l: true, c: true, r: true, t: true, m: true, b: true };
    let bV = null, bH = null;
    const vAnchors = [];
    if (ex.l) vAnchors.push(0); if (ex.c) vAnchors.push(w / 2); if (ex.r) vAnchors.push(w);
    const hAnchors = [];
    if (ex.t) hAnchors.push(0); if (ex.m) hAnchors.push(h / 2); if (ex.b) hAnchors.push(h);
    vAnchors.forEach((off) => vx.forEach((gx) => {
      const d = Math.abs((left + off) - gx);
      if (d <= ALIGN_TOL && (!bV || d < bV.d)) bV = { d, guide: gx, newLeft: gx - off };
    }));
    hAnchors.forEach((off) => hy.forEach((gy) => {
      const d = Math.abs((top + off) - gy);
      if (d <= ALIGN_TOL && (!bH || d < bH.d)) bH = { d, guide: gy, newTop: gy - off };
    }));
    return {
      left: bV ? bV.newLeft : left,
      top: bH ? bH.newTop : top,
      vGuide: bV ? bV.guide : null,
      hGuide: bH ? bH.guide : null,
    };
  };

  let alignGuideEl = null;
  const showAlignGuides = (parent, vGuide, hGuide) => {
    if (vGuide == null && hGuide == null) { clearAlignGuides(); return; }
    if (!alignGuideEl || alignGuideEl.parentElement !== parent) {
      clearAlignGuides();
      alignGuideEl = document.createElement('div');
      alignGuideEl.className = 'cs-align-guides';
      alignGuideEl.setAttribute('data-cs-chrome', '');
      parent.appendChild(alignGuideEl);
    }
    alignGuideEl.innerHTML = '';
    if (vGuide != null) {
      const v = document.createElement('div');
      v.className = 'cs-align-guide cs-align-guide--v';
      v.style.left = `${vGuide}px`;
      alignGuideEl.appendChild(v);
    }
    if (hGuide != null) {
      const hl = document.createElement('div');
      hl.className = 'cs-align-guide cs-align-guide--h';
      hl.style.top = `${hGuide}px`;
      alignGuideEl.appendChild(hl);
    }
  };
  const clearAlignGuides = () => { if (alignGuideEl) { alignGuideEl.remove(); alignGuideEl = null; } };

  const onMoveDown = (event) => {
    wasDragged = false;
    // Let resize handles operate freely
    if (event.target.closest('.cs-resize-handle')) return;
    // Badge action buttons are clicks, not drags — never start a move on them.
    if (event.target.closest('[data-cs-action]')) return;
    // Renaming the badge label: clicks place the caret, they don't drag.
    if (event.target.closest('.cs-block-badge__label[contenteditable="true"]')) return;

    const block = event.target.closest('.cs_block_s');
    if (!block) return;

    // Locked layers (set from the Layers panel) can't be moved.
    if (block.closest('[data-cs-locked="1"]')) return;

    // Group containers (and dragging the whole multi-selection) are owned by
    // group.js — it manages those drags with a movement threshold so a clean
    // click can still drill into a child. Inline-editor must not start a move
    // or capture the pointer for a group, or it hijacks that click.
    if (block.classList.contains('cs-group-block')) return;

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

    // Child blocks inside a group are allowed to move beyond the group's current
    // boundary (constrained by the cover page instead). The group live-expands
    // rightward/downward; refitGroupToChildren on mouseup handles any top/left
    // overflow by repositioning the group and adjusting all children.
    const parentIsGroup = parent.classList?.contains('cs-group-block');
    // A flexible container holds absolute children, but (unlike a group) its
    // content box does NOT grow to wrap them — so its height stays at the
    // current min-height. That left maxTop = parentHeight - blockHeight ≈ 0
    // when the box was only as tall as one block, pinning a duplicated block
    // at the top and allowing horizontal movement only. Treat it like a group:
    // allow dragging downward and live-expand the box (below) so there's
    // always vertical room.
    const parentIsFlexible = parent.classList?.contains('cs-flexible-content');
    let minLeft, maxLeft, minTop, maxTop;
    if (parentIsGroup) {
      const cover = parent.closest('[data-cs-cover="1"]');
      if (cover) {
        const coverRect = cover.getBoundingClientRect();
        const bw = block.offsetWidth, bh = block.offsetHeight;
        minLeft = coverRect.left - parentRect.left;
        maxLeft = coverRect.right - parentRect.left - bw;
        minTop = coverRect.top - parentRect.top;
        maxTop = coverRect.bottom - parentRect.top - bh;
      } else {
        ({ minLeft, maxLeft, minTop, maxTop } = getFlexibleMoveBounds(parent, block));
      }
    } else if (parentIsFlexible) {
      // Horizontal stays clamped to the box width; vertical is free to grow
      // (the box live-expands downward below, refit on mouseup tidies it).
      ({ minLeft, maxLeft } = getFlexibleMoveBounds(parent, block));
      minTop = 0;
      maxTop = Infinity;
    } else {
      ({ minLeft, maxLeft, minTop, maxTop } = getFlexibleMoveBounds(parent, block));
    }

    if (Math.abs(event.clientX - move.startX) > 3 || Math.abs(event.clientY - move.startY) > 3) {
      wasDragged = true;
    }

    let left = Math.min(Math.max(event.clientX - parentRect.left - offsetX, minLeft), maxLeft);
    let top = Math.min(Math.max(event.clientY - parentRect.top - offsetY, minTop), maxTop);

    // Smart-guide snapping (free blocks): align edges/centre to page + siblings.
    if (isFreeFormBlock(block)) {
      const a = snapAlign(parent, block, left, top, block.offsetWidth, block.offsetHeight);
      left = a.left; top = a.top;
      showAlignGuides(parent, a.vGuide, a.hGuide);
    }

    block.style.left = `${left}px`;
    block.style.top = `${top}px`;

    // Live-expand the group's right/bottom edge as the child is dragged outward.
    // Top/left overflow is handled by refitGroupToChildren on mouseup.
    if (parentIsGroup) {
      const neededW = left + block.offsetWidth;
      const neededH = top + block.offsetHeight;
      if (neededW > parent.clientWidth) parent.style.width = `${neededW}px`;
      if (neededH > parent.clientHeight) parent.style.height = `${neededH}px`;
    } else if (parentIsFlexible) {
      // Grow the flexible content box downward so the block can be dropped
      // below the previous content height (its absolute children don't
      // contribute to the box height on their own). syncFlexibleContentBounds
      // on mouseup reconciles the final height.
      const neededH = top + block.offsetHeight;
      if (neededH > parent.clientHeight) parent.style.minHeight = `${neededH}px`;
    }

    // Live X/Y readout in the title badge for free-move blocks.
    if (isFreeFormBlock(block)) {
      showMetric(block, `X: ${Math.round(left)}  Y: ${Math.round(top)}`);
    }
  };

  const onMoveUp = () => {
    restoreMetric();
    clearAlignGuides();
    const moved = move?.block;
    const didDrag = wasDragged;
    move = null;
    // A child moved inside a group → grow/shrink the group to wrap its children.
    const group = moved?.closest?.('.cs-group-block');
    if (group && group !== moved) {
      window.FlowCanvas?.refitGroupToChildren?.(group);
    } else if (didDrag && moved && moved.dataset?.csInSection === '1') {
      // Free block on a cover page was dragged — if it lands over a group, reparent it.
      const cover = moved.closest?.('[data-cs-cover="1"]');
      if (cover) tryReparentIntoGroup(moved, cover);
    }
    // A child moved inside a flexible box → grow the box so it wraps the
    // lowest child (the box's absolute children don't size it on their own,
    // so without this the box would clip a block dragged below its old height).
    const flexBox = moved?.parentElement?.matches?.('.cs-flexible-content')
      ? moved.parentElement.closest('.cs-flexible-block')
      : null;
    if (didDrag && flexBox) {
      let lowest = 0;
      flexBox.querySelectorAll(':scope > .cs-flexible-content > .cs_block_s').forEach((c) => {
        lowest = Math.max(lowest, (parseFloat(c.style.top) || 0) + c.offsetHeight);
      });
      const content = flexBox.querySelector(':scope > .cs-flexible-content');
      const floor = window.CanvasConfig?.flexible?.minHeight ?? 20;
      if (content) content.style.minHeight = `${Math.max(floor, Math.round(lowest))}px`;
    }
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
    // Locked layers can't be resized.
    if (block.closest('[data-cs-locked="1"]')) return;

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
    let MIN_H = isFreeForm ? (flexCfg.minHeight ?? 20) : MIN;

    // Divider and spacer blocks have no content — let them shrink to 1px.
    const blockType = block.dataset.blockType;
    if (blockType === 'divider' || blockType === 'spacer') MIN_H = 1;

    // For a TEXT block, never shrink the height below the text's natural height
    // — otherwise the box clips and the text overflows it (the box would be
    // shorter than the content). The edit target is height:auto, so its
    // scrollHeight is the true content height regardless of the box size.
    const editEl = block.querySelector('.edit_me');
    if (editEl && editEl.closest('.cs_block_s') === block) {
      const csb = getComputedStyle(block);
      const extra = (parseFloat(csb.paddingTop) || 0) + (parseFloat(csb.paddingBottom) || 0)
        + (parseFloat(csb.borderTopWidth) || 0) + (parseFloat(csb.borderBottomWidth) || 0);
      MIN_H = Math.max(MIN_H, Math.ceil(editEl.scrollHeight + extra));
    }

    // For TABLE and TABLE-REPEATER blocks, never shrink below the rendered table height.
    if (blockType === 'table' || blockType === 'table-repeater') {
      const tableEl = block.querySelector('table.cs-table') || block.querySelector('table');
      if (tableEl) MIN_H = Math.max(MIN_H, Math.ceil(tableEl.getBoundingClientRect().height));
    }

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

    // A vertical resize must PIN the height as a min-height floor, not just set
    // `height`. Both the editor's auto-grow (_onInputGrow) and edit-entry
    // (startFroala) force `height:auto`, which would otherwise collapse a
    // manually-enlarged but empty/short block back to its content height the
    // next time it's edited. min-height survives `height:auto` while still
    // letting the box grow when the content is taller.
    const pinHeight = dir.includes('n') || dir.includes('s');

    // Flow-mode blocks (sections in a column) aren't absolutely positioned —
    // skip left/top, cap width to parent column.
    const isFlowBlock = block.closest('.cs-flow-canvas') && !block.dataset.csInSection;
    if (isFlowBlock) {
      block.style.height = `${newH}px`;
      if (pinHeight) block.style.minHeight = `${newH}px`;

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
      // Smart-guide snapping for the dragged edge(s): line up with the page or
      // sibling blocks, keeping the opposite edge fixed.
      if (isFreeForm && block.offsetParent) {
        const { vx, hy } = alignLines(block.offsetParent, block);
        const near = (val, cands) => { let b = null; cands.forEach((g) => { const d = Math.abs(val - g); if (d <= ALIGN_TOL && (!b || d < b.d)) b = { d, g }; }); return b; };
        let vG = null, hG = null;
        if (dir.includes('e')) { const s = near(newLeft + newW, vx); if (s && (s.g - newLeft) >= MIN_W) { newW = s.g - newLeft; vG = s.g; } }
        else if (dir.includes('w')) { const s = near(newLeft, vx); if (s && ((newLeft + newW) - s.g) >= MIN_W) { newW = (newLeft + newW) - s.g; newLeft = s.g; vG = s.g; } }
        if (dir.includes('s')) { const s = near(newTop + newH, hy); if (s && (s.g - newTop) >= MIN_H) { newH = s.g - newTop; hG = s.g; } }
        else if (dir.includes('n')) { const s = near(newTop, hy); if (s && ((newTop + newH) - s.g) >= MIN_H) { newH = (newTop + newH) - s.g; newTop = s.g; hG = s.g; } }
        showAlignGuides(block.offsetParent, vG, hG);
      }
      block.style.width = `${newW}px`;
      block.style.height = `${newH}px`;
      if (pinHeight) block.style.minHeight = `${newH}px`;
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

    // Image/video media is pinned to a fixed inline height at creation — a
    // vertical resize must drive that pinned height too, otherwise the picture
    // stays at its old size inside the resized box.
    if (pinHeight) window.FlowCanvas?.syncMediaToBlock?.(block);

    // Live W/H readout in the title badge for free-form blocks.
    if (isFreeForm) {
      showMetric(block, `W: ${Math.round(newW)}  H: ${Math.round(newH)}`);
    }
  };

  const onResizeUp = () => {
    restoreMetric();
    clearAlignGuides();
    const resized = resize?.block;
    resize = null;
    // A child resized inside a group → grow the group so it wraps all children.
    const group = resized?.closest?.('.cs-group-block');
    if (group && group !== resized) window.FlowCanvas?.refitGroupToChildren?.(group);
  };

  /* ----------------------------- click routing ----------------------------- */

  const onSurfaceClick = (event) => {
    if (wasDragged) {
      wasDragged = false;
      return;
    }

    // Ignore clicks on our own chrome (handled by their own listeners)
    if (event.target.closest('[data-cs-chrome]')) return;

    // Innermost block under the click selects directly — a child inside a group
    // selects the child, clicking the group's own area selects the group.
    const block = event.target.closest('.cs_block_s');

    if (!block) {
      // No block under the click. If this is the tail of a drag that began
      // inside the active block (text selection released on empty page area or
      // the .cs_paper gutter outside the page), the user never meant to click
      // away — keep editing + the selection. A real click on empty canvas has
      // its press start outside the block, so the flag is false and we tear
      // down as normal. Do NOT reset the flag here: onDocumentClick fires for
      // this same click and must read the same value — onCaptureMouseDown is
      // the sole owner and re-sets it on the next press.
      if (pressStartedInActive) {
        return;
      }
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
      // A group is a move-only container — never enter text editing on it.
      if (block.classList.contains('cs-group-block')) return;
      // Pass the click point so the caret lands where the user clicked.
      enterEditing(block, { x: event.clientX, y: event.clientY });
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
    if (!editingBlock && !selectedBlock) {
      pressStartedInActive = false;
      return;
    }

    const target = event.target;
    const activeBlock = editingBlock || selectedBlock;

    // Remember whether this gesture began inside the active block so the trailing
    // `click` (which may land outside the page if the user drag-selected past the
    // block edge) isn't mistaken for an outside click that exits edit mode.
    pressStartedInActive = activeBlock.contains(target);

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

    // Tail of a text-selection drag that began inside the block and released
    // fully outside the page: the browser fires `click` on a common ancestor
    // (e.g. .cs_paper) outside the canvas. The user never meant to click away,
    // so keep editing. Read-only: onSurfaceClick may have already handled this
    // same click — the flag is owned by onCaptureMouseDown, which re-sets it on
    // the next press, so neither click handler must consume it here.
    if (pressStartedInActive) {
      return;
    }

    clearAll();
  };

  const onKeydown = (event) => {
    // A rename is in progress — the label's own listeners own the keyboard.
    if (labelEdit) return;

    if (event.key === 'Escape') {
      clearAll();
      return;
    }

    // Ctrl/Cmd+R on the active block → rename it (edit the badge label).
    // preventDefault stops the browser's reload while a block is active.
    if ((event.ctrlKey || event.metaKey) && (event.key === 'r' || event.key === 'R')) {
      const block = selectedBlock || editingBlock;
      if (block) {
        event.preventDefault();
        startLabelEdit(block);
      }
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

    let minLeft, maxLeft, minTop, maxTop;
    if (parent?.classList?.contains('cs-group-block')) {
      const cover = parent.closest('[data-cs-cover="1"]');
      if (cover) {
        const bw = block.offsetWidth, bh = block.offsetHeight;
        minLeft = -parent.offsetLeft;
        maxLeft = cover.clientWidth - parent.offsetLeft - bw;
        minTop = -parent.offsetTop;
        maxTop = cover.clientHeight - parent.offsetTop - bh;
      } else {
        ({ minLeft, maxLeft, minTop, maxTop } = getFlexibleMoveBounds(parent, block));
      }
    } else {
      ({ minLeft, maxLeft, minTop, maxTop } = getFlexibleMoveBounds(parent, block));
    }

    let left = readRenderedPosition(block, 'left');
    let top = readRenderedPosition(block, 'top');

    if (event.key === 'ArrowLeft') left -= step;
    if (event.key === 'ArrowRight') left += step;
    if (event.key === 'ArrowUp') top -= step;
    if (event.key === 'ArrowDown') top += step;

    block.style.left = `${Math.min(Math.max(left, minLeft), maxLeft)}px`;
    block.style.top = `${Math.min(Math.max(top, minTop), maxTop)}px`;

    // Arrow-nudge on a group child → refit the group to wrap all children.
    const group = block.closest('.cs-group-block');
    if (group) window.FlowCanvas?.refitGroupToChildren?.(group);
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
            // Blocks seeded into header/footer regions during page add are not
            // user-initiated drops — skip them to avoid clearing block selection
            // on existing pages whenever a new page is added with header/footer.
            if (newBlock.closest('.cs-page-header, .cs-page-footer')) continue;
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
    if (!editingBlock) return;
    const sel = document.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (editingBlock.contains(range.commonAncestorContainer)) {
        lastSelectionRange = range.cloneRange();
      }
    }
  };

  document.addEventListener('selectionchange', updateSelectionRange);

  const insertTextAtCursor = (text) => {
    if (!editingBlock) return false;
    const doc = document;
    const selection = doc.getSelection();
    let range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (range && !editingBlock.contains(range.commonAncestorContainer)) range = null;
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
