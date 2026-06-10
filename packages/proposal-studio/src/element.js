// <proposal-studio> — a framework-agnostic Custom Element that hosts the
// visual editor inside an isolated iframe.
//
// Why an iframe?  The editor engine ships its own jQuery + Froala + a pile of
// `window.*` globals.  Running it in an iframe keeps all of that sealed off
// from the host application (Angular / React / Vue), so there are zero global
// collisions and you can mount several editors on one page.  The iframe uses
// `srcdoc`, so it inherits the host page's origin — that means same-origin DOM
// access AND working localStorage (the editor's "save template" feature).
//
// Public surface (see types/index.d.ts for the full contract):
//   Properties : value (get/set HTML), contentWindow, contentDocument, ready
//   Methods    : getHtml(), setHtml(html), loadTemplate(html), post(msg),
//                whenReady(), focus()
//   Events     : 'ready', 'change', 'resize', 'message'
//   Attributes : height, auto-height

import EDITOR_HTML from './_generated/editor-html.js';

const CANVAS_SELECTOR = '.custom-form-design';

// SSR / Node-import safety: `HTMLElement` only exists in the browser. Extending
// a dummy base on the server lets `import 'proposal-studio'` run during SSR
// (Angular Universal, Next.js, vite-ssr) without throwing. The element is only
// ever instantiated in the browser, where the real HTMLElement is used.
const HTMLElementBase =
  typeof HTMLElement !== 'undefined' ? HTMLElement : /** @type {any} */ (class {});

export class ProposalStudioElement extends HTMLElementBase {
  static get observedAttributes() {
    return ['height', 'auto-height'];
  }

  constructor() {
    super();
    /** @type {HTMLIFrameElement|null} */
    this._iframe = null;
    this._ready = false;
    this._readyWaiters = [];
    /** Value set before the iframe finished booting; flushed on ready. */
    this._pendingValue = null;
    this._onMessage = this._onMessage.bind(this);
  }

  // -- lifecycle ------------------------------------------------------------

  connectedCallback() {
    if (this._iframe) return; // already mounted (re-connect)

    if (!this.style.display) this.style.display = 'block';

    const iframe = document.createElement('iframe');
    iframe.setAttribute('part', 'frame');
    iframe.style.cssText =
      'width:100%;border:0;display:block;' +
      (this._autoHeight() ? '' : 'height:100%;');
    iframe.setAttribute('title', 'Proposal Studio editor');
    // Allow the rich-text / clipboard / fullscreen features the editor uses.
    iframe.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-popups allow-forms allow-modals allow-downloads'
    );
    iframe.addEventListener('load', () => this._onFrameLoad());
    iframe.srcdoc = EDITOR_HTML;

    this._iframe = iframe;
    this.appendChild(iframe);

