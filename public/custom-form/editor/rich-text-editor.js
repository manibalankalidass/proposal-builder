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
 *   font family · font size
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

  // Proper text-alignment icons (rows of lines, like a word processor) drawn as
  // inline SVG so they read clearly instead of the ambiguous arrow glyphs.
  const alignSvg = (rows) => {
    // rows: array of [x, width] for each of the 4 lines (viewBox 16 wide).
    const bars = rows.map((r, i) =>
      `<rect x="${r[0]}" y="${2 + i * 4}" width="${r[1]}" height="2" rx="1"/>`).join('');
    return `<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${bars}</svg>`;
  };

  // SVG/text glyphs for toolbar buttons (no icon font needed).
  const ICON = {
    bold: 'B', italic: 'I', underline: 'U', strike: 'S',
    sub: 'x₂', sup: 'x²',
    alignLeft: alignSvg([[1, 14], [1, 8], [1, 14], [1, 8]]),
    alignCenter: alignSvg([[1, 14], [4, 8], [1, 14], [4, 8]]),
    alignRight: alignSvg([[1, 14], [7, 8], [1, 14], [7, 8]]),
    alignJustify: alignSvg([[1, 14], [1, 14], [1, 14], [1, 14]]),
    ol: '1.', ul: '•', outdent: '⇤', indent: '⇥',
    link: '🔗', unlink: '⛓', clear: '⌫', undo: '↶', redo: '↷',
  };

  let uid = 0;

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
      t.removeAttribute('contenteditable');
      t.removeAttribute('spellcheck');
      t.classList.remove('cre-editable');
      if (this._toolbar) this._toolbar.remove();
      this._toolbar = null;
    }

    /* ------------------------------- toolbar -------------------------------- */
    _buildToolbar() {
      const tb = this.doc.createElement('div');
      tb.className = 'cre-toolbar';
      tb.setAttribute('data-cs-chrome', ''); // never exported / never starts a drag

      const fontOpts = Object.entries(this.fonts)
        .map(([val, label]) => `<option value="${val.replace(/"/g, '&quot;')}">${label}</option>`).join('');
      const sizeOpts = this.sizes.map((s) => `<option value="${s}">${s}</option>`).join('');

      tb.innerHTML = `
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
        </div>
        <div class="cre-group">
          <label class="cre-color" title="Text colour">A<input type="color" data-color="fore" value="#000000"></label>
          <label class="cre-color cre-color--bg" title="Highlight colour">▣<input type="color" data-color="back" value="#ffff00"></label>
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
      tb.querySelector('[data-color="fore"]').addEventListener('input', (e) => this._setForeColor(e.target.value));
      tb.querySelector('[data-color="back"]').addEventListener('input', (e) => this._setBackColor(e.target.value));

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
    }

    // Hide only if focus truly left the editor AND the toolbar (a click on a
    // toolbar select/colour input blurs the text but should keep the bar up).
    _maybeHideToolbar() {
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
      // Anchor to the block (stable) — not the selection — so the bar holds its
      // place while the user types or moves the caret.
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
        fmtSel.value = /^h[1-6]$/.test(tag) ? tag : '';
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
      this._restoreSelection();
      try { this.doc.execCommand('styleWithCSS', false, true); } catch (e) { /* */ }
      try { this.doc.execCommand(cmd, false, null); } catch (e) { /* */ }
      this._afterChange();
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

    // Wrap the current line(s) in a heading/paragraph tag (Normal = <p>). After
    // switching, strip explicit font-size from the block so the heading's own
    // size shows (otherwise a previously-set size, e.g. 14px, keeps it small).
    _applyFormatBlock(tag) {
      this._restoreSelection();
      const t = (tag && /^h[1-6]$/i.test(tag)) ? tag : 'p';
      try { this.doc.execCommand('formatBlock', false, '<' + t.toUpperCase() + '>'); } catch (e) { /* */ }
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
        case 'align': return this._setAlign(args[0]);
        case 'paragraphStyle': return this._setParagraphWeight(args[0]);
        default:
          // Best-effort passthrough for any other execCommand name.
          try { this._runCommand(name); } catch (e) { /* */ }
      }
    }
  }

  window.CustomRichEditor = CustomRichEditor;
  console.log('rich-text-editor: CustomRichEditor ready');
})();
