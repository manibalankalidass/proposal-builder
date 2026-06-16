/**
 * @fileoverview Brand Kit — document-wide font application (iframe side).
 *
 * Listens for the Angular shell's `brand:apply-fonts` message and restyles every
 * text element (`.edit_me`) in the canvas with the chosen brand fonts:
 *   - heading blocks  → the heading font
 *   - everything else → the body font
 *
 * Fonts are written as CONCRETE inline `font-family` (not CSS variables) so the
 * change survives the Twig/PDF export, which only resolves var() fallbacks.
 *
 * Colours are applied per-block from the Style-panel brand swatches (concrete
 * inline too), so nothing here is needed for colour.
 */
(function () {
  const isHeadingBlock = (block) => {
    if (!block) return false;
    const t = (block.dataset && block.dataset.blockType) || '';
    if (t.indexOf('heading') === 0) return true; // 'heading' / 'heading-two'
    if (block.classList && block.classList.contains('add-heading-two')) return true;
    return !!block.querySelector(':scope > .add-heading-two, :scope > .edit_me.add-heading-two');
  };

  const applyFonts = (headingFont, bodyFont) => {
    const root = document.querySelector('.cs_paper') || document.querySelector('.custom-form-design') || document.body;
    if (!root) return;
    root.querySelectorAll('.edit_me').forEach((edit) => {
      const block = edit.closest('.cs_block_s');
      const font = isHeadingBlock(block) || edit.classList.contains('add-heading-two') ? headingFont : bodyFont;
      if (font) edit.style.fontFamily = font;
    });
  };

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || msg.target !== 'custom-form-twig') return;
    if (msg.type === 'brand:apply-fonts') {
      applyFonts(msg.headingFont, msg.bodyFont);
    }
  });
})();
