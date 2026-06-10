// <proposal-studio> — a framework-agnostic Custom Element that hosts the
// FULL visual editor (toolbar + sidebars + canvas) inside an isolated iframe.
//
// Why an iframe?  The editor is a complete Angular application bundled into one
// self-contained document.  Running it in an iframe seals its Angular runtime,
// jQuery, Froala and globals off from the host app (which may itself be Angular
// of a different version, React, Vue, …) — zero collisions, multiple instances.
// The iframe uses `srcdoc`, so it inherits the host page's origin: same-origin
// DOM access AND working localStorage (the editor's save/template features).
//
// Frame layout (all same-origin via the srcdoc chain):
//   <proposal-studio> → outer iframe (Angular app) → inner iframe (canvas engine)
// The canvas (.custom-form-design) and its engine (window.FlowCanvas) live in
// the inner iframe; getHtml/setHtml reach it by traversing both frames.
//
// Public surface (see types/index.d.ts for the full contract):
//   Properties : value (get/set HTML), contentWindow, contentDocument, ready
//   Methods    : getHtml(), setHtml(html), loadTemplate(html), post(msg),
//                whenReady(), focus()
//   Events     : 'ready', 'change', 'resize', 'message'
//   Attributes : height, auto-height

import EDITOR_HTML from './_generated/editor-html.js';

const CANVAS_SELECTOR = '.custom-form-design';
const CANVAS_FRAME_SELECTOR = 'iframe.canvas-frame__iframe';

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
    // The editor is a full app with its own internal scrolling, so the frame
    // fills the host element. Give it a sensible default height if the host
    // hasn't sized us (so it's never a 0px-tall, invisible element).
    if (!this.style.height && !this.getAttribute('height')) this.style.height = '720px';

    const iframe = document.createElement('iframe');
    iframe.setAttribute('part', 'frame');
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;';
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
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
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
    const win = this._canvasWin();
    if (win) win.postMessage(message, '*');
    return this;
  }

  /** Focus the editor canvas. */
  focus() {
    const win = this._canvasWin();
    if (win) win.focus();
    const canvas = this._canvas();
    if (canvas) canvas.focus && canvas.focus();
  }

  // -- internals ------------------------------------------------------------

  /** The inner canvas iframe element (lives inside the outer Angular doc). */
  _canvasIframe() {
    const doc = this.contentDocument; // outer Angular document
    return doc ? doc.querySelector(CANVAS_FRAME_SELECTOR) : null;
  }

  /** The canvas iframe's window — hosts window.FlowCanvas (the engine). */
  _canvasWin() {
    const f = this._canvasIframe();
    return f ? f.contentWindow : null;
  }

  /** The .custom-form-design element inside the (nested) canvas document. */
  _canvas() {
    const win = this._canvasWin();
    const doc = win && win.document;
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
    // The editor boots asynchronously: the outer Angular app loads, then it
    // mounts the inner canvas iframe, then the engine (window.FlowCanvas) wires
    // up. Poll the whole chain until the canvas engine is live.
    let tries = 0;
    const poll = () => {
      if (this._ready) return;
      const win = this._canvasWin();
      const canvas = this._canvas();
      if (win && win.FlowCanvas && canvas) {
        this._markReady();
        return;
      }
      if (tries++ < 400) setTimeout(poll, 50); // up to ~20s (Angular boot + engine)
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
    this._observeChanges();
    this.dispatchEvent(new CustomEvent('ready', { detail: { editor: this } }));
    const waiters = this._readyWaiters.splice(0);
    waiters.forEach((res) => res(this));
  }

  /**
   * Emit `change` when the canvas content changes. The engine posts its
   * twig:updated message to the Angular app (not to us), so we watch the canvas
   * DOM directly. Debounced to coalesce burst mutations.
   */
  _observeChanges() {
    const canvas = this._canvas();
    const win = this._canvasWin();
    if (!canvas || !win) return;
    let timer = null;
    const MO = win.MutationObserver || window.MutationObserver;
    this._observer = new MO(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => this._emitChange(), 150);
    });
    this._observer.observe(canvas, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
  }

  _reinit() {
    // Give the engine a chance to re-wire after a bulk innerHTML swap.
    const win = this._canvasWin();
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
