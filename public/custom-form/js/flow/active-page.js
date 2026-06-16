/**
 * @fileoverview Scroll-driven "active page" tracker.
 *
 * As the user scrolls (or clicks) through the document, the page currently in
 * view is marked as the active/selected page by adding a class to its `.cs_page`
 * wrapper — so the rest of the editor can identify which page the user is
 * working on:
 *
 *   - Cover page   (.cs_page[data-cs-cover="1"]) → `cs_selected`
 *   - Content page (.cs_page wrapping a .cs_margin) → `cs_selected_border`
 *
 * Only ONE page carries a selection class at a time. These classes are
 * editor-only and are stripped from the exported markup by the Twig generator
 * (common-twig-generator.js).
 *
 * Exposes:
 *   window.FlowCanvas.getSelectedPage()         — the selected `.cs_page` element
 *   window.FlowCanvas.getSelectedDrawablePage() — cover `.cs_page`, or the content
 *                                                 page's inner `.cs_margin`
 *                                                 (what per-page features target)
 */
(function () {
  window.FlowCanvas = window.FlowCanvas || {};

  const PAGE_SEL = '.cs_page';
  const SEL_CLASSES = ['cs_selected', 'cs_selected_border'];

  let selectedPage = null;
  let rafId = 0;

  // This script runs inside the editor iframe, but the iframe is sized to its
  // full content height — so it never scrolls itself; the HOST (Angular shell)
  // scroll container is what actually moves. We must therefore measure page
  // visibility against the HOST viewport, mapping each page's iframe-local rect
  // into host coordinates via the iframe element's position in the host.
  const hostWin = (() => {
    try { return window.parent && window.parent !== window ? window.parent : window; } catch (e) { return window; }
  })();
  const isEmbedded = hostWin !== window;
  const frameEl = (() => { try { return window.frameElement || null; } catch (e) { return null; } })();

  const allPages = () => Array.from(document.querySelectorAll(PAGE_SEL));

  // Viewport height + the vertical offset to add to an iframe-local rect to get
  // its position in the visible (host) viewport.
  const viewport = () => {
    if (isEmbedded && frameEl) {
      let frameTop = 0;
      try { frameTop = frameEl.getBoundingClientRect().top; } catch (e) { frameTop = 0; }
      const vh = hostWin.innerHeight || hostWin.document?.documentElement?.clientHeight || 0;
      return { vh, offset: frameTop };
    }
    return { vh: window.innerHeight || document.documentElement.clientHeight || 0, offset: 0 };
  };

  // The page whose visible area best covers the viewport centre wins. A page
  // that straddles the centre line always beats one that's merely partly
  // visible, so the "current" page is stable while scrolling.
  const pickMostVisible = () => {
    const pages = allPages();
    if (!pages.length) return null;
    const { vh, offset } = viewport();
    if (!vh) return pages[0];
    const centerY = vh / 2;
    let best = null, bestScore = -Infinity;
    for (const p of pages) {
      const r = p.getBoundingClientRect();
      if (r.height === 0) continue;
      const top = r.top + offset;          // host-viewport coordinates
      const bottom = r.bottom + offset;
      if (bottom <= 0 || top >= vh) continue; // off-screen
      const overlap = Math.max(0, Math.min(bottom, vh) - Math.max(top, 0));
      const containsCenter = top <= centerY && bottom >= centerY;
      const score = overlap + (containsCenter ? 1e7 : 0);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best || pages[0];
  };

  // Report "page X of Y" to the host shell, but only when it actually changes
  // (apply() runs on every scroll frame, so guard against spamming postMessage).
  let lastPostedKey = '';
  const postActivePage = (page) => {
    const pages = allPages();
    const index = pages.indexOf(page) + 1;       // 1-based; 0 if not found
    const total = pages.length;
    // This page's own background image (set per-page by flow-canvas) so the host
    // panel preview reflects whichever page is in view.
    const drawable = page.matches('[data-cs-cover="1"]') ? page : (page.querySelector(':scope > .cs_margin') || page);
    const bgImage = (drawable && drawable.dataset.csBgImage) || '';
    const key = `${index}/${total}`;
    if (key === lastPostedKey) return;
    lastPostedKey = key;
    try {
      hostWin.postMessage({ source: 'custom-form-twig', type: 'page:active', index, total, bgImage }, '*');
    } catch (e) { /* parent on different origin — ignore */ }
  };

  const apply = (page) => {
    if (!page) return;
    selectedPage = page;
    allPages().forEach((p) => {
      if (p !== page) p.classList.remove(...SEL_CLASSES);
    });
    const isCover = page.matches('[data-cs-cover="1"]');
    page.classList.toggle('cs_selected', isCover);
    page.classList.toggle('cs_selected_border', !isCover);
    postActivePage(page);
  };

  // While we're deliberately scrolling to a just-added page, suppress the
  // scroll-driven recompute so it can't momentarily reselect the old page
  // (the page-add MutationObserver fires before the scroll has moved).
  let focusLock = false;
  let focusLockTimer = 0;

  const update = () => { if (!focusLock) apply(pickMostVisible()); };

  const scheduleUpdate = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; update(); });
  };

  /* ------------------------- scroll to a given page ------------------------- */

  // The nearest scrollable ancestor of the iframe in the HOST document.
  const findScrollable = (node) => {
    let n = node ? node.parentElement : null;
    while (n && n.nodeType === 1) {
      let oy = '';
      try { oy = hostWin.getComputedStyle(n).overflowY; } catch (e) { /* */ }
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n;
      n = n.parentElement;
    }
    return null;
  };

  const hostScroller = () => {
    if (isEmbedded && frameEl) {
      try { return frameEl.closest('.canvas-stage') || findScrollable(frameEl); } catch (e) { /* */ }
    }
    return null;
  };

  // Scroll the host so `page` sits near the top of the viewport, then keep it
  // selected. The iframe is resized by the host asynchronously after a page is
  // added, so the target may be momentarily out of scroll range — retry until
  // it's reachable (or attempts run out).
  const scrollHostToPage = (page) => {
    const scroller = hostScroller();
    if (!scroller) {
      try { page.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* */ }
      return;
    }
    const PAD = 24;
    let tries = 0;
    const attempt = () => {
      tries += 1;
      let frameTop = 0;
      try { frameTop = frameEl.getBoundingClientRect().top; } catch (e) { frameTop = 0; }
      const sRect = scroller.getBoundingClientRect();
      const pageTopInScroller =
        scroller.scrollTop + (frameTop + page.getBoundingClientRect().top) - sRect.top;
      const target = Math.max(0, pageTopInScroller - PAD);
      const maxTop = scroller.scrollHeight - scroller.clientHeight;
      // Iframe hasn't grown to include the new page yet → wait and retry.
      if (target > maxTop + 2 && tries < 15) { hostWin.setTimeout(attempt, 40); return; }
      try { scroller.scrollTo({ top: Math.min(target, maxTop), behavior: 'smooth' }); }
      catch (e) { scroller.scrollTop = Math.min(target, maxTop); }
    };
    attempt();
  };

  /* -------------------------------- public --------------------------------- */

  window.FlowCanvas.getSelectedPage = () =>
    (selectedPage && document.contains(selectedPage) ? selectedPage : null);

  // The element per-page features should target: a cover IS its own page; a
  // content wrapper exposes its inner .cs_margin.
  window.FlowCanvas.getSelectedDrawablePage = () => {
    const sel = window.FlowCanvas.getSelectedPage();
    if (!sel) return null;
    if (sel.matches('[data-cs-cover="1"]')) return sel;
    return sel.querySelector(':scope > .cs_margin') || sel;
  };

  // Scroll to a page (e.g. a freshly added one) and mark it selected. `el` may
  // be the `.cs_page` wrapper itself or any element inside it (e.g. a .cs_margin).
  window.FlowCanvas.focusPage = (el) => {
    if (!el) return;
    const page = el.closest(PAGE_SEL) || el;
    apply(page);                       // select immediately, don't wait for scroll
    focusLock = true;                  // hold the selection through the scroll
    if (focusLockTimer) hostWin.clearTimeout(focusLockTimer);
    focusLockTimer = hostWin.setTimeout(() => {
      focusLock = false; focusLockTimer = 0; update();
    }, 1200);
    scrollHostToPage(page);
  };

  /* --------------------------------- init ---------------------------------- */

  const init = () => {
    // `true` (capture) catches scrolls of any inner scroll container too, since
    // the scroll event doesn't bubble. The REAL scroller is in the host (the
    // iframe is full-height and never scrolls itself), so listen there too.
    window.addEventListener('scroll', scheduleUpdate, true);
    window.addEventListener('resize', scheduleUpdate);
    if (isEmbedded) {
      try {
        hostWin.addEventListener('scroll', scheduleUpdate, true);
        hostWin.addEventListener('resize', scheduleUpdate);
      } catch (e) { /* cross-origin host — fall back to iframe listeners */ }
    }

    // Clicking into a page selects it immediately (don't wait for a scroll).
    document.addEventListener('pointerdown', (e) => {
      const p = e.target?.closest?.(PAGE_SEL);
      if (p) apply(p);
    }, true);

    // Re-evaluate when pages are added / removed. Pages attach as direct
    // children of .cs_paper, so a shallow childList watch is enough (and avoids
    // firing on every nested content edit).
    const root = document.querySelector('.cs_paper') || document.body;
    if (root) new MutationObserver(scheduleUpdate).observe(root, { childList: true });

    update();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