    window.addEventListener('message', this._onMessage);
    this._applyHeight();
  }

  disconnectedCallback() {
    window.removeEventListener('message', this._onMessage);
  }

  attributeChangedCallback(name) {
    if (name === 'height' || name === 'auto-height') this._applyHeight();
  }

  // -- public API -----------------------------------------------------------

  /** True once the editor engine has booted inside the iframe. */
  get ready() {
    return this._ready;
  }

  /** The editor iframe's window (same-origin — safe to touch). */
  get contentWindow() {
    return this._iframe ? this._iframe.contentWindow : null;
  }

  /** The editor iframe's document. */
  get contentDocument() {
    return this._iframe
      ? this._iframe.contentDocument || (this._iframe.contentWindow && this._iframe.contentWindow.document)
      : null;
  }

  /** Convenience getter/setter mirroring a form control's `value`. */
  get value() {
    return this.getHtml();
  }
  set value(html) {
    this.setHtml(html);
  }

  /** Resolves when the editor is ready (immediately if already ready). */
  whenReady() {
    if (this._ready) return Promise.resolve(this);
    return new Promise((res) => this._readyWaiters.push(res));
  }

  /** Returns the current canvas HTML, or '' if not ready. */
  getHtml() {
    const canvas = this._canvas();
    return canvas ? canvas.innerHTML : this._pendingValue || '';
  }

  /**
   * Replaces the canvas content with `html`. If called before the editor has
   * booted, the value is queued and applied on ready.
   * @param {string} html
   */
  setHtml(html) {
    if (!this._ready) {
      this._pendingValue = html;
      return this;
    }
    const canvas = this._canvas();
    if (canvas) {
      canvas.innerHTML = html || '';
      this._reinit();
      this._emitChange();
    }
    return this;
  }

  /** Alias for setHtml — reads naturally when loading a saved template. */
  loadTemplate(html) {
    return this.setHtml(html);
  }

  /**
   * Low-level escape hatch: post a message to the editor iframe. Use this for
   * advanced editor commands (set-block-style, component:insert, etc.).
   * @param {any} message
   */
  post(message) {
    const win = this.contentWindow;
    if (win) win.postMessage(message, '*');
    return this;
  }

  /** Focus the editor canvas. */
  focus() {
    const win = this.contentWindow;
    if (win) win.focus();
    const canvas = this._canvas();
    if (canvas) canvas.focus && canvas.focus();
  }

  // -- internals ------------------------------------------------------------

  _canvas() {
    const doc = this.contentDocument;
    return doc ? doc.querySelector(CANVAS_SELECTOR) : null;
  }

  _autoHeight() {
    const attr = this.getAttribute('auto-height');
    // auto-height defaults to ON; only an explicit "false" disables it.
    return attr === null ? true : attr !== 'false';
  }

  _applyHeight() {
    if (!this._iframe) return;
    const fixed = this.getAttribute('height');
    if (fixed && !this._autoHeight()) {
      this._iframe.style.height = /^\d+$/.test(fixed) ? fixed + 'px' : fixed;
    } else if (fixed) {
      // a starting height while we wait for the first auto measurement
      this._iframe.style.height = /^\d+$/.test(fixed) ? fixed + 'px' : fixed;
    } else if (!this._autoHeight()) {
      this._iframe.style.height = '100%';
    }
  }

  _onFrameLoad() {
    // The injected ready-signal posts {source:'proposal-studio', type:'ready'}
    // once FlowCanvas is up. As a fallback, poll for the engine ourselves.
    let tries = 0;
    const poll = () => {
      if (this._ready) return;
      const win = this.contentWindow;
      const canvas = this._canvas();
      if (win && win.FlowCanvas && canvas) {
        this._markReady();
        return;
      }
      if (tries++ < 200) setTimeout(poll, 50); // up to ~10s
    };
    poll();
  }

  _markReady() {
    if (this._ready) return;
    this._ready = true;
    if (this._pendingValue != null) {
      const html = this._pendingValue;
      this._pendingValue = null;
      this.setHtml(html);
    }
    this.dispatchEvent(new CustomEvent('ready', { detail: { editor: this } }));
    const waiters = this._readyWaiters.splice(0);
    waiters.forEach((res) => res(this));
  }

  _reinit() {
    // Give the engine a chance to re-wire after a bulk innerHTML swap.
    const win = this.contentWindow;
    try {
      const fc = win && win.FlowCanvas;
      const canvas = this._canvas();
      if (fc && canvas) {
        if (typeof fc.migrateLegacySectionLayouts === 'function') fc.migrateLegacySectionLayouts();
        if (typeof fc.cleanupEmpty === 'function') fc.cleanupEmpty(canvas);
      }
    } catch (e) {
      /* engine may not expose these helpers — non-fatal */
    }
  }

  _emitChange() {
    this.dispatchEvent(
      new CustomEvent('change', { detail: { html: this.getHtml() } })
    );
  }

  _onMessage(event) {
    // Only react to messages coming from *our* iframe.
    if (!this._iframe || event.source !== this.contentWindow) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    // Re-broadcast everything as a DOM event so framework hosts can listen.
    this.dispatchEvent(new CustomEvent('message', { detail: msg }));

    if (msg.type === 'ready' && msg.ready) {
      this._markReady();
      return;
    }

    if (msg.type === 'iframe:height' && typeof msg.height === 'number') {
      if (this._autoHeight() && this._iframe) {
        this._iframe.style.height = msg.height + 'px';
      }
      this.dispatchEvent(
        new CustomEvent('resize', { detail: { height: msg.height } })
      );
      return;
    }

    // The twig generator fires this whenever the canvas content changes.
    if (msg.source === 'custom-form-twig' && msg.type === 'twig:updated') {
      this._emitChange();
    }
  }
}
