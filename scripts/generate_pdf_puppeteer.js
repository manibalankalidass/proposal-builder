/**
 * Puppeteer-based PDF generator.
 *
 * Usage:
 *   node scripts/generate_pdf_puppeteer.js <input.html> <output.pdf>
 *
 * Why this exists:
 *   wkhtmltopdf uses an old WebKit engine (~2014) which renders flexbox,
 *   CSS variables, and modern layouts incorrectly. Puppeteer launches a
 *   real headless Chromium, loads the HTML exactly as a modern browser
 *   would, and then uses Chrome's native "Print to PDF" to export.
 *   Result: the PDF matches what you see in the browser.
 */

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const puppeteer = require('puppeteer');

// The editor CSS sets html/body { height:100%; overflow:hidden } so the
// app behaves like a fixed-viewport SPA. When we print, that clips
// everything past the first A4 page. These overrides release the height
// lock so content can flow naturally and Chromium will paginate it
// across as many pages as needed.
// The .cs_margin element is the A4 page in the editor and already supplies
// its own padding (var(--cs-page-padding, 32px)) plus a 1px border. We
// want the PDF page to match that exactly, so:
//   - keep .cs_margin's padding intact (don't strip it)
//   - drop the 1px border, the .cs_paper gap, and the page-number badge,
//     since those are editor chrome that shouldn't appear in the PDF
//   - drop box-shadow so we don't print a halo
// Combined with `margin: 0` in page.pdf(), this makes the printed page
// inset match what the user sees in the editor.
const PRINT_OVERRIDES_CSS = `
  html, body {
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    overflow: visible !important;
    background: #ffffff !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  #place_everything,
  .page_container,
  .cs_paper,
  .custom-form-design {
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
    padding: 0 !important;
    margin: 0 !important;
    background: transparent !important;
  }
  .cs_paper { gap: 0 !important; }
  /* Each page canvas (.custom-form-design) wraps one .cs_margin A4 page.
     Force every page after the first to begin on a fresh PDF page, so a
     new cs_page always starts at the top of a new sheet — regardless of
     how much the previous page's content used. The first page must NOT
     break (otherwise the PDF would start with a blank leading page). */
  .custom-form-design { break-before: page !important; page-break-before: always !important; }
  .custom-form-design:first-of-type { break-before: auto !important; page-break-before: avoid !important; }
  .cs_margin {
    /* width / max-width set dynamically per page size below */
    /* Keep a full A4 minimum so page backgrounds fill the sheet, but let
       height grow so overflowing content flows onto additional pages
       instead of being clipped at the A4 boundary. This overrides the
       fixed height:1123px that custom-form.css sets under @media print. */
    min-height: var(--cs-page-min-height, 1123px) !important;
    height: auto !important;
    margin: 0 auto !important;
    /* NOTE: padding is intentionally NOT reset here. The editor's page
       inset (the "MARGINS (MM)" control / default --cs-page-padding) lives
       as padding on .cs_margin, and we want that SAME inset in the PDF.
       restructureDocsForPrint() captures it and re-applies it to the
       rebuilt content table, so the printed page matches the editor. */
    border: 0 !important;
    box-shadow: none !important;
  }
  /* Editor-only chrome that should not appear in the PDF */
  .cs_margin::before { display: none !important; content: none !important; }
  .cs-overflow-mark { display: none !important; }
  .cs-page-header, .cs-page-footer { border: none !important; }
  /* Remove default border that causes 1px gap, but let user inline styles override this */
  .cs_block_s { border: none; }
  /* Only keep individual table rows from splitting — let larger blocks
     (row-item, canvas-block) flow naturally across pages so we don't get
     big empty gaps at the bottom of a page. */
  tr { page-break-inside: avoid; break-inside: avoid; }
  /* Disable all animations during PDF generation */
  * {
    animation: none !important;
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition: none !important;
  }
`;

// Maps page-size keys (used in the editor + pdfSettings.pageSize) to
// the Chrome PDF print settings. Keep in sync with PageSizes in
// public/custom-form/js/canvas-config.js.
const PAGE_SIZE_MAP = {
  'A4': { format: 'A4', landscape: false },
  'A4-Landscape': { format: 'A4', landscape: true },
  'Letter': { format: 'Letter', landscape: false },
  'Letter-Landscape': { format: 'Letter', landscape: true },
  // Legacy single-orientation aliases — default to portrait.
  'A3': { format: 'A3', landscape: false },
  'A5': { format: 'A5', landscape: false },
  'Legal': { format: 'Legal', landscape: false },
};

