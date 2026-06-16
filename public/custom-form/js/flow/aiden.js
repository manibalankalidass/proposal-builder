/**
 * @fileoverview Aiden — AI writing-assistant block.
 *
 * A text block (behaves exactly like a normal Heading/Body-Text block when you
 * just click + type) that gains an AI authoring flow when you press the
 * shortcut while focused in it:
 *
 *   Windows / Linux : Alt + H
 *   macOS           : ⌘ + H
 *
 * Empty state shows a "Help me to write… (Alt + H)" placeholder, exactly like
 * the title-block placeholder (CSS `:empty:before` on the `.edit_me`).
 *
 * AI flow (a floating action bar under the block drives the phases):
 *   1. prompt   — type what you want; [Cancel] [Generate]
 *   2. loading  — "AI:den writing…" spinner + [Stop] (Stop aborts the request)
 *   3. result   — the generated text is written into the block; the bar shows
 *                 [↻ Recreate] [🎤 Adjust tone]            [Cancel] [Insert]
 *   - Adjust tone opens a popup (professional / casual) → Apply re-generates.
 *   - Recreate re-runs the request with the same prompt.
 *   - Insert keeps the generated text; Cancel reverts to the previous content.
 *
 * The actual text generation goes through a configurable seam so a real backend
 * can be wired in without touching this file:
 *
 *   window.Aiden.configure({
 *     generate: async ({ prompt, tones, signal }) => '<p>…</p>'  // HTML or text
 *   });
 *
 * Until configured, a built-in stub returns a realistic simulated response (and
 * honours `signal` so Stop works), so the whole UX is exercisable end-to-end.
 *
 * Exposes: window.Aiden.createBlock(), window.Aiden.configure(), window.Aiden.open(block)
 */
