/**
 * @fileoverview Canvas history manager — undo / redo for block-level
 * actions (add, remove, move, binding changes, page splits).
 *
 * Design (DOM-snapshot, observer-driven):
 *
 *   1. We observe the canvas tree with a MutationObserver. Whenever
 *      blocks / rows / cols / pages are added or removed (or their
 *      data-repeat-* / data-twig-* attributes change), we take a
 *      snapshot of the canvas innerHTML.
 *
 *   2. A burst of mutations from a single user action (eg. dropping a
 *      block creates a row + col + block all at once) is collapsed
 *      into ONE history entry via a 300ms debounce.
 *
 *   3. Undo restores the canvas innerHTML to the previous snapshot.
 *      Redo restores to the next one.
 *
 *   4. During a restore we set `suspended = true` so the observer
 *      doesn't record the restoration itself as a new action.
 *
 *   5. We DON'T track inline text edits — Froala owns its own undo
 *      stack for that. (Text edits arrive as `characterData` mutations,
 *      which we ignore.)
 *
 * Why DOM snapshot instead of command pattern?
 *
 *   The codebase has many mutation sites scattered across modules
 *   (placeBlock, page splits, binding-modal apply, reorder, cleanup
 *   observer, etc.). Instrumenting every one is invasive and easy to
 *   forget — a missed site = silently broken undo. Observing the DOM
 *   covers EVERY mutation uniformly without touching any existing
 *   logic, which the user explicitly asked for.
 *
 * Memory: snapshots cap at HISTORY_LIMIT entries (default 50). At ~50KB
 * per snapshot for a typical document, worst case is ~2.5MB — well
 * within budget.
 *
 * Exposes:
 *   window.FlowCanvas.initHistory(canvas)
 *   window.FlowCanvas.undo()
 *   window.FlowCanvas.redo()
 *   window.FlowCanvas.suspendHistory(fn)     — run fn without recording
 *   window.FlowCanvas.getHistoryState()      — { undoCount, redoCount }
 */