function readPageSettings() {
  const raw = (process.env.PDF_PAGE_SIZE || 'A4').trim();
  const entry = PAGE_SIZE_MAP[raw] || PAGE_SIZE_MAP['A4'];
  const { format, landscape } = entry;

  const num = (v, fallback) => {
    const n = Number.parseFloat(v);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return n;
  };

  // Default to 0 print margins. The editor's .cs_margin element already
  // applies its own padding (var(--cs-page-padding, 32px)), so adding
  // Chrome print margins on top of that produces visibly larger insets
  // in the PDF than in the editor preview. Keep margins at 0 unless
  // explicitly overridden via env var.
  return {
    format,
    landscape,
    margin: {
      top: `${num(process.env.PDF_MARGIN_TOP, 0)}mm`,
      right: `${num(process.env.PDF_MARGIN_RIGHT, 0)}mm`,
      bottom: `${num(process.env.PDF_MARGIN_BOTTOM, 0)}mm`,
      left: `${num(process.env.PDF_MARGIN_LEFT, 0)}mm`,
    },
  };
}

// CSS px viewport size for each page key. Used by puppeteer's setViewport
// so the editor's .cs_margin width matches the rendered page.
const VIEWPORTS = {
  'A4': { width: 794, height: 1123 },
  'A4-Landscape': { width: 1123, height: 794 },
  'Letter': { width: 816, height: 1056 },
  'Letter-Landscape': { width: 1056, height: 816 },
  'A3': { width: 1123, height: 1587 },
  'A5': { width: 559, height: 794 },
  'Legal': { width: 816, height: 1344 },
};

