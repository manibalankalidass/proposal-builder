/**
 * @fileoverview Full-page background shape designer.
 *
 * Opens a full-screen modal whose drawing stage matches the real page's
 * width × height (aspect ratio). The user designs a vector shape with the
 * SAME pen tool used by the Pen Shape block (reused via window.PenShape), then
 * Save injects that shape as a behind-content background layer into EVERY page
 * (.cs-doc). New pages added later inherit the design automatically.
 *
 * The injected layer (.cs-page-shape-bg) is plain DOM inside .cs-doc — NOT
 * marked [data-cs-chrome] — so the Twig generator clones it and it exports to
 * the PDF. Critical styles are inlined so it renders even if a stylesheet is
 * missing.
 *
 * Opened from the Angular "Style → Page Settings" button via postMessage
 * (page-shape:open), wired in flow-canvas.js.
 *
 * Exposes:
 *   window.PageShapeDesigner.open()   — open the designer (loads existing design)
 *   window.PageShapeDesigner.clearAll() — remove the design from every page
 */
(function () {
  window.PageShapeDesigner = window.PageShapeDesigner || {};

  const LAYER_CLASS = 'cs-page-shape-bg';
  const DEFAULT_W = 794, DEFAULT_H = 1123; // A4 @96dpi fallback

  let modal = null;
  let block = null;

  // The modal is rendered in the HOST document (the Angular shell), NOT inside
  // this iframe — so it reads as a true root-level modal (like the save-as
  // modal) instead of being clipped to the canvas panel. Pages (.cs-doc) still
  // live in THIS document, so getPageDims/getAllDocs keep using `document`.
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

  const getAllDocs = () => Array.from(document.querySelectorAll('.cs-doc'));
  const getPagesRoot = () => document.querySelector('.cs_paper')
    || document.querySelector('.cs_page')
    || document.querySelector('.custom-form-design');

  // The current design, kept in memory so newly-added pages can inherit it.
  // { svg: <svg> markup string, penPath, penStyle } | null
  let currentDesign = null;

  /* ---------------------- inject / remove the bg layer ---------------------- */

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

  const injectLayer = (doc, index) => {
    doc.querySelectorAll(`:scope > .${LAYER_CLASS}`).forEach((el) => el.remove());
    if (!currentDesign || !currentDesign.svg) return;

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
    layer.dataset.penPath = currentDesign.penPath || '';
    layer.dataset.penStyle = currentDesign.penStyle || '';

    const wrap = document.createElement('div');
    wrap.innerHTML = currentDesign.svg;
    const svg = wrap.querySelector('svg');
    if (!svg) return;
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    uniquifyIds(svg, `pg${index}`);
    layer.appendChild(svg);

    // Insert first so it paints first; negative-z keeps it under content anyway.
    doc.insertBefore(layer, doc.firstChild);
  };

  const applyToAllPages = () => {
    getAllDocs().forEach((doc, i) => injectLayer(doc, i));
  };

  const readExistingFromDom = () => {
    const layer = document.querySelector(`.${LAYER_CLASS}`);
    if (!layer) return null;
    const svg = layer.querySelector('svg');
    return {
      svg: svg ? svg.outerHTML : '',
      penPath: layer.dataset.penPath || '',
      penStyle: layer.dataset.penStyle || '',
    };
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
          </div>
          <aside class="cs-page-shape-shapes" data-shapes-panel>
            <div class="cs-page-shape-shapes__title">Properties</div>
            <div class="cs-page-shape-props" data-props-host></div>
            <div class="cs-page-shape-shapes__title">Shapes</div>
            <div class="cs-page-shape-size">
              <label>W <input type="number" data-shape-w min="10" step="10" value="220"></label>
              <label>H <input type="number" data-shape-h min="10" step="10" value="160"></label>
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

  // Fit the page (dims) inside the available modal body area, preserving aspect.
  // Sized against the HOST window (full app), since the modal lives there.
  const fitStageSize = (dims) => {
    const maxW = Math.max(200, hostWin.innerWidth - 460);  // leave room for both side panels
    const maxH = Math.max(200, hostWin.innerHeight - 180);
    const scale = Math.min(maxW / dims.w, maxH / dims.h, 1);
    return { w: Math.round(dims.w * scale), h: Math.round(dims.h * scale) };
  };

  // Size the stage + drawing block to fit the host window, preserving the page
  // aspect ratio. Re-run on host window resize.
  const layoutStage = () => {
    if (!modal || !block) return;
    const dims = getPageDims();
    const size = fitStageSize(dims);
    const stage = modal.querySelector('.cs-page-shape-stage');
    if (stage) { stage.style.width = `${size.w}px`; stage.style.height = `${size.h}px`; }
    block.style.width = `${size.w}px`;
    block.style.height = `${size.h}px`;
  };
  let onResize = null;

  const close = () => {
    if (!modal) return;
    try { window.PenShape?.deactivate?.(); } catch (e) { /* */ }
    if (onResize) { hostWin.removeEventListener('resize', onResize); onResize = null; }
    modal.remove();
    modal = null;
    block = null;
  };

  const save = () => {
    if (!block) { close(); return; }
    // End the session so the final <path>/<defs> are written + rendered.
    try { window.PenShape?.deactivate?.(); } catch (e) { /* */ }

    const svg = block.querySelector('.cs-pen-svg');
    // Each clip-path renders as its own <path class="cs-pen-fill"> — any with a
    // non-empty `d` means there is something to apply.
    const hasShape = svg && Array.from(svg.querySelectorAll('.cs-pen-fill'))
      .some((p) => (p.getAttribute('d') || '').trim().length > 0);

    if (!hasShape) {
      // Nothing drawn → treat Save as "remove the background".
      currentDesign = null;
    } else {
      const clean = svg.cloneNode(true);
      currentDesign = {
        svg: clean.outerHTML,
        penPath: block.dataset.penPath || '',
        penStyle: block.dataset.penStyle || '',
      };
    }
    applyToAllPages();
    close();
  };

  const open = () => {
    if (modal) return;
    if (!window.PenShape || typeof window.PenShape.createBlock !== 'function') {
      console.warn('[PageShapeDesigner] PenShape engine not available');
      return;
    }

    // Pull any existing design (memory first, else from the DOM).
    if (!currentDesign) currentDesign = readExistingFromDom();

    // Render the modal in the HOST document (root) so it covers the whole app
    // like the save-as modal — no iframe resizing needed.
    ensureHostStyles();

    const dims = getPageDims();
    modal = buildModal(dims);
    hostDoc.body.appendChild(modal);

    const stage = modal.querySelector('.cs-page-shape-stage');

    // Build a clean pen-shape block; layoutStage() sizes it to the stage.
    block = window.PenShape.createBlock();
    block.classList.add('cs-page-shape-block');
    block.style.margin = '0';

    // Restore an existing design into the editor.
    if (currentDesign && currentDesign.penPath) {
      block.dataset.penPath = currentDesign.penPath;
      if (currentDesign.penStyle) block.dataset.penStyle = currentDesign.penStyle;
      window.PenShape.renderShape(block);
    }

    stage.appendChild(block);
    layoutStage();

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
      const lact = e.target.closest('[data-layers-act]')?.dataset.layersAct;
      if (lact === 'merge') { try { window.PenShape?.mergeSelected?.(); } catch (err) { /* */ } return; }
      if (lact === 'lock') { try { window.PenShape?.toggleLockSelected?.(); } catch (err) { /* */ } return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'cancel') return close();
      if (act === 'save') return save();
      if (act === 'clear') { try { window.PenShape?.clearAllPaths?.(); } catch (err) { /* */ } return; }
      if (e.target.classList.contains('cs-page-shape-modal__backdrop')) return close();
    });

    // Re-fit when the host window resizes. The pen engine's ResizeObserver
    // redraws the overlay to the new size.
    onResize = () => layoutStage();
    hostWin.addEventListener('resize', onResize);

    // Activate the pen session once the stage has real dimensions, then hand
    // the engine the side-panel element so it renders the rich layers list.
    requestAnimationFrame(() => {
      if (!block) return;
      window.PenShape.activate(block);
      window.PenShape.setLayersPanel?.(modal.querySelector('[data-layers-list]'));
      window.PenShape.setPropsPanel?.(modal.querySelector('[data-props-host]'));
      layoutStage();
    });
  };

  const clearAll = () => {
    currentDesign = null;
    getAllDocs().forEach((doc) => {
      doc.querySelectorAll(`:scope > .${LAYER_CLASS}`).forEach((el) => el.remove());
    });
  };

  /* ------------------- keep new pages in sync with design ------------------- */

  const watchNewPages = () => {
    const root = getPagesRoot();
    if (!root) return;
    const obs = new MutationObserver((muts) => {
      if (!currentDesign) return;
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          const docs = node.matches?.('.cs-doc')
            ? [node]
            : Array.from(node.querySelectorAll?.('.cs-doc') || []);
          docs.forEach((doc) => {
            if (!doc.querySelector(`:scope > .${LAYER_CLASS}`)) {
              const idx = getAllDocs().indexOf(doc);
              injectLayer(doc, idx < 0 ? 0 : idx);
            }
          });
        }
      }
    });
    obs.observe(root, { childList: true, subtree: true });
  };

  Object.assign(window.PageShapeDesigner, { open, clearAll });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchNewPages);
  } else {
    watchNewPages();
  }
})();
