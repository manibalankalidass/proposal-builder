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
      // Clear old propsEl from host before activating — prevents duplicates when
      // deactivate() was called (e.g. via captureBlock) and a new session creates
      // a fresh propsEl that would otherwise stack on top of the old one.
      const propsHost = modal.querySelector('[data-props-host]');
      if (propsHost) propsHost.innerHTML = '';
      window.PenShape.activate(block);
      window.PenShape.setLayersPanel?.(modal.querySelector('[data-layers-list]'));
      window.PenShape.setPropsPanel?.(propsHost);
      layoutStage();
    });
  };

  /* ----------------------------- design templates --------------------------- */

  // Pre-built page background designs. Each entry has:
  //   label   — short display name
  //   thumb   — inline SVG string (small preview, viewBox="0 0 60 85")
  //   paths   — penPath JSON (window.PenShape state format) to load
  //   style   — optional per-path fill colour overrides applied after load

  // All coordinates are in 0–1000 viewBox space (pen engine VB=1000).
  // Bezier: outX/outY = handle leaving a node; inX/inY = handle arriving at a node.
  // SVG cubic: C(prev.outX prev.outY)(curr.inX curr.inY)(curr.x curr.y)

  // VB=1000 space. outX/outY = handle leaving node (C1), inX/inY = handle arriving (C2).
  const DESIGN_TEMPLATES = [
    
    {
      // Red letterhead — large arc top + footer bar
      label: 'Red Letterhead',
      thumb: `<svg viewBox="0 0 60 85" xmlns="http://www.w3.org/2000/svg"><rect width="60" height="85" fill="#fff"/><path d="M0,0 L60,0 L60,28 C45,44 15,38 0,45 Z" fill="#e53935"/><path d="M0,0 L60,0 L60,18 C45,30 15,24 0,30 Z" fill="#fff" opacity=".3"/><rect x="0" y="80" width="60" height="5" fill="#e53935"/></svg>`,
      paths: [
        { anchors: [
            { x: 0,    y: 0 },
            { x: 1000, y: 0 },
            { x: 1000, y: 280, outX: 1000, outY: 440 },
            { x: 0,    y: 450, inX: 480,   inY: 450 },
          ], closed: true, name: 'Top arc',
          style: { fillType: 'solid', fill: '#e53935', opacity: 1 } },
        { anchors: [
            { x: 0,    y: 0 },
            { x: 1000, y: 0 },
            { x: 1000, y: 180, outX: 1000, outY: 300 },
            { x: 0,    y: 300, inX: 480,   inY: 300 },
          ], closed: true, name: 'Highlight',
          style: { fillType: 'solid', fill: '#ffffff', opacity: 0.28 } },
        { anchors: [
            { x: 0, y: 940 }, { x: 1000, y: 940 },
            { x: 1000, y: 1000 }, { x: 0, y: 1000 },
          ], closed: true, name: 'Footer bar',
          style: { fillType: 'solid', fill: '#e53935', opacity: 1 } },
      ],
    },
    {
      // Dark corporate: header bar + red left accent + bottom-left wedge
      label: 'Dark Corporate',
      thumb: `<svg viewBox="0 0 60 85" xmlns="http://www.w3.org/2000/svg"><rect width="60" height="85" fill="#fff"/><rect x="0" y="0" width="60" height="14" fill="#1a1a2e"/><rect x="0" y="0" width="14" height="26" fill="#c62828"/><path d="M0,85 L26,85 L0,60 Z" fill="#1a1a2e"/></svg>`,
      paths: [
        { anchors: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 140 }, { x: 0, y: 140 }],
          closed: true, name: 'Header bar',
          style: { fillType: 'solid', fill: '#1a1a2e', opacity: 1 } },
        { anchors: [{ x: 0, y: 0 }, { x: 140, y: 0 }, { x: 140, y: 260 }, { x: 0, y: 260 }],
          closed: true, name: 'Red accent',
          style: { fillType: 'solid', fill: '#c62828', opacity: 1 } },
        { anchors: [{ x: 0, y: 1000 }, { x: 260, y: 1000 }, { x: 0, y: 700 }],
          closed: true, name: 'Bottom wedge',
          style: { fillType: 'solid', fill: '#1a1a2e', opacity: 1 } },
      ],
    },
    
    {
      // Large teal arc covering left portion of page (C-shape open right)
      label: 'Teal Arc Side',
      thumb: `<svg viewBox="0 0 60 85" xmlns="http://www.w3.org/2000/svg"><rect width="60" height="85" fill="#fff"/><path d="M0,0 L60,0 C60,0 12,17 12,42 C12,68 60,85 60,85 L0,85 Z" fill="#00695c"/><path d="M0,0 L42,0 C42,0 0,18 0,42 C0,67 42,85 42,85 L0,85 Z" fill="#004d40" opacity=".5"/></svg>`,
      paths: [
        { anchors: [
            { x: 0,    y: 0 },
            { x: 1000, y: 0,    outX: 1000, outY: 0 },
            { x: 200,  y: 500,  inX: 200,   inY: 141, outX: 200, outY: 858 },
            { x: 1000, y: 1000, inX: 1000,  inY: 1000 },
            { x: 0,    y: 1000 },
          ], closed: true, name: 'Teal outer',
          style: { fillType: 'solid', fill: '#00695c', opacity: 1 } },
        { anchors: [
            { x: 0,    y: 0 },
            { x: 700,  y: 0,    outX: 700,  outY: 0 },
            { x: 0,    y: 500,  inX: 0,     inY: 127, outX: 0, outY: 873 },
            { x: 700,  y: 1000, inX: 700,   inY: 1000 },
            { x: 0,    y: 1000 },
          ], closed: true, name: 'Teal inner',
          style: { fillType: 'solid', fill: '#004d40', opacity: 0.5 } },
      ],
    },
    {
      // Right-side crimson wave sweeping from right edge
      label: 'Right Wave',
      thumb: `<svg viewBox="0 0 60 85" xmlns="http://www.w3.org/2000/svg"><rect width="60" height="85" fill="#fff"/><path d="M60,0 L60,85 C40,85 20,65 30,42 C40,20 20,5 60,0 Z" fill="#c62828"/><path d="M60,0 L60,85 C50,85 34,68 40,42 C47,18 36,3 60,0 Z" fill="#e53935" opacity=".5"/></svg>`,
      paths: [
        { anchors: [
            { x: 1000, y: 0 },
            { x: 1000, y: 1000 },
            { x: 400,  y: 1000, inX: 800,  inY: 1000, outX: 200, outY: 1000 },
            { x: 300,  y: 500,  inX: 200,  inY: 750,  outX: 400,  outY: 250 },
            { x: 600,  y: 0,    inX: 400,  inY: 50 },
          ], closed: true, name: 'Right wave outer',
          style: { fillType: 'solid', fill: '#c62828', opacity: 1 } },
        { anchors: [
            { x: 1000, y: 0 },
            { x: 1000, y: 1000 },
            { x: 580,  y: 1000, inX: 850,  inY: 1000, outX: 380, outY: 1000 },
            { x: 480,  y: 500,  inX: 360,  inY: 730,  outX: 580, outY: 270 },
            { x: 720,  y: 0,    inX: 560,  inY: 40 },
          ], closed: true, name: 'Right wave inner',
          style: { fillType: 'solid', fill: '#e53935', opacity: 0.5 } },
      ],
    },
    {
      // Flat header + footer bars
      label: 'Header+Footer',
      thumb: `<svg viewBox="0 0 60 85" xmlns="http://www.w3.org/2000/svg"><rect width="60" height="85" fill="#fff"/><rect x="0" y="0" width="60" height="13" fill="#1a237e"/><rect x="0" y="74" width="60" height="11" fill="#1a237e"/></svg>`,
      paths: [
        { anchors: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 130 }, { x: 0, y: 130 }],
          closed: true, name: 'Header',
          style: { fillType: 'solid', fill: '#1a237e', opacity: 1 } },
        { anchors: [{ x: 0, y: 870 }, { x: 1000, y: 870 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }],
          closed: true, name: 'Footer',
          style: { fillType: 'solid', fill: '#1a237e', opacity: 1 } },
      ],
    },
    
  ];

  /* ----------------------- custom saved designs (localStorage) --------------- */

  const SAVED_KEY = 'cs-page-shape:saved-designs';

  const loadSavedDesigns = () => {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch (e) { return []; }
  };

  const persistSavedDesigns = (list) => {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch (e) { /* */ }
  };

  // Capture the current drawing and save it to localStorage with a user-supplied name.
  const saveCurrentDesign = () => {
    if (!block) return;
    const design = captureBlock();
    if (!design || !design.penPath) {
      alert('Nothing to save — draw a shape first.');
      return;
    }
    // Re-activate after captureBlock deactivated the pen session.
    try {
      const propsHost = modal?.querySelector('[data-props-host]');
      if (propsHost) propsHost.innerHTML = '';
      window.PenShape.activate(block);
      window.PenShape.setLayersPanel?.(modal?.querySelector('[data-layers-list]'));
      window.PenShape.setPropsPanel?.(propsHost);
    } catch (e) { /* */ }

    const name = (prompt('Name this design:', 'My Design') || '').trim();
    if (!name) return;

    const state = JSON.parse(design.penPath || '{}');
    // Generate a thumbnail SVG from the pen paths using their recorded fill styles.
    const thumbPaths = (state.paths || []).map((p) => {
      if (!p.anchors || p.anchors.length < 2) return '';
      const fill = p.style?.fill || '#248567';
      const opacity = p.style?.opacity != null ? p.style.opacity : 1;
      let d = `M ${p.anchors[0].x * 60 / 1000},${p.anchors[0].y * 85 / 1000}`;
      for (let i = 1; i < p.anchors.length; i++) {
        const prev = p.anchors[i - 1];
        const curr = p.anchors[i];
        const c1x = ((prev.outX != null ? prev.outX : prev.x) * 60 / 1000).toFixed(2);
        const c1y = ((prev.outY != null ? prev.outY : prev.y) * 85 / 1000).toFixed(2);
        const c2x = ((curr.inX  != null ? curr.inX  : curr.x) * 60 / 1000).toFixed(2);
        const c2y = ((curr.inY  != null ? curr.inY  : curr.y) * 85 / 1000).toFixed(2);
        const ex  = (curr.x * 60 / 1000).toFixed(2);
        const ey  = (curr.y * 85 / 1000).toFixed(2);
        d += ` C ${c1x},${c1y} ${c2x},${c2y} ${ex},${ey}`;
      }
      if (p.closed) d += ' Z';
      return `<path d="${d}" fill="${fill}" opacity="${opacity}"/>`;
    }).join('');
    const thumb = `<svg viewBox="0 0 60 85" xmlns="http://www.w3.org/2000/svg"><rect width="60" height="85" fill="#fff"/>${thumbPaths}</svg>`;

    const list = loadSavedDesigns();
    list.push({ label: name, thumb, penPath: design.penPath, penStyle: design.penStyle || '', savedAt: Date.now() });
    persistSavedDesigns(list);

    // Refresh the saved section in the open templates panel.
    refreshSavedGrid();
  };

  // Delete one saved design by index.
  const deleteSavedDesign = (idx) => {
    const list = loadSavedDesigns();
    list.splice(idx, 1);
    persistSavedDesigns(list);
    refreshSavedGrid();
  };

  // Rebuild only the saved-designs grid inside the open templates panel.
  const refreshSavedGrid = () => {
    if (!modal) return;
    const grid = modal.querySelector('[data-saved-tpl-grid]');
    if (!grid) return;
    const empty = modal.querySelector('[data-saved-tpl-empty]');
    const list = loadSavedDesigns();
    if (empty) empty.style.display = list.length ? 'none' : '';
    grid.innerHTML = '';
    list.forEach((tpl, i) => {
      const btn = hostDoc.createElement('button');
      btn.type = 'button';
      btn.className = 'cs-page-shape-tpl__item';
      btn.dataset.savedTplIndex = String(i);
      btn.title = tpl.label;
      btn.innerHTML = `<span class="cs-page-shape-tpl__thumb">${tpl.thumb}</span>
        <span class="cs-page-shape-tpl__name">${tpl.label}</span>
        <span class="cs-page-shape-tpl__del" data-del-saved="${i}" title="Delete">✕</span>`;
      grid.appendChild(btn);
    });
  };

  // Load a design template into the active pen block, replacing any existing paths.
  const loadTemplate = (tpl) => {
    if (!block) return;
    // Build a fresh penPath state from the template paths.
    const state = {
      paths: tpl.paths.map((p, i) => ({
        anchors: p.anchors.map((a) => Object.assign({}, a)),
        closed: p.closed !== false,
        name: p.name || `Path ${i + 1}`,
        style: Object.assign({ fillType: 'solid', fill: '#248567', opacity: 1 }, p.style || {}),
      })),
    };
    try {
      // Move propsEl back to toolbar BEFORE deactivate, so the host container is
      // empty when the new session appends its fresh propsEl (prevents duplicates).
      window.PenShape.setPropsPanel?.(null);
      window.PenShape.deactivate?.();
      block.dataset.penPath = JSON.stringify(state);
      block.dataset.penStyle = '';
      window.PenShape.renderShape(block);
      window.PenShape.activate(block);
      window.PenShape.setLayersPanel?.(modal?.querySelector('[data-layers-list]'));
      window.PenShape.setPropsPanel?.(modal?.querySelector('[data-props-host]'));
    } catch (e) { /* */ }
  };

  // Populate the prebuilt + saved grids already inside the modal's layers aside.
  const populateTemplateGrids = () => {
    if (!modal) return;

    // Prebuilt grid.
    const grid = modal.querySelector('[data-tpl-grid]');
    if (grid) {
      grid.innerHTML = '';
      DESIGN_TEMPLATES.forEach((tpl, i) => {
        const btn = hostDoc.createElement('button');
        btn.type = 'button';
        btn.className = 'cs-page-shape-tpl__item';
        btn.dataset.tplIndex = String(i);
        btn.title = tpl.label;
        btn.innerHTML = `<span class="cs-page-shape-tpl__thumb">${tpl.thumb}</span>
          <span class="cs-page-shape-tpl__name">${tpl.label}</span>`;
        grid.appendChild(btn);
      });
    }

    // Saved grid (also used by refreshSavedGrid).
    refreshSavedGrid();
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
            <button type="button" data-act="save-design" class="cs-page-shape-btn cs-page-shape-btn--ghost" title="Save current drawing as a reusable template">Save Design</button>
            <button type="button" data-act="clear" class="cs-page-shape-btn cs-page-shape-btn--ghost">Clear</button>
            <button type="button" data-act="cancel" class="cs-page-shape-btn cs-page-shape-btn--ghost">Cancel</button>
            <button type="button" data-act="save" class="cs-page-shape-btn cs-page-shape-btn--primary">Save &amp; Apply</button>
          </div>
        </header>
        <div class="cs-page-shape-modal__body">
          <aside class="cs-page-shape-layers">
            <div class="cs-page-shape-left-tabs">
              <button type="button" class="cs-page-shape-left-tab is-active" data-left-tab="layers">Layers</button>
              <button type="button" class="cs-page-shape-left-tab" data-left-tab="templates">Templates</button>
            </div>

            <div class="cs-page-shape-left-pane" data-left-pane="layers">
              <div class="cs-page-shape-layers__list" data-layers-list></div>
              <div class="cs-page-shape-layers__actions">
                <button type="button" data-layers-act="merge" title="Merge selected layers">Merge</button>
                <button type="button" data-layers-act="lock" title="Lock / unlock selected">Lock</button>
              </div>
              <div class="cs-page-shape-layers__hint">Ctrl/Cmd-click to multi-select · drag to reorder (top = front)</div>
            </div>

            <div class="cs-page-shape-left-pane" data-left-pane="templates" style="display:none">
              <div class="cs-page-shape-tpl-tabs">
                <button type="button" class="cs-page-shape-tpl-tab is-active" data-tpl-tab="prebuilt">Prebuilt</button>
                <button type="button" class="cs-page-shape-tpl-tab" data-tpl-tab="saved">Saved</button>
              </div>
              <div class="cs-page-shape-tpl-pane" data-tpl-pane="prebuilt">
                <div class="cs-page-shape-tpl__grid" data-tpl-grid></div>
              </div>
              <div class="cs-page-shape-tpl-pane" data-tpl-pane="saved" style="display:none">
                <div class="cs-page-shape-tpl__grid" data-saved-tpl-grid></div>
                <div class="cs-page-shape-tpl__empty" data-saved-tpl-empty style="display:none">No saved designs yet.<br>Draw a shape and click <b>Save Design</b>.</div>
              </div>
            </div>
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
    const maxW = Math.max(200, hostWin.innerWidth - 660);  // leave room for layers+templates+shapes panels
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
    zoom = Math.max(0.25, Math.min(10, z));
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

    // Populate the template grids already embedded in the layers aside.
    populateTemplateGrids();

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
      // Left-panel main tab switch: Layers ↔ Templates.
      const leftTab = e.target.closest('[data-left-tab]');
      if (leftTab) {
        const key = leftTab.dataset.leftTab;
        modal.querySelectorAll('[data-left-tab]').forEach((t) => t.classList.toggle('is-active', t.dataset.leftTab === key));
        modal.querySelectorAll('[data-left-pane]').forEach((p) => { p.style.display = p.dataset.leftPane === key ? '' : 'none'; });
        return;
      }

      // Templates sub-tab switch: Prebuilt ↔ Saved.
      const tplTab = e.target.closest('[data-tpl-tab]');
      if (tplTab) {
        const key = tplTab.dataset.tplTab;
        modal.querySelectorAll('[data-tpl-tab]').forEach((t) => t.classList.toggle('is-active', t.dataset.tplTab === key));
        modal.querySelectorAll('[data-tpl-pane]').forEach((p) => { p.style.display = p.dataset.tplPane === key ? '' : 'none'; });
        return;
      }

      // Delete a saved design (the ✕ button inside a saved tile).
      const delBtn = e.target.closest('[data-del-saved]');
      if (delBtn) {
        e.stopPropagation();
        const idx = Number(delBtn.dataset.delSaved);
        const list = loadSavedDesigns();
        const name = list[idx]?.label || 'this design';
        if (confirm(`Delete "${name}"?`)) deleteSavedDesign(idx);
        return;
      }

      // Load a saved (user-created) template.
      const savedBtn = e.target.closest('[data-saved-tpl-index]');
      if (savedBtn) {
        const idx = Number(savedBtn.dataset.savedTplIndex);
        const list = loadSavedDesigns();
        const tpl = list[idx];
        if (tpl) {
          modal.querySelectorAll('[data-tpl-index],[data-saved-tpl-index]').forEach((b) => b.classList.remove('is-active'));
          savedBtn.classList.add('is-active');
          try {
            window.PenShape.setPropsPanel?.(null);
            window.PenShape.deactivate?.();
            block.dataset.penPath = tpl.penPath;
            block.dataset.penStyle = tpl.penStyle || '';
            window.PenShape.renderShape(block);
            window.PenShape.activate(block);
            window.PenShape.setLayersPanel?.(modal?.querySelector('[data-layers-list]'));
            window.PenShape.setPropsPanel?.(modal?.querySelector('[data-props-host]'));
          } catch (err) { /* */ }
        }
        return;
      }

      const tplBtn = e.target.closest('[data-tpl-index]');
      if (tplBtn) {
        const idx = Number(tplBtn.dataset.tplIndex);
        const tpl = DESIGN_TEMPLATES[idx];
        if (tpl) {
          modal.querySelectorAll('[data-tpl-index],[data-saved-tpl-index]').forEach((b) => b.classList.remove('is-active'));
          tplBtn.classList.add('is-active');
          loadTemplate(tpl);
        }
        return;
      }
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
      if (act === 'save-design') return saveCurrentDesign();
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