// Runs INSIDE the page. Rebuilds every .cs_margin into a table and pins its
// page header to the TOP and footer to the BOTTOM of every printed page via
// position:fixed, while a matching thead/tfoot spacer reserves that space so
// body content never slides under the header/footer.
//
// position:fixed gives a true page-bottom footer on every sheet — including a
// partially filled final page — which thead/tfoot alone cannot. The catch is
// that fixed elements repeat on EVERY printed page globally, so this is only
// correct when ONE .cs_margin is present. Multi-page documents are therefore
// rendered one .cs_margin at a time (the others are removed before this runs)
// and the resulting single-doc PDFs are merged.
function restructureDocsForPrint() {
  document.querySelectorAll('.cs_margin').forEach(doc => {
    // Capture the editor's page inset (the "MARGINS (MM)" control sets this
    // as padding on .cs_margin; the default is --cs-page-padding). We re-apply
    // it to the rebuilt content table below so the PDF page inset matches what
    // the user sees in the editor instead of printing edge-to-edge.
    const docComp = window.getComputedStyle(doc);
    const padTop = docComp.paddingTop || '0px';
    const padRight = docComp.paddingRight || '0px';
    const padBottom = docComp.paddingBottom || '0px';
    const padLeft = docComp.paddingLeft || '0px';
    // The element's own padding is folded into the table cells below, so zero
    // it on the element to avoid double-insetting.
    doc.style.padding = '0';

    const header = doc.querySelector(':scope > .cs-page-header');
    const footer = doc.querySelector(':scope > .cs-page-footer');

    let headerHeight = 0;
    let footerHeight = 0;

    if (header) {
      headerHeight = header.offsetHeight;
      header.style.position = 'fixed';
      header.style.top = '0';
      header.style.left = '0';
      header.style.width = '100%';
      header.style.zIndex = '1000';
      // Ensure it doesn't get a transparent background
      header.style.backgroundColor = 'white';
    }

    if (footer) {
      footerHeight = footer.offsetHeight;
      footer.style.position = 'fixed';
      footer.style.bottom = '0';
      footer.style.left = '0';
      footer.style.width = '100%';
      footer.style.zIndex = '1000';
      footer.style.backgroundColor = 'white';
    }

    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderSpacing = '0';
    table.style.borderCollapse = 'collapse';

    // The thead/tfoot spacers repeat on EVERY printed page, so folding the
    // page's top/bottom inset into them gives a consistent page margin on
    // every sheet (combined with the fixed header/footer height when present).
    const pxOf = (v) => { const n = Number.parseFloat(v); return Number.isFinite(n) ? n : 0; };
    const padT = pxOf(padTop);
    const padB = pxOf(padBottom);

    const thead = document.createElement('thead');
    const theadTr = document.createElement('tr');
    const theadTd = document.createElement('td');
    theadTd.style.height = (headerHeight + padT) + 'px';
    theadTd.style.padding = '0';
    theadTd.style.border = 'none';
    theadTr.appendChild(theadTd);
    thead.appendChild(theadTr);

    const tfoot = document.createElement('tfoot');
    const tfootTr = document.createElement('tr');
    const tfootTd = document.createElement('td');
    tfootTd.style.height = (footerHeight + padB) + 'px';
    tfootTd.style.padding = '0';
    tfootTd.style.border = 'none';
    tfootTr.appendChild(tfootTd);
    tfoot.appendChild(tfootTr);

    const tbody = document.createElement('tbody');

    let mainPt = '0px', mainPr = '0px', mainPb = '0px', mainPl = '0px', mainBg = '';
    const main = doc.querySelector(':scope > .body-main-content');
    if (main) {
      const comp = window.getComputedStyle(main);
      mainPt = comp.paddingTop;
      mainPr = comp.paddingRight;
      mainPb = comp.paddingBottom;
      mainPl = comp.paddingLeft;
      mainBg = comp.backgroundColor;
    }

    // Page horizontal inset, added to every content cell so the body is
    // inset from the sheet edges by the same amount as in the editor. Uses
    // calc() so any existing per-cell padding (eg. body-main-content) is
    // preserved and the page inset stacks on top of it.
    const addX = (base, extra) => {
      if (!extra || extra === '0px') return base || '0px';
      if (!base || base === '0px') return extra;
      return `calc(${base} + ${extra})`;
    };
    const wrapNode = (node, pt = '0px', pr = '0px', pb = '0px', pl = '0px', bg = '') => {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.style.paddingTop = pt;
      td.style.paddingRight = addX(pr, padRight);
      td.style.paddingBottom = pb;
      td.style.paddingLeft = addX(pl, padLeft);
      td.style.border = 'none';
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        td.style.backgroundColor = bg;
      }
      td.appendChild(node);
      tr.appendChild(td);
      return tr;
    };

    if (main) {
      const children = Array.from(main.children);
      children.forEach((node, i) => {
        const isFirst = i === 0;
        const isLast = i === children.length - 1;
        tbody.appendChild(wrapNode(
          node,
          isFirst ? mainPt : '0px',
          mainPr,
          isLast ? mainPb : '0px',
          mainPl,
          mainBg
        ));
      });
    }

    Array.from(doc.querySelectorAll(':scope > .row-item:not(.cs-page-header):not(.cs-page-footer)')).forEach(node => {
      tbody.appendChild(wrapNode(node));
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    table.appendChild(tfoot);

    // Preserve the page background shape layer(s): they're direct children of
    // .cs_margin but aren't header/footer/rows, so the innerHTML reset below would
    // otherwise drop them (this is why designed clip-paths didn't appear in the
    // PDF). Re-add them FIRST (behind content) and lift the content table above
    // them with z-index.
    const shapeLayers = Array.from(doc.querySelectorAll(':scope > .cs-page-shape-bg'));

    doc.innerHTML = '';
    shapeLayers.forEach(layer => doc.appendChild(layer));
    if (header) doc.appendChild(header);
    table.style.position = 'relative';
    table.style.zIndex = '1';
    doc.appendChild(table);
    if (footer) doc.appendChild(footer);
  });
}

// Runs INSIDE the page. Blocks inside a .cs-flexible-content are absolutely
// positioned with the exact pixel geometry they had in the editor, and the
// container carries a fixed pixel height. When a merge tag renders longer than
// its editor placeholder, the block grows (or silently clips, if it has a
// fixed inline height) while the blocks below it and the container itself stay
// frozen — content overlaps and the flexible box never gets taller.
//
// The twig generator stamps each child's design-time geometry as
// data-cs-design-top / data-cs-design-h. Using that, per container
// (innermost first, so nested flexible boxes grow before their parent is
// measured):
//   1. release fixed heights that clip rendered content,
//   2. push each block down by the accumulated growth of the blocks that sat
//      above it at design time in the same column,
//   3. grow the container so the lowest block fits.
function expandFlexibleContainersToFit() {
  // Reverse document order ⇒ descendants before ancestors.
  const contents = Array.from(document.querySelectorAll('.cs-flexible-content')).reverse();
  contents.forEach((content) => {
    const children = Array.from(content.children).filter((el) => el instanceof HTMLElement);
    if (!children.length) return;

    // 1) A fixed inline height clips grown content silently — release it so
    // the block shows everything, keeping the design height as a floor.
    children.forEach((el) => {
      [el, ...el.querySelectorAll('[style*="height"]')].forEach((n) => {
        if (n.scrollHeight > n.clientHeight + 1) {
          if (n.style.height) {
            n.style.minHeight = n.style.height;
            n.style.height = 'auto';
          }
          n.style.maxHeight = 'none';
        }
      });
    });

    // 2) Re-flow: shift each block down by the growth of the blocks that were
    // fully above it at design time and horizontally overlap it. Intentional
    // design-time overlaps (e.g. text over a shape) are untouched because the
    // shift is the growth DELTA, not a generic de-overlap.
    const items = children.map((el) => {
      const dTop = Number.parseFloat(el.dataset.csDesignTop);
      const dH = Number.parseFloat(el.dataset.csDesignH);
      return {
        el,
        designTop: Number.isFinite(dTop) ? dTop : el.offsetTop,
        designH: Number.isFinite(dH) ? dH : el.offsetHeight,
        left: el.offsetLeft,
        right: el.offsetLeft + el.offsetWidth,
        growth: 0,
        shift: 0,
      };
    }).sort((a, b) => a.designTop - b.designTop || a.left - b.left);

    items.forEach((it) => {
      it.growth = Math.max(0, it.el.offsetHeight - it.designH);
    });

    items.forEach((it, i) => {
      for (let j = 0; j < i; j++) {
        const above = items[j];
        const sharesColumn = it.left < above.right && above.left < it.right;
        const wasAbove = above.designTop + above.designH <= it.designTop + 1;
        if (sharesColumn && wasAbove) {
          it.shift = Math.max(it.shift, above.shift + above.growth);
        }
      }
      if (it.shift > 0) it.el.style.top = `${it.designTop + it.shift}px`;
    });

    // 3) Grow the container so the lowest block fits, and release the block
    // wrapper's own fixed height so the grown container isn't clipped.
    const padBottom = Number.parseFloat(getComputedStyle(content).paddingBottom) || 0;
    const maxBottom = Math.max(...items.map((it) => it.designTop + it.shift + it.el.offsetHeight));
    const needed = Math.ceil(maxBottom + padBottom);
    if (needed > content.clientHeight) {
      content.style.height = `${needed}px`;
      content.style.minHeight = `${needed}px`;
      const wrapper = content.closest('.cs_block_s');
      if (wrapper && wrapper.style.height) {
        wrapper.style.height = 'auto';
        wrapper.style.minHeight = `${needed}px`;
      }
    }
  });
}

// Merge several single-page-canvas PDFs into one, in order, using poppler's
// `pdfunite`. Same family as the other system binaries this pipeline already
// shells out to (php, wkhtmltopdf).
function mergePdfs(parts, outputPath) {
  return new Promise((resolve, reject) => {
    execFile('pdfunite', [...parts, outputPath], (err) => {
      if (err) reject(new Error(`pdfunite failed (is poppler installed?): ${err.message}`));
      else resolve();
    });
  });
}

// Render ONE page canvas to a PDF. When `keepIndex` is a number, every other
// .custom-form-design page wrapper is removed first so only this canvas — and
// therefore only its single fixed header/footer — is printed. When it's null
// the document is printed as-is (the lone-canvas fast path).
async function renderCanvasPdf(browser, fileUrl, viewport, pdfOpts, keepIndex, outPath) {
  const page = await browser.newPage();
  try {
    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 2,
    });

    await page.goto(fileUrl, {
      waitUntil: ['load', 'networkidle0'],
      timeout: 60000,
    });

    if (keepIndex !== null) {
      await page.evaluate((idx) => {
        const wrappers = Array.from(document.querySelectorAll('.custom-form-design'));
        if (wrappers.length > 1) {
          wrappers.forEach((w, i) => { if (i !== idx) w.remove(); });
        }
      }, keepIndex);
    }

    // Inject overrides AFTER load so we beat any CSS that sets fixed
    // heights / overflow:hidden on html, body, and the page wrappers.
    // The .cs_margin width override is computed from the requested page size
    // so each rendered page matches the chosen paper. When isolating a
    // single canvas we also neutralise the inter-page break so an isolated
    // non-first page doesn't emit a blank leading sheet (page separation
    // is provided by the merge instead).
    await page.addStyleTag({
      content: PRINT_OVERRIDES_CSS + `
        .cs_margin {
          width: ${viewport.width}px !important;
          max-width: ${viewport.width}px !important;
        }
        /* The page-background shape layer is absolute inset:0 inside
           .cs_margin, so when content overflows one sheet the layer
           stretches across the whole grown height (bottom bands land
           mid-sheet, top shapes blow up). position:fixed makes Chromium
           repaint it at the same spot on EVERY printed sheet — the same
           mechanism as the fixed page header/footer — and the explicit
           width/height pin it to exactly one sheet. Safe because each
           canvas is printed in isolation, so only its own layer repeats. */
        .cs-page-shape-bg {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          right: auto !important;
          bottom: auto !important;
          width: ${viewport.width}px !important;
          height: ${viewport.height}px !important;
          z-index: 0 !important;
        }
        ${keepIndex !== null ? '.custom-form-design { break-before: auto !important; page-break-before: auto !important; }' : ''}
      `,
    });

    // Restructure DOM so headers/footers repeat at the top/bottom of every page.
    await page.evaluate(restructureDocsForPrint);

    // Force print media so any @media print rules apply.
    await page.emulateMediaType('print');

    // Wait for web fonts to be ready so text metrics are final.
    await page.evaluate(() => document.fonts && document.fonts.ready);

    // Re-flow flexible containers whose rendered content grew past the
    // design-time geometry (merge tags longer than their editor placeholder):
    // grown blocks push the blocks below them down and the container height
    // expands to fit, instead of overlapping at a frozen height.
    await page.evaluate(expandFlexibleContainersToFit);

    await page.pdf({
      path: outPath,
      format: pdfOpts.format,
      landscape: pdfOpts.landscape,
      printBackground: true,
      preferCSSPageSize: false,
      margin: pdfOpts.margin,
    });
  } finally {
    await page.close();
  }
}