(function () {
  window.FlowCanvas = window.FlowCanvas || {};

  const HISTORY_LIMIT = 50;
  const COMMIT_DEBOUNCE_MS = 300;

  // Snapshot stacks. `past` holds older states (the most recent is the
  // one we'd revert to on undo). `future` holds states the user undid;
  // any new action clears `future` (standard editor behaviour).
  const past = [];
  const future = [];
  let baseline = '';     // the snapshot the canvas currently matches
  let canvasRef = null;  // root we snapshot

  let suspended = false;
  let pendingCommit = null;

  // Take a fresh snapshot of the canvas. Returns the HTML string we'd
  // restore on undo. We snapshot innerHTML of the canvas (which
  // contains the cs-doc pages); the canvas element itself stays in
  // place so listeners attached to it survive the restore.
  const snapshot = () => canvasRef ? canvasRef.innerHTML : '';

  const restore = (html) => {
    if (!canvasRef) return;
    suspended = true;
    try {
      canvasRef.innerHTML = html;
      baseline = html;
      // Tell downstream observers (twig generator, field panel, etc.)
      // that the tree has changed via a synthetic mutation. They
      // already react to childList mutations on the canvas, which the
      // innerHTML assignment triggers naturally — no manual nudge
      // needed beyond clearing our suspend flag.
    } finally {
      // Let any synchronous mutation handlers finish before we resume,
      // otherwise their cleanup pass would record a fresh entry on
      // top of the restored state.
      requestAnimationFrame(() => { suspended = false; });
    }
  };

  // Commit the current canvas state to history. Called after the
  // debounce window expires for a burst of mutations.
  const commit = () => {
    pendingCommit = null;
    if (suspended || !canvasRef) return;
    const next = snapshot();
    if (next === baseline) return; // nothing actually changed
    past.push(baseline);
    if (past.length > HISTORY_LIMIT) past.shift();
    baseline = next;
    // Any new committed change invalidates the redo stack — once the
    // user diverges from the previous future, that future is gone.
    future.length = 0;
  };

  const scheduleCommit = () => {
    if (suspended) return;
    if (pendingCommit) clearTimeout(pendingCommit);
    pendingCommit = setTimeout(commit, COMMIT_DEBOUNCE_MS);
  };

  // Public: run `fn` without history capturing. Used by code that
  // performs migrations or other behind-the-scenes mutations that
  // shouldn't be exposed as undoable user actions.
  const suspendHistory = (fn) => {
    const wasSuspended = suspended;
    suspended = true;
    try { fn(); }
    finally {
      requestAnimationFrame(() => { suspended = wasSuspended; });
    }
  };

  const undo = () => {
    if (pendingCommit) {
      // Flush pending burst first so the user gets the most recent
      // state into the undo stack before stepping back.
      clearTimeout(pendingCommit);
      commit();
    }
    if (!past.length) return false;
    future.push(baseline);
    const prev = past.pop();
    restore(prev);
    return true;
  };

  const redo = () => {
    if (!future.length) return false;
    past.push(baseline);
    const next = future.pop();
    restore(next);
    return true;
  };

  const getHistoryState = () => ({
    undoCount: past.length,
    redoCount: future.length,
  });

  // ---------------------------------------------------------------------------
  // Init: attach the observer and the keyboard shortcuts.
  //
  // Watches childList (block/row/col add/remove) and selected attribute
  // changes (data-repeat-*, data-twig-if, data-page) so binding /
  // condition / page edits are also captured. Inline style and class
  // changes are ignored — they're cosmetic and would flood the stack
  // with selection / hover noise.
  // ---------------------------------------------------------------------------
  window.FlowCanvas.initHistory = function (canvas) {
    if (!canvas) return;
    canvasRef = canvas;
    // Defer the first baseline snapshot until other startup work has
    // finished (section migration, page creation, etc.). Otherwise the
    // user's very first action would have nothing to undo back to AND
    // any startup mutation would be recorded as a phantom user action.
    suspended = true;
    requestAnimationFrame(() => {
      baseline = snapshot();
      suspended = false;
    });

    const obs = new MutationObserver((mutations) => {
      if (suspended) return;
      // Reject mutations that are clearly NOT user-edits: characterData
      // (inline text edits — Froala territory) and style/class changes.
      let interesting = false;
      for (const m of mutations) {
        if (m.type === 'childList') {
          // Skip mutations that ONLY add/remove chrome elements —
          // they're our own decoration, not user content.
          const isChrome = (n) =>
            n.nodeType === 1 && (
              n.hasAttribute?.('data-cs-chrome') ||
              n.classList?.contains('cs-overflow-mark') ||
              n.classList?.contains('cs-block-grip') ||
              n.classList?.contains('cs-block-badge') ||
              n.classList?.contains('section-binding-info')
            );
          const added = Array.from(m.addedNodes).filter((n) => !isChrome(n));
          const removed = Array.from(m.removedNodes).filter((n) => !isChrome(n));
          if (added.length || removed.length) { interesting = true; break; }
        } else if (m.type === 'attributes') {
          interesting = true; break;
        }
      }
      if (interesting) scheduleCommit();
    });
    obs.observe(canvas, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'data-repeat-path',
        'data-repeat-alias',
        'data-repeat-chain',
        'data-twig-if',
        'data-page',
      ],
    });

    // Keyboard shortcuts. We bind on document so the focus can be
    // anywhere in the iframe. If the user is typing inside a
    // contenteditable (Froala) we defer to its own undo handler.
    document.addEventListener('keydown', (e) => {
      const inEditable = e.target?.isContentEditable ||
                         e.target?.tagName === 'INPUT' ||
                         e.target?.tagName === 'TEXTAREA';
      if (inEditable) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    });
  };

  window.FlowCanvas.undo = undo;
  window.FlowCanvas.redo = redo;
  window.FlowCanvas.suspendHistory = suspendHistory;
  window.FlowCanvas.getHistoryState = getHistoryState;
})();
