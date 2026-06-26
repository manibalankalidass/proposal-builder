/**
 * @fileoverview Right-click context menu for blocks.
 *
 * Right-click a block → quick actions: Duplicate, Delete, z-order (free blocks),
 * Copy / Paste style, Lock / Unlock. Reuses FlowCanvas.duplicateBlock /
 * deleteBlock; z-order + lock + style-copy are handled here so they work for any
 * free-move block (cover page / section child). Editor-only (menu lives in
 * <body>, never exported). Right-clicking while editing text falls through to
 * the browser's native menu (spellcheck etc.).
 */
(function () {
  window.FlowCanvas = window.FlowCanvas || {};
  const FC = window.FlowCanvas;

  const isFree = (b) => !!(b && b.classList && b.classList.contains('cs_block_s') &&
    (b.dataset.csInSection === '1' || b.classList.contains('cs-flexible-block') ||
      (b.closest && b.closest('[data-cs-cover="1"]'))));

  /* ------------------------------ operations -------------------------------- */

  // Dense z-index reorder among `.cs_block_s` siblings (cover / section).
  const zOrder = (block, kind) => {
    const parent = block.parentElement;
    if (!parent) return;
    const sibs = Array.from(parent.children).filter((c) => c.matches && c.matches('.cs_block_s'));
    if (sibs.length < 2) return;
    const z = (el) => (parseInt(el.style.zIndex || '0', 10) || 0);
    const ordered = sibs.slice().sort((a, b) => (z(a) - z(b)) || (sibs.indexOf(a) - sibs.indexOf(b)));
    const i = ordered.indexOf(block);
    if (i < 0) return;
    if (kind === 'front') { ordered.splice(i, 1); ordered.push(block); }
    else if (kind === 'back') { ordered.splice(i, 1); ordered.unshift(block); }
    else if (kind === 'forward' && i < ordered.length - 1) { ordered.splice(i, 1); ordered.splice(i + 1, 0, block); }
    else if (kind === 'backward' && i > 0) { ordered.splice(i, 1); ordered.splice(i - 1, 0, block); }
    else return;
    ordered.forEach((el, idx) => { el.style.zIndex = String(idx + 1); });
  };

  const toggleLock = (block) => {
    if (block.dataset.csLocked === '1') delete block.dataset.csLocked;
    else block.dataset.csLocked = '1';
  };

  // Format painter — uses StyleManager so color/font reading matches exactly
  // what the style panel reads (handles span-wrapped text from CustomRichEditor).
  let styleClip = null;

  const TYPO_KEYS = ['color', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
    'textAlign', 'lineHeight', 'letterSpacing', 'textTransform', 'textDecorationLine'];
  const BOX_KEYS = ['backgroundColor',
    'borderTopWidth', 'borderTopStyle', 'borderTopColor',
    'borderRightWidth', 'borderRightStyle', 'borderRightColor',
    'borderBottomWidth', 'borderBottomStyle', 'borderBottomColor',
    'borderLeftWidth', 'borderLeftStyle', 'borderLeftColor',
    'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
    'boxShadow', 'opacity', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'];
  const textEl = (b) => b.querySelector(':scope > .edit_me') || b.querySelector(':scope > .canvas-block__content') || b;

  const copyStyle = (block) => {
    const SM = window.StyleManager;
    if (SM && SM.readBlockStyles) {
      styleClip = SM.readBlockStyles(block);
      delete styleClip.width;
      delete styleClip.height;
      console.log('[COPY-STYLE] styleClip:', JSON.stringify(styleClip));
      return;
    }
    const src = textEl(block);
    styleClip = { _raw: true, typo: {}, box: {} };
    TYPO_KEYS.forEach((k) => { const v = src.style[k]; if (v) styleClip.typo[k] = v; });
    BOX_KEYS.forEach((k) => { const v = block.style[k]; if (v) styleClip.box[k] = v; });
    console.log('[COPY-STYLE] fallback styleClip:', JSON.stringify(styleClip));
  };

  const pasteStyle = (block) => {
    console.log('[PASTE-STYLE] styleClip:', JSON.stringify(styleClip), '| block:', block?.id);
    if (!styleClip) return;
    const SM = window.StyleManager;
    if (SM && SM.applyStyles && !styleClip._raw) {
      SM.applyStyles(block, styleClip);
    } else {
      const dst = textEl(block);
      Object.entries(styleClip.typo || {}).forEach(([k, v]) => { dst.style[k] = v; });
      Object.entries(styleClip.box || {}).forEach(([k, v]) => { block.style[k] = v; });
    }
    console.log('[PASTE-STYLE] after paste, block.style.color:', block.style.color, '| edit_me.style.color:', textEl(block)?.style?.color);
    window.FlowCanvas?.broadcastSelection?.();
  };

  /* -------------------------------- the menu -------------------------------- */

  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };

  const buildItems = (block) => {
    const free = isFree(block);
    const del = FC.deleteBlock || ((b) => b.remove());
    const items = [
      { label: 'Duplicate', hint: '⌘/Ctrl+D', act: () => FC.duplicateBlock && FC.duplicateBlock(block) },
      { label: 'Delete', hint: 'Del', danger: true, act: () => del(block) },
    ];
    if (free) {
      items.push({ sep: true },
        { label: 'Bring to front', act: () => zOrder(block, 'front') },
        { label: 'Bring forward', act: () => zOrder(block, 'forward') },
        { label: 'Send backward', act: () => zOrder(block, 'backward') },
        { label: 'Send to back', act: () => zOrder(block, 'back') });
    }
    items.push({ sep: true }, { label: 'Copy style', act: () => copyStyle(block) });
    if (styleClip) items.push({ label: 'Paste style', act: () => pasteStyle(block) });
    if (free) items.push({ sep: true }, { label: block.dataset.csLocked === '1' ? 'Unlock' : 'Lock', act: () => toggleLock(block) });
    return items;
  };

  const openMenu = (x, y, block) => {
    closeMenu();
    menu = document.createElement('div');
    menu.className = 'cs-ctx-menu';
    menu.setAttribute('data-cs-chrome', '');
    buildItems(block).forEach((it) => {
      if (it.sep) { const s = document.createElement('div'); s.className = 'cs-ctx-menu__sep'; menu.appendChild(s); return; }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cs-ctx-menu__item' + (it.danger ? ' is-danger' : '');
      b.innerHTML = `<span>${it.label}</span>${it.hint ? `<span class="cs-ctx-menu__hint">${it.hint}</span>` : ''}`;
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); try { it.act(); } catch (err) { /* */ } closeMenu(); });
      menu.appendChild(b);
    });
    menu.addEventListener('pointerdown', (e) => e.stopPropagation(), true);
    document.body.appendChild(menu);
    // Clamp to viewport.
    const w = menu.offsetWidth, h = menu.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    menu.style.left = `${Math.min(x, vw - w - 8)}px`;
    menu.style.top = `${Math.min(y, vh - h - 8)}px`;
  };

  /* --------------------------------- wiring --------------------------------- */

  const init = () => {
    document.addEventListener('contextmenu', (e) => {
      const block = e.target.closest && e.target.closest('.cs_block_s');
      if (!block) { closeMenu(); return; }                 // empty area → native menu
      // Table blocks own their own context menu (table-block.js) outside Froala
      // mode — bail here so both menus don't open at once on the same right-click.
      const inFroala = (typeof window.isFroalaEditor === 'function') && window.isFroalaEditor();
      if (block.dataset.blockType === 'table' && !inFroala) { closeMenu(); return; }
      // While editing text, defer to the browser's native menu.
      if (window.EditorManager && window.EditorManager.getEditing && window.EditorManager.getEditing() === block) return;
      e.preventDefault();
      try { window.EditorManager && window.EditorManager.select && window.EditorManager.select(block); } catch (err) { /* */ }
      openMenu(e.clientX, e.clientY, block);
    });
    document.addEventListener('pointerdown', (e) => {
      if (menu && !e.target.closest('.cs-ctx-menu')) closeMenu();
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
    document.addEventListener('scroll', closeMenu, true);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
