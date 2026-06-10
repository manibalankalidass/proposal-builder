/**
 * @fileoverview Canvas-level configuration.
 *
 * Centralized settings for the flow canvas. Tune these to change page size,
 * column behavior, drop-zone sensitivity, etc. without touching the canvas
 * logic. Loaded BEFORE flow-canvas.js so module code can read window.CanvasConfig.
 */
(function () {
  // Page-size catalog. Keys are the IDs used everywhere (editor dropdown,
  // pdfSettings.pageSize, PDF_PAGE_SIZE env var). Width / height are in
  // CSS px at 96 dpi — these are the physical paper dimensions, so the
  // canvas .cs-doc matches what the printed PDF page will be.
  const PageSizes = {
    'A4':                 { label: 'A4 Portrait',       width: 794,  height: 1123, format: 'A4',     landscape: false },
    'A4-Landscape':       { label: 'A4 Landscape',      width: 1123, height: 794,  format: 'A4',     landscape: true  },
    'Letter':             { label: 'Letter Portrait',   width: 816,  height: 1056, format: 'Letter', landscape: false },
    'Letter-Landscape':   { label: 'Letter Landscape',  width: 1056, height: 816,  format: 'Letter', landscape: true  },
  };

  const DEFAULT_PAGE_KEY = 'A4';

  const Config = {
    /** Page dimensions — controls the visible .cs-doc box. */
    page: {
      sizeKey: DEFAULT_PAGE_KEY,
      width: PageSizes[DEFAULT_PAGE_KEY].width,
      minHeight: PageSizes[DEFAULT_PAGE_KEY].height,
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
      background: '#ffffff',
      backgroundImage: '',
      borderColor: '#cfd4f6',
      borderWidth: 1,
      borderRadius: 4,
      shadow: '0 4px 20px rgba(0, 0, 0, 0.08)'
    },

    /** Row defaults. */
    row: {
      gap: 0,                        // px between columns (excluding divider)
      marginBottom: 8,               // px between consecutive rows
      minHeight: 40                  // px — empty row visual height
    },

    /** Column defaults. */
    column: {
      minWidth: 60,                  // px — smallest a column can shrink to during resize
      minHeight: 40,                 // px — empty column visual height
      padding: 4                     // px — interior padding
    },

    /** Section container (mini-canvas inside a column). */
    section: {
      minHeight: 160,                // px — default min-height after first child drop
      background: '#e5e7e7',
      defaultWidth: null             // null = fill column. Set a number to cap.
    },

    /** Flexible (free-form) block — and its absolutely-positioned children. */
    flexible: {
      defaultHeight: 80,             // px — height of a freshly dropped empty flexible block
      minHeight: 20,                 // px — smallest height it can be resized to
      minWidth: 20                   // px — smallest width a free-form block can be resized to
    },

    /** Drop-zone detection sensitivity. */
    dropZone: {
      rowEdgeGap: 12,                // px — distance from row edge to count as "between rows"
      colEdgeGap: 24                 // px — distance from col edge to count as "new column"
    },

    /** Visual indicator while dragging. */
    indicator: {
      color: '#5c5cff',
      thickness: 3,
      glowAlpha: 0.25
    },

    /** Inline "+" insert control. */
    inlineInsert: {
      enabled: true
    }
  };

  // Make available on window so flow-canvas.js and CSS-via-JS can read it.
  window.CanvasConfig = Config;
  window.CanvasPageSizes = PageSizes;

  // Switch the editor canvas to a different paper size at runtime.
  // Re-applies the CSS vars so every .cs-doc updates in place. Existing
  // block widths (set inline by the user) are preserved on purpose.
  window.setCanvasPageSize = function (sizeKey) {
    const size = PageSizes[sizeKey];
    if (!size) {
      console.warn('[CanvasConfig] unknown page size:', sizeKey);
      return false;
    }
    Config.page.sizeKey = sizeKey;
    Config.page.width = size.width;
    Config.page.minHeight = size.height;
    applyPageVars();
    // Notify listeners (overflow indicator, etc.) so they can recompute.
    document.dispatchEvent(new CustomEvent('canvas:page-size-changed', {
      detail: { sizeKey, width: size.width, height: size.height }
    }));
    return true;
  };

  // Set the page background image. Accepts a URL or base64 data URL.
  window.setCanvasPageBackground = function (imageUrl) {
    Config.page.backgroundImage = imageUrl || '';
    applyPageVars();
  };

  // Apply page styles to .cs-doc as CSS custom properties so the stylesheet
  // can pick them up without hardcoding values.
  const applyPageVars = () => {
    const root = document.documentElement;
    root.style.setProperty('--cs-page-width', `${Config.page.width}px`);
    root.style.setProperty('--cs-page-min-height', `${Config.page.minHeight}px`);
    root.style.setProperty('--cs-page-padding',
      `${Config.page.paddingTop}px ${Config.page.paddingRight}px ${Config.page.paddingBottom}px ${Config.page.paddingLeft}px`);
    root.style.setProperty('--cs-page-bg', Config.page.background);
    root.style.setProperty('--cs-page-bg-image', Config.page.backgroundImage ? `url("${Config.page.backgroundImage}")` : 'none');
    root.style.setProperty('--cs-page-border', `${Config.page.borderWidth}px solid ${Config.page.borderColor}`);
    root.style.setProperty('--cs-page-radius', `${Config.page.borderRadius}px`);
    root.style.setProperty('--cs-page-shadow', Config.page.shadow);
    root.style.setProperty('--cs-row-margin-bottom', `${Config.row.marginBottom}px`);
    root.style.setProperty('--cs-row-min-height', `${Config.row.minHeight}px`);
    root.style.setProperty('--cs-col-min-width', `${Config.column.minWidth}px`);
    root.style.setProperty('--cs-col-min-height', `${Config.column.minHeight}px`);
    root.style.setProperty('--cs-col-padding', `${Config.column.padding}px`);
    root.style.setProperty('--cs-section-min-height', `${Config.section.minHeight}px`);
    root.style.setProperty('--cs-section-bg', Config.section.background);
    root.style.setProperty('--cs-indicator-color', Config.indicator.color);
    root.style.setProperty('--cs-indicator-thickness', `${Config.indicator.thickness}px`);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyPageVars);
  } else {
    applyPageVars();
  }
})();
