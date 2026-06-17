/**
 * @fileoverview CustomRichEditor — a dependency-free inline rich-text editor.
 *
 * Built to REPLACE the commercial Froala editor for in-canvas text blocks
 * (Title / Heading / Body, etc.) so the project carries no third-party editor
 * licence. It is a DROP-IN for the Froala instance used by inline-editor.js:
 *
 *   const ed = new CustomRichEditor(target, opts);
 *   ed.commands.exec('bold');            // ← same call shape froala-style-handler uses
 *   ed.commands.exec('textColor', ['#f00']);
 *   ed.destroy();
 *
 * It edits the element in place (contenteditable) — exactly like Froala did —
 * so the rest of the app (HTML export, style panel, save/load) needs no change.
 *
 * Toolbar (inline, floats above the selection):
 *   bold · italic · underline · strikethrough · sub · super
 *   heading (inline) · font family · font size · line height
 *   letter spacing · text case (UPPER / Capitalize / lower / as typed)
 *   text colour · highlight colour
 *   align L/C/R/justify
 *   ordered / unordered list · outdent / indent
 *   link · unlink · clear formatting
 *   undo · redo
 *
 * Exposes: window.CustomRichEditor
 */
(function () {
  'use strict';

  const DEFAULT_SIZES = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36', '40', '48', '56', '64', '72', '80', '88', '96'];
  const DEFAULT_FONTS = {
    'Arial': 'Arial',
    "'Roboto', sans-serif": 'Roboto',
    "'Poppins', sans-serif": 'Poppins',
    "'Open Sans', sans-serif": 'Open Sans',
    "'Lato', sans-serif": 'Lato',
    "'Montserrat', sans-serif": 'Montserrat',
    "'Inter', sans-serif": 'Inter',
    "'Playfair Display', serif": 'Playfair Display',
    'Georgia, serif': 'Georgia',
    "'Courier New', monospace": 'Courier New',
  };

  // Heading levels map to inline font-size + weight (NOT block <h1> tags) so a
  // heading styles only the SELECTED run — e.g. make "balan" H1 without turning
  // the rest of the line into a heading. Shared by apply + toolbar sync.
  const HEADING_SPEC = {
    h1: { fontSize: '32px', fontWeight: '700' },
    h2: { fontSize: '24px', fontWeight: '700' },
    h3: { fontSize: '19px', fontWeight: '700' },
    h4: { fontSize: '16px', fontWeight: '700' },
    h5: { fontSize: '13px', fontWeight: '700' },
    h6: { fontSize: '11px', fontWeight: '700' },
  };

  // Proper text-alignment icons (rows of lines, like a word processor) drawn as
  // inline SVG so they read clearly instead of the ambiguous arrow glyphs.
  const alignSvg = (rows) => {
    // rows: array of [x, width] for each of the 4 lines (viewBox 16 wide).
    const bars = rows.map((r, i) =>
      `<rect x="${r[0]}" y="${2 + i * 4}" width="${r[1]}" height="2" rx="1"/>`).join('');
    return `<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${bars}</svg>`;
  };

  // Helper: stroke-only SVG icon (14×14, viewBox 0 0 16 16).
  const _s = (d) => `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

  // SVG/text glyphs for toolbar buttons (no icon font needed).
  const ICON = {
    // B / I / U / S keep styled-text glyphs — universally recognised in every editor.
    bold:      'B',
    italic:    'I',
    underline: 'U',
    strike:    'S',
    // subscript / superscript
    sub: 'x<sub style="font-size:8px;line-height:1">2</sub>',
    sup: 'x<sup style="font-size:8px;line-height:1">2</sup>',
    // alignment (word-processor row-of-lines style, already SVG)
    alignLeft:    alignSvg([[1, 14], [1, 8], [1, 14], [1, 8]]),
    alignCenter:  alignSvg([[1, 14], [4, 8], [1, 14], [4, 8]]),
    alignRight:   alignSvg([[1, 14], [7, 8], [1, 14], [7, 8]]),
    alignJustify: alignSvg([[1, 14], [1, 14], [1, 14], [1, 14]]),
    // numbered list: three lines + filled square markers on the left
    ol: _s(`<line x1="7" y1="4" x2="14" y2="4"/><line x1="7" y1="8.5" x2="14" y2="8.5"/><line x1="7" y1="13" x2="14" y2="13"/><rect x="2" y="2.5" width="3.2" height="3" rx="0.6" fill="currentColor" stroke="none"/><rect x="2" y="7" width="3.2" height="3" rx="0.6" fill="currentColor" stroke="none"/><rect x="2" y="11.5" width="3.2" height="3" rx="0.6" fill="currentColor" stroke="none"/>`),
    // bullet list: three lines + filled circle markers on the left
    ul: _s(`<line x1="7" y1="4" x2="14" y2="4"/><line x1="7" y1="8.5" x2="14" y2="8.5"/><line x1="7" y1="13" x2="14" y2="13"/><circle cx="3.5" cy="4" r="1.6" fill="currentColor" stroke="none"/><circle cx="3.5" cy="8.5" r="1.6" fill="currentColor" stroke="none"/><circle cx="3.5" cy="13" r="1.6" fill="currentColor" stroke="none"/>`),
    // outdent: lines + left-pointing chevron
    outdent: _s(`<line x1="2" y1="2.5" x2="14" y2="2.5"/><polyline points="6,5.5 3,8 6,10.5"/><line x1="7.5" y1="8" x2="14" y2="8"/><line x1="2" y1="13.5" x2="14" y2="13.5"/>`),
    // indent: lines + right-pointing chevron
    indent:  _s(`<line x1="2" y1="2.5" x2="14" y2="2.5"/><polyline points="3,5.5 6,8 3,10.5"/><line x1="7.5" y1="8" x2="14" y2="8"/><line x1="2" y1="13.5" x2="14" y2="13.5"/>`),
    // link: two interlocking arcs (chain link)
    link:   _s(`<path d="M7 9.5C7.6 11 9 12 10.5 12C12.4 12 14 10.4 14 8.5C14 6.6 12.4 5 10.5 5L9.5 5"/><path d="M9 6.5C8.4 5 7 4 5.5 4C3.6 4 2 5.6 2 7.5C2 9.4 3.6 11 5.5 11L6.5 11"/>`),
    // unlink: same arcs dimmed + diagonal slash
    unlink: _s(`<path d="M7 9.5C7.6 11 9 12 10.5 12C12.4 12 14 10.4 14 8.5C14 6.6 12.4 5 10.5 5L9.5 5" stroke-opacity="0.35"/><path d="M9 6.5C8.4 5 7 4 5.5 4C3.6 4 2 5.6 2 7.5C2 9.4 3.6 11 5.5 11L6.5 11" stroke-opacity="0.35"/><line x1="3" y1="13" x2="13" y2="3"/>`),
    // clear formatting: eraser shape
    clear:  _s(`<path d="M10.5 2L14 5.5L7.5 12H3.5V8.5L10.5 2Z"/><line x1="7" y1="5.5" x2="11" y2="9.5"/><line x1="1.5" y1="12" x2="7.5" y2="12"/>`),
    // undo: curved arrow counter-clockwise
    undo:   _s(`<path d="M5 6C6 3.8 8.3 2.5 10.5 2.5C13.5 2.5 15 5 15 7.5C15 10.5 12.8 13 10 13H8"/><polyline points="5,2.5 5,6 8.5,6"/>`),
    // redo: curved arrow clockwise
    redo:   _s(`<path d="M11 6C10 3.8 7.7 2.5 5.5 2.5C2.5 2.5 1 5 1 7.5C1 10.5 3.2 13 6 13H8"/><polyline points="11,2.5 11,6 7.5,6"/>`),
  };

  let uid = 0;

  // The toolbar markup is shared by the live (functional) editor bar and the
  // docked placeholder bar, so it's built from one template.
  function toolbarInnerHTML(fonts, sizes) {
    const fontOpts = Object.entries(fonts || DEFAULT_FONTS)
      .map(([val, label]) => `<option value="${val.replace(/"/g, '&quot;')}">${label}</option>`).join('');
    const sizeOpts = (sizes || DEFAULT_SIZES).map((s) => `<option value="${s}">${s}</option>`).join('');
    return `
        <div class="cre-group">
          <button type="button" data-cmd="bold" title="Bold" style="font-weight:700">${ICON.bold}</button>
          <button type="button" data-cmd="italic" title="Italic" style="font-style:italic">${ICON.italic}</button>
          <button type="button" data-cmd="underline" title="Underline" style="text-decoration:underline">${ICON.underline}</button>
          <button type="button" data-cmd="strikeThrough" title="Strikethrough" style="text-decoration:line-through">${ICON.strike}</button>
          <button type="button" data-cmd="subscript" title="Subscript">${ICON.sub}</button>
          <button type="button" data-cmd="superscript" title="Superscript">${ICON.sup}</button>
        </div>
        <div class="cre-group">
          <select data-sel="format" title="Paragraph / heading">
            <option value="">Normal</option>
            <option value="h1">H1</option>
            <option value="h2">H2</option>
            <option value="h3">H3</option>
            <option value="h4">H4</option>
            <option value="h5">H5</option>
            <option value="h6">H6</option>
          </select>
          <select data-sel="font" title="Font family"><option value="">Font</option>${fontOpts}</select>
          <select data-sel="size" class="cre-size" title="Font size"><option value="">Size</option>${sizeOpts}</select>
          <select data-sel="lineheight" title="Line height">
            <option value="">↕ LH</option>
            <option value="1">1.0</option>
            <option value="1.15">1.15</option>
            <option value="1.3">1.3</option>
            <option value="1.5">1.5</option>
            <option value="2">2.0</option>
            <option value="2.5">2.5</option>
            <option value="3">3.0</option>
          </select>
          <select data-sel="letterspacing" title="Letter spacing">
            <option value="">⇿ LS</option>
            <option value="normal">Normal</option>
            <option value="0.5px">0.5</option>
            <option value="1px">1</option>
            <option value="2px">2</option>
            <option value="3px">3</option>
            <option value="4px">4</option>
            <option value="6px">6</option>
            <option value="8px">8</option>
          </select>
          <select data-sel="textcase" title="Text case">
            <option value="">Aa Case</option>
            <option value="none">As typed</option>
            <option value="uppercase">UPPERCASE</option>
            <option value="capitalize">Capitalize Each</option>
            <option value="lowercase">lowercase</option>
          </select>
        </div>
        <div class="cre-group">
          <label class="cre-color" title="Text colour"><span class="cre-color__glyph">A</span><input type="color" data-color="fore" value="#000000"></label>
          <label class="cre-color cre-color--bg" title="Highlight colour"><span class="cre-color__glyph cre-color__glyph--hi">A</span><input type="color" data-color="back" value="#ffff00"></label>
        </div>
        <div class="cre-group">
          <button type="button" data-cmd="justifyLeft" title="Align left">${ICON.alignLeft}</button>
          <button type="button" data-cmd="justifyCenter" title="Align center">${ICON.alignCenter}</button>
          <button type="button" data-cmd="justifyRight" title="Align right">${ICON.alignRight}</button>
          <button type="button" data-cmd="justifyFull" title="Justify">${ICON.alignJustify}</button>
        </div>
        <div class="cre-group">
          <button type="button" data-cmd="insertOrderedList" title="Numbered list">${ICON.ol}</button>
          <button type="button" data-cmd="insertUnorderedList" title="Bullet list">${ICON.ul}</button>
          <button type="button" data-cmd="outdent" title="Decrease indent">${ICON.outdent}</button>
          <button type="button" data-cmd="indent" title="Increase indent">${ICON.indent}</button>
        </div>
        <div class="cre-group">
          <button type="button" data-act="link" title="Insert / edit link">${ICON.link}</button>
          <button type="button" data-cmd="unlink" title="Remove link">${ICON.unlink}</button>
          <button type="button" data-cmd="removeFormat" title="Clear formatting">${ICON.clear}</button>
        </div>
        <div class="cre-group">
          <button type="button" data-cmd="undo" title="Undo">${ICON.undo}</button>
          <button type="button" data-cmd="redo" title="Redo">${ICON.redo}</button>
        </div>`;
  }

  // All currently-alive editor instances (normally 0 or 1). Used to decide when
  // the docked placeholder bar should show (only when nothing is being edited).
  const liveEditors = new Set();
  // Set true by non-rich editors (e.g. the table block) that show their OWN
  // docked bar, so the placeholder hides and two bars never stack at the top.
  let externalDockedActive = false;

  // Persistent docked toolbar: a non-interactive copy of the bar that stays
  // pinned to the top of the canvas whenever docked mode is ON and no block is
  // being edited. As soon as a text block is edited, the real (functional) bar
  // takes its place; on teardown the placeholder returns. So in docked mode a
  // bar is ALWAYS visible — never hidden.
  const DockedPlaceholder = {
    el: null,
    ensure(doc) {
      if (this.el && this.el.ownerDocument === doc && doc.body.contains(this.el)) return this.el;
      const tb = doc.createElement('div');
      tb.className = 'cre-toolbar cre-toolbar--docked cre-toolbar--placeholder';
      tb.setAttribute('data-cs-chrome', '');
      tb.setAttribute('aria-hidden', 'true');
      tb.innerHTML = toolbarInnerHTML(DEFAULT_FONTS, DEFAULT_SIZES);
      // Inert: swallow any interaction so it can't steal focus / fire commands.
      tb.addEventListener('mousedown', (e) => e.preventDefault());
      doc.body.appendChild(tb);
      this.el = tb;
      return tb;
    },
    sync(doc) {
      doc = doc || document;
      const win = doc.defaultView || window;
      const docked = !!(typeof win.isRichToolbarDocked === 'function' && win.isRichToolbarDocked());
      if (!docked) { if (this.el) this.el.classList.remove('is-visible'); return; }
      this.ensure(doc);
      // Show the placeholder only while no real editor bar is up — and not while
      // another editor (e.g. the table block) is showing its own docked bar.
      const show = liveEditors.size === 0 && !externalDockedActive;
      this.el.classList.toggle('is-visible', show);
      // Follow the host scroll like any docked bar (or stop when hidden).
      if (show) CustomRichEditor.trackDockedBar(this.el);
      else CustomRichEditor.untrackDockedBar(this.el);
    }
  };

  // Global hook: when the Page Settings toggle flips docked mode (and on first
  // load), update the placeholder even if no editor instance is alive.
  document.addEventListener('canvas:rich-toolbar-mode', () => DockedPlaceholder.sync(document));
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => DockedPlaceholder.sync(document));
  } else {
    DockedPlaceholder.sync(document);
  }

  class CustomRichEditor {
    constructor(target, opts = {}) {
      this.target = target;
      this.doc = target.ownerDocument || document;
      this.win = this.doc.defaultView || window;
      this.opts = opts;
      this.fonts = opts.fonts || DEFAULT_FONTS;
      this.sizes = opts.fontSizes || DEFAULT_SIZES;
      this.id = ++uid;
      this.lastRange = null;
      this.destroyed = false;

      // Froala-compatible no-op surfaces (inline-editor calls these defensively).
      this.popups = { hideAll: () => this._hideToolbar() };
      this.toolbar = { hide: () => this._hideToolbar() };
      // The command surface the style panel / froala-style-handler talk to.
      this.commands = { exec: (name, args) => this._exec(name, args) };

      this._init();
    }

    /* ------------------------------- lifecycle ------------------------------ */
    _init() {
      const t = this.target;
      // Anchor the toolbar to the BLOCK (stable) rather than the live caret —
      // otherwise it jumps around as the selection/text moves while typing.
      this.anchor = t.closest('.cs_block_s') || t;
      t.setAttribute('contenteditable', 'true');
      t.setAttribute('spellcheck', 'false');
      t.classList.add('cre-editable');

      this._buildToolbar();

      // Bound handlers (so destroy can remove the exact same refs).
      this._onSelChange = () => this._syncFromSelection();
      this._onFocus = () => this._showToolbar();
      this._onBlur = () => this._maybeHideToolbar();
      this._onReflow = () => { if (this._toolbarVisible) this._positionToolbar(); };
      // Page Settings → "Inline text toolbar" toggle flips inline ↔ docked while
      // a block is open; re-place the live bar and refresh the placeholder.
      this._onDockMode = () => {
        if (this._toolbarVisible) this._positionToolbar();
        DockedPlaceholder.sync(this.doc);
      };
      this._onKey = (e) => this._onKeydown(e);
      // Keep the block hugging its content so new lines (Enter) expand the box
      // rather than overflowing a fixed height.
      this._onInputGrow = () => {
        this.anchor.style.height = 'auto';
        t.style.height = 'auto';
        if (this._toolbarVisible) this._positionToolbar();
      };

      this.doc.addEventListener('selectionchange', this._onSelChange);
      t.addEventListener('focus', this._onFocus);
      t.addEventListener('blur', this._onBlur);
      t.addEventListener('keydown', this._onKey);
      t.addEventListener('input', this._onInputGrow);
      this._onInputGrow();
      this.win.addEventListener('scroll', this._onReflow, true);
      this.win.addEventListener('resize', this._onReflow);
      this.doc.addEventListener('canvas:rich-toolbar-mode', this._onDockMode);

      // Editing has begun: register this instance and hide the docked
      // placeholder (the real, functional bar takes over).
      liveEditors.add(this);
      DockedPlaceholder.sync(this.doc);

      // Match Froala's behaviour: focus immediately on init.
      try { t.focus(); } catch (e) { /* */ }
      this._showToolbar();
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      const t = this.target;
      this.doc.removeEventListener('selectionchange', this._onSelChange);
      t.removeEventListener('focus', this._onFocus);
      t.removeEventListener('blur', this._onBlur);
      t.removeEventListener('keydown', this._onKey);
      t.removeEventListener('input', this._onInputGrow);
      this.win.removeEventListener('scroll', this._onReflow, true);
      this.win.removeEventListener('resize', this._onReflow);
      this.doc.removeEventListener('canvas:rich-toolbar-mode', this._onDockMode);
      t.removeAttribute('contenteditable');
      t.removeAttribute('spellcheck');
      t.classList.remove('cre-editable');
      if (this._toolbar) { CustomRichEditor.untrackDockedBar(this._toolbar); this._toolbar.remove(); }
      this._toolbar = null;
      // Editing finished: bring the docked placeholder back so a bar stays
      // visible at the top in docked mode.
      liveEditors.delete(this);
      DockedPlaceholder.sync(this.doc);
    }

    /* ------------------------------- toolbar -------------------------------- */
    _buildToolbar() {
      const tb = this.doc.createElement('div');
      tb.className = 'cre-toolbar';
      tb.setAttribute('data-cs-chrome', ''); // never exported / never starts a drag

      tb.innerHTML = toolbarInnerHTML(this.fonts, this.sizes);

      // Keep focus/selection in the text while pressing a toolbar control.
      tb.addEventListener('mousedown', (e) => {
        // Selects + colour inputs NEED focus to open; everything else must not
        // steal it (so execCommand applies to the live selection).
        if (!e.target.closest('select, input')) e.preventDefault();
      });

      tb.addEventListener('click', (e) => {
        const cmdBtn = e.target.closest('button[data-cmd]');
        if (cmdBtn) { e.preventDefault(); this._runCommand(cmdBtn.dataset.cmd); return; }
        const actBtn = e.target.closest('button[data-act]');
        if (actBtn) { e.preventDefault(); this._runAction(actBtn.dataset.act); return; }
      });

      // Font family — keep the chosen value shown (no reset) so the dropdown
      // reflects the selected text's font.
      tb.querySelector('[data-sel="font"]').addEventListener('change', (e) => {
        if (e.target.value) this._wrapStyle({ fontFamily: e.target.value });
      });
      // Font size — dropdown (like font family). Any current/custom size is
      // injected as an option by _syncFontControls so it still displays.
      tb.querySelector('[data-sel="size"]').addEventListener('change', (e) => {
        const v = parseInt(e.target.value, 10);
        if (v > 0) this._wrapStyle({ fontSize: v + 'px' });
      });
      // Paragraph / heading format (H1–H6, Normal).
      tb.querySelector('[data-sel="format"]').addEventListener('change', (e) => this._applyFormatBlock(e.target.value));
      // Line height.
      tb.querySelector('[data-sel="lineheight"]').addEventListener('change', (e) => {
        if (e.target.value) this._setLineHeight(e.target.value);
      });
      // Letter spacing.
      tb.querySelector('[data-sel="letterspacing"]').addEventListener('change', (e) => {
        if (e.target.value) this._setLetterSpacing(e.target.value);
      });
      // Text case (CSS text-transform).
      tb.querySelector('[data-sel="textcase"]').addEventListener('change', (e) => {
        if (e.target.value) this._setTextCase(e.target.value);
      });
      tb.querySelector('[data-color="fore"]').addEventListener('input', (e) => {
        e.target.closest('.cre-color').style.setProperty('--cre-swatch', e.target.value);
        this._setForeColor(e.target.value);
      });
      tb.querySelector('[data-color="back"]').addEventListener('input', (e) => {
        e.target.closest('.cre-color').style.setProperty('--cre-swatch', e.target.value);
        this._setBackColor(e.target.value);
      });

      this.doc.body.appendChild(tb);
      this._toolbar = tb;
      this._toolbarVisible = false;
    }

    _showToolbar() {
      if (!this._toolbar) return;
      this._toolbar.classList.add('is-visible');
      this._toolbarVisible = true;
      this._positionToolbar();
      this._syncActiveStates();
    }

    _hideToolbar() {
      if (!this._toolbar) return;
      this._toolbar.classList.remove('is-visible');
      this._toolbarVisible = false;
      CustomRichEditor.untrackDockedBar(this._toolbar);
    }

    // Hide only if focus truly left the editor AND the toolbar (a click on a
    // toolbar select/colour input blurs the text but should keep the bar up).
    _maybeHideToolbar() {
      // Docked mode: the bar lives at the top for the whole edit session — never
      // hide it on blur (teardown/destroy hands back to the placeholder instead).
      const docked = (typeof this.win.isRichToolbarDocked === 'function') ? this.win.isRichToolbarDocked() : false;
      if (docked) return;
      this.win.setTimeout(() => {
        if (this.destroyed) return;
        const a = this.doc.activeElement;
        if (a && (a === this.target || this.target.contains(a) || (this._toolbar && this._toolbar.contains(a)))) return;
        this._hideToolbar();
      }, 80);
    }

    _positionToolbar() {
      const tb = this._toolbar;
      if (!tb) return;

      // Docked mode: pin the bar to the top of the canvas viewport as a
      // full-width sticky strip (CSS drives layout; trackDockedBar follows the
      // host scroll). We clear the inline left left over from inline mode.
      const docked = (typeof this.win.isRichToolbarDocked === 'function')
        ? this.win.isRichToolbarDocked() : false;
      tb.classList.toggle('cre-toolbar--docked', docked);
      if (docked) {
        tb.style.left = '';
        CustomRichEditor.trackDockedBar(tb);
        return;
      }
      CustomRichEditor.untrackDockedBar(tb);

      // Inline mode — anchor to the block (stable) — not the selection — so the
      // bar holds its place while the user types or moves the caret.
      const rect = (this.anchor || this.target).getBoundingClientRect();
      const tbw = tb.offsetWidth, tbh = tb.offsetHeight;
      const vw = this.win.innerWidth, vh = this.win.innerHeight;
      let top = rect.top - tbh - 8;
      if (top < 8) top = Math.min(rect.bottom + 8, vh - tbh - 8);
      let left = rect.left + (rect.width / 2) - (tbw / 2);
      if (left + tbw > vw - 8) left = vw - tbw - 8;
      if (left < 8) left = 8;
      tb.style.top = top + 'px';
      tb.style.left = left + 'px';
    }

    /* ----------------------------- selection -------------------------------- */
    _selectionRect() {
      const sel = this.doc.getSelection();
      if (!sel || !sel.rangeCount) return null;
      const r = sel.getRangeAt(0);
      if (!this._inEditor(r.commonAncestorContainer)) return null;
      const rect = r.getBoundingClientRect();
      if (rect && (rect.width || rect.height || rect.top)) return rect;
      return null;
    }

    _inEditor(node) {
      return !!node && (node === this.target || this.target.contains(node));
    }

    // Remember the live range so colour/select changes (which blur the text)
    // can be re-applied to what the user had selected.
    _syncFromSelection() {
      if (this.destroyed) return;
      const sel = this.doc.getSelection();
      if (sel && sel.rangeCount && this._inEditor(sel.getRangeAt(0).commonAncestorContainer)) {
        this.lastRange = sel.getRangeAt(0).cloneRange();
        // Refresh button active-states only — DON'T reposition (keeps the bar
        // anchored to the block instead of chasing the caret).
        if (this._toolbarVisible) this._syncActiveStates();
      }
    }

    _restoreSelection() {
      this.target.focus();
      if (!this.lastRange) return;
      const sel = this.doc.getSelection();
      sel.removeAllRanges();
      sel.addRange(this.lastRange);
    }

    _syncActiveStates() {
      if (!this._toolbar) return;
      const map = {
        bold: 'bold', italic: 'italic', underline: 'underline', strikeThrough: 'strikeThrough',
        justifyLeft: 'justifyLeft', justifyCenter: 'justifyCenter', justifyRight: 'justifyRight',
        justifyFull: 'justifyFull', insertOrderedList: 'insertOrderedList', insertUnorderedList: 'insertUnorderedList',
      };
      this._toolbar.querySelectorAll('button[data-cmd]').forEach((btn) => {
        const q = map[btn.dataset.cmd];
        if (!q) return;
        let on = false;
        try { on = this.doc.queryCommandState(q); } catch (e) { /* */ }
        btn.classList.toggle('is-active', on);
      });
      this._syncFontControls();
    }

    // Reflect the selected text's actual font size / family / line-height /
    // heading in the toolbar so the dropdowns SHOW the current style.
    _syncFontControls() {
      if (!this._toolbar) return;
      const el = this._currentEl();
      let cs = null;
      try { cs = this.win.getComputedStyle(el.nodeType === 1 ? el : el.parentElement); } catch (e) { /* */ }
      if (!cs) return;

      const sizeSel = this._toolbar.querySelector('[data-sel="size"]');
      if (sizeSel) {
        const px = Math.round(parseFloat(cs.fontSize));
        // Drop any previously-injected custom option so they don't pile up.
        sizeSel.querySelectorAll('option[data-dynamic="1"]').forEach((o) => o.remove());
        if (!isNaN(px)) {
          const val = String(px);
          // Make sure the current size exists as an option so it shows even if
          // it isn't one of the presets (e.g. 70), then select it.
          if (!Array.from(sizeSel.options).some((o) => o.value === val)) {
            const opt = this.doc.createElement('option');
            opt.value = val; opt.textContent = val;
            opt.dataset.dynamic = '1';
            sizeSel.appendChild(opt);
          }
          sizeSel.value = val;
        } else {
          sizeSel.value = '';
        }
      }

      const fontSel = this._toolbar.querySelector('[data-sel="font"]');
      if (fontSel) {
        const cur = this._famKey(cs.fontFamily);
        let val = '';
        for (const opt of fontSel.options) { if (opt.value && this._famKey(opt.value) === cur) { val = opt.value; break; } }
        fontSel.value = val;
      }

      const lhSel = this._toolbar.querySelector('[data-sel="lineheight"]');
      if (lhSel) {
        const fs = parseFloat(cs.fontSize), lh = parseFloat(cs.lineHeight);
        let val = '';
        if (!isNaN(fs) && !isNaN(lh) && fs) {
          const ratio = lh / fs;
          for (const opt of lhSel.options) { if (opt.value && Math.abs(parseFloat(opt.value) - ratio) < 0.09) { val = opt.value; break; } }
        }
        lhSel.value = val;
      }

      const fmtSel = this._toolbar.querySelector('[data-sel="format"]');
      if (fmtSel) {
        const blk = this._closestBlock();
        const tag = (blk && blk !== this.target) ? blk.tagName.toLowerCase() : '';
        let val = /^h[1-6]$/.test(tag) ? tag : '';
        // Headings are applied as inline size+weight, so reflect the level by
        // matching the computed (bold) size back to a preset.
        if (!val) {
          const px = Math.round(parseFloat(cs.fontSize));
          const bold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
          if (bold) {
            for (const [lvl, spec] of Object.entries(HEADING_SPEC)) {
              if (Math.round(parseFloat(spec.fontSize)) === px) { val = lvl; break; }
            }
          }
        }
        fmtSel.value = val;
      }

      const lsSel = this._toolbar.querySelector('[data-sel="letterspacing"]');
      if (lsSel) {
        const ls = cs.letterSpacing;
        const norm = (!ls || ls === 'normal') ? '' : (parseFloat(ls) + 'px');
        let val = '';
        for (const opt of lsSel.options) { if (opt.value && opt.value === norm) { val = opt.value; break; } }
        lsSel.value = val;
      }

      const tcSel = this._toolbar.querySelector('[data-sel="textcase"]');
      if (tcSel) {
        const tt = (cs.textTransform && cs.textTransform !== 'none') ? cs.textTransform : '';
        let val = '';
        for (const opt of tcSel.options) { if (opt.value && opt.value === tt) { val = opt.value; break; } }
        tcSel.value = val;
      }
    }

    _famKey(f) {
      return String(f || '').split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
    }

    // The element holding the current caret/selection start (within the editor).
    // IMPORTANT: when the range starts BEFORE a child element — which is exactly
    // what happens after we re-select a freshly-wrapped <span> (setStartBefore)
    // — startContainer is the PARENT. We must descend into childNodes[offset]
    // (the span) so reads hit the styled element, not the parent. Without this,
    // the toolbar shows the parent's size (e.g. 14) and changing the font family
    // would capture+restore 14, wiping the 70 the user had set.
    _currentEl() {
      const sel = this.doc.getSelection();
      if (!sel || !sel.rangeCount) return this.target;
      const range = sel.getRangeAt(0);
      let n = range.startContainer;
      if (n && n.nodeType === 1) {
        n = n.childNodes[range.startOffset] || n.childNodes[range.startOffset - 1] || n;
      }
      if (n && n.nodeType === 3) n = n.parentElement;
      return (n && n.nodeType === 1 && this._inEditor(n)) ? n : this.target;
    }

    // Nearest block-level element around the selection, capped at the editor.
    _closestBlock() {
      for (let n = this._currentEl(); n && n !== this.target.parentElement; n = n.parentElement) {
        if (n === this.target) return this.target;
        if (n.tagName && /^(P|DIV|LI|H[1-6]|BLOCKQUOTE|PRE)$/.test(n.tagName)) return n;
      }
      return this.target;
    }

    // First explicit inline value of `prop` on the chain from the selection up
    // to (and including) the editor — used to keep size/family/weight when one
    // of the others is being changed.
    _currentStyleProp(prop) {
      for (let n = this._currentEl(); n && n !== this.target.parentElement; n = n.parentElement) {
        if (n.style && n.style[prop]) return n.style[prop];
        if (n === this.target) break;
      }
      return '';
    }

    /* ------------------------------ commands -------------------------------- */
    _runCommand(cmd) {
      // Indent/outdent ourselves with margin-left. Native execCommand('outdent')
      // won't reverse a CSS-margin indent, so "decrease indent" did nothing
      // after an indent or an align change. Doing both directions by hand keeps
      // them symmetric and reliable. (User-reported.)
      if (cmd === 'indent') return this._changeIndent(1);
      if (cmd === 'outdent') return this._changeIndent(-1);
      this._restoreSelection();
      try { this.doc.execCommand('styleWithCSS', false, true); } catch (e) { /* */ }
      try { this.doc.execCommand(cmd, false, null); } catch (e) { /* */ }
      this._afterChange();
    }

    // Step the current block's left indent by ±40px, clamped at 0.
    _changeIndent(dir) {
      this._restoreSelection();
      const STEP = 40;
      const el = this._closestBlock();
      const cur = parseFloat(this.win.getComputedStyle(el).marginLeft) || 0;
      const next = Math.max(0, cur + dir * STEP);
      if (next <= 0) el.style.removeProperty('margin-left');
      else el.style.marginLeft = next + 'px';
      this._afterChange();
    }

    // Letter spacing — to the selection if there is one, else the whole block
    // (mirrors line height). 'normal' clears it.
    _setLetterSpacing(value) {
      this._restoreSelection();
      const sel = this.doc.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed) {
        this._wrapStyle({ letterSpacing: value });
      } else {
        this.target.style.letterSpacing = value;
        this.target.querySelectorAll('[style*="letter-spacing"]').forEach((el) => el.style.removeProperty('letter-spacing'));
        this._afterChange();
      }
    }

    // Text case via CSS text-transform: none (as typed) / uppercase /
    // capitalize / lowercase. Non-destructive — the underlying text is unchanged.
    _setTextCase(value) {
      this._restoreSelection();
      const sel = this.doc.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed) {
        this._wrapStyle({ textTransform: value });
      } else {
        this.target.style.textTransform = value;
        this.target.querySelectorAll('[style*="text-transform"]').forEach((el) => el.style.removeProperty('text-transform'));
        this._afterChange();
      }
    }

    _runAction(act) {
      if (act === 'link') this._insertLink();
    }

    _insertLink() {
      this._restoreSelection();
      const sel = this.doc.getSelection();
      const existing = this._closestTag('a');
      const url = this.win.prompt('Link URL:', existing ? existing.getAttribute('href') : 'https://');
      if (url === null) return;
      if (url === '') { try { this.doc.execCommand('unlink'); } catch (e) { /* */ } this._afterChange(); return; }
      if (sel && sel.isCollapsed && !existing) {
        // No selection — insert the URL as its own link text.
        const a = this.doc.createElement('a');
        a.href = url; a.textContent = url;
        sel.getRangeAt(0).insertNode(a);
      } else {
        try { this.doc.execCommand('createLink', false, url); } catch (e) { /* */ }
      }
      this._afterChange();
    }

    _closestTag(tag) {
      const sel = this.doc.getSelection();
      let n = sel && sel.rangeCount ? sel.getRangeAt(0).commonAncestorContainer : null;
      for (; n && n !== this.target; n = n.parentNode) {
        if (n.nodeType === 1 && n.tagName.toLowerCase() === tag) return n;
      }
      return null;
    }

    _setForeColor(hex) {
      this._restoreSelection();
      try { this.doc.execCommand('styleWithCSS', false, true); } catch (e) { /* */ }
      try { this.doc.execCommand('foreColor', false, hex); } catch (e) { /* */ }
      this._afterChange();
    }

    _setBackColor(hex) {
      this._restoreSelection();
      try { this.doc.execCommand('styleWithCSS', false, true); } catch (e) { /* */ }
      // hiliteColor is the standard; backColor is the WebKit fallback.
      let ok = false;
      try { ok = this.doc.execCommand('hiliteColor', false, hex); } catch (e) { /* */ }
      if (!ok) { try { this.doc.execCommand('backColor', false, hex); } catch (e) { /* */ } }
      this._afterChange();
    }

    // Apply arbitrary inline CSS (font-size / font-family / font-weight) to the
    // current selection. Uses the classic `fontSize=7` wrapper trick so the
    // exact selected run gets wrapped, then rewrites each wrapper to a <span>
    // carrying the requested style — works across multi-node selections.
    //
    // The trick's `fontSize` command WIPES any existing font-size on the run, so
    // before wrapping we capture the current size/family/weight the caller is
    // NOT changing and re-apply them — otherwise picking a new font family would
    // silently reset a font-size the user had set (e.g. 70 → back to default).
    _wrapStyle(styleObj) {
      this._restoreSelection();
      const sel = this.doc.getSelection();
      if (!sel || !sel.rangeCount) return;
      if (sel.isCollapsed) return; // nothing selected → nothing to style

      const keep = {};
      ['fontSize', 'fontFamily', 'fontWeight'].forEach((p) => {
        if (styleObj[p] != null) return;
        const v = this._currentStyleProp(p);
        if (v && !(p === 'fontWeight' && (v === '400' || v === 'normal'))) keep[p] = v;
      });

      try { this.doc.execCommand('styleWithCSS', false, false); } catch (e) { /* */ }
      try { this.doc.execCommand('fontSize', false, '7'); } catch (e) { /* */ }
      const spans = [];
      this.target.querySelectorAll('font[size="7"]').forEach((f) => {
        const span = this.doc.createElement('span');
        Object.assign(span.style, styleObj);
        Object.keys(keep).forEach((k) => { if (!span.style[k]) span.style[k] = keep[k]; });
        // Carry over any colour the trick may have set on the <font>.
        if (f.getAttribute('color')) span.style.color = f.getAttribute('color');
        while (f.firstChild) span.appendChild(f.firstChild);
        f.replaceWith(span);
        spans.push(span);
      });
      try { this.doc.execCommand('styleWithCSS', false, true); } catch (e) { /* */ }
      // Keep the just-styled text selected so the user can apply more changes
      // (font + size + colour …) without re-selecting every time.
      this._reselect(spans);
      this._afterChange();
    }

    // Re-select a list of nodes (from first to last) and remember the range.
    _reselect(nodes) {
      if (!nodes || !nodes.length) return;
      try {
        const range = this.doc.createRange();
        range.setStartBefore(nodes[0]);
        range.setEndAfter(nodes[nodes.length - 1]);
        const sel = this.doc.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        this.lastRange = range.cloneRange();
      } catch (e) { /* */ }
    }

    // Apply a heading level. With a real text selection it styles ONLY the
    // selected run (inline size + weight) so "balan" can become H1 without
    // turning "mani" in the same line into a heading too — a true block <h1>
    // would swallow the whole line. With just a caret (nothing selected) we
    // fall back to a block-level heading/paragraph for the whole line.
    _applyFormatBlock(tag) {
      this._restoreSelection();
      const t = (tag && /^h[1-6]$/i.test(tag)) ? tag.toLowerCase() : '';
      const sel = this.doc.getSelection();
      const hasSelection = sel && sel.rangeCount && !sel.isCollapsed;

      if (hasSelection) {
        if (t) {
          this._wrapStyle(HEADING_SPEC[t]);
        } else {
          // Normal → strip the heading look from the selection. Set explicit
          // base size + normal weight (an empty value would just inherit the
          // surrounding heading span, so it must be explicit).
          const base = this.win.getComputedStyle(this.target).fontSize;
          this._wrapStyle({ fontSize: base, fontWeight: '400' });
        }
        return;
      }

      // Caret only → turn the whole line into a block heading / <p>, then strip
      // explicit font-size so the heading's own size shows.
      try { this.doc.execCommand('formatBlock', false, '<' + (t ? t.toUpperCase() : 'P') + '>'); } catch (e) { /* */ }
      const blk = this._closestBlock();
      if (blk && blk !== this.target) {
        blk.style.removeProperty('font-size');
        blk.querySelectorAll('[style*="font-size"]').forEach((el) => el.style.removeProperty('font-size'));
      }
      this._afterChange();
    }

    // Line-height applies to the WHOLE text block and clears any per-element
    // line-height so a new value always takes effect (re-setting works).
    _setLineHeight(value) {
      this._restoreSelection();
      this.target.style.lineHeight = value;
      this.target.querySelectorAll('[style*="line-height"]').forEach((el) => el.style.removeProperty('line-height'));
      this._afterChange();
    }

    _setAlign(align) {
      const map = { left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight', justify: 'justifyFull' };
      this._runCommand(map[align] || 'justifyLeft');
    }

    _setParagraphWeight(styleName) {
      const w = {
        'font-weight-light': '300', 'normal': '400', 'font-weight-medium': '500',
        'font-weight-semi-bold': '600', 'font-weight-bold': '700', 'bold': '700',
      }[styleName] || styleName;
      this._wrapStyle({ fontWeight: String(w) });
    }

    // List markers (1. 2. / bullets) use the <li>'s OWN font-size, but our font
    // controls size a nested <span>, so the marker stays tiny next to big text.
    // Bring each <li> up to the largest font-size found in its content.
    _syncListMarkers() {
      this.target.querySelectorAll('li').forEach((li) => {
        let max = 0, found = '';
        li.querySelectorAll('[style]').forEach((el) => {
          const fs = el.style && el.style.fontSize;
          if (!fs) return;
          const px = parseFloat(fs);
          if (!isNaN(px) && px > max) { max = px; found = fs; }
        });
        if (found) li.style.fontSize = found;
      });
    }

    _afterChange() {
      // Re-sync state + let the app know content changed (mirrors a user edit).
      this._syncListMarkers();
      this._syncActiveStates();
      try {
        this.target.dispatchEvent(new this.win.Event('input', { bubbles: true }));
      } catch (e) { /* */ }
    }

    _onKeydown(e) {
      // Native browser shortcuts already cover bold/italic/underline/undo/redo;
      // we just refresh button states afterwards.
      if (e.key === 'Escape') { this.target.blur(); return; }
      this.win.setTimeout(() => this._syncActiveStates(), 0);
    }

    /* -------- Froala-compatible command bridge (froala-style-handler) -------- */
    _exec(name, rawArgs) {
      const args = Array.isArray(rawArgs) ? rawArgs : (rawArgs === undefined ? [] : [rawArgs]);
      switch (name) {
        case 'bold': case 'italic': case 'underline':
        case 'strikeThrough': case 'subscript': case 'superscript':
        case 'insertOrderedList': case 'insertUnorderedList':
        case 'outdent': case 'indent': case 'undo': case 'redo':
          return this._runCommand(name);
        case 'removeFormat':
          this._runCommand('removeFormat'); try { this.doc.execCommand('unlink'); } catch (e) { /* */ } return;
        case 'textColor': return this._setForeColor(args[0]);
        case 'backgroundColor': return this._setBackColor(args[0]);
        case 'fontSize': {
          const v = String(args[0] || '');
          return this._wrapStyle({ fontSize: /px|em|rem|%/.test(v) ? v : (v + 'px') });
        }
        case 'fontFamily': return this._wrapStyle({ fontFamily: args[0] });
        case 'letterSpacing': {
          const v = String(args[0] || 'normal');
          return this._setLetterSpacing(/px|em|rem|%/.test(v) || v === 'normal' ? v : (v + 'px'));
        }
        case 'align': return this._setAlign(args[0]);
        case 'paragraphStyle': return this._setParagraphWeight(args[0]);
        default:
          // Best-effort passthrough for any other execCommand name.
          try { this._runCommand(name); } catch (e) { /* */ }
      }
    }
  }

  // Let other editors (the table block) suppress the docked placeholder while
  // they display their own docked toolbar — keeps a single bar at the top.
  CustomRichEditor.setExternalDockedActive = (on) => {
    externalDockedActive = !!on;
    DockedPlaceholder.sync(document);
  };

  // Shared toolbar markup so the table block can render the IDENTICAL text-format
  // bar (and just append its own table-structure group), instead of maintaining
  // a second look-alike toolbar.
  CustomRichEditor.toolbarInnerHTML = (fonts, sizes) => toolbarInnerHTML(fonts, sizes);

  // --- Docked bar: follow the host's scroll --------------------------------
  // The editor lives in an iframe that GROWS to fit ALL pages; the HOST window
  // scrolls it. A position:fixed bar therefore pins to the iframe's content-top
  // and scrolls off-screen for blocks lower down (that's the "toolbar hides at
  // the top" bug). We keep the bar IN the iframe (position:absolute) and, since
  // we're same-origin, read our own <iframe> element to find where the visible
  // viewport currently starts, moving the bar there each animation frame.
  const dockedVisibleTop = () => {
    try {
      const fe = window.frameElement; // same-origin → readable; null if standalone
      if (fe) return Math.max(0, -fe.getBoundingClientRect().top);
    } catch (e) { /* cross-origin — fall through to own scroll */ }
    return window.scrollY || window.pageYOffset || 0;
  };
  const dockedBars = new Set();
  let lastDockTop = -1;
  const applyDockedTop = () => {
    const t = dockedVisibleTop();
    if (t === lastDockTop) return;
    lastDockTop = t;
    dockedBars.forEach((el) => { if (el && el.isConnected) el.style.top = t + 'px'; });
  };
  // rAF-throttle the scroll/resize bursts to one reposition per frame.
  let dockScheduled = false;
  const onDockScroll = () => {
    if (dockScheduled) return;
    dockScheduled = true;
    requestAnimationFrame(() => { dockScheduled = false; applyDockedTop(); });
  };
  let dockListenersOn = false;
  const ensureDockListeners = () => {
    if (dockListenersOn) return;
    dockListenersOn = true;
    // Capture phase catches scrolling of ANY element in the host (the window OR
    // a scroll container — we can't predict which). Same-origin lets us reach
    // the parent document; wrapped in try/catch for the cross-origin/standalone
    // case where we just watch our own scroll.
    try { if (window.parent && window.parent !== window) { window.parent.document.addEventListener('scroll', onDockScroll, true); window.parent.addEventListener('resize', onDockScroll); } } catch (e) { /* */ }
    window.addEventListener('scroll', onDockScroll, true);
    window.addEventListener('resize', onDockScroll);
  };
  CustomRichEditor.trackDockedBar = (el) => {
    if (!el) return;
    ensureDockListeners();
    dockedBars.add(el);
    el.style.top = dockedVisibleTop() + 'px';
  };
  CustomRichEditor.untrackDockedBar = (el) => {
    if (!el) return;
    dockedBars.delete(el);
    el.style.top = '';
  };

  window.CustomRichEditor = CustomRichEditor;
  console.log('rich-text-editor: CustomRichEditor ready');
})();
