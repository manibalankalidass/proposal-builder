/**
 * @fileoverview Per-page background shape designer.
 *
 * Opens a full-screen modal whose drawing stage matches the real page's
 * width × height (aspect ratio). The user designs a vector shape with the
 * SAME pen tool used by the Pen Shape block (reused via window.PenShape).
 *
 * Shapes are PAGE-SPECIFIC: each page (a content page `.cs_margin` or a cover
 * page `.cs_page[data-cs-cover]`) carries its own `.cs-page-shape-bg` layer.
 * The designer targets ONE page at a time (defaulting to the page the user is
 * working on) and a page selector in the modal lets the user switch between
 * pages and add / edit / remove a shape on each independently. Saving applies
 * the design only to the pages edited in that session; other pages are left
 * untouched and newly-added pages start blank.
 *
 * The injected layer (.cs-page-shape-bg) is plain DOM inside the page — NOT
 * marked [data-cs-chrome] — so the Twig generator clones it and it exports to
 * the PDF. Critical styles are inlined so it renders even if a stylesheet is
 * missing.
 *
 * Opened from the Angular "Style → Page Settings" button via postMessage
 * (page-shape:open), wired in flow-canvas.js.
 *
 * Exposes:
 *   window.PageShapeDesigner.open()             — open the designer on the active page
 *   window.PageShapeDesigner.removeFromActive() — remove the shape from the active page
 *   window.PageShapeDesigner.clearAll()         — remove the shape from every page
 */
