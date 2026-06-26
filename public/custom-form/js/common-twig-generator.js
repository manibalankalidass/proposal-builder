/**
 * @fileoverview Common Twig Code Generator
 * Captures drag, drop, move, resize, etc. on the canvas and generates Twig code natively,
 * passing state and selections back to the Angular parent context.
 */
(function () {
  const CANVAS_SELECTOR = '.custom-form-design';
  const BLOCK_SELECTOR = '.canvas-block, .cs_block_s';

  const state = {
    twig: '',
  };

  const notify = () => {
    try {
      window.parent?.postMessage({
        source: 'custom-form-twig',
        type: 'twig:updated',
        data: { twig: state.twig }
      }, '*');
    } catch (e) { }
  };

  const getCanvas = () => document.querySelector(CANVAS_SELECTOR);

  const stripChrome = (root) => {
    const clone = root.cloneNode(true);
    clone.querySelectorAll('[data-cs-chrome], .section-binding-info').forEach((el) => el.remove());
    // Strip editor-only selection markers. `cs_selected` / `cs_selected_border`
    // are the scroll-driven "active page" highlight on .cs_page wrappers (see
    // active-page.js) and must never appear in the exported markup. The root
    // itself can carry them (a cover page IS the .custom-form-design root).
    [clone, ...clone.querySelectorAll('.cs-selected, .cs-editing, .canvas-block--selected, .cs_selected, .cs_selected_border, .cs-aiden--active, .cs-aiden--loading')]
      .forEach((el) => {
        el.classList?.remove('cs-selected', 'cs-editing', 'canvas-block--selected', 'cs_selected', 'cs_selected_border', 'cs-aiden--active', 'cs-aiden--loading');
      });
    // Aiden's empty-state hint is a `:empty:before` placeholder — drop it on
    // empty AI-writer blocks so the hint text never shows in the export.
    clone.querySelectorAll('.cs-aiden-block .edit_me[placeholder]').forEach((el) => {
      if (!(el.textContent || '').trim()) el.removeAttribute('placeholder');
    });

    // Section wrappers used to record their last manual resize as an
    // inline `height: NNNpx`. With flow layout that height clips growing
    // content (and worse — clips the rendered PDF), so we drop it from
    // the emitted markup whenever the block contains a flow section.
    const matchesSection = (el) => !!(el.querySelector && el.querySelector(':scope > .section-container-content'));
    const allBlocks = [clone, ...clone.querySelectorAll('.cs_block_s')];
    allBlocks.forEach((el) => {
      if (!el.style) return;
      if (matchesSection(el)) {
        el.style.height = '';
        el.style.minHeight = '';
      }
    });

    return clone;
  };

  const generateForCanvas = (canvas) => {
    if (!canvas) return '';

    const allBlocks = Array.from(canvas.querySelectorAll(BLOCK_SELECTOR));

    // Assign temp IDs
    allBlocks.forEach((b, i) => {
      if (!b.dataset.twigId) {
        b.dataset.twigId = 'tw_' + Math.random().toString(36).substr(2, 9);
      }
    });

    // Process from deepest to shallowest to gracefully replace inner HTML
    allBlocks.sort((a, b) => {
      let depthA = 0, currA = a; while (currA) { depthA++; currA = currA.parentElement; }
      let depthB = 0, currB = b; while (currB) { depthB++; currB = currB.parentElement; }
      return depthB - depthA;
    });

    const blockTwigMap = new Map();

    for (const block of allBlocks) {
      const clone = stripChrome(block);

      const subBlocks = clone.querySelectorAll(BLOCK_SELECTOR);
      subBlocks.forEach(sb => {
        // If a subblock was identified, we replace it in the clone
        // Note: the clone's subBlocks still have their dataset if they were on the live block
        const tid = sb.dataset.twigId;
        if (tid && blockTwigMap.has(tid)) {
          const marker = document.createComment(`__TWIG_ID_${tid}__`);
          sb.replaceWith(marker);
        }
      });

      // Row/cell-level conditions: <tr>/<td>/<th> carrying data-twig-if get
      // wrapped — whole element — in {% if %}...{% endif %}, so when the
      // condition is false the entire <tr>/<td> disappears from the output
      // (not just its content). NOTE: removing a single <td> shifts the
      // remaining columns in that row, so use cell conditions only when a
      // missing column is acceptable. The expressions are stashed and
      // replaced by numbered comment markers, then swapped for twig after
      // serialisation — that keeps comparison operators (<, >) in the
      // expression from being HTML-escaped by outerHTML.
      const elementConditions = [];
      clone.querySelectorAll('tr[data-twig-if], td[data-twig-if], th[data-twig-if]').forEach((el) => {
        const expr = (el.getAttribute('data-twig-if') || '').trim();
        el.removeAttribute('data-twig-if');
        if (!expr) return;
        const idx = elementConditions.length;
        elementConditions.push(expr);
        el.before(document.createComment(`__IFEL_START_${idx}__`));
        el.after(document.createComment(`__IFEL_END_${idx}__`));
      });

      let rawHTML = clone.outerHTML;
      rawHTML = rawHTML.replace(/<!--__TWIG_ID_([^>]+)__-->/g, (match, tid) => {
        return blockTwigMap.get(tid) || '';
      });
      if (elementConditions.length) {
        rawHTML = rawHTML
          .replace(/<!--__IFEL_START_(\d+)__-->/g, (_, i) => `{% if ${elementConditions[i]} %}`)
          .replace(/<!--__IFEL_END_(\d+)__-->/g, () => `{% endif %}`);
      }

      const repeatPath = block.dataset.repeatPath || '';
      const repeatAlias = block.dataset.repeatAlias || '';
      const ifExpr = block.dataset.twigIf || '';

      // Clean up custom twig attributes from the generated HTML
      rawHTML = rawHTML.replace(/\s+data-twig-if="[^"]*"/g, '')
        .replace(/\s+data-repeat-path="[^"]*"/g, '')
        .replace(/\s+data-repeat-alias="[^"]*"/g, '')
        .replace(/\s+data-repeat-chain="[^"]*"/g, '')
        .replace(/\s+data-repeat-label="[^"]*"/g, '')
        .replace(/\s+data-twig-id="[^"]*"/g, '')
        // Also handle single quotes just in case
        .replace(/\s+data-twig-if='[^']*'/g, '')
        .replace(/\s+data-repeat-path='[^']*'/g, '')
        .replace(/\s+data-repeat-alias='[^']*'/g, '')
        .replace(/\s+data-repeat-chain='[^']*'/g, '')
        .replace(/\s+data-repeat-label='[^']*'/g, '')
        .replace(/\s+data-twig-id='[^']*'/g, '');

      let twig = rawHTML;

      // Multi-level binding chain (set when the user picks a deeply nested
      // array in the modal). Each entry is one {% for %} loop, outermost
      // first. Single-level bindings keep using data-repeat-path/-alias.
      let chain = null;
      try {
        if (block.dataset.repeatChain) {
          chain = JSON.parse(block.dataset.repeatChain);
        }
      } catch (e) { chain = null; }

      // Strip leading chain steps that an ancestor block is ALREADY
      // looping over. Modal-saved chains include every outer loop needed
      // to reach the selected array, but when this block sits inside a
      // section that's already iterating the same outer scope, emitting
      // those steps again would produce nested duplicate {% for %} loops
      // (one from the ancestor block, one from this block) and the data
      // would multiply across both axes.
      if (Array.isArray(chain) && chain.length > 0) {
        const ancestorPaths = new Set();
        let anc = block.parentElement;
        while (anc) {
          if (anc.dataset?.repeatChain) {
            try {
              const ancChain = JSON.parse(anc.dataset.repeatChain);
              if (Array.isArray(ancChain)) ancChain.forEach((s) => s?.path && ancestorPaths.add(s.path));
            } catch (e) { /* ignore */ }
          } else if (anc.dataset?.repeatPath) {
            ancestorPaths.add(anc.dataset.repeatPath);
          }
          if (anc.matches?.('.cs_margin, .cs-flow-canvas') || anc.tagName === 'BODY') break;
          anc = anc.parentElement;
        }
        if (ancestorPaths.size) {
          chain = chain.filter((step) => !ancestorPaths.has(step.path));
          if (chain.length === 0) chain = null;
        }
      }

      // Build the {% for %} stack from a chain (multi-level) or the
      // single repeatPath/-alias pair. Returns the wrapped body, or the
      // body unchanged if there's no loop.
      const wrapInLoops = (body) => {
        if (Array.isArray(chain) && chain.length > 0) {
          let out = body;
          for (let i = chain.length - 1; i >= 0; i--) {
            const step = chain[i];
            if (step.kind === 'map' && step.keyAlias) {
              out = `{% for ${step.keyAlias}, ${step.alias} in ${step.path} %}\n${out}\n{% endfor %}`;
            } else {
              out = `{% for ${step.alias} in ${step.path} %}\n${out}\n{% endfor %}`;
            }
          }
          return out;
        }
        if (repeatPath) {
          const alias = repeatAlias || 'item';
          return `{% for ${alias} in ${repeatPath} %}\n${body}\n{% endfor %}`;
        }
        return body;
      };

      const hasLoop = (Array.isArray(chain) && chain.length > 0) || !!repeatPath;
      // Tables: by default the whole <table> would repeat, which means
      // <thead> (the column header row) repeats once per iteration too.
      // Almost always the header should appear ONCE and only the data
      // rows under <tbody> should repeat. We rewrite the block to wrap
      // just the <tbody> contents in the {% for %} stack.
      //
      // BUT: when the header itself uses loop-specific content (eg.
      // `Visit {{ loop.index }}` or `{{ item.engineer }}`), the header
      // is supposed to repeat alongside the body — that's effectively a
      // "card per item" layout rendered as a table. Detect that by
      // looking for any chain alias or `loop.` reference inside the
      // <thead>; if found, fall back to wrapping the entire block.
      //
      // For non-table loops we DEFER the {% for %} wrap to the canvas
      // finalisation pass: if the block sits alone in its row/col, the
      // wrap is hoisted up to wrap the row instead (so the rendered
      // markup contains one row per iteration, not one block-with-no-row
      // per iteration which would put multiple blocks under the same
      // col and trip duplicate IDs).
      const tbodyMatch = hasLoop ? rawHTML.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i) : null;
      const theadMatch = hasLoop ? rawHTML.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i) : null;
      const aliasList = Array.isArray(chain) && chain.length
        ? chain.map((s) => s.alias).concat(chain.filter((s) => s.keyAlias).map((s) => s.keyAlias))
        : (repeatAlias ? [repeatAlias] : []);
      const theadInner = theadMatch ? theadMatch[1] : '';
      const theadIsDynamic = theadInner.includes('loop.') ||
        aliasList.some((a) => a && new RegExp(`\\b${a}\\b`).test(theadInner));

      let wrappedAtBlockLevel = false;
      if (tbodyMatch && !theadIsDynamic) {
        const tbodyInner = tbodyMatch[1];
        // Within <tbody> the rows may mix static label rows ("Part |
        // Quantity") with data rows that reference loop aliases. Only
        // the dynamic rows should repeat — leave static rows outside
        // the {% for %} so they render once. We split on </tr> and
        // group consecutive dynamic rows together, then wrap each
        // dynamic group with the loop while leaving static rows as-is.
        const trMatches = tbodyInner.match(/<tr[\s\S]*?<\/tr>/gi) || [];
        if (trMatches.length > 1 && aliasList.length) {
          const aliasRe = new RegExp(`\\b(?:${aliasList.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b|loop\\.`);
          let assembled = '';
          let buffer = '';
          const flushBuffer = () => {
            if (!buffer) return;
            assembled += wrapInLoops(buffer);
            buffer = '';
          };
          for (const tr of trMatches) {
            if (aliasRe.test(tr)) {
              buffer += tr;
            } else {
              flushBuffer();
              assembled += tr;
            }
          }
          flushBuffer();
          twig = rawHTML.replace(tbodyMatch[0], `<tbody>${assembled}</tbody>`);
        } else {
          const wrappedTbody = wrapInLoops(tbodyInner);
          twig = rawHTML.replace(tbodyMatch[0], `<tbody>${wrappedTbody}</tbody>`);
        }
        wrappedAtBlockLevel = true;
      }

      if (ifExpr && wrappedAtBlockLevel) {
        twig = `{% if ${ifExpr} %}\n${twig}\n{% endif %}`;
      }

      blockTwigMap.set(block.dataset.twigId, twig);
      // Carry the unwrapped loop info forward to the finalisation pass
      // so it can decide whether to wrap at the block, col, or row level.
      if (!wrappedAtBlockLevel && (hasLoop || ifExpr)) {
        blockTwigMap.set(block.dataset.twigId + '__wrap', {
          chain: Array.isArray(chain) && chain.length ? chain : null,
          repeatPath: !chain ? repeatPath : '',
          repeatAlias: !chain ? repeatAlias : '',
          ifExpr,
          wrapInLoops,
        });
      }
    }

    const canvasClone = stripChrome(canvas);
    const canvasSubBlocks = canvasClone.querySelectorAll(BLOCK_SELECTOR);

    // For each block that DEFERRED its {% for %} wrap, decide where the
    // wrap should land: ideally on the outermost ancestor that contains
    // ONLY this block (typically the row-item when the block is alone in
    // a single-col row). That way, each loop iteration produces a fresh
    // row/col stack instead of stuffing multiple blocks under the same
    // <col-item> (which leaves duplicate IDs and broken flex layout).
    //
    // We mark the hoist target with BEGIN/END comment sentinels — these
    // survive .innerHTML serialization, and we substitute them with the
    // actual {% for %} / {% endif %} text in the final string pass.
    // Top-level blocks of `el` = blocks inside el whose CLOSEST ancestor
    // block (excluding themselves) is NOT also inside el. Without this
    // filter, a section block's own nested children blocks would inflate
    // the count and prevent legitimate row-hoisting.
    const topLevelBlocksUnder = (el) => {
      const all = Array.from(el.querySelectorAll(BLOCK_SELECTOR));
      return all.filter((b) => {
        const outer = b.parentElement?.closest(BLOCK_SELECTOR);
        return !outer || !el.contains(outer);
      });
    };

    const hoistMap = new Map();
    canvasSubBlocks.forEach((sb) => {
      const tid = sb.dataset.twigId;
      if (!tid || !blockTwigMap.has(tid + '__wrap')) return;
      // Walk up while the ancestor's ONLY top-level descendant block is
      // this one. Stop at the cs_margin / section-container-content
      // boundary, and only hoist through structural row/col wrappers.
      let hoist = sb;
      let cursor = sb.parentElement;
      while (cursor) {
        if (cursor.matches?.('.cs_margin, .section-container-content, .cs-flow-canvas')) break;
        if (!cursor.matches?.('.row-item, .col-item')) break;
        const topBlocks = topLevelBlocksUnder(cursor);
        if (topBlocks.length !== 1 || topBlocks[0] !== sb) break;
        hoist = cursor;
        cursor = cursor.parentElement;
      }
      hoistMap.set(tid, hoist);
    });

    canvasSubBlocks.forEach((sb) => {
      const tid = sb.dataset.twigId;
      if (tid && blockTwigMap.has(tid)) {
        const marker = document.createComment(`__TWIG_ID_${tid}__`);
        sb.replaceWith(marker);
      }
    });

    // Insert hoist BEGIN/END markers around the chosen ancestor for each
    // deferred wrap. Done AFTER block replacement so the markers don't
    // accidentally get nuked by the replaceWith.
    hoistMap.forEach((hoistEl, tid) => {
      if (!hoistEl || !hoistEl.parentElement) return;
      const begin = document.createComment(`__TWIG_WRAP_BEGIN_${tid}__`);
      const end = document.createComment(`__TWIG_WRAP_END_${tid}__`);
      hoistEl.parentElement.insertBefore(begin, hoistEl);
      hoistEl.parentElement.insertBefore(end, hoistEl.nextSibling);
    });

    let finalHTML = canvasClone.outerHTML;
    finalHTML = finalHTML.replace(/<!--__TWIG_ID_([^>]+)__-->/g, (match, tid) => {
      return blockTwigMap.get(tid) || '';
    });
    // Substitute hoisted wraps. Each pair becomes {% for ... %} ... {% endfor %}.
    finalHTML = finalHTML.replace(
      /<!--__TWIG_WRAP_BEGIN_([^>]+)__-->([\s\S]*?)<!--__TWIG_WRAP_END_\1__-->/g,
      (match, tid, body) => {
        const info = blockTwigMap.get(tid + '__wrap');
        if (!info) return body;
        let wrapped = info.wrapInLoops(body);
        if (info.ifExpr) wrapped = `{% if ${info.ifExpr} %}\n${wrapped}\n{% endif %}`;
        return wrapped;
      }
    );

    // Clean any remaining root-level custom attributes that leaked through
    finalHTML = finalHTML.replace(/\s+data-twig-if="[^"]*"/g, '')
      .replace(/\s+data-repeat-path="[^"]*"/g, '')
      .replace(/\s+data-repeat-alias="[^"]*"/g, '')
      .replace(/\s+data-repeat-chain="[^"]*"/g, '')
      .replace(/\s+data-repeat-label="[^"]*"/g, '')
      .replace(/\s+data-twig-id="[^"]*"/g, '');

    // Cleanup live DOM dataset twigIds
    allBlocks.forEach(b => delete b.dataset.twigId);

    return finalHTML;
  };

  // Serialise EVERY page canvas (.custom-form-design) on the board and
  // concatenate them, each on its own line. Each canvas is one A4 .cs_margin
  // page; emitting all of them (instead of only the first via getCanvas())
  // is what lets a multi-page design render past page 1 in the PDF.
  const generate = () => {
    const canvases = Array.from(document.querySelectorAll(CANVAS_SELECTOR));
    if (!canvases.length) return '';
    const html = canvases.map((c) => generateForCanvas(c)).join('\n');
    state.twig = html;
    notify();
    return html;
  };

  const startObserver = () => {
    const canvas = getCanvas();
    if (!canvas) return;
    // Observe the whole multi-page board (.cs_paper) when present so edits
    // on ANY page — and newly added pages — regenerate the twig, not just
    // changes to page 1.
    const target = canvas.closest('.cs_paper') || canvas.parentElement || canvas;

    let scheduled = false;
    const scheduleRegen = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        generate();
      });
    };

    const obs = new MutationObserver(scheduleRegen);
    obs.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style', 'data-twig-if', 'data-repeat-path', 'data-repeat-alias', 'data-repeat-chain', 'class']
    });
  };

  // Convert RGB to Hex for consistent color display
  const rgbToHex = (rgb) => {
    if (!rgb) return '';
    if (rgb.startsWith('#')) return rgb;

    const match = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (!match) return rgb;

    const r = parseInt(match[1]);
    const g = parseInt(match[2]);
    const b = parseInt(match[3]);

    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  };

  const readBlockStyles = (block) => {
    // Use StyleManager if available
    if (typeof window.StyleManager !== 'undefined' && typeof window.StyleManager.readBlockStyles === 'function') {
      return window.StyleManager.readBlockStyles(block);
    }

    // Fallback implementation with RGB to Hex conversion
    const s = block.style;
    const inner = block.querySelector('.edit_me, .section-container-content, .cs-flexible-content, .image-container');
    const iS = inner ? inner.style : {};

    return {
      backgroundColor: rgbToHex(s.backgroundColor) || '',
      textColor: rgbToHex(iS.color || s.color) || '',
      fontSize: iS.fontSize || '',
      fontWeight: iS.fontWeight || '',
      borderStyle: s.borderStyle || '',
      borderColor: rgbToHex(s.borderColor) || '',
      borderWidth: s.borderWidth || '',
      borderRadius: s.borderRadius || '',
      paddingTop: s.paddingTop || '',
      paddingRight: s.paddingRight || '',
      paddingBottom: s.paddingBottom || '',
      paddingLeft: s.paddingLeft || '',
      marginTop: s.marginTop || '',
      marginRight: s.marginRight || '',
      marginBottom: s.marginBottom || '',
      marginLeft: s.marginLeft || '',
      opacity: s.opacity || '',
      boxShadow: s.boxShadow || '',
      width: s.width || '',
      height: s.height || '',
    };
  };

  // Walk UP from a selected block collecting every ancestor that is itself a
  // content block (.cs_block_s) — e.g. the Flexible / Section that wraps it.
  // Returns innermost-first ({id, name}) so the panel can offer a "Choose
  // parent <name>" button for each level. Ids are minted lazily so the panel
  // can target them with `block:select`.
  const getBlockParents = (block) => {
    const out = [];
    let cur = block && block.parentElement;
    while (cur && cur !== document.body) {
      if (cur.matches && cur.matches('.cs_margin, .cs-flow-canvas, .cs_paper, .cs_page')) break;
      if (cur.classList && cur.classList.contains('cs_block_s')) {
        if (!cur.id) cur.id = 'block_' + Math.random().toString(36).substr(2, 9);
        out.push({
          id: cur.id,
          name: cur.getAttribute('custom-name') || cur.dataset.blockType || cur.getAttribute('data') || 'Block'
        });
      }
      cur = cur.parentElement;
    }
    return out;
  };

  // The set of mutually-exclusive frame-shape classes an image container can
  // carry. Shared by the read (getImageFrame) and write (set-image-frame) paths
  // so they never drift. Mirrors the .image-container.<shape> rules in editor.css.
  const IMAGE_FRAME_SHAPES = [
    'square-image',
    'rounded-square-image',
    'circle-image',
    'diagonal-corners-image',
    'polygon',
    'star',
    'rectangle-image',
  ];

  const getImageFrame = (container) => {
    for (const shape of IMAGE_FRAME_SHAPES) {
      if (container.classList.contains(shape)) return shape;
    }
    return 'square-image'; // default framing when no shape class is present
  };

  // Geometric frames need a 1:1 box — otherwise a percentage clip-path (star /
  // polygon / hexagon) stretches across the image's wide-and-short frame and
  // stops looking like the shape. They also need the image to COVER that box;
  // the global `.cs_block_s img { object-fit: contain }` rule otherwise
  // letterboxes the picture inside the shape. Rectangular frames keep the
  // default contain / full-width framing.
  //
  // These have to be driven via inline `!important` from JS: the container's
  // creation-time inline `aspect-ratio` carries `!important`, which no
  // stylesheet rule (even `!important`) can override — only another inline
  // declaration can.
  const SHAPED_FRAMES = ['circle-image', 'diagonal-corners-image', 'polygon', 'star'];

  const setImageFrame = (container, shape) => {
    if (!IMAGE_FRAME_SHAPES.includes(shape)) return;
    IMAGE_FRAME_SHAPES.forEach((s) => container.classList.remove(s));
    container.classList.add(shape);

    const img = container.querySelector('img');
    if (SHAPED_FRAMES.includes(shape)) {
      // Square, centred box (margin:auto on the container already centres it)
      // so the shape renders true-to-form, with the image filling it.
      container.style.setProperty('aspect-ratio', '1', 'important');
      container.style.setProperty('width', 'auto', 'important');
      img?.style.setProperty('object-fit', 'cover', 'important');
    } else {
      // Restore the default wide framing for square / rounded / rectangle.
      container.style.setProperty('aspect-ratio', 'auto', 'important');
      container.style.setProperty('width', '100%', 'important');
      img?.style.removeProperty('object-fit');
    }

    // The box size/aspect just changed, so re-clamp any active zoom/pan.
    window.FlowCanvas?.refreshImageZoom?.(container);
  };

  const broadcastSelection = () => {
    // Find the currently selected block, whether it is selected via inline-editor class or custom-form class
    let block = document.querySelector('.cs_block_s.cs-selected, .cs_block_s.cs-editing') ||
      document.querySelector('.canvas-block--selected');

    if (!block) {
      window.parent?.postMessage({
        source: 'custom-form-twig',
        type: 'selection:cleared'
      }, '*');
      return;
    }

    // Ensure it has an ID so we can apply properties back to it
    if (!block.id) {
      block.id = 'block_' + Math.random().toString(36).substr(2, 9);
    }

    // Image-block frame: surface whether this is an image and which frame
    // shape it currently uses, so the parent panel can show the shape picker
    // only for images and highlight the active shape.
    const imageContainer = block.querySelector('.image-container');

    window.parent?.postMessage({
      source: 'custom-form-twig',
      type: 'selection:changed',
      data: {
        blockId: block.id,
        blockType: block.dataset.blockType || block.getAttribute('data') || null,
        label: block.getAttribute('custom-name') || block.dataset.blockType || 'Block',
        twigIf: block.dataset.twigIf || '',
        tableBorderWidth: block.querySelector('table') ? (block.querySelector('table').dataset.borderWidth || '0') : '0',
        tableBorderColor: block.querySelector('table') ? (block.querySelector('table').dataset.borderColor || '#000000') : '#000000',
        isImage: !!imageContainer,
        imageFrame: imageContainer ? getImageFrame(imageContainer) : '',
        styles: readBlockStyles(block),
        parents: getBlockParents(block)
      }
    }, '*');
  };

  // When the user clicks inside a Table block we surface the clicked cell and
  // its row to the panel so each can carry its own show-condition. Cell/row
  // ids are minted lazily so the panel can target them with set-condition.
  const broadcastTableTarget = (target) => {
    const cell = target && target.closest ? target.closest('td, th') : null;
    const blockEl = target && target.closest ? target.closest('.cs_block_s, .canvas-block') : null;
    const isTable = !!(cell && blockEl && blockEl.querySelector('table'));
    if (!isTable) {
      window.parent?.postMessage({ source: 'custom-form-twig', type: 'table-target:cleared' }, '*');
      return;
    }
    const row = cell.closest('tr');
    if (!cell.id) cell.id = 'cell_' + Math.random().toString(36).substr(2, 9);
    if (row && !row.id) row.id = 'row_' + Math.random().toString(36).substr(2, 9);
    window.parent?.postMessage({
      source: 'custom-form-twig',
      type: 'table-target:changed',
      data: {
        cellId: cell.id,
        cellTag: cell.tagName.toLowerCase(),
        cellCondition: cell.dataset.twigIf || '',
        rowId: row ? row.id : '',
        rowCondition: row ? (row.dataset.twigIf || '') : ''
      }
    }, '*');
  };

  // Remove a block with a small shrink/fade animation, then prune empty
  // columns/rows and regenerate. Shared by the Delete key and the block badge
  // "delete" action.
  const deleteBlockWithAnimation = (block) => {
    if (!block) return;
    block.style.transition = 'transform 0.2s cubic-bezier(0.6, -0.28, 0.735, 0.045), opacity 0.2s ease-in';
    block.style.transform = 'scale(0.85)';
    block.style.opacity = '0';
    setTimeout(() => {
      block.remove();
      broadcastSelection();
      if (typeof window.FlowCanvas !== 'undefined' && typeof window.FlowCanvas.cleanupEmpty === 'function') {
        const c = getCanvas();
        if (c) window.FlowCanvas.cleanupEmpty(c);
      }
      if (typeof window.generate === 'function') window.generate();
    }, 200);
  };
  window.FlowCanvas = window.FlowCanvas || {};
  window.FlowCanvas.deleteBlock = deleteBlockWithAnimation;

  const startSelectionObserver = () => {
    document.addEventListener('click', (e) => {
      setTimeout(broadcastSelection, 50);
      broadcastTableTarget(e.target);
    });
    document.addEventListener('drop', () => {
      setTimeout(broadcastSelection, 50);
      setTimeout(generate, 100);
    });
    // The main observer watches for 'class' changes which covers selections too
    const canvas = getCanvas();
    if (canvas) {
      const classObs = new MutationObserver(() => {
        broadcastSelection();
      });
      classObs.observe(canvas, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.isContentEditable || activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
          return; // Let user natively edit text within block
        }

        const activeBlock = document.querySelector('.cs_block_s.cs-selected, .cs_block_s.cs-editing') || document.querySelector('.canvas-block--selected');
        if (activeBlock) {
          // Route through FlowCanvas.deleteBlock so wrappers (e.g. the List's
          // group-delete) run; it falls back to deleteBlockWithAnimation.
          (window.FlowCanvas?.deleteBlock || deleteBlockWithAnimation)(activeBlock);
        }
      }
    });
  };

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.target !== 'custom-form-twig') return;

    if (msg.type === 'delete-block') {
      const block = document.getElementById(msg.blockId);
      if (block) {
        block.remove();
        // Manually trigger cleanup to remove empty cols/rows in sections
        if (window.FlowCanvas?.cleanupEmpty) {
          const doc = document.querySelector('.custom-form-design');
          if (doc) window.FlowCanvas.cleanupEmpty(doc);
        }
        broadcastSelection();
        generate();
      }
    }

    if (msg.type === 'set-condition') {
      const block = document.getElementById(msg.blockId);
      if (block) {
        if (msg.expr && msg.expr.trim()) {
          block.dataset.twigIf = msg.expr.trim();
        } else {
          delete block.dataset.twigIf;
        }
        generate();
      }
    }

    if (msg.type === 'set-table-border-params') {
      const block = document.getElementById(msg.blockId);
      if (block) {
        const table = block.querySelector('table');
        const cells = block.querySelectorAll('th, td');

        let bw = parseInt(msg.borderWidth) || 0;
        let color = msg.borderColor || '#000000';
        let borderStr = bw > 0 ? `${bw}px solid ${color}` : 'none';

        if (table) {
          table.dataset.borderWidth = bw.toString();
          table.dataset.borderColor = color;
          table.style.border = borderStr;
          table.style.borderCollapse = 'collapse';
        }
        cells.forEach(c => c.style.border = borderStr);
        generate();
      }
    }

    // Result from the parent-side binding modal: apply repeat-path/alias to
    // the block, or do nothing on skip.
    if (msg.type === 'binding-modal:apply') {
      const block = document.getElementById(msg.blockId);
      if (block && msg.path) {
        block.dataset.repeatPath = msg.path;
        block.dataset.repeatAlias = msg.alias || 'item';
        block.dataset.repeatLabel = msg.path;

        // Multi-level binding (deeply nested array picked in the modal):
        // persist the full chain so the twig generator can emit nested
        // {% for %} loops. Single-level bindings clear the chain so the
        // simpler code path is used.
        if (Array.isArray(msg.chain) && msg.chain.length > 1) {
          block.dataset.repeatChain = JSON.stringify(msg.chain);
        } else {
          delete block.dataset.repeatChain;
        }

        // Visual hint (matches old in-iframe modal behaviour)
        let info = block.querySelector('.section-binding-info');
        if (!info) {
          info = document.createElement('div');
          info.className = 'section-binding-info';
          block.appendChild(info);
        }
        const chainLen = Array.isArray(msg.chain) ? msg.chain.length : 1;
        info.textContent = chainLen > 1
          ? `Repeats ${msg.path} (${chainLen} nested loops)`
          : `Repeats ${msg.path}`;
        generate();
      }
    }

    // Handle style updates from the parent
    if (msg.type === 'set-block-style') {
      const block = document.getElementById(msg.blockId);
      if (block && msg.prop && msg.value !== undefined) {
        const { prop, value } = msg;

        // Handle different style properties
        if (prop === 'textColor') {
          const inner = block.querySelector('.edit_me, .section-container-content, .cs-flexible-content, .image-container');
          if (inner) {
            inner.style.color = value || '';
          }
          block.style.color = value || '';
        } else if (prop === 'fontSize') {
          const inner = block.querySelector('.edit_me, .section-container-content, .cs-flexible-content, .image-container');
          if (inner) {
            inner.style.fontSize = value || '';
          }
        } else if (prop === 'fontWeight') {
          const inner = block.querySelector('.edit_me, .section-container-content, .cs-flexible-content, .image-container');
          if (inner) {
            inner.style.fontWeight = value || '';
          }
        } else {
          // Apply style directly to the block
          if (value === '' || value === null) {
            const cssProp = prop === 'backgroundColor' ? 'background-color' : camelCaseToCssProp(prop);
            block.style.removeProperty(cssProp);
          } else {
            const cssProp = prop === 'backgroundColor' ? 'background-color' : camelCaseToCssProp(prop);
            block.style.setProperty(cssProp, value, 'important');
          }
        }

        // After applying styles, broadcast the selection to update the panel
        setTimeout(() => broadcastSelection(), 50);
        generate();
      }
    }

    // Change an image block's frame shape (square / rounded / circle / polygon
    // / star …). Only the .image-container's shape class is swapped — the <img>,
    // its src and any zoom/pan transform are untouched, so all other image
    // functionality keeps working; only the visible frame changes.
    if (msg.type === 'set-image-frame') {
      const block = document.getElementById(msg.blockId);
      const container = block?.querySelector('.image-container');
      if (container && msg.shape) {
        setImageFrame(container, msg.shape);
        broadcastSelection();
        generate();
      }
    }
  });

  // Helper function for style handler
  const camelCaseToCssProp = (camelCase) => {
    return camelCase.replace(/([A-Z])/g, (g) => `-${g.toLowerCase()}`);
  };

  // Expose so other modules (e.g. context-menu paste style) can refresh the
  // Angular style panel after a programmatic style change.
  window.FlowCanvas = window.FlowCanvas || {};
  window.FlowCanvas.broadcastSelection = broadcastSelection;

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      startObserver();
      startSelectionObserver();
      generate();
    }, 100);
  });
})();
