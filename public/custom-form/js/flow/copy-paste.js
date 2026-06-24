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

  // The page the user last interacted with (content page or cover page). Used so
  // a paste with no selected block lands on the ACTIVE page — not always page 1.
  let activePage = null;

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

  // The whole multi-page board. Pages (content pages AND cover pages) live in
  // separate `.custom-form-design` wrappers under one `.cs_paper`, so a single
  // page's canvas does NOT contain blocks on the other pages. Containment checks
  // must use the board, or copy/paste from a cover page falls back to page 1.
  const boardOf = (canvas) =>
    canvas?.closest?.('.cs_paper') || document.querySelector('.cs_paper') || canvas;

  const isFlowBlock = (el, canvas) => (
    el && el.matches?.('.cs_block_s, .canvas-block') &&
    boardOf(canvas).contains(el) &&
    !el.dataset.csInSection &&
    el.parentElement?.matches?.('.col-item')
  );

  // Containers that hold absolutely-positioned ("free") children: a flexible
  // box, a cover page, or a group. A block's free parent is its IMMEDIATE such
  // container — so paste/duplicate lands back in the SAME place (same cover
  // page, same group, same flexible box).
  const FREE_PARENT_SEL = '.cs-flexible-content, .cs-group-block, [data-cs-cover="1"]';
  const freeParentOf = (el, canvas) => {
    if (!el || !boardOf(canvas).contains(el)) return null;
    const p = el.parentElement;
    return p && p.matches?.(FREE_PARENT_SEL) ? p : null;
  };

  // A block that lives inside any free-positioning container (flexible / cover /
  // group). Its paste/duplicate should land back inside that same container.
  const isFlexibleChild = (el, canvas) => !!freeParentOf(el, canvas);

  const copySelected = () => {
    const EM = window.EditorManager;
    const block = EM?.getSelected?.();
    if (!block) return false;

    const clone = cleanClone(block.cloneNode(true));
    clipboardHtml = clone.outerHTML;

    // Also overwrite the SYSTEM clipboard with this block's text. The paste
    // handler treats "an image sits on the clipboard" as a newer external copy
    // that should out-rank the in-memory block — so a picture copied earlier
    // must not linger and hijack a fresh block copy. Writing here clears it.
    // Best-effort: if clipboard-write isn't permitted we still have clipboardHtml.
    try {
      const text = (block.innerText || '').trim() || ' ';
      navigator.clipboard?.writeText?.(text)?.catch?.(() => { });
    } catch (e) { /* clipboard API unavailable — ignore */ }
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
    row ? Array.from(row.children).filter((c) => c.matches?.('.col-item')) : []
  );

  // Where should a new block land, relative to an anchor block?
  //   - anchor's row has MULTIPLE columns → place in the same column, right
  //     after the anchor (keeps the multi-column layout).
  //   - anchor's row has a SINGLE column   → create a brand-new row right after
  //     the current one (like adding a fresh block to a row).
  // Fall back to a new row at the end of the doc when there is no anchor.
  const resolvePasteTarget = (canvas, anchor) => {
    // Anchor inside a free-positioning container (flexible / cover / group) →
    // paste back into that SAME container as an absolute child.
    const freeParent = freeParentOf(anchor, canvas);
    if (freeParent) {
      return { freeParent, target: { kind: 'in-free', parent: freeParent } };
    }

    if (isFlowBlock(anchor, canvas)) {
      const col = anchor.closest('.col-item');
      const row = anchor.closest('.row-item');
      const doc = anchor.closest('.cs_margin');
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

    // No usable anchor: drop onto the ACTIVE page (the last page the user
    // touched), honouring cover pages (absolute) vs content pages (flow).
    const board = boardOf(canvas);
    const page = activePage && board.contains(activePage) ? activePage : null;
    if (page && page.matches('[data-cs-cover="1"]')) {
      return { freeParent: page, target: { kind: 'in-free', parent: page } };
    }
    const doc = (page && page.matches('.cs_margin') ? page : null) || board.querySelector('.cs_margin');
    if (!doc) return null;
    return { doc, target: { kind: 'between-rows', parent: doc, beforeRow: null } };
  };

  // Place a ready-built block next to an anchor, then select it (immediate
  // feedback + becomes the next paste/duplicate anchor).
  const placeAndSelect = (canvas, newBlock, anchor) => {
    if (!newBlock) return null;

    // ---- Container-selected paste: paste INTO the container, not next to it ----

    // List container (the col itself) is selected → create a new synced block
    // in this col and all sibling cols, same as adding a block to the list.
    if (anchor?.classList?.contains('cs-synclist__col') && window.SyncList?.pasteIntoCol) {
      const placed = window.SyncList.pasteIntoCol(anchor, newBlock);
      if (placed) {
        requestAnimationFrame(() => {
          if (!boardOf(canvas).contains(placed)) return;
          placed.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          placed.click();
        });
        return placed;
      }
    }

    // Group block selected → paste as a free child inside the group.
    // Exception: if the block being pasted IS itself a group, it should land
    // next to the anchor group (same cover page level), not nested inside it.
    if (anchor?.classList?.contains('cs-group-block') && !newBlock.classList?.contains('cs-group-block')) {
      newBlock.dataset.csInSection = '1';
      newBlock.style.position = 'absolute';
      newBlock.style.left = '8px';
      newBlock.style.top = '8px';
      anchor.appendChild(newBlock);
      window.FlowCanvas?.refitGroupToChildren?.(anchor);
      requestAnimationFrame(() => {
        if (!boardOf(canvas).contains(newBlock)) return;
        newBlock.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        newBlock.click();
      });
      return newBlock;
    }

    // Flexible block or Section container selected → paste into the inner free
    // canvas (cs-flexible-content) or the section's row/col content area.
    const innerCanvas = anchor?.querySelector?.(':scope > .cs-flexible-content');
    const innerSection = !innerCanvas && anchor?.querySelector?.(':scope > .section-container-content');
    if (innerCanvas) {
      newBlock.dataset.csInSection = '1';
      newBlock.style.position = 'absolute';
      newBlock.style.left = '8px';
      newBlock.style.top = '8px';
      innerCanvas.appendChild(newBlock);
      window.FlowCanvas?.syncFlexibleContentBounds?.(anchor);
      requestAnimationFrame(() => {
        if (!boardOf(canvas).contains(newBlock)) return;
        newBlock.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        newBlock.click();
      });
      return newBlock;
    }
    if (innerSection) {
      const doc = anchor.closest('.cs_margin');
      window.FlowCanvas?.placeBlock?.(doc, newBlock,
        { kind: 'between-rows', parent: innerSection, beforeRow: null });
      requestAnimationFrame(() => {
        if (!boardOf(canvas).contains(newBlock)) return;
        newBlock.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        newBlock.click();
      });
      return newBlock;
    }

    // ---- List-aware paste for child blocks already inside a col ----
    // Two cases, both keep the synced behaviour:
    //   - a whole Container (column) was copied → add it as a new column whose
    //     children clone into the existing sync groups (handleColumnPaste);
    //   - a content block was copied while a child-block anchor → paste into
    //     that column + clone across the others as a new group (handlePaste).
    if (anchor?.closest?.('.cs-synclist__col') && window.SyncList) {
      const isColumn = newBlock.classList?.contains('cs-synclist__col');
      const fn = isColumn ? window.SyncList.handleColumnPaste : window.SyncList.handlePaste;
      const placed = fn && fn(anchor, newBlock);
      if (placed) {
        requestAnimationFrame(() => {
          if (!boardOf(canvas).contains(placed)) return;
          placed.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          placed.click();
        });
        return placed;
      }
    }

    const placement = resolvePasteTarget(canvas, anchor);
    if (!placement) return null;

    if (placement.freeParent) {
      // Append as an absolutely-positioned child of the SAME container (cover
      // page / group / flexible box), offset 10px so the copy is visible.
      const parent = placement.freeParent;
      newBlock.dataset.csInSection = '1';
      newBlock.style.position = 'absolute';
      const left = parseFloat(newBlock.style.left) || 0;
      const top = parseFloat(newBlock.style.top) || 0;
      newBlock.style.left = `${left + 10}px`;
      newBlock.style.top = `${top + 10}px`;
      parent.appendChild(newBlock);
      const wrapper = parent.closest('.cs-flexible-block') || parent;
      window.FlowCanvas?.syncFlexibleContentBounds?.(wrapper);
      // Pasted into a group → grow the group so it wraps the new child.
      if (parent.classList.contains('cs-group-block')) {
        window.FlowCanvas?.refitGroupToChildren?.(parent);
      }
    } else {
      window.FlowCanvas?.placeBlock?.(placement.doc, newBlock, placement.target);
    }

    requestAnimationFrame(() => {
      if (!boardOf(canvas).contains(newBlock)) return;
      newBlock.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      newBlock.click();
    });
    return newBlock;
  };

  // The block a freshly-pasted block should anchor next to (or into, for
  // container selections). Returns null only when there's nothing useful selected.
  const currentAnchor = (canvas) => {
    const anchor = window.EditorManager?.getSelected?.();
    if (!anchor) return null;
    // Synclist col selected (paste INTO col) or child block inside a col.
    if (anchor.closest?.('.cs-synclist__col')) return anchor;
    // Regular flow block or flexible child (paste next to it).
    if (isFlowBlock(anchor, canvas) || isFlexibleChild(anchor, canvas)) return anchor;
    // Group selected directly (paste inside group).
    if (anchor.classList?.contains('cs-group-block')) return anchor;
    return null;
  };

  const pasteBlock = (canvas) => (
    !!placeAndSelect(canvas, buildPasteBlock(), currentAnchor(canvas))
  );

  /* ------------------- external clipboard → new block ----------------------- */
  // Pasting content copied from another site/app (when NOT editing a block)
  // auto-creates the matching block, just like adding it from the sidebar and
  // then filling in the content:
  //   - image data  → an Image block showing the pasted picture;
  //   - text        → a Textarea (body-text) block holding the pasted text.

  // Escape plain text for safe innerHTML and keep line breaks visible (newlines
  // → <br>) so a multi-line paste reads the same as when it was copied.
  const textToHtml = (text) => text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r\n?|\n/g, '<br>');

  // Build an Image block populated with the pasted picture. Mirrors the
  // image-upload handler in flow-canvas.js: drop the "click to select"
  // placeholder and append a real <img> the container styles fill.
  const buildPastedImageBlock = (dataUrl) => {
    const block = window.FlowCanvas.createBlock?.('image');
    if (!block) return null;
    const container = block.querySelector('.image-container');
    if (container) {
      container.querySelector('.img-btn')?.remove();
      container.querySelector('img')?.remove();
      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = 'Pasted image';
      container.appendChild(img);
    }
    return block;
  };

  // Build a Textarea (body-text) block holding the pasted text.
  const buildPastedTextBlock = (text) => {
    const block = window.FlowCanvas.createBlock?.('body-text');
    if (!block) return null;
    const editable = block.querySelector('.edit_me');
    if (editable) editable.innerHTML = textToHtml(text);
    return block;
  };

  // Place the clipboard's image as a NEW Image block on the canvas, next to
  // `anchor`. Used both for plain canvas paste AND to push an image OUT of a
  // text block (a picture must never live inside a Title/Textarea — it lands in
  // the parent instead). Returns true when an image was found and placement
  // kicked off.
  //
  // A pasted image file ("Copy image") is always handled. An <img> embedded in
  // copied rich HTML (e.g. a web-page region) is only handled when
  // `includeHtmlImg` is set — on the canvas a text+image region stays a text
  // block (keeps the text); ejecting from a text block extracts the picture.
  const placePastedImageBlock = (canvas, clipboardData, anchor, includeHtmlImg = false) => {
    if (!clipboardData) return false;

    const imageItem = Array.from(clipboardData.items || [])
      .find((it) => it.kind === 'file' && it.type.startsWith('image/'));
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          placeAndSelect(canvas, buildPastedImageBlock(e.target.result), anchor);
        };
        reader.readAsDataURL(file);
        return true;
      }
    }

    if (includeHtmlImg) {
      const html = clipboardData.getData('text/html') || '';
      const src = html.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
      if (src) {
        placeAndSelect(canvas, buildPastedImageBlock(src), anchor);
        return true;
      }
    }
    return false;
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
    const isGroup = !!clone.querySelector('.cs_block_s, .canvas-block, .row-item');
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

    // Track the page the user last pressed on, so a paste with no selection
    // lands on the active page (cover or content) instead of always page 1.
    document.addEventListener('pointerdown', (e) => {
      const p = e.target?.closest?.('.cs_margin, .cs_page[data-cs-cover="1"]');
      if (p) activePage = p;
    }, true);

    // Expose the active page so other features (e.g. the per-page background
    // shape designer) can target the page the user is currently working on.
    window.FlowCanvas.getActivePage = () =>
      (activePage && document.contains(activePage) ? activePage : null);

    document.addEventListener('keydown', (event) => {
      const ctrl = event.ctrlKey || event.metaKey;
      if (!ctrl) return;

      const key = event.key.toLowerCase();
      if (key !== 'c' && key !== 'v' && key !== 'd') return;

      // While editing text inside a block, defer to native copy/paste.
      if (window.EditorManager?.getEditing?.()) return;

      const target = event.target;
      const inEditable = target?.isContentEditable ||
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA';
      if (inEditable) return;

      // Ctrl/Cmd+D → duplicate the selected block in place.
      if (key === 'd') {
        const sel = window.EditorManager?.getSelected?.();
        if (sel) {
          event.preventDefault();
          window.FlowCanvas.duplicateBlock?.(sel);
        }
        return;
      }

      // Only handle COPY here. Paste (Ctrl+V) is deliberately left to the native
      // `paste` listener below, so it can inspect the REAL system clipboard.
      // That's what lets a freshly-copied external image/text win over a
      // previously-copied internal block — hijacking paste here would always
      // re-insert the in-memory block and never even look at the clipboard.
      if (key === 'c') {
        // Only hijack copy when a block is actually selected; otherwise let the
        // browser copy any plain text selection normally.
        if (copySelected()) event.preventDefault();
      }
    });

    // Native paste. Two contexts:
    //   1. Editing a text block (or focused in a field) → text blocks accept
    //      TEXT ONLY. A pasted picture never lands inside a Title/Textarea; it
    //      is ejected to the parent as its own Image block instead, while any
    //      accompanying text still pastes into the block.
    //   2. Not editing (canvas) → drop the highest-priority clipboard content
    //      as a new block: external image → Image, else internal block, else
    //      external text → Textarea.
    //
    // CAPTURE phase (the `true` below): this must run BEFORE the active text
    // editor's (Froala's) own paste handler so we can stop it from inserting an
    // image into a text block. Cases we don't handle return early WITHOUT
    // stopping propagation, so the editor / table handlers still run normally.
    document.addEventListener('paste', (event) => {
      const target = event.target;
      const clipboardData = event.clipboardData;

      const inEditable = target?.isContentEditable ||
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA';

      // --- text-editing context: keep images out of text blocks ---
      if (window.EditorManager?.getEditing?.() || inEditable) {
        // Plain fields can't hold images, and the Table block runs its own
        // text-only paste handler — leave both to their native behaviour.
        if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
        if (target?.closest?.('table')) return;

        // Does the clipboard carry an image? Either a pasted file ("Copy
        // image") or an <img> embedded in copied rich HTML (a web-page region).
        const html = clipboardData?.getData('text/html') || '';
        const hasImageFile = Array.from(clipboardData?.items || [])
          .some((it) => it.kind === 'file' && it.type.startsWith('image/'));
        const htmlHasImage = /<img\b/i.test(html);

        // No image → let the native (rich) text paste run untouched.
        if (!hasImageFile && !htmlHasImage) return;

        // Image present → block the paste so no picture is inserted into the
        // text block. preventDefault alone is NOT enough: the active editor
        // (Froala) inserts the image programmatically from its OWN paste
        // handler, immune to the default-action cancel. stopImmediatePropagation
        // (this listener runs at capture phase, before the editor's handler)
        // stops that handler from ever firing. Then keep any accompanying plain
        // text in the block and eject the image to the parent as an Image block.
        event.preventDefault();
        event.stopImmediatePropagation();
        const text = clipboardData?.getData('text/plain') || '';
        if (text) {
          try { document.execCommand('insertText', false, text); } catch (e) { /* */ }
        }

        // Anchor the new Image block next to this text block so it lands right
        // in the parent (column / row), not somewhere unrelated.
        const editingBlock = window.EditorManager?.getEditing?.();
        const board = boardOf(canvas);
        const onCanvas = board.contains(target) ||
          (editingBlock && board.contains(editingBlock));
        if (onCanvas) {
          const anchor = currentAnchor(canvas) ||
            ((editingBlock && (isFlowBlock(editingBlock, canvas) || isFlexibleChild(editingBlock, canvas)))
              ? editingBlock : null);
          placePastedImageBlock(canvas, clipboardData, anchor, true);
        }
        return;
      }

      // --- canvas context: decide what Ctrl+V drops in ---
      // Priority:
      //   1. An external IMAGE on the clipboard. It can only have come from a
      //      copy made AFTER any internal block copy (an internal copy never
      //      writes to the system clipboard), so it reflects the latest intent.
      //      This is the fix for "copy a block, copy an image elsewhere, paste →
      //      the block came back": now the image wins.
      //   2. A previously-copied internal block (held in memory).
      //   3. External text.
      const anchor = currentAnchor(canvas);
      if (placePastedImageBlock(canvas, clipboardData, anchor)) {
        event.preventDefault();
        return;
      }
      if (clipboardHtml && pasteBlock(canvas)) {
        event.preventDefault();
        return;
      }
      const text = clipboardData?.getData('text/plain');
      if (text && text.trim()) {
        placeAndSelect(canvas, buildPastedTextBlock(text), anchor);
        event.preventDefault();
      }
    }, true);
  };
})();