(function () {
  window.Aiden = window.Aiden || {};

  const isMac = /Mac|iPhone|iPad|iPod/i.test(
    (navigator.platform || '') + ' ' + (navigator.userAgent || '')
  );
  const SHORTCUT = isMac ? '⌘ H' : 'Alt + H';
  const HINT = `✦  Help me to write…  ${SHORTCUT}`;
  const PROMPT_HINT = '✦  Tell Aiden what to write…';

  const hash = () => (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID() : Math.random().toString(16).slice(2);

  /* ----------------------------- generation seam ---------------------------- */

  let customGenerate = null;
  window.Aiden.configure = (opts = {}) => {
    if (typeof opts.generate === 'function') customGenerate = opts.generate;
  };

  // Built-in simulated writer. Returns HTML. Honours an AbortSignal so Stop
  // cancels it. Replace via window.Aiden.configure({ generate }).
  const simulate = (prompt, tones) => {
    const topic = (prompt || 'your topic').trim().replace(/\s+/g, ' ');
    const cap = topic.charAt(0).toUpperCase() + topic.slice(1);
    let opener = `Here's a draft about ${topic}.`;
    if (tones && tones.professional) {
      opener = `${cap}: an overview. The following outlines the key considerations in a clear, professional tone.`;
    } else if (tones && tones.casual) {
      opener = `So, about ${topic} — here's the friendly, no-fuss version. 👍`;
    }
    const body = `It brings together the essentials so you can adapt the wording, trim what you don't need, and keep the parts that fit your document. Edit it inline once inserted.`;
    return `<p>${opener}</p><p>${body}</p>`;
  };

  const defaultGenerate = ({ prompt, tones, signal }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(simulate(prompt, tones)), 1100);
    if (signal) {
      if (signal.aborted) { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); return; }
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }
  });

  const runGenerate = (args) =>
    Promise.resolve().then(() => (customGenerate || defaultGenerate)(args));

  /* ------------------------------- the block -------------------------------- */

  window.Aiden.createBlock = () => {
    const bc = (typeof BlockCreator !== 'undefined') ? new BlockCreator() : null;
    const block = bc
      ? bc.getCsBlockSmall('AI Writer', 'cs-aiden-block')
      : Object.assign(document.createElement('div'), { className: 'cs_block_s cs-aiden-block' });
    block.dataset.blockType = 'aiden';
    block.setAttribute('custom-name', 'AI Writer');

    const inner = document.createElement('div');
    inner.className = 'edit_me cs-aiden-text';
    inner.id = `aiden_${hash()}`;
    inner.setAttribute('placeholder', HINT);
    inner.style.fontSize = '14px';
    block.appendChild(inner);
    return block;
  };

  // Register the builder so createBlock(type='aiden') / drag-drop work.
  if (window.FlowCanvas && window.FlowCanvas.BLOCK_BUILDERS) {
    window.FlowCanvas.BLOCK_BUILDERS['aiden'] = () => window.Aiden.createBlock();
  }

  /* ------------------------------ session state ----------------------------- */

  // One AI session at a time. { block, editable, phase, prompt, prevHTML,
  // controller, tones }.
  let session = null;

  // The action bar + tone popup are docked INSIDE the block (so they sit in the
  // input box itself). They're tagged data-cs-chrome so export + surface-click
  // ignore them, and removeChrome() has an exception so chrome teardown can't
  // wipe them mid-session (see inline-editor.js).
  let bar = null;
  let tonePop = null;

  const editableText = () => (session ? (session.editable.textContent || '').trim() : '');

  /* --------------------------------- the bar -------------------------------- */

  const BTN = (act, label, cls) =>
    `<button type="button" data-act="${act}" class="cs-aiden-btn ${cls}">${label}</button>`;

  const renderBar = () => {
    if (!bar || !session) return;
    let html = '';
    if (session.phase === 'prompt') {
      html = `<div class="cs-aiden-bar__sp"></div>`
        + BTN('cancel', 'Cancel', 'cs-aiden-btn--ghost')
        + BTN('generate', 'Generate', 'cs-aiden-btn--primary');
    } else if (session.phase === 'loading') {
      html = `<span class="cs-aiden-status"><span class="cs-aiden-spin"></span>AI:den writing…</span>`
        + `<div class="cs-aiden-bar__sp"></div>`
        + BTN('stop', 'Stop', 'cs-aiden-btn--stop');
    } else { // result
      html = BTN('recreate', '↻ Recreate', 'cs-aiden-btn--link')
        + BTN('tone', '🎤 Adjust tone', 'cs-aiden-btn--link')
        + `<div class="cs-aiden-bar__sp"></div>`
        + BTN('cancel', 'Cancel', 'cs-aiden-btn--ghost')
        + BTN('insert', 'Insert', 'cs-aiden-btn--primary');
    }
    bar.innerHTML = html;
  };

  const ensureBar = () => {
    if (bar) return;
    bar = document.createElement('div');
    bar.className = 'cs-aiden-bar';
    bar.setAttribute('data-cs-chrome', '');
    // Keep the caret in the block when a button is pressed, and keep our clicks
    // away from inline-editor's document-level select/teardown listeners.
    bar.addEventListener('mousedown', (e) => { e.preventDefault(); }, true);
    bar.addEventListener('pointerdown', (e) => { e.stopPropagation(); }, true);
    bar.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      onAction(act);
    });
    if (session) session.block.appendChild(bar);
  };

  const onAction = (act) => {
    if (act === 'generate') return generate();
    if (act === 'stop') return stop();
    if (act === 'recreate') return generateCore();
    if (act === 'insert') return commit();
    if (act === 'cancel') return cancel();
    if (act === 'tone') return toggleTonePopup();
    if (act === 'apply-tone') return applyTone();
  };

  /* ------------------------------- tone popup ------------------------------- */

  const ensureTonePop = () => {
    if (tonePop) return;
    tonePop = document.createElement('div');
    tonePop.className = 'cs-aiden-pop';
    tonePop.setAttribute('data-cs-chrome', '');
    tonePop.innerHTML = `
      <div class="cs-aiden-pop__title">Adjust tone</div>
      <label class="cs-aiden-pop__row"><input type="checkbox" data-tone="professional"> Make it sound professional</label>
      <label class="cs-aiden-pop__row"><input type="checkbox" data-tone="casual"> Make it casual</label>
      <div class="cs-aiden-pop__foot">${BTN('apply-tone', 'Apply', 'cs-aiden-btn--primary')}</div>`;
    tonePop.addEventListener('mousedown', (e) => e.preventDefault(), true);
    tonePop.addEventListener('pointerdown', (e) => e.stopPropagation(), true);
    tonePop.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act) { e.preventDefault(); e.stopPropagation(); onAction(act); }
    });
    (bar || document.body).appendChild(tonePop);
  };

  const toggleTonePopup = () => {
    ensureTonePop();
    const open = !tonePop.classList.contains('is-open');
    if (open && session) {
      tonePop.querySelectorAll('input[data-tone]').forEach((cb) => {
        cb.checked = !!session.tones[cb.dataset.tone];
      });
    }
    tonePop.classList.toggle('is-open', open);
  };

  const closeTonePopup = () => { if (tonePop) tonePop.classList.remove('is-open'); };

  const applyTone = () => {
    if (!session || !tonePop) return;
    tonePop.querySelectorAll('input[data-tone]').forEach((cb) => {
      session.tones[cb.dataset.tone] = cb.checked;
    });
    closeTonePopup();
    generateCore();
  };

  /* ----------------------------- phase control ------------------------------ */

  const setPhase = (phase) => {
    if (!session) return;
    session.phase = phase;
    session.block.classList.toggle('cs-aiden--loading', phase === 'loading');
    session.block.setAttribute('data-aiden-phase', phase);
    renderBar();
  };

  const generate = () => {
    if (!session) return;
    const prompt = editableText();
    if (!prompt) { focusEditable(); return; }
    session.prompt = prompt;
    generateCore();
  };

  const generateCore = () => {
    if (!session) return;
    closeTonePopup();
    setPhase('loading');
    const controller = ('AbortController' in window) ? new AbortController() : null;
    session.controller = controller;
    const mine = controller;
    runGenerate({ prompt: session.prompt, tones: session.tones, signal: controller && controller.signal })
      .then((out) => {
        if (!session || session.controller !== mine) return; // superseded / closed
        session.controller = null;
        session.result = out || '';
        session.editable.innerHTML = sanitize(out);
        setPhase('result');
      })
      .catch((err) => {
        if (err && err.name === 'AbortError') return;            // Stop handled it
        if (!session || session.controller !== mine) return;
        session.controller = null;
        console.warn('[Aiden] generate failed:', err);
        setPhase('prompt');
        flash('Generation failed — try again.');
      });
  };

  const stop = () => {
    if (!session) return;
    if (session.controller) { try { session.controller.abort(); } catch (e) { /* */ } }
    session.controller = null;
    setPhase('prompt');         // editable still shows the prompt
    focusEditable();
  };

  // Insert: keep the generated text as the block's content and leave AI mode.
  const commit = () => {
    if (!session) return;
    session.editable.setAttribute('placeholder', HINT);
    close();
  };

  // Cancel: discard everything and restore the block's previous content.
  const cancel = () => {
    if (!session) return;
    if (session.controller) { try { session.controller.abort(); } catch (e) { /* */ } }
    session.editable.innerHTML = session.prevHTML;
    session.editable.setAttribute('placeholder', HINT);
    close();
  };

  const close = () => {
    if (session) {
      session.block.classList.remove('cs-aiden--active', 'cs-aiden--loading');
      session.block.removeAttribute('data-aiden-phase');
    }
    closeTonePopup();
    if (tonePop) { tonePop.remove(); tonePop = null; }
    if (bar) { bar.remove(); bar = null; }
    session = null;
  };

  /* -------------------------------- helpers --------------------------------- */

  // Very small guard so a configured backend can't inject scripts. Allows basic
  // formatting tags; everything else is treated as text by the browser anyway
  // once assigned via innerHTML, so we just strip <script>.
  const sanitize = (html) => String(html == null ? '' : html).replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '');

  const focusEditable = () => {
    if (!session) return;
    try {
      session.editable.focus();
      const sel = window.getSelection();
      if (sel && session.editable.lastChild) {
        const range = document.createRange();
        range.selectNodeContents(session.editable);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch (e) { /* */ }
  };

  const flash = (msg) => {
    if (!bar) return;
    const n = document.createElement('span');
    n.className = 'cs-aiden-flash';
    n.textContent = msg;
    bar.insertBefore(n, bar.firstChild);
    setTimeout(() => n.remove(), 2600);
  };

  /* ------------------------------- open AI mode ----------------------------- */

  window.Aiden.open = (block) => {
    if (!block || !block.classList || !block.classList.contains('cs-aiden-block')) return;
    const editable = block.querySelector('.edit_me');
    if (!editable) return;
    if (session && session.block === block) return; // already open here
    if (session) close();

    session = {
      block,
      editable,
      phase: 'prompt',
      prompt: (editable.textContent || '').trim(),
      prevHTML: editable.innerHTML,
      controller: null,
      tones: { professional: false, casual: false },
    };
    block.classList.add('cs-aiden--active');
    editable.setAttribute('contenteditable', 'true');
    editable.setAttribute('placeholder', PROMPT_HINT);

    ensureBar();
    setPhase('prompt');
    focusEditable();
  };

  /* -------------------------------- shortcut -------------------------------- */

  // Alt+H (Win/Linux) or ⌘+H (mac) while focused in / on an Aiden block.
  const onKey = (e) => {
    if (e.code !== 'KeyH' && (e.key || '').toLowerCase() !== 'h') return;
    const combo = isMac ? (e.metaKey && !e.ctrlKey && !e.altKey) : (e.altKey && !e.ctrlKey && !e.metaKey);
    if (!combo) {
      // Escape closes an open session (acts like Cancel).
      return;
    }
    const block = e.target?.closest?.('.cs-aiden-block')
      || document.querySelector('.cs-aiden-block.cs-editing, .cs-aiden-block.cs-selected');
    if (!block) return;
    e.preventDefault();
    e.stopPropagation();
    window.Aiden.open(block);
  };

  const onKeyAux = (e) => {
    if (!session) return;
    if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }
    // Ctrl/Cmd+Enter generates from the prompt.
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && session.phase === 'prompt') {
      e.preventDefault();
      generate();
    }
  };

  // Clicking outside the block + bar finalises: keep the result, otherwise cancel.
  const onDocPointerDown = (e) => {
    if (!session) return;
    const t = e.target;
    if (t.closest?.('.cs-aiden-bar, .cs-aiden-pop')) return;
    if (session.block.contains(t)) return;
    if (session.phase === 'result') commit();
    else cancel();
  };

  const init = () => {
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keydown', onKeyAux, true);
    document.addEventListener('pointerdown', onDocPointerDown, true);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