(function () {
  window.PageShapeDesigner = window.PageShapeDesigner || {};

  const LAYER_CLASS = 'cs-page-shape-bg';
  const PAGE_SEL = '.cs_margin, .cs_page[data-cs-cover="1"]';
  const DEFAULT_W = 794, DEFAULT_H = 1123; // A4 @96dpi fallback

  let modal = null;
  let block = null;
  let targetPage = null;       // the page currently shown in the designer
  let pageList = [];           // pages captured when the modal opened (select order)
  let sessionDesigns = null;   // Map<pageEl, design|null> edited during this session
  let uidSeq = 0;              // ensures every injected layer gets globally-unique def ids

  // The modal is rendered in the HOST document (the Angular shell), NOT inside
  // this iframe — so it reads as a true root-level modal (like the save-as
  // modal) instead of being clipped to the canvas panel. Pages still live in
  // THIS document, so the page helpers keep using `document`.
  const hostWin = (() => { try { return window.parent && window.parent !== window ? window.parent : window; } catch (e) { return window; } })();
  const hostDoc = hostWin.document;

  // The modal + pen styling lives in editor.css, which the iframe loads but the
  // host page does not. Inject it into the host once so the modal is styled.
  const ensureHostStyles = () => {
    if (hostDoc === document) return; // standalone (not embedded) → already has it
    if (hostDoc.getElementById('cs-pen-host-styles')) return;
    const ownLink = document.querySelector('link[href*="editor.css"]');
    const href = ownLink ? ownLink.getAttribute('href') : './editor/editor.css';
    const link = hostDoc.createElement('link');
    link.id = 'cs-pen-host-styles';
    link.rel = 'stylesheet';
    // Resolve relative to THIS iframe's document so the host can find the file.
    link.href = new URL(href, document.baseURI).href;
    hostDoc.head.appendChild(link);
  };

  /* ------------------------------ page helpers ------------------------------ */

  const getPageDims = () => {
    const cs = getComputedStyle(document.documentElement);
    const w = parseFloat(cs.getPropertyValue('--cs-page-width')) || DEFAULT_W;
    const h = parseFloat(cs.getPropertyValue('--cs-page-min-height')) || DEFAULT_H;
    return { w, h };
  };

  // Every page (content + cover) in document order.
  const getAllPages = () => Array.from(document.querySelectorAll(PAGE_SEL));
  const getPagesRoot = () => document.querySelector('.cs_paper')
    || document.querySelector('.cs_page')
    || document.querySelector('.custom-form-design');

  // A human label for the page selector, e.g. "Cover Page 2" / "Content Page 1".
  const labelPages = (pages) => {
    let cover = 0, content = 0;
    return pages.map((p) => {
      if (p.matches('[data-cs-cover="1"]')) { cover += 1; return `Cover Page ${cover}`; }
      content += 1; return `Content Page ${content}`;
    });
  };

  // The page the user is currently working on — used as the default target.
  // Prefer the scroll-driven selection (the page in view), then the last page
  // the user clicked, then the first page.
  const resolveActivePage = () => {
    const sel = window.FlowCanvas?.getSelectedDrawablePage?.();
    if (sel && document.contains(sel) && sel.matches(PAGE_SEL)) return sel;
    const ap = window.FlowCanvas?.getActivePage?.();
    if (ap && document.contains(ap) && ap.matches(PAGE_SEL)) return ap;
    return getAllPages()[0] || null;
  };

  /* ---------------------- inject / read the bg layer ----------------------- */

  // Clone an <svg> and make every def id unique so multiple pages don't clash
  // (duplicate ids in one document make all gradients/patterns resolve to the
  // first one). Rewrites url(#id) references in fill/stroke too.
  const uniquifyIds = (svg, suffix) => {
    svg.querySelectorAll('[id]').forEach((el) => {
      const oldId = el.id;
      const newId = `${oldId}_${suffix}`;
      el.id = newId;
      svg.querySelectorAll('[fill],[stroke]').forEach((node) => {
        ['fill', 'stroke'].forEach((attr) => {
          const v = node.getAttribute(attr);
          if (v && v.includes(`#${oldId}`)) {
            node.setAttribute(attr, v.replace(`#${oldId})`, `#${newId})`));
          }
        });
      });
    });
  };

  // Inject the given design into ONE page (or, when design is empty, remove any
  // existing layer from that page). `design` = { svg, penPath, penStyle } | null.
  const injectLayer = (pageEl, design) => {
    pageEl.querySelectorAll(`:scope > .${LAYER_CLASS}`).forEach((el) => el.remove());
    if (!design || !design.svg) return;

    const layer = document.createElement('div');
    layer.className = LAYER_CLASS;
    layer.setAttribute('aria-hidden', 'true');
    // Inline the critical styles so the layer renders in the exported PDF even
    // if editor.css isn't loaded. z-index:0 keeps it above the page background
    // but below page content (which is forced to z-index:1 in custom-form.css).
    // Negative z-index + isolation are NOT used here because some PDF engines
    // (wkhtmltopdf) don't honour them and the shape would vanish.
    layer.style.cssText =
      'position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden;';
    // Stash the editable model so re-opening the designer restores the shape.
    layer.dataset.penPath = design.penPath || '';
    layer.dataset.penStyle = design.penStyle || '';

    const wrap = document.createElement('div');
    wrap.innerHTML = design.svg;
    const svg = wrap.querySelector('svg');
    if (!svg) return;
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    uniquifyIds(svg, `pg${uidSeq += 1}`);
    layer._csShapeUniq = true; // mark so the new-page watcher won't re-uniquify
    layer.appendChild(svg);

    // Insert first so it paints first; z-index keeps it under content anyway.
    pageEl.insertBefore(layer, pageEl.firstChild);
  };

  // Read the design currently stored on a page (so the designer can restore it).
  const readDesignFromPage = (pageEl) => {
    if (!pageEl) return null;
    const layer = pageEl.querySelector(`:scope > .${LAYER_CLASS}`);
    if (!layer) return null;
    const svg = layer.querySelector('svg');
    return {
      svg: svg ? svg.outerHTML : '',
      penPath: layer.dataset.penPath || '',
      penStyle: layer.dataset.penStyle || '',
    };
  };

  /* --------------------------- block <-> design ----------------------------- */

  // Capture whatever is drawn in the editor right now as a design (or null when
  // nothing is drawn → treated as "remove the shape"). Ends the pen session so
  // the final <path>/<defs> are written + rendered.
  const captureBlock = () => {
    if (!block) return null;
    try { window.PenShape?.deactivate?.(); } catch (e) { /* */ }
    const svg = block.querySelector('.cs-pen-svg');
    const hasShape = svg && Array.from(svg.querySelectorAll('.cs-pen-fill'))
      .some((p) => (p.getAttribute('d') || '').trim().length > 0);
    if (!hasShape) return null;
    const clean = svg.cloneNode(true);
    return {
      svg: clean.outerHTML,
      penPath: block.dataset.penPath || '',
      penStyle: block.dataset.penStyle || '',
    };
  };

  // Load a design (or a blank shape) into the editor block, then repaint.
  const loadBlock = (design) => {
    if (!block) return;
    if (design && design.penPath) {
      block.dataset.penPath = design.penPath;
      block.dataset.penStyle = design.penStyle || '';
    } else {
      block.dataset.penPath = JSON.stringify({ paths: [] });
      block.dataset.penStyle = '';
    }
    try { window.PenShape.renderShape(block); } catch (e) { /* */ }
  };

  // (Re)start the pen session on the block and hand the engine the modal's
  // side panels. Deferred a frame so the stage has real dimensions.
  const activateBlock = () => {
    requestAnimationFrame(() => {
      if (!block || !modal) return;
      window.PenShape.activate(block);
      window.PenShape.setLayersPanel?.(modal.querySelector('[data-layers-list]'));
      window.PenShape.setPropsPanel?.(modal.querySelector('[data-props-host]'));
      layoutStage();
    });
  };

  /* --------------------------------- modal ---------------------------------- */

  const buildModal = (dims) => {
    const el = hostDoc.createElement('div');
    el.className = 'cs-page-shape-modal';
    el.innerHTML = `
      <div class="cs-page-shape-modal__backdrop"></div>
      <div class="cs-page-shape-modal__panel">
        <header class="cs-page-shape-modal__header">
          <div class="cs-page-shape-modal__title">
            Design Page Background
            <span class="cs-page-shape-modal__dims">${Math.round(dims.w)} × ${Math.round(dims.h)} px</span>
          </div>
          <label class="cs-page-shape-modal__pagepick">
            Page
            <select data-page-select></select>
          </label>
          <div class="cs-page-shape-modal__actions">
            <button type="button" data-act="clear" class="cs-page-shape-btn cs-page-shape-btn--ghost">Clear</button>
            <button type="button" data-act="cancel" class="cs-page-shape-btn cs-page-shape-btn--ghost">Cancel</button>
            <button type="button" data-act="save" class="cs-page-shape-btn cs-page-shape-btn--primary">Save &amp; Apply</button>
          </div>
        </header>
        <div class="cs-page-shape-modal__body">
          <aside class="cs-page-shape-layers">
            <div class="cs-page-shape-layers__title">Layers</div>
            <div class="cs-page-shape-layers__list" data-layers-list></div>
            <div class="cs-page-shape-layers__actions">
              <button type="button" data-layers-act="merge" title="Merge selected layers">Merge</button>
              <button type="button" data-layers-act="lock" title="Lock / unlock selected">Lock</button>
            </div>
            <div class="cs-page-shape-layers__hint">Ctrl/Cmd-click to multi-select · drag to reorder (top = front)</div>
          </aside>
          <div class="cs-page-shape-stagewrap">
            <div class="cs-page-shape-stage"></div>
            <div class="cs-page-shape-zoom">
              <button type="button" data-zoom="out" title="Zoom out">−</button>
              <button type="button" data-zoom="fit" class="cs-page-shape-zoom__val" title="Reset to fit">100%</button>
              <button type="button" data-zoom="in" title="Zoom in">+</button>
            </div>
          </div>
          <aside class="cs-page-shape-shapes" data-shapes-panel>
            <div class="cs-page-shape-shapes__title">Trace reference</div>
            <div class="cs-page-shape-ref">
              <label class="cs-page-shape-ref__btn">
                <input type="file" accept="image/*" data-ref-file>
                <span>⬆&nbsp; Upload image</span>
              </label>
              <label class="cs-page-shape-ref__op">
                <span>Dim</span>
                <input type="range" min="5" max="100" value="45" data-ref-op>
              </label>
              <label class="cs-page-shape-ref__chk">
                <input type="checkbox" data-trace-outline>
                <span>Outline only — mark without fill (so the image stays visible)</span>
              </label>
              <button type="button" data-ref-clear class="cs-page-shape-ref__clear">Remove reference</button>
              <p class="cs-page-shape-ref__hint">Drop an image, dim it, then trace it with the pen tool. It's only a guide — it is NOT saved with the shape.</p>
              <label class="cs-page-shape-ref__chk cs-page-shape-ref__apply-all">
                <input type="checkbox" data-apply-all-pages>
                <span>Apply to all pages</span>
              </label>
            </div>
            <div class="cs-page-shape-shapes__title">Properties</div>
            <div class="cs-page-shape-props" data-props-host></div>
            <div class="cs-page-shape-shapes__title">Shapes</div>
            <div class="cs-page-shape-size">
              <label>W <input type="number" data-shape-w min="10" step="1" value="220"></label>
              <button type="button" class="cs-shape-lock" data-shape-lock title="Lock aspect ratio">🔒</button>
              <label>H <input type="number" data-shape-h min="10" step="1" value="160"></label>
            </div>
            <div class="cs-page-shape-shapes__grid">
              <button type="button" data-preset="rectangle"      title="Rectangle">▭</button>
              <button type="button" data-preset="square"         title="Square">◻</button>
              <button type="button" data-preset="rounded-rect"   title="Rounded rectangle">▢</button>
              <button type="button" data-preset="pill"           title="Pill / capsule">⬭</button>
              <button type="button" data-preset="ellipse"        title="Ellipse / circle">◯</button>
              <button type="button" data-preset="triangle"       title="Triangle">△</button>
              <button type="button" data-preset="triangle-down"  title="Triangle down">▽</button>
              <button type="button" data-preset="right-triangle" title="Right triangle">◣</button>
              <button type="button" data-preset="diamond"        title="Diamond">◇</button>
              <button type="button" data-preset="pentagon"       title="Pentagon">⬠</button>
              <button type="button" data-preset="hexagon"        title="Hexagon">⬡</button>
              <button type="button" data-preset="heptagon"       title="Heptagon">⬣</button>
              <button type="button" data-preset="octagon"        title="Octagon">⯃</button>
              <button type="button" data-preset="parallelogram"  title="Parallelogram">▰</button>
              <button type="button" data-preset="trapezoid"      title="Trapezoid">⏢</button>
              <button type="button" data-preset="star"           title="Star (5)">★</button>
              <button type="button" data-preset="star-4"         title="Star (4)">✦</button>
              <button type="button" data-preset="star-6"         title="Star (6)">✶</button>
              <button type="button" data-preset="star-12"        title="Star (12)">✺</button>
              <button type="button" data-preset="burst"          title="Burst / seal">❉</button>
              <button type="button" data-preset="arrow-right"    title="Arrow right">➜</button>
              <button type="button" data-preset="arrow-left"     title="Arrow left">⬅</button>
              <button type="button" data-preset="arrow-up"       title="Arrow up">⬆</button>
              <button type="button" data-preset="arrow-down"     title="Arrow down">⬇</button>
              <button type="button" data-preset="arrow-h"        title="Double arrow (horizontal)">↔</button>
              <button type="button" data-preset="arrow-v"        title="Double arrow (vertical)">↕</button>
              <button type="button" data-preset="chevron"        title="Chevron">❯</button>
              <button type="button" data-preset="plus"           title="Plus / cross">✚</button>
              <button type="button" data-preset="heart"          title="Heart">♥</button>
              <button type="button" data-preset="speech"         title="Speech bubble">💬</button>
              <button type="button" data-preset="banner"         title="Banner / ribbon">⚑</button>
              <button type="button" data-preset="cloud"          title="Cloud">☁</button>
            </div>
            <div class="cs-page-shape-shapes__title">Page backgrounds</div>
            <div class="cs-page-shape-shapes__grid">
              <button type="button" data-preset="corner"    title="Corner wedge (full bleed)">◣</button>
              <button type="button" data-preset="diagonal"  title="Diagonal band (full bleed)">◹</button>
              <button type="button" data-preset="header"    title="Header bar (full bleed)">▀</button>
              <button type="button" data-preset="footer"    title="Footer bar (full bleed)">▄</button>
            </div>
          </aside>
        </div>
      </div>`;
    return el;
  };

  // Fill the page selector with one option per page, marking the target page.
  const populatePageSelect = () => {
    const sel = modal?.querySelector('[data-page-select]');
    if (!sel) return;
    const labels = labelPages(pageList);
    sel.innerHTML = pageList
      .map((p, i) => `<option value="${i}"${p === targetPage ? ' selected' : ''}>${labels[i]}</option>`)
      .join('');
  };

  // Fit the page (dims) inside the available modal body area, preserving aspect.
  // Sized against the HOST window (full app), since the modal lives there.
  const fitStageSize = (dims) => {
    const maxW = Math.max(200, hostWin.innerWidth - 460);  // leave room for both side panels
    const maxH = Math.max(200, hostWin.innerHeight - 180);
    const scale = Math.min(maxW / dims.w, maxH / dims.h, 1);
    return { w: Math.round(dims.w * scale), h: Math.round(dims.h * scale) };
  };

  // Zoom multiplier on top of the fit size (1 = fit-to-window). Lets the user
  // zoom into the trace reference for precise anchor/handle placement; the
  // stagewrap scrolls when the stage grows past the viewport.
  let zoom = 1;

  const updateZoomLabel = () => {
    const el = modal && modal.querySelector('.cs-page-shape-zoom__val');
    if (el) el.textContent = `${Math.round(zoom * 100)}%`;
  };

  const setZoom = (z) => {
    zoom = Math.max(0.25, Math.min(6, z));
    layoutStage();
  };

  // Size the stage + drawing block to fit the host window, preserving the page
  // aspect ratio, then apply the zoom factor. Re-run on host window resize.
  const layoutStage = () => {
    if (!modal || !block) return;
    const dims = getPageDims();
    const fit = fitStageSize(dims);
    const w = Math.round(fit.w * zoom);
    const h = Math.round(fit.h * zoom);
    const stage = modal.querySelector('.cs-page-shape-stage');
    if (stage) { stage.style.width = `${w}px`; stage.style.height = `${h}px`; }
    block.style.width = `${w}px`;
    block.style.height = `${h}px`;
    updateZoomLabel();
  };
  let onResize = null;

  /* --------------------------- trace reference image ------------------------ */
  // A faint image behind the pen block that the user traces over (Photoshop
  // "template layer" style). It lives inside the stage, behind the pen overlay,
  // with pointer-events:none so every click still reaches the pen tool. It is
  // purely a guide — Save reads only the pen SVG, so the image never ends up in
  // the saved shape or the exported PDF.

  const refEl = () => modal && modal.querySelector('[data-ref-img]');

  const setReference = (url) => {
    const el = refEl();
    if (!el) return;
    if (url) { el.style.backgroundImage = `url("${url}")`; el.classList.add('is-on'); }
    else { el.style.backgroundImage = 'none'; el.classList.remove('is-on'); }
  };

  const setReferenceOpacity = (pct) => {
    const el = refEl();
    if (el) el.style.opacity = String(Math.max(0, Math.min(1, (Number(pct) || 0) / 100)));
  };

  const loadReferenceFile = (file) => {
    if (!file || !/^image\//.test(file.type || '')) return;
    const reader = new FileReader();
    reader.onload = () => setReference(reader.result);
    reader.readAsDataURL(file);
  };

  const close = () => {
    if (!modal) return;
    try { window.PenShape?.deactivate?.(); } catch (e) { /* */ }
    if (onResize) { hostWin.removeEventListener('resize', onResize); onResize = null; }
    modal.remove();
    modal = null;
    block = null;
    targetPage = null;
    pageList = [];
    sessionDesigns = null;
  };

  // Move to a different page: stash the current page's edits, then load the
  // selected page's design into the editor.
  const switchToPage = (pageEl) => {
    if (!pageEl || pageEl === targetPage) return;
    sessionDesigns.set(targetPage, captureBlock());
    targetPage = pageEl;
    const design = sessionDesigns.has(pageEl) ? sessionDesigns.get(pageEl) : readDesignFromPage(pageEl);
    loadBlock(design);
    activateBlock();
  };

  const save = () => {
    if (!block || !sessionDesigns) { close(); return; }
    // Capture the page currently open.
    sessionDesigns.set(targetPage, captureBlock());

    const applyAll = !!(modal && modal.querySelector('[data-apply-all-pages]')?.checked);
    // Persist preference so the checkbox is pre-ticked next time.
    try { localStorage.setItem('cs-page-shape:apply-all', applyAll ? '1' : '0'); } catch (e) { /* */ }

    if (applyAll) {
      // Apply the current page's design to every page (live design, not stale session map).
      const design = sessionDesigns.get(targetPage);
      getAllPages().forEach((pageEl) => {
        if (document.contains(pageEl)) injectLayer(pageEl, design);
      });
    } else {
      // Only pages edited in this session; others are left untouched.
      sessionDesigns.forEach((design, pageEl) => {
        if (document.contains(pageEl)) injectLayer(pageEl, design);
      });
    }
    close();
  };

  const open = () => {
    if (modal) return;
    if (!window.PenShape || typeof window.PenShape.createBlock !== 'function') {
      console.warn('[PageShapeDesigner] PenShape engine not available');
      return;
    }

    pageList = getAllPages();
    targetPage = resolveActivePage();
    if (!targetPage) {
      console.warn('[PageShapeDesigner] no page to design');
      return;
    }
    if (!pageList.includes(targetPage)) pageList = getAllPages();
    sessionDesigns = new Map();

    // Render the modal in the HOST document (root) so it covers the whole app
    // like the save-as modal — no iframe resizing needed.
    ensureHostStyles();

    const dims = getPageDims();
    modal = buildModal(dims);
    hostDoc.body.appendChild(modal);
    populatePageSelect();

    // Restore "Apply to all pages" preference from last session.
    const applyAllChk = modal.querySelector('[data-apply-all-pages]');
    if (applyAllChk) {
      try { applyAllChk.checked = localStorage.getItem('cs-page-shape:apply-all') === '1'; } catch (e) { /* */ }
    }

    const stage = modal.querySelector('.cs-page-shape-stage');
    zoom = 1;

    // Build a clean pen-shape block; layoutStage() sizes it to the stage.
    block = window.PenShape.createBlock();
    block.classList.add('cs-page-shape-block');
    block.style.margin = '0';

    // Trace-reference layer sits BEHIND the pen block (inserted first).
    const refImg = document.createElement('div');
    refImg.className = 'cs-page-shape-ref-img';
    refImg.setAttribute('data-ref-img', '');
    refImg.setAttribute('aria-hidden', 'true');
    refImg.style.opacity = '0.45';
    stage.appendChild(refImg);

    // Restore the target page's existing design (if any) into the editor.
    loadBlock(readDesignFromPage(targetPage));

    stage.appendChild(block);
    layoutStage();

    // W/H size inputs: show current active-path bbox, scale shape on change.
    let shapeLocked = true; // proportion lock — on by default
    const wInput = modal.querySelector('[data-shape-w]');
    const hInput = modal.querySelector('[data-shape-h]');
    const lockBtn = modal.querySelector('[data-shape-lock]');
    if (lockBtn) lockBtn.classList.toggle('is-locked', shapeLocked);

    // Convert viewBox units → page px and back for the inputs.
    const vbToPx = (vb, axis) => {
      const dims = getPageDims();
      const VBU = window.PenShape?.VIEWBOX || 1000;
      return Math.round(vb / VBU * (axis === 'w' ? dims.w : dims.h));
    };
    const pxToVb = (px, axis) => {
      const dims = getPageDims();
      const VBU = window.PenShape?.VIEWBOX || 1000;
      return (px / (axis === 'w' ? dims.w : dims.h)) * VBU;
    };

    // Update inputs from current active-path bbox — but not while user is typing.
    const syncWH = (bb) => {
      if (!bb || bb.w < 1 || bb.h < 1) return;
      if (document.activeElement === wInput || document.activeElement === hInput) return;
      if (wInput) wInput.value = vbToPx(bb.w, 'w');
      if (hInput) hInput.value = vbToPx(bb.h, 'h');
    };

    // Register callback so inputs update whenever shape changes or path switches.
    window.PenShape?.onBboxChange?.(syncWH);
    // Sync immediately for the already-loaded shape.
    syncWH(window.PenShape?.getActivePathBbox?.());

    // Scale shape live as user types W or H.
    // When locked: changing W auto-updates H display and scales proportionally.
    let _lastBb = window.PenShape?.getActivePathBbox?.() || null;
    const applyWH = (changedAxis) => {
      // Use the bbox captured at the START of this edit (before scaleActivePath
      // mutates the anchors) so the ratio stays constant while typing.
      const bb = _lastBb;
      if (!bb || bb.w < 1 || bb.h < 1) return;
      let newWvb, newHvb;
      if (changedAxis === 'w') {
        newWvb = pxToVb(Number(wInput.value), 'w');
        if (newWvb <= 0) return;
        if (shapeLocked) {
          newHvb = (newWvb / bb.w) * bb.h;
          // Mirror the computed H into the H input so user sees it update live.
          if (hInput) hInput.value = vbToPx(newHvb, 'h');
        } else {
          newHvb = pxToVb(Number(hInput.value), 'h');
        }
      } else {
        newHvb = pxToVb(Number(hInput.value), 'h');
        if (newHvb <= 0) return;
        if (shapeLocked) {
          newWvb = (newHvb / bb.h) * bb.w;
          if (wInput) wInput.value = vbToPx(newWvb, 'w');
        } else {
          newWvb = pxToVb(Number(wInput.value), 'w');
        }
      }
      if (newWvb > 0 && newHvb > 0) window.PenShape?.scaleActivePath?.(newWvb, newHvb);
    };

    // Reset the baseline bbox when the user starts typing (focus), so ratio is
    // computed from the shape's size at focus time, not after mid-edit mutations.
    const resetBb = () => { _lastBb = window.PenShape?.getActivePathBbox?.() || null; };
    if (wInput) { wInput.addEventListener('focus', resetBb); wInput.addEventListener('input', () => applyWH('w')); }
    if (hInput) { hInput.addEventListener('focus', resetBb); hInput.addEventListener('input', () => applyWH('h')); }

    modal.addEventListener('change', (e) => {
      if (e.target.matches('[data-page-select]')) {
        const next = pageList[Number(e.target.value)];
        switchToPage(next);
        return;
      }
      if (e.target.matches('[data-ref-file]')) {
        loadReferenceFile(e.target.files && e.target.files[0]);
        return;
      }
      if (e.target.matches('[data-trace-outline]')) {
        const st = modal.querySelector('.cs-page-shape-stage');
        if (st) st.classList.toggle('cs-trace-outline', e.target.checked);
      }
    });

    modal.addEventListener('input', (e) => {
      if (e.target.matches('[data-ref-op]')) setReferenceOpacity(e.target.value);
    });

    modal.addEventListener('click', (e) => {
      const preset = e.target.closest('[data-preset]')?.dataset.preset;
      if (preset) {
        try {
          // Convert the W/H (page px) into viewBox units so the shape drops in
          // at the chosen size instead of filling the page.
          const dims = getPageDims();
          const VBU = window.PenShape?.VIEWBOX || 1000;
          const wpx = Number(modal.querySelector('[data-shape-w]')?.value) || 0;
          const hpx = Number(modal.querySelector('[data-shape-h]')?.value) || 0;
          const opts = (wpx > 0 && hpx > 0)
            ? { w: (wpx / dims.w) * VBU, h: (hpx / dims.h) * VBU }
            : null;
          window.PenShape?.loadPreset?.(preset, opts);
        } catch (err) { /* */ }
        return;
      }
      const zc = e.target.closest('[data-zoom]')?.dataset.zoom;
      if (zc) {
        if (zc === 'in') setZoom(zoom * 1.25);
        else if (zc === 'out') setZoom(zoom / 1.25);
        else setZoom(1);
        return;
      }
      if (e.target.closest('[data-ref-clear]')) {
        setReference(null);
        const f = modal.querySelector('[data-ref-file]');
        if (f) f.value = '';
        return;
      }
      if (e.target.closest('[data-shape-lock]')) {
        shapeLocked = !shapeLocked;
        lockBtn?.classList.toggle('is-locked', shapeLocked);
        return;
      }
      const lact = e.target.closest('[data-layers-act]')?.dataset.layersAct;
      if (lact === 'merge') { try { window.PenShape?.mergeSelected?.(); } catch (err) { /* */ } return; }
      if (lact === 'lock') { try { window.PenShape?.toggleLockSelected?.(); } catch (err) { /* */ } return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'cancel') return close();
      if (act === 'save') return save();
      if (act === 'clear') { try { window.PenShape?.clearAllPaths?.(); } catch (err) { /* */ } return; }
      if (e.target.classList.contains('cs-page-shape-modal__backdrop')) return close();
    });

    // Ctrl/Cmd + wheel zooms the stage (the pen engine's ResizeObserver redraws
    // the overlay to the new size; the stagewrap scrolls when it overflows).
    const stagewrap = modal.querySelector('.cs-page-shape-stagewrap');
    if (stagewrap) {
      stagewrap.addEventListener('wheel', (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        setZoom(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
      }, { passive: false });
    }

    // Re-fit when the host window resizes. The pen engine's ResizeObserver
    // redraws the overlay to the new size.
    onResize = () => layoutStage();
    hostWin.addEventListener('resize', onResize);

    // Activate the pen session once the stage has real dimensions.
    activateBlock();
  };

  // Remove the shape from the page the user is currently working on.
  const removeFromActive = () => {
    const page = resolveActivePage();
    if (!page) return;
    page.querySelectorAll(`:scope > .${LAYER_CLASS}`).forEach((el) => el.remove());
  };

  // Remove the shape from every page (used by tooling, not the per-page UI).
  const clearAll = () => {
    getAllPages().forEach((page) => {
      page.querySelectorAll(`:scope > .${LAYER_CLASS}`).forEach((el) => el.remove());
    });
  };

  /* -------------------- keep cloned pages' def ids unique ------------------- */

  // Page shapes are per-page, so newly-added pages do NOT inherit any design.
  // But duplicating a page that already has a shape clones its <svg> verbatim —
  // duplicate gradient/pattern ids in one document make them all resolve to the
  // first. Re-uniquify any cloned layer's ids so each page renders its own.
  const watchNewPages = () => {
    const root = getPagesRoot();
    if (!root) return;
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          const pages = node.matches?.(PAGE_SEL)
            ? [node]
            : Array.from(node.querySelectorAll?.(PAGE_SEL) || []);
          pages.forEach((pageEl) => {
            const layer = pageEl.querySelector(`:scope > .${LAYER_CLASS}`);
            const svg = layer && layer.querySelector('svg');
            // _csShapeUniq is a JS property (not an attribute) so it is NOT
            // copied by cloneNode — a freshly-cloned layer lacks it and gets
            // re-uniquified exactly once.
            if (svg && !layer._csShapeUniq) {
              uniquifyIds(svg, `pg${uidSeq += 1}`);
              layer._csShapeUniq = true;
            }
          });
        }
      }
    });
    obs.observe(root, { childList: true, subtree: true });
  };

  Object.assign(window.PageShapeDesigner, { open, removeFromActive, clearAll });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchNewPages);
  } else {
    watchNewPages();
  }
})();