async function generatePdf(inputHtmlPath, outputPdfPath) {
  if (!fs.existsSync(inputHtmlPath)) {
    throw new Error(`Input HTML not found: ${inputHtmlPath}`);
  }

  const absoluteHtmlPath = path.resolve(inputHtmlPath);
  const fileUrl = 'file://' + absoluteHtmlPath;
  const { format, landscape, margin } = readPageSettings();
  const sizeKey = (process.env.PDF_PAGE_SIZE || 'A4').trim();
  const viewport = VIEWPORTS[sizeKey] || VIEWPORTS['A4'];
  const pdfOpts = { format, landscape, margin };

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--allow-file-access-from-files',
    ],
  });

  try {
    // Count the page canvases. Each .custom-form-design is one cs_page that
    // must start on its own sheet; .cs_margin is the fallback for older markup
    // that isn't wrapped.
    const probe = await browser.newPage();
    await probe.goto(fileUrl, { waitUntil: ['load', 'networkidle0'], timeout: 60000 });
    const canvasCount = await probe.evaluate(() =>
      document.querySelectorAll('.custom-form-design').length ||
      document.querySelectorAll('.cs_margin').length
    );
    await probe.close();

    if (canvasCount <= 1) {
      // Single page canvas — print directly, fixed header/footer works as-is.
      await renderCanvasPdf(browser, fileUrl, viewport, pdfOpts, null, outputPdfPath);
    } else {
      // Multiple page canvases. Render each one in isolation (so its fixed
      // header/footer doesn't bleed onto other pages), then merge in order.
      // Each merged part already starts at its own page 1, so concatenation
      // makes every cs_page begin on a fresh sheet.
      const parts = [];
      const base = outputPdfPath.replace(/\.pdf$/i, '');
      for (let i = 0; i < canvasCount; i++) {
        const part = `${base}.part${i}.pdf`;
        await renderCanvasPdf(browser, fileUrl, viewport, pdfOpts, i, part);
        parts.push(part);
      }
      try {
        await mergePdfs(parts, outputPdfPath);
      } finally {
        parts.forEach((p) => { try { fs.unlinkSync(p); } catch (e) { /* ignore */ } });
      }
    }

    console.log(`PDF settings: size=${sizeKey} format=${format} landscape=${landscape} margins=${JSON.stringify(margin)} canvases=${canvasCount}`);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  const [, , input, output] = process.argv;
  if (!input || !output) {
    console.error('Usage: node generate_pdf_puppeteer.js <input.html> <output.pdf>');
    process.exit(1);
  }
  generatePdf(input, output)
    .then(() => {
      console.log('PDF generated:', output);
    })
    .catch((err) => {
      console.error('PDF generation failed:', err);
      process.exit(1);
    });
}

module.exports = { generatePdf };
