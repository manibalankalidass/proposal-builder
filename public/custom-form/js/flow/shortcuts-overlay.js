/**
 * @fileoverview Keyboard-shortcuts help overlay.
 *
 * Press “?” (Shift+/) anywhere outside a text field to toggle a cheat-sheet of
 * the editor's shortcuts. Esc or a click on the backdrop closes it. Also
 * openable via window.ShortcutsOverlay.toggle() (e.g. from a host button).
 */
(function () {
  window.ShortcutsOverlay = window.ShortcutsOverlay || {};

  const isMac = /Mac|iPhone|iPad|iPod/i.test((navigator.platform || '') + ' ' + (navigator.userAgent || ''));
  const MOD = isMac ? '⌘' : 'Ctrl';

  const SECTIONS = [
    ['General', [
      [`${MOD} Z`, 'Undo'],
      [isMac ? '⌘ ⇧ Z' : 'Ctrl Y', 'Redo'],
      ['?', 'This help'],
      ['Esc', 'Deselect / close'],
    ]],
    ['Blocks', [
      [`${MOD} C`, 'Copy'],
      [`${MOD} V`, 'Paste'],
      [`${MOD} D`, 'Duplicate'],
      ['Del', 'Delete'],
      [`${MOD} R`, 'Rename block'],
      ['Arrows', 'Nudge / reorder (Shift = bigger)'],
      ['Right-click', 'Context menu'],
    ]],
    ['AI Writer', [
      [isMac ? '⌘ H' : 'Alt H', 'Ask Aiden to write'],
    ]],
    ['Pen / Shape', [
      ['✒ then click', 'Add points'],
      ['Hover edge', '+ to add a point'],
      ['Hover point', '× to remove (drag = move)'],
      ['✋', 'Move points / shape'],
      ['Enter', 'Close the shape'],
      [`${MOD} drag-snap`, 'Smart-align guides'],
      [`${MOD} wheel`, 'Zoom (shape designer)'],
    ]],
  ];

  let modal = null;

  const close = () => { if (modal) { modal.remove(); modal = null; } };

  const open = () => {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'cs-shortcuts';
    modal.setAttribute('data-cs-chrome', '');
    let cols = '';
    SECTIONS.forEach(([title, rows]) => {
      cols += `<div class="cs-shortcuts__group"><div class="cs-shortcuts__title">${title}</div>`;
      rows.forEach(([k, d]) => {
        cols += `<div class="cs-shortcuts__row"><kbd>${k}</kbd><span>${d}</span></div>`;
      });
      cols += '</div>';
    });
    modal.innerHTML = `
      <div class="cs-shortcuts__backdrop"></div>
      <div class="cs-shortcuts__panel">
        <div class="cs-shortcuts__head">
          <span>Keyboard shortcuts</span>
          <button type="button" class="cs-shortcuts__close" aria-label="Close">✕</button>
        </div>
        <div class="cs-shortcuts__cols">${cols}</div>
      </div>`;
    modal.addEventListener('click', (e) => {
      if (e.target.closest('.cs-shortcuts__close') || e.target.classList.contains('cs-shortcuts__backdrop')) close();
    });
    document.body.appendChild(modal);
  };

  const toggle = () => { if (modal) close(); else open(); };
  Object.assign(window.ShortcutsOverlay, { open, close, toggle });

  const init = () => {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { close(); return; }
      // “?” = Shift + / . Ignore while typing in a field / editing text.
      if (e.key !== '?') return;
      const t = e.target;
      if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (window.EditorManager && window.EditorManager.getEditing && window.EditorManager.getEditing()) return;
      e.preventDefault();
      toggle();
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
