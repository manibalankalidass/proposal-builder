/**
 * @fileoverview Canvas-zoom keyboard shortcuts (iframe side).
 *
 * The canvas zoom is owned by the Angular host (it sets `--editor-zoom` and
 * scales the iframe wrapper). When focus is inside this editor iframe, Ctrl/⌘
 * +／−／0 fire HERE, not on the host — so the browser would do its own page
 * zoom instead of the editor's. This module intercepts those presses, blocks
 * the native zoom (preventDefault), and forwards the intent to the host via the
 * standard postMessage channel; the host applies the editor zoom.
 *
 * The host has a matching keydown handler for when focus is on its own chrome,
 * so the shortcut works no matter where focus sits.
 */
(function () {
  if (window.EditorFeatures && window.EditorFeatures.zoomShortcuts === false) return;

  // Map a Ctrl/⌘ key event to a zoom direction, or null if it isn't one.
  const zoomDir = (e) => {
    if (!e.ctrlKey && !e.metaKey) return null;
    const k = e.key;
    if (k === '+' || k === '=' || e.code === 'NumpadAdd') return 'in';
    if (k === '-' || k === '_' || e.code === 'NumpadSubtract') return 'out';
    if (k === '0' || e.code === 'Numpad0' || e.code === 'Digit0') return 'reset';
    return null;
  };

  const onKeyDown = (e) => {
    const dir = zoomDir(e);
    if (!dir) return;
    e.preventDefault();                       // stop the browser's own page zoom
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ source: 'custom-form-twig', type: 'editor:zoom', dir }, '*');
      }
    } catch (err) { /* cross-origin parent — nothing we can do */ }
  };

  // Capture phase so we win before any block-level handler swallows the combo.
  document.addEventListener('keydown', onKeyDown, true);
})();
