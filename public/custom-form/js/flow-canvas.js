/**
 * @fileoverview Flow Canvas — entry point.
 *
 * Wires together the feature modules under /flow/:
 *   - block-factory.js     — creates block elements
 *   - row-col-builder.js   — DOM scaffolding + placeBlock
 *   - drop-zones.js        — find target + visual indicator
 *   - col-resize.js        — draggable column divider
 *   - section-canvas.js    — in-section absolute placement
 *   - cleanup-observer.js  — auto-remove empty cols/rows
 *
 * This file:
 *   1. Bootstraps the .cs_margin root inside the canvas.
 *   2. Attaches drag/drop listeners that route through findDropTarget → placeBlock.
 *   3. Initializes column resize + cleanup observer.
 *
 * All shared helpers live on `window.FlowCanvas`.
 */
(function () {
  // Feature flag: set to true to enable header/footer rendering & sync.
  // When false, pages render without header/footer regions.
  let ENABLE_HEADER_FOOTER = false;

  const CANVAS_SELECTOR = '.custom-form-design';

  const canvas = document.querySelector(CANVAS_SELECTOR);
  if (!canvas) {
    console.warn('flow-canvas: canvas not found');
    return;
  }

  // Guard against double-initialization (HMR / accidental double-load).
  if (canvas.dataset.flowCanvasInit === '1') {
    console.warn('flow-canvas: already initialized, skipping');
    return;
  }
  canvas.dataset.flowCanvasInit = '1';

  canvas.classList.add('cs-flow-canvas');

  const FC = window.FlowCanvas || {};

  // -------------------------------------------------------------------------
  // Document model:
  //   canvas (.custom-form-design)
  //     └─ .cs_paper        — multi-page container
  //          ├─ .cs_margin[data-page="1"]  — first page (always has header/footer)
  //          ├─ .cs_margin[data-page="2"]  — additional pages (with or without)
  //          └─ ...
  // -------------------------------------------------------------------------
  // The host page owns the outer .cs_paper wrapper (see custom-form.html);
  // we must NOT inject a second .cs_paper inside the canvas. Pages
  // (.cs_margin) attach directly under the canvas so the existing drag /
  // drop listeners (mounted on the canvas) keep working. From the rest
  // of the file's point of view, `paper` is "the element pages live in" —
  // here, that's the canvas itself.
  //
  // If a legacy DOM still has a nested .cs_paper inside the canvas, lift
  // its docs up to canvas level and drop the empty wrapper.
  const legacyPaper = canvas.querySelector(':scope > .cs_paper');
  if (legacyPaper) {
    legacyPaper.querySelectorAll(':scope > .cs_margin').forEach((d) => canvas.appendChild(d));
    legacyPaper.remove();
  }
  const paper = canvas.closest('.cs_paper') || canvas;

  const makeRegion = (region) => {
    const el = (FC.makeRow && FC.makeRow()) || document.createElement('div');
    el.className = `row-item cs-page-${region}`;
    FC.assignNodeId?.(el, 'row');
    el.setAttribute('data-cs-page-region', region);
    el.setAttribute('data-cs-region-label', region.toUpperCase());
    const placeholder = `Double-click to edit ${region}`;
    el.setAttribute('data-cs-placeholder', placeholder);

    if (region === 'header') {
      const col1 = (FC.makeCol && FC.makeCol()) || document.createElement('div');
      if (!col1.classList.contains('col-item')) col1.classList.add('col-item');
      col1.style.flex = '2';
      col1.style.maxWidth = '100%';
      const imgBlock = FC.createBlock && FC.createBlock('image');
      if (imgBlock) {
        imgBlock.style.position = '';
        imgBlock.style.left = '';
        imgBlock.style.top = '';
        imgBlock.style.maxWidth = '100%';
        const wrapper = imgBlock.querySelector('.image-container');
        if (wrapper) wrapper.style.setProperty('height', '60px', 'important');
        col1.appendChild(imgBlock);
      }
      el.appendChild(col1);

      const col2 = (FC.makeCol && FC.makeCol()) || document.createElement('div');
      if (!col2.classList.contains('col-item')) col2.classList.add('col-item');
      col2.style.flex = '1';
      col2.style.maxWidth = '100%';
      const textBlock = FC.createBlock && FC.createBlock('body-text');
      if (textBlock) {
        textBlock.style.position = '';
        textBlock.style.left = '';
        textBlock.style.top = '';
        textBlock.style.maxWidth = '100%';
        col2.appendChild(textBlock);
      }
      el.appendChild(col2);

      setTimeout(() => { if (FC.rebuildDividers) FC.rebuildDividers(el); }, 0);
    } else if (region === 'footer') {
      const col1 = (FC.makeCol && FC.makeCol()) || document.createElement('div');
      if (!col1.classList.contains('col-item')) col1.classList.add('col-item');
      col1.style.flex = '2';
      col1.style.maxWidth = '100%';
      const textBlock = FC.createBlock && FC.createBlock('body-text');
      if (textBlock) {
        textBlock.style.position = '';
        textBlock.style.left = '';
        textBlock.style.top = '';
        textBlock.style.maxWidth = '100%';
        col1.appendChild(textBlock);
      }
      el.appendChild(col1);

      const col2 = (FC.makeCol && FC.makeCol()) || document.createElement('div');
      if (!col2.classList.contains('col-item')) col2.classList.add('col-item');
      col2.style.flex = '1';
      col2.style.maxWidth = '100%';
      const imgBlock = FC.createBlock && FC.createBlock('image');
      if (imgBlock) {
        imgBlock.style.position = '';
        imgBlock.style.left = '';
        imgBlock.style.top = '';
        imgBlock.style.maxWidth = '100%';
        const wrapper = imgBlock.querySelector('.image-container');
        if (wrapper) wrapper.style.setProperty('height', '60px', 'important');
        col2.appendChild(imgBlock);
      }
      el.appendChild(col2);

      setTimeout(() => { if (FC.rebuildDividers) FC.rebuildDividers(el); }, 0);
    } else {
      const col = (FC.makeCol && FC.makeCol()) || document.createElement('div');
      if (!col.classList.contains('col-item')) col.classList.add('col-item');
      col.setAttribute('data-cs-placeholder', placeholder);
      el.appendChild(col);
    }

    return el;
  };

  const ensurePageRegions = (docEl) => {
    if (docEl.dataset.csNoHeaderFooter === '1') return; // blank page
    let header = docEl.querySelector(':scope > .cs-page-header');
    let footer = docEl.querySelector(':scope > .cs-page-footer');
    let main = docEl.querySelector(':scope > .body-main-content');

    if (!main) {
      main = document.createElement('div');
      main.className = 'body-main-content';
      main.style.flex = '1';
      main.style.display = 'flex';
      main.style.flexDirection = 'column';
    }

    if (!header) {
      header = makeRegion('header');
      docEl.prepend(header);
    }

    if (!main.parentNode) {
      Array.from(docEl.querySelectorAll(':scope > .row-item:not(.cs-page-header):not(.cs-page-footer)')).forEach(r => main.appendChild(r));
    }

    if (!footer) {
      footer = makeRegion('footer');
      docEl.appendChild(footer);
    }

    if (header.nextElementSibling !== main) docEl.insertBefore(main, header.nextSibling);
    if (main.nextElementSibling !== footer) docEl.insertBefore(footer, main.nextSibling);

    return { header, footer, main };
  };

  const setRegionActive = (docEl, region) => {
    // Clear active state across ALL pages.
    paper.querySelectorAll('.cs_margin').forEach((d) => {
      d.classList.remove('editing-header', 'editing-footer');
      d.querySelectorAll('.cs-page-header, .cs-page-footer')
        .forEach((el) => el.classList.remove('is-active'));
    });
    if (!docEl || !region) return;
    const header = docEl.querySelector(':scope > .cs-page-header');
    const footer = docEl.querySelector(':scope > .cs-page-footer');
    if (region === 'header' && header) { header.classList.add('is-active'); docEl.classList.add('editing-header'); }
    else if (region === 'footer' && footer) { footer.classList.add('is-active'); docEl.classList.add('editing-footer'); }
  };

  const wireRegionEvents = (docEl) => {
    const header = docEl.querySelector(':scope > .cs-page-header');
    const footer = docEl.querySelector(':scope > .cs-page-footer');
    header?.addEventListener('dblclick', (e) => { e.stopPropagation(); setRegionActive(docEl, 'header'); });
    footer?.addEventListener('dblclick', (e) => { e.stopPropagation(); setRegionActive(docEl, 'footer'); });
  };

  const wireRegionOrderObserver = (docEl) => {
    let reordering = false;
    const obs = new MutationObserver(() => {
      if (reordering) return;
      const header = docEl.querySelector(':scope > .cs-page-header');
      const footer = docEl.querySelector(':scope > .cs-page-footer');
      if (!header && !footer) return;
      if (docEl.firstElementChild === header && docEl.lastElementChild === footer) return;
      reordering = true;
      if (header && docEl.firstElementChild !== header) docEl.prepend(header);
      if (footer && docEl.lastElementChild !== footer) docEl.appendChild(footer);
      requestAnimationFrame(() => { reordering = false; });
    });
    obs.observe(docEl, { childList: true });
  };

  // -------------------------------------------------------------------------
  // Header/footer sync across pages
  //
  // Any page's header/footer is editable. After the user finishes editing
  // (focus leaves the region, or typing stops for 400ms), the content is
  // copied to every other page's matching region.
  //
  // The non-destructive part: we don't overwrite innerHTML on every
  // keystroke. We only sync once the user pauses or moves focus away.
  // While the user is actively editing a region, mirror updates are
  // suspended for the page being edited so the cursor and selection
  // stay intact.
  // -------------------------------------------------------------------------
  let regionSyncing = false;
  const editingState = { region: null, docEl: null };

  // After cloning header/footer content to a mirror page we must rewrite
  // every `id` attribute so each page's blocks are still unique. The
  // editor and block IDs are used as keys by block-creator, inline-editor
  // and Froala — duplicate IDs break selection and editing.
  const rewriteIds = (root, suffix) => {
    root.querySelectorAll('[id]').forEach((el) => {
      const oldId = el.id;
      el.id = `${oldId}__p${suffix}`;
    });
  };

  const syncRegion = (region, sourceDocEl) => {
    if (regionSyncing) return;
    const source = sourceDocEl.querySelector(`:scope > .cs-page-${region} > .col-item`);
    if (!source) return;
    const html = source.innerHTML;
    regionSyncing = true;
    paper.querySelectorAll('.cs_margin').forEach((d) => {
      if (d === sourceDocEl) return;
      // Don't clobber the page the user is actively typing into.
      if (editingState.docEl === d && editingState.region === region) return;
      const target = d.querySelector(`:scope > .cs-page-${region} > .col-item`);
      if (target && target.innerHTML !== html) {
        target.innerHTML = html;
        rewriteIds(target, d.dataset.page || 'x');
      }
    });
    requestAnimationFrame(() => { regionSyncing = false; });
  };

  const wireRegionSync = (docEl) => {
    ['header', 'footer'].forEach((region) => {
      const regionEl = docEl.querySelector(`:scope > .cs-page-${region}`);
      const col = docEl.querySelector(`:scope > .cs-page-${region} > .col-item`);
      if (!regionEl || !col) return;

      // Track when this region is the one being actively edited so the
      // sync routine knows to leave it alone.
      regionEl.addEventListener('focusin', () => {
        editingState.region = region;
        editingState.docEl = docEl;
      });
      regionEl.addEventListener('focusout', (e) => {
        // If focus moved to another element in the SAME region, stay editing.
        if (regionEl.contains(e.relatedTarget)) return;
        if (editingState.docEl === docEl && editingState.region === region) {
          editingState.region = null;
          editingState.docEl = null;
          // On blur, push final content to all other pages.
          syncRegion(region, docEl);
        }
      });

      // Debounced sync while typing — runs 400ms after the last mutation
      // so we don't fight the user's cursor.
      let debounceTimer = null;
      const obs = new MutationObserver(() => {
        if (regionSyncing) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => syncRegion(region, docEl), 400);
      });
      obs.observe(col, { childList: true, subtree: true, characterData: true, attributes: true });
    });
  };

  // Pull current header/footer content from the canonical page into a
  // freshly-created doc. No-ops when there's no canonical page (it was deleted
  // and not yet re-established) or when seeding the canonical into itself.
  const seedRegionsFromCanonical = (docEl) => {
    if (!firstDoc || !document.contains(firstDoc) || docEl === firstDoc) return;
    ['header', 'footer'].forEach((region) => {
      const src = firstDoc.querySelector(`:scope > .cs-page-${region} > .col-item`);
      const dst = docEl.querySelector(`:scope > .cs-page-${region} > .col-item`);
      if (src && dst) {
        regionSyncing = true;
        dst.innerHTML = src.innerHTML;
        rewriteIds(dst, docEl.dataset.page || 'x');
        requestAnimationFrame(() => { regionSyncing = false; });
      }
    });
  };

  // Bootstrap page 1.
  let firstDoc = paper.querySelector('.cs_margin[data-page="1"]') || paper.querySelector('.cs_margin');
  if (!firstDoc) {
    firstDoc = document.createElement('div');
    firstDoc.className = 'cs_margin';
    firstDoc.dataset.page = '1';
    const firstPageWrapper = paper.querySelector('.cs_page') || paper;
    firstPageWrapper.appendChild(firstDoc);
  } else if (!firstDoc.dataset.page) {
    firstDoc.dataset.page = '1';
  }
  if (ENABLE_HEADER_FOOTER) {
    ensurePageRegions(firstDoc);
    wireRegionEvents(firstDoc);
    wireRegionOrderObserver(firstDoc);
    wireRegionSync(firstDoc);
  } else {
    firstDoc.dataset.csNoHeaderFooter = '1';
  }

  // Backwards-compat alias for the rest of the file (drag handlers
  // expect a single `doc`). It now always refers to page 1.
  const doc = firstDoc;

  // -------------------------------------------------------------------------
  // Add Page API — callable from the host shell or a future "+" button.
  //   window.FlowCanvas.addPage({ headerFooter: true | false }) → docEl
  // -------------------------------------------------------------------------
  const renumberPages = () => {
    paper.querySelectorAll('.cs_margin').forEach((d, i) => { d.dataset.page = String(i + 1); });
  };

  // Total pages = every `.cs_page` directly under the paper (content wrappers +
  // cover pages). Reported to the host shell so the footer / Delete-page button
  // stay in sync with add/remove.
  const countPages = () => paper.querySelectorAll(':scope > .cs_page').length;
  const postPageCount = () => {
    try {
      window.parent?.postMessage({ source: 'custom-form-twig', type: 'page:count', count: countPages() }, '*');
    } catch (e) { /* parent on different origin — ignore */ }
  };
  const postRemoveResult = (ok, reason) => {
    try {
      window.parent?.postMessage({ source: 'custom-form-twig', type: 'page:removed', ok: !!ok, reason: reason || null, count: countPages() }, '*');
    } catch (e) { /* ignore */ }
    return !!ok;
  };

  FC.addPage = function (opts) {
    const withHF = ENABLE_HEADER_FOOTER && (!opts || opts.headerFooter !== false);
    const newDoc = document.createElement('div');
    newDoc.className = 'cs_margin';
    if (!withHF) newDoc.dataset.csNoHeaderFooter = '1';

    if (paper.classList.contains('cs_paper')) {
      const pageWrapper = document.createElement('div');
      pageWrapper.className = 'cs_page custom-form-design centercontent cs-flow-canvas';
      pageWrapper.style.visibility = 'visible';
      pageWrapper.appendChild(newDoc);
      paper.appendChild(pageWrapper);
    } else {
      paper.appendChild(newDoc);
    }
    if (withHF) {
      ensurePageRegions(newDoc);
      // If the canonical page was deleted (no content page left to copy from),
      // this new page becomes the canonical source. Otherwise seed its
      // header/footer from the canonical, then start two-way sync.
      if (!firstDoc || !document.contains(firstDoc)) firstDoc = newDoc;
      seedRegionsFromCanonical(newDoc); // no-ops when newDoc IS the canonical
      wireRegionSync(newDoc);
      wireRegionEvents(newDoc);
      wireRegionOrderObserver(newDoc);
    }
    renumberPages();
    postPageCount();
    // Scroll to the new page and mark it active. focusPage handles the host
    // scroll container + waits for the iframe to resize; plain scrollIntoView
    // can't cross the iframe→host boundary reliably.
    if (FC.focusPage) FC.focusPage(newDoc);
    else newDoc.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return newDoc;
  };

  FC.removePage = function (docEl) {
    if (!docEl || docEl === firstDoc) return false; // can't remove page 1
    docEl.remove();
    renumberPages();
    postPageCount();
    return true;
  };

  // Remove the page the user is currently viewing (scroll-tracked active page),
  // covering both content pages (`.cs_page` wrapping a `.cs_margin`) and cover
  // pages (`.cs_page[data-cs-cover]`). Falls back to the last page when nothing
  // is selected. Page 1 (the header/footer canonical source) and the very last
  // remaining page are protected. Posts a `page:removed` result so the host can
  // surface why a delete was refused.
  FC.removeActivePage = function () {
    const pages = Array.from(paper.querySelectorAll(':scope > .cs_page'));
    if (pages.length <= 1) return postRemoveResult(false, 'last');

    const page = (FC.getSelectedPage && FC.getSelectedPage()) || pages[pages.length - 1];
    if (!page || !pages.includes(page)) return postRemoveResult(false, 'none');

    const isCover = page.matches('[data-cs-cover="1"]');

    // Any page can be deleted as long as one page (of any type) remains. If this
    // page held the header/footer canonical source (firstDoc), hand that role to
    // another content page when one exists; otherwise leave it empty — the next
    // content page added re-establishes it (see addPage). Every content page
    // already carries identical, synced header/footer content, so any other
    // `.cs_margin` is a valid replacement.
    if (!isCover && firstDoc && page.contains(firstDoc)) {
      firstDoc = Array.from(paper.querySelectorAll('.cs_margin')).find((m) => m !== firstDoc) || null;
    }

    // Pick a neighbour to scroll to once this page is gone.
    const i = pages.indexOf(page);
    const neighbor = pages[i - 1] || pages[i + 1] || null;

    page.remove();
    renumberPages();
    if (neighbor && FC.focusPage) FC.focusPage(neighbor);
    postPageCount();
    return postRemoveResult(true);
  };

  // Clear the content of the page the user is viewing WITHOUT deleting the page:
  // every dropped block / row is removed, but the header & footer regions, the
  // page-number / overflow chrome and any designed background-shape layer are
  // kept. Works on content pages (clears the `.body-main-content`) and cover
  // pages (clears the absolutely-positioned blocks). Falls back to the last
  // page when nothing is scrolled into view.
  FC.clearActivePage = function () {
    const pages = Array.from(paper.querySelectorAll(':scope > .cs_page'));
    const page = (FC.getSelectedPage && FC.getSelectedPage()) || pages[pages.length - 1];
    if (!page) return false;
    const doc = page.matches('[data-cs-cover="1"]')
      ? page
      : (page.querySelector(':scope > .cs_margin') || page);

    // Drop any selection / inline-edit chrome first so no overlay is orphaned
    // when its block is detached.
    try { window.EditorManager?.clearAll?.(); } catch (e) { /* */ }

    // Content page: empty the main body region (keeps header/footer in place).
    const main = doc.querySelector(':scope > .body-main-content');
    if (main) main.innerHTML = '';

    // Sweep any remaining top-level user content — covers / blank pages keep
    // their blocks directly on the doc, and legacy pages may have stray rows.
    Array.from(doc.children).forEach((c) => {
      if (c === main) return;
      if (c.matches('.cs-page-header, .cs-page-footer')) return; // shared regions
      if (c.matches('[data-cs-chrome]')) return;                 // page number / marks
      if (c.classList && c.classList.contains('cs-page-shape-bg')) return; // designed bg
      c.remove();
    });

    try {
      window.parent?.postMessage({ source: 'custom-form-twig', type: 'page:cleared', ok: true }, '*');
    } catch (e) { /* ignore */ }
    return true;
  };

  // -------------------------------------------------------------------------
  // Cover page — a free-move canvas.
  //
  // Unlike a normal page (rigid row/col flow), a cover page's body is one
  // full-page `.cs-flexible-content`. Every block dropped onto it is placed
  // with `position:absolute` (free move + resize), reusing the existing
  // flexible-container machinery in row-col-builder.js / inline-editor.js /
  // drop-zones.js. The `data-cs-cover="1"` flag lets placeBlock relax the
  // `restrictInFlexible` rule so ALL block types are allowed here. No
  // header/footer regions — it always renders blank like an added page.
  //
  //   window.FlowCanvas.addCoverPage() → docEl
  // -------------------------------------------------------------------------
  FC.addCoverPage = function () {
    // A cover page is a free-move canvas: the `.cs_page` IS the page and the
    // positioning context — dropped blocks become absolutely-positioned DIRECT
    // children of it. No `.cs_margin` and no inner `.cs-flexible-content`
    // wrapper (that's the structure the export/template layer expects).
    //
    // It carries `.custom-form-design` so the twig generator (which iterates
    // `.custom-form-design`) serialises it as its own sheet, and so the editor
    // surface (now `.cs_paper`-wide) covers it for selection/move/resize.
    // `data-cs-cover="1"` is the single flag drop-zones / placeBlock key off to
    // treat it as a free canvas instead of a row/col flow root.
    const newDoc = document.createElement('div');
    newDoc.className = 'cs_page custom-form-design centercontent cs-flow-canvas cs-cover-canvas';
    newDoc.id = `cover_${FC.generateHash ? FC.generateHash() : Math.random().toString(16).slice(2)}`;
    newDoc.dataset.csCover = '1';
    newDoc.dataset.csNoHeaderFooter = '1';
    newDoc.style.visibility = 'visible';

    paper.appendChild(newDoc);
    renumberPages();
    postPageCount();
    if (FC.focusPage) FC.focusPage(newDoc);
    else newDoc.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return newDoc;
  };

  // -------------------------------------------------------------------------
  // Page break splitter
  //
  // When the user drops a Page Break block, we split the source doc at
  // that location. Everything AFTER the break (including the block that
  // contains the break itself) is moved onto a freshly-created page so
  // the user's content naturally flows onto two pages. The break block
  // itself is discarded — its presence in the DOM was just a marker for
  // where to cut. Header/footer regions on the source page are
  // preserved on the source; the destination page is created without
  // them (matches the manual "Add Page" default).
  // -------------------------------------------------------------------------
  FC.splitPageAt = function (docEl, breakBlock) {
    if (!docEl || !breakBlock) return null;
    const breakRow = breakBlock.closest('.row-item');
    if (!breakRow || breakRow.parentElement !== docEl) return null;

    // Collect every row that comes AFTER the break row at the doc root,
    // skipping the footer (which always stays at the bottom of the
    // source page). Order is preserved because we walk forward.
    const rowsToMove = [];
    let cursor = breakRow.nextElementSibling;
    while (cursor) {
      const next = cursor.nextElementSibling;
      if (cursor.classList && cursor.classList.contains('cs-page-footer')) {
        cursor = next;
        continue;
      }
      rowsToMove.push(cursor);
      cursor = next;
    }

    // Remove the break marker row itself — its job is done. If the row
    // contained other siblings inside the same column, keep those by
    // detaching just the break block.
    const breakCol = breakBlock.closest('.col-item');
    if (breakCol && breakCol.children.length > 1) {
      breakBlock.remove();
    } else {
      breakRow.remove();
    }

    // Create the destination page and move rows over (in original
    // order, before the destination footer if it has one).
    const newDoc = FC.addPage({ headerFooter: false });
    if (!newDoc) return null;
    const newFooter = newDoc.querySelector(':scope > .cs-page-footer');
    rowsToMove.forEach((row) => {
      if (newFooter) newDoc.insertBefore(row, newFooter);
      else newDoc.appendChild(row);
    });
    return newDoc;
  };

  // -------------------------------------------------------------------------
  // A4 overflow indicator
  //
  // Adds .cs-overflowing to any .cs_margin whose content exceeds the
  // configured A4 height. CSS renders a dashed boundary at the A4 mark
  // with a hint suggesting the user drop a Page Break. We only TOGGLE
  // the class — the visible split is the user's call.
  // -------------------------------------------------------------------------
  const PAGE_TARGET_HEIGHT = (window.CanvasConfig?.page?.minHeight) ?? 1123;
  // Measure how tall the doc's actual children stretch. We can't rely on
  // d.scrollHeight because the `.cs-overflowing::after` pseudo-element is
  // positioned at top: 1123px and contributes to scrollHeight — meaning
  // once we add the class, scrollHeight is locked at >=1123 forever and
  // the class can never come back off when content shrinks.
  const measureContentBottom = (docEl) => {
    let bottom = 0;
    docEl.querySelectorAll(':scope > .row-item, :scope > .body-main-content').forEach((row) => {
      const rect = row.getBoundingClientRect();
      const docRect = docEl.getBoundingClientRect();
      const offset = (rect.bottom - docRect.top);
      if (offset > bottom) bottom = offset;
    });
    return bottom;
  };
  const ensureOverflowMark = (docEl) => {
    let mark = docEl.querySelector(':scope > .cs-overflow-mark');
    if (!mark) {
      mark = document.createElement('div');
      mark.className = 'cs-overflow-mark';
      mark.setAttribute('data-cs-chrome', '1');
      const label = document.createElement('span');
      label.className = 'cs-overflow-mark__label';
      label.textContent = 'Suggested page break — drag a Page Break here';
      mark.appendChild(label);
      docEl.appendChild(mark);
    }
  };
  const removeOverflowMark = (docEl) => {
    docEl.querySelectorAll(':scope > .cs-overflow-mark').forEach((m) => m.remove());
  };
  const updatePageNumbers = () => {
    const docs = Array.from(paper.querySelectorAll('.cs_margin'));
    const total = docs.length;
    docs.forEach((d, index) => {
      let pageNumEl = d.querySelector(':scope > .cs-page-number');
      if (!pageNumEl) {
        pageNumEl = document.createElement('div');
        pageNumEl.className = 'cs-page-number';
        pageNumEl.setAttribute('data-cs-chrome', '1');
        pageNumEl.style.fontSize = '12px';
        pageNumEl.style.color = '#505b65';
        pageNumEl.style.paddingLeft = '4px';
        d.appendChild(pageNumEl);
      }
      pageNumEl.textContent = `Page ${index + 1} of ${total}`;

      if (d.lastElementChild !== pageNumEl) {
        d.appendChild(pageNumEl);
      }
    });
  };

  const updateOverflowMarks = () => {
    paper.querySelectorAll('.cs_margin').forEach((d) => {
      const contentBottom = measureContentBottom(d);
      const overflowing = contentBottom > PAGE_TARGET_HEIGHT + 1;
      if (overflowing) ensureOverflowMark(d);
      else removeOverflowMark(d);
    });
    // updatePageNumbers();
  };
  // MutationObserver catches additions/removals (childList) and inline
  // style edits (attributes). We exclude our own .cs-overflowing class
  // flips from triggering re-runs by listing the attribute filter
  // explicitly — `class` is included so legitimate class changes still
  // re-check, but the guard above prevents loops.
  const overflowObs = new MutationObserver(() => requestAnimationFrame(updateOverflowMarks));
  overflowObs.observe(paper, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['style', 'class'],
  });
  // ResizeObserver covers the case where content stays the same DOM but
  // its rendered height changes (image loads, text re-flows, etc.) so the
  // indicator hides as soon as the doc shrinks back under A4.
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => requestAnimationFrame(updateOverflowMarks));
    const observeDocs = () => {
      paper.querySelectorAll('.cs_margin').forEach((d) => ro.observe(d));
    };
    observeDocs();
    // Re-observe whenever a new doc is added (FC.addPage).
    new MutationObserver(observeDocs).observe(paper, { childList: true });
  }
  requestAnimationFrame(updateOverflowMarks);

  // -------------------------------------------------------------------------
  // Auto-resize: tell the parent shell how tall our content is so the
  // iframe can grow to fit all stacked pages.
  // -------------------------------------------------------------------------
  const reportHeight = () => {
    // Measure the ACTUAL content (the paper), never document.body /
    // documentElement scrollHeight: those are pinned to the iframe's
    // host-forced height, so once the host grows the iframe they floor at
    // that value and never let it shrink again (e.g. after a page is
    // deleted the empty space stays). Walking the offset chain gives the
    // paper's absolute bottom independent of the iframe's current height.
    let top = 0;
    for (let el = paper; el; el = el.offsetParent) top += el.offsetTop;
    const contentH = Math.max(paper.offsetHeight, paper.scrollHeight);
    const h = Math.ceil(top + contentH + 64);
    try {
      window.parent?.postMessage({
        source: 'custom-form-twig',
        type: 'iframe:height',
        height: h,
      }, '*');
    } catch (e) { /* parent on different origin — ignore */ }
  };
  const heightObs = new MutationObserver(() => requestAnimationFrame(reportHeight));
  heightObs.observe(paper, { childList: true, subtree: true, attributes: true });
  window.addEventListener('load', reportHeight);
  requestAnimationFrame(reportHeight);
  // Tell the host how many pages exist on boot (e.g. a multi-page template
  // loaded) so the footer / Delete-page button start in sync.
  window.addEventListener('load', postPageCount);
  requestAnimationFrame(postPageCount);

  // -------------------------------------------------------------------------
  // postMessage listener — host shell can ask us to add/remove pages.
  // -------------------------------------------------------------------------
  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || msg.target !== 'custom-form-twig') return;
    if (msg.type === 'page:add') {
      FC.addPage({ headerFooter: msg.headerFooter !== false });
    }
    if (msg.type === 'page:add-cover') {
      FC.addCoverPage();
    }
    if (msg.type === 'page:remove' && msg.pageNumber > 1) {
      const docEl = paper.querySelector(`.cs_margin[data-page="${msg.pageNumber}"]`);
      FC.removePage(docEl);
    }
    if (msg.type === 'page:remove-active') {
      FC.removeActivePage();
    }
    if (msg.type === 'page:clear-active') {
      FC.clearActivePage();
    }
    if (msg.type === 'page-size:change' && msg.sizeKey) {
      if (typeof window.setCanvasPageSize === 'function') {
        window.setCanvasPageSize(msg.sizeKey);
      }
    }
    if (msg.type === 'page-bg:change') {
      if (typeof window.setCanvasPageBackground === 'function') {
        window.setCanvasPageBackground(msg.imageUrl || '');
      }
    }
    // Per-page background image: apply to the page the user is currently viewing
    // (content `.cs_margin` OR cover `.cs_page[data-cs-cover]`). Inline style wins
    // over the global `--cs-page-bg-image` var; `data-cs-bg-image` lets us read it
    // back (panel preview on page switch) and survives template save/export.
    if (msg.type === 'page-bg:set-active') {
      const page = FC.getSelectedDrawablePage ? FC.getSelectedDrawablePage() : null;
      if (page) {
        const url = msg.imageUrl || '';
        if (url) {
          page.style.backgroundImage = `url("${url}")`;
          page.style.backgroundSize = 'cover';
          page.style.backgroundPosition = 'center';
          page.style.backgroundRepeat = 'no-repeat';
          page.dataset.csBgImage = url;
        } else {
          page.style.backgroundImage = '';
          delete page.dataset.csBgImage;
        }
        // Echo back so the panel preview matches this page immediately.
        try { window.parent?.postMessage({ source: 'custom-form-twig', type: 'page:active', bgImage: url }, '*'); } catch (e) { /* */ }
      }
    }
    if (msg.type === 'page-bg:set-all') {
      const url = msg.imageUrl || '';
      const allPages = document.querySelectorAll('.cs_margin, .cs_page[data-cs-cover="1"]');
      allPages.forEach((page) => {
        if (url) {
          page.style.backgroundImage = `url("${url}")`;
          page.style.backgroundSize = 'cover';
          page.style.backgroundPosition = 'center';
          page.style.backgroundRepeat = 'no-repeat';
          page.dataset.csBgImage = url;
        } else {
          page.style.backgroundImage = '';
          delete page.dataset.csBgImage;
        }
      });
      // Echo back the active page's state so the panel preview updates.
      try { window.parent?.postMessage({ source: 'custom-form-twig', type: 'page:active', bgImage: url }, '*'); } catch (e) { /* */ }
    }
    if (msg.type === 'component:capture') {
      const data = window.FlowCanvas?.captureComponent?.() || null;
      window.parent?.postMessage({ source: 'custom-form-twig', type: 'component:captured', data }, '*');
    }
    if (msg.type === 'component:insert') {
      window.FlowCanvas?.insertComponentHtml?.(msg.html);
    }
    if (msg.type === 'block:select' && msg.blockId) {
      // Panel asked us to select an ancestor block (the "Choose parent" button).
      const el = document.getElementById(msg.blockId);
      if (el) {
        if (window.EditorManager?.select) window.EditorManager.select(el);
        else el.click();
      }
    }
    if (msg.type === 'comment:toggle') {
      window.Collab?.toggleCommentMode?.();
    }
    if (msg.type === 'collab:config') {
      window.Collab?.applyConfig?.(msg.config);
    }
    if (msg.type === 'page-shape:open') {
      window.PageShapeDesigner?.open();
    }
    if (msg.type === 'page-shape:clear') {
      // Per-page: remove the shape only from the page the user is working on.
      window.PageShapeDesigner?.removeFromActive();
    }
    if (msg.type === 'page-margins:change') {
      const margins = msg.margins || {};
      const { top, right, bottom, left } = margins;
      paper.querySelectorAll('.cs_margin').forEach(docEl => {
        docEl.style.padding = `${top || 0}mm ${right || 0}mm ${bottom || 0}mm ${left || 0}mm`;
      });
      setTimeout(updateOverflowMarks, 50);
    }
    if (msg.type === 'header-footer:toggle') {
      ENABLE_HEADER_FOOTER = msg.enabled;
      paper.querySelectorAll('.cs_margin').forEach(p => {
        // Cover pages are always blank free-move canvases — never give them
        // header/footer regions, regardless of the global toggle.
        if (p.dataset.csCover === '1') return;
        if (msg.enabled) {
          delete p.dataset.csNoHeaderFooter;
          ensurePageRegions(p);
          seedRegionsFromCanonical(p);
          wireRegionSync(p);
          wireRegionEvents(p);
          wireRegionOrderObserver(p);
        } else {
          p.dataset.csNoHeaderFooter = '1';
          const h = p.querySelector(':scope > .cs-page-header');
          const f = p.querySelector(':scope > .cs-page-footer');
          if (h) h.remove();
          if (f) f.remove();
        }
      });
      // Optionally re-measure after structural changes
      setTimeout(updateOverflowMarks, 50);
    }
    if (msg.type === 'inline-insert:toggle') {
      const enabled = window.FlowCanvas.setInlineInsertEnabled?.(msg.enabled) !== false;
      window.parent?.postMessage({
        source: 'custom-form-twig',
        type: 'inline-insert:state',
        enabled
      }, '*');
    }
    if (msg.type === 'history:undo') { window.FlowCanvas?.undo?.(); }
    if (msg.type === 'history:redo') { window.FlowCanvas?.redo?.(); }
    if (msg.type === 'template:apply') {
      // Apply a predefined template HTML to the canvas (replaces existing content).
      const html = window.FlowCanvas?.TEMPLATE_HTML?.[msg.templateIndex];
      if (!html) return;
      try { window.EditorManager?.clearAll?.(); } catch (e) { /* */ }
      const firstDocEl = paper.querySelector('.cs_margin');
      if (firstDocEl) {
        firstDocEl.innerHTML = html;
        window.FlowCanvas?.initEditors?.(firstDocEl);
      }
      window.parent?.postMessage({ source: 'custom-form-twig', type: 'draft:restored', data: { savedAt: new Date().toISOString() } }, '*');
    }
    if (msg.type === 'savedtemplate:apply') {
      // Apply a saved template HTML to the canvas (replaces existing content).
      try { window.EditorManager?.clearAll?.(); } catch (e) { /* */ }
      const firstDocEl = paper.querySelector('.cs_margin');
      if (firstDocEl) {
        firstDocEl.innerHTML = msg.html;
        window.FlowCanvas?.initEditors?.(firstDocEl);
      }
      window.parent?.postMessage({ source: 'custom-form-twig', type: 'draft:restored', data: { savedAt: new Date().toISOString() } }, '*');
    }
    if (msg.type === 'rich-toolbar:dock') {
      // Place the CustomRichEditor toolbar: docked (top sticky) vs inline float.
      if (typeof window.setRichToolbarDocked === 'function') {
        window.setRichToolbarDocked(!!msg.docked);
      } else if (window.CanvasConfig && window.CanvasConfig.editor) {
        window.CanvasConfig.editor.dockRichToolbar = !!msg.docked;
      }
    }
    if (msg.type === 'set-block-style') {
      const block = document.getElementById(msg.blockId);
      if (!block) return;

      // ===== HANDLE LAYOUT PROPERTIES (layoutStyle, layoutColumns, sectionColor) =====
      if (msg.prop === 'layoutColumns') {
        const contentArea = block.querySelector('.cs-flexible-content');
        if (contentArea) {
          contentArea.dataset.layoutColumns = msg.value;
          // Remove all layout classes
          contentArea.classList.remove('cs-layout--one-col', 'cs-layout--two-col-wave', 'cs-layout--two-col-diagonal', 'cs-layout--two-col-organic', 'cs-layout--three-col');
          // Add appropriate class
          const layoutStyle = contentArea.dataset.layoutStyle || 'wave';
          if (msg.value === '1') {
            contentArea.classList.add('cs-layout--one-col');
          } else if (msg.value === '2') {
            contentArea.classList.add(`cs-layout--two-col-${layoutStyle}`);
          } else if (msg.value === '3') {
            contentArea.classList.add('cs-layout--three-col');
          }
        }
        return;
      }

      if (msg.prop === 'sectionColor') {
        const contentArea = block.querySelector('.cs-flexible-content, .section-container-content');
        if (contentArea) {
          contentArea.style.backgroundColor = msg.value;
        }
        return;
      }

      // ===== HANDLE REGULAR STYLE PROPERTIES =====
      // Check if this block is currently in editing mode with Froala active
      const isEditing = block.classList.contains('cs-editing');
      const hasFroala = window.FroalaStyleHandler && window.FroalaStyleHandler.hasActiveEditor();

      // If block is editing and Froala is active, use Froala commands for typography
      if (isEditing && hasFroala) {
        const typographyCommands = {
          'color': () => window.FroalaStyleHandler.applyColor(msg.value),
          'fontSize': () => window.FroalaStyleHandler.applyFontSize(msg.value),
          'fontWeight': () => window.FroalaStyleHandler.applyFontWeight(msg.value)
        };

        if (msg.prop in typographyCommands) {
          typographyCommands[msg.prop]();
          // Also set inline style as fallback
          const inner = block.querySelector('.edit_me, .canvas-block__content');
          if (inner) inner.style[msg.prop] = msg.value;
          return;
        }
      }

      // Fallback: Apply as inline styles (for non-editing blocks or non-Froala props)
      const typographyProps = ['color', 'fontSize', 'fontWeight'];
      const containerProps = ['backgroundColor', 'borderStyle', 'borderColor', 'borderWidth', 'borderRadius'];

      // For typography (color, fontSize, fontWeight), apply to inner editable element
      const typographyTarget = block.querySelector('.edit_me, .canvas-block__content');
      if (typographyProps.includes(msg.prop) && typographyTarget) {
        typographyTarget.style[msg.prop] = msg.value;
        return;
      }

      // For background/border on flexible/section containers, apply to the content area
      const isFlexible = block.classList.contains('cs-flexible-block');
      const isSection = block.dataset.blockType === 'section-container' || block.getAttribute('data') === 'Section Container';

      if ((isFlexible || isSection) && containerProps.includes(msg.prop)) {
        const contentArea = block.querySelector('.cs-flexible-content, .section-container-content');
        if (contentArea) {
          contentArea.style[msg.prop] = msg.value;
          return;
        }
      }

      // Default: Apply to outer block
      block.style[msg.prop] = msg.value;
      // When height is set manually, clear min-height so the user can freely
      // shrink the block below whatever the previous min was.
      if (msg.prop === 'height') block.style.minHeight = '';
    }
  });

  // -------------------------------------------------------------------------
  // Global click / keyboard: deactivate header/footer focus
  // -------------------------------------------------------------------------
  if (ENABLE_HEADER_FOOTER) {
    canvas.addEventListener('click', (e) => {
      if (!e.target.closest('.cs-page-header') && !e.target.closest('.cs-page-footer')) {
        setRegionActive(null);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setRegionActive(null);
    });
  }

  // -------------------------------------------------------------------------
  // Drag payload helpers
  // -------------------------------------------------------------------------
  const DRAG_STORE_KEY = '__BROCHURE_FLOW_DRAG__';

  const parsePayload = (value) => {
    if (!value) return null;
    try { return JSON.parse(value); } catch (e) { return null; }
  };

  const getDragPayload = (event) => {
    const direct =
      parsePayload(event.dataTransfer?.getData('application/x-brochure-block')) ||
      parsePayload(event.dataTransfer?.getData('text/plain'));
    if (direct?.blockType) {
      console.log('getDragPayload: got direct payload from dataTransfer');
      return direct;
    }
    try {
      const fallback = window.parent?.[DRAG_STORE_KEY] ?? null;
      if (fallback?.blockType) {
        console.log('getDragPayload: got fallback payload from parent window:', fallback);
        return fallback;
      }
      console.log('getDragPayload: no payload found');
      return null;
    } catch (e) {
      console.warn('getDragPayload: error accessing parent window:', e);
      return null;
    }
  };

  const createBlockFromPayload = (payload) => {
    // Reusable component: build from stored HTML instead of the block factory.
    if (payload?.blockType === 'component' && payload.componentHtml) {
      return FC.buildComponentBlock?.(payload.componentHtml) || null;
    }
    if (!payload?.blockType) return null;

    const block = FC.createBlock?.(payload.blockType);
    if (!block) {
      console.warn('BLOCK CREATE: failed for blockType:', payload.blockType);
      return null;
    }

    if (payload.blockType === 'fa-icon' && payload.class) {
      const iconEl = block.querySelector('i');
      if (iconEl) {
        iconEl.className = payload.class;
        block.dataset.iconName = payload.icon || 'star';
        block.dataset.iconClass = payload.class;
      }
    }

    return block;
  };

  const maybeOpenBindingModal = (payload, block) => {
    if (!payload?.blockType || !block) return;
    const REPEATER_TYPES = window.FormBlockRegistry?.repeaterTypes() ||
      ['section-container', 'table-repeater', 'list-repeater'];
    if (REPEATER_TYPES.includes(payload.blockType) &&
      typeof window.showSectionBindingModal === 'function') {
      window.showSectionBindingModal(block);
    }
  };

  const insertPayloadAtTarget = ({ payload, activeDoc, target, clientX, clientY }) => {
    if (!payload?.blockType || !activeDoc || !target) return null;

    const block = createBlockFromPayload(payload);
    if (!block) return null;

    // A reusable component carries blockType 'component', but for placement
    // rules (row/col wrap + the flexible-container restriction in placeBlock) it
    // must behave like its underlying block — e.g. a saved Section must bounce
    // out of a flexible container just like a real section-container would,
    // instead of being placed as a stray absolute child. Derive the real type
    // from the built block.
    const effectiveType = payload.blockType === 'component'
      ? (block.dataset.blockType || 'component')
      : payload.blockType;

    if (payload.blockType === 'page-break') {
      let beforeRow = null;
      if (target.kind === 'between-rows') {
        beforeRow = target.beforeRow || null;
      } else if (target.kind === 'col-edge' || target.kind === 'in-col') {
        const refRow = (target.row || target.col || target.beforeBlock)?.closest?.('.row-item');
        beforeRow = refRow?.nextElementSibling || null;
      }
      FC.placeBlock?.(activeDoc, block, { kind: 'between-rows', beforeRow }, clientX, clientY, payload.blockType);
      if (typeof FC.splitPageAt === 'function') FC.splitPageAt(activeDoc, block);
      return block;
    }

    FC.placeBlock?.(activeDoc, block, target, clientX, clientY, effectiveType);
    maybeOpenBindingModal(payload, block);
    return block;
  };

  // -------------------------------------------------------------------------
  // Drag-and-drop event wiring
  // -------------------------------------------------------------------------
  console.log('FLOW-CANVAS: drop listeners attached to element:', paper?.className || paper?.id || 'unknown');

  paper.addEventListener('dragenter', (event) => {
    console.log('FLOW-CANVAS: dragenter fired');
    if (getDragPayload(event)) {
      console.log('FLOW-CANVAS: dragenter has valid payload');
      event.preventDefault();
      const activeDoc = findActiveDoc(event.clientX, event.clientY);
      const page = activeDoc?.closest('.custom-form-design');
      if (page) page.classList.add('drop-surface--active');
    }
  });

  paper.addEventListener('dragover', (event) => {
    console.log('FLOW-CANVAS: dragover fired');
    if (getDragPayload(event)) {
      console.log('FLOW-CANVAS: dragover has valid payload, calling preventDefault');
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  });

  // Pick the page that's currently under the pointer (multi-page aware).
  // Includes cover pages, which are free-canvas `.cs_page[data-cs-cover]`
  // elements rather than `.cs_margin` flow pages.
  const findActiveDoc = (clientX, clientY) => {
    const docs = Array.from(paper.querySelectorAll('.cs_margin, .cs_page[data-cs-cover="1"]'));
    for (const d of docs) {
      const r = d.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return d;
    }
    return docs[0] || firstDoc;
  };

  paper.addEventListener('dragover', (event) => {
    const payload = getDragPayload(event);
    if (!payload) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    const activeDoc = findActiveDoc(event.clientX, event.clientY);

    paper.querySelectorAll('.drop-surface--active').forEach(el => el.classList.remove('drop-surface--active'));
    const page = activeDoc?.closest('.custom-form-design');
    if (page) page.classList.add('drop-surface--active');

    const result = FC.findDropTarget?.(activeDoc, paper, event.clientX, event.clientY, payload.blockType);
    if (result) {
      FC.showIndicator?.(result.indicator);
      paper._pendingDropTarget = result.target;
      paper._pendingDropDoc = activeDoc;
    }
  });

  paper.addEventListener('dragleave', (event) => {
    if (!paper.contains(event.relatedTarget)) {
      paper.querySelectorAll('.drop-surface--active').forEach(el => el.classList.remove('drop-surface--active'));
      FC.hideIndicator?.();
      paper._pendingDropTarget = null;
    }
  });

  let lastDropAt = 0;
  paper.addEventListener('drop', (event) => {
    console.log('DROP EVENT FIRED');
    const payload = getDragPayload(event);
    console.log('DROP: getDragPayload result:', payload);
    if (!payload) {
      console.warn('DROP: no payload found');
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    paper.querySelectorAll('.drop-surface--active').forEach(el => el.classList.remove('drop-surface--active'));
    FC.hideIndicator?.();

    // Predefined templates replace the whole canvas — ask the host to confirm.
    const templateMatch = payload.blockType && payload.blockType.match(/^predefine-template-(\d+)$/);
    if (templateMatch) {
      paper._pendingDropTarget = null;
      paper._pendingDropDoc = null;
      window.parent?.postMessage({ source: 'custom-form-twig', type: 'template:confirm', templateIndex: Number(templateMatch[1]) }, '*');
      return;
    }

    // De-dupe: some browsers / wrapper frames emit duplicate drop events.
    const now = performance.now();
    if (now - lastDropAt < 200) {
      paper._pendingDropTarget = null;
      return;
    }
    lastDropAt = now;

    const activeDoc = paper._pendingDropDoc || findActiveDoc(event.clientX, event.clientY);
    const result = paper._pendingDropTarget ||
      FC.findDropTarget?.(activeDoc, paper, event.clientX, event.clientY, payload.blockType)?.target;
    paper._pendingDropTarget = null;
    paper._pendingDropDoc = null;

    // Sidebar drop: build a fresh block.
    console.log('DROP: payload =', payload);
    const block = insertPayloadAtTarget({
      payload,
      activeDoc,
      target: result,
      clientX: event.clientX,
      clientY: event.clientY,
    });
    console.log('DROP: block inserted?', !!block);
  });

  // -------------------------------------------------------------------------
  // Feature modules
  // -------------------------------------------------------------------------
  FC.initColResize?.(canvas);
  FC.initFieldPanel?.(canvas);
  FC.initHistory?.(canvas);
  FC.initDimensionIndicator?.(canvas);
  FC.initInlineInsert?.(canvas);
  FC.initCopyPaste?.(canvas);
  FC.initImageZoom?.(canvas);
  // Per-doc feature wiring (cleanup observer, block reorder) — also run
  // these for any future docs added via FC.addPage().
  const wireDocFeatures = (docEl) => {
    FC.initCleanupObserver?.(docEl, canvas);
    FC.initBlockReorder?.(canvas, docEl);
  };
  wireDocFeatures(firstDoc);
  const _origAddPage = FC.addPage;
  FC.addPage = function (opts) {
    const newDoc = _origAddPage.call(FC, opts);
    if (newDoc) wireDocFeatures(newDoc);
    return newDoc;
  };
  const _origAddCoverPage = FC.addCoverPage;
  FC.addCoverPage = function () {
    const newDoc = _origAddCoverPage.call(FC);
    if (newDoc) wireDocFeatures(newDoc);
    return newDoc;
  };

  // -------------------------------------------------------------------------
  // Image upload handler
  // -------------------------------------------------------------------------
  const initImageUpload = () => {
    // Attach to the whole board (.cs_paper) — not just page 1's canvas — so the
    // image upload also fires for image blocks on added pages and cover pages,
    // which live in their own sibling `.custom-form-design` wrappers.
    paper.addEventListener('click', (e) => {
      const imgBtn = e.target.closest('.img-btn');
      if (!imgBtn) return;

      const imageBlock = imgBtn.closest('.cs_block_s');
      const isImageBlockArmed = !!imageBlock &&
        (imageBlock.classList.contains('cs-selected') || imageBlock.classList.contains('cs-editing'));

      // First click should only select the image block. We let the normal
      // inline-editor click state machine handle that. Only when the block
      // is already selected/editing do we intercept and open the upload modal.
      if (!isImageBlockArmed) return;

      e.preventDefault();
      e.stopPropagation();

      // Create a hidden file input
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';

      fileInput.addEventListener('change', (event) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        const file = files[0];

        const reader = new FileReader();
        reader.onload = (e) => {
          const imageDataUrl = e.target.result;
          const imageContainer = imgBtn.closest('.image-container');

          if (imageContainer) {
            // Remove the existing button and img if present
            imgBtn.remove();
            const existingImg = imageContainer.querySelector('img');
            if (existingImg) existingImg.remove();

            // Create and add the image element
            const img = document.createElement('img');
            img.src = imageDataUrl;
            img.alt = 'Uploaded image';
            imageContainer.appendChild(img);
          }
        };
        reader.readAsDataURL(file);
      });

      fileInput.click();
    }, true); // Use capture phase to catch clicks before other handlers
  };

  initImageUpload();

  // -------------------------------------------------------------------------
  // Send initial header/footer state to parent
  // -------------------------------------------------------------------------
  window.parent?.postMessage({
    source: 'custom-form-twig',
    type: 'header-footer:state',
    enabled: ENABLE_HEADER_FOOTER
  }, '*');
  window.parent?.postMessage({
    source: 'custom-form-twig',
    type: 'inline-insert:state',
    enabled: window.FlowCanvas.isInlineInsertEnabled?.() !== false
  }, '*');

  // -------------------------------------------------------------------------
  // Debug surface
  // -------------------------------------------------------------------------
  window.__FLOW_CANVAS__ = { canvas, doc, FC };
  Object.assign(FC, {
    createBlockFromPayload,
    insertPayloadAtTarget,
  });
  console.log('flow-canvas: initialized');
})();
