/**
 * @fileoverview Editor feature flags — MANAGER-FACING ON/OFF SWITCHES.
 *
 * Flip any flag to `false` to completely hide that feature from the editor
 * (its palette entries, panels, and UI won't appear). Loaded in BOTH runtime
 * contexts (the Angular shell via src/index.html, and the iframe canvas via
 * custom-form.html) BEFORE block-registry.js, so every consumer can read it.
 *
 * Read it as `window.EditorFeatures.<flag>` (defaults to enabled if missing).
 */
(function () {
  const FEATURES = {
    rulersGuides: true,  // Rulers + draggable alignment guides
  };

  const g = (typeof window !== 'undefined') ? window : globalThis;
  // Keep any flags an embedder set earlier; our defaults fill the rest.
  g.EditorFeatures = Object.assign({}, FEATURES, g.EditorFeatures || {});
  if (typeof globalThis !== 'undefined') globalThis.EditorFeatures = g.EditorFeatures;
})();
