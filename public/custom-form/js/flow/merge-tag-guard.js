/**
 * @fileoverview Merge-tag guard — keeps `{{ ... }}` merge tags atomic
 * while editing.
 *
 * Merge tags are inserted from the Variables panel as PLAIN TEXT (no
 * wrapper span), so nothing stops a user from deleting a single brace
 * and leaving a broken fragment like `{ mainContent.jobNo }}` that
 * silently corrupts the Twig export. This module makes every complete
 * tag behave as one unit:
 *
 *   - Deleting ANY character of a tag (Backspace, Delete, Ctrl+Backspace,
 *     selection delete, cut, drag-delete) removes the ENTIRE tag.
 *   - Typing with the caret strictly INSIDE a tag replaces the whole tag
 *     with the typed text. Typing at the tag edges inserts normally.
 *   - A selection that partially overlaps a tag is expanded to cover the
 *     whole tag before the delete / type-over / cut / paste applies.
 *
 * Design (single global hook, text-scan based):
 *
 *   1. One capture-phase `beforeinput` listener on the iframe document
 *      covers every editing path at once — CustomRichEditor text blocks,
 *      table / table-repeater cells (own contenteditable), and bare
 *      contenteditable section containers. No per-block wiring.
 *
 *   2. Tags carry no marker, so detection is a text scan: walk the text
 *      nodes of the editable root, concatenate them (with `\n` sentinels
 *      at block/<br> boundaries so a tag can't falsely span lines), find
 *      /\{\{[^{}\n]*\}\}/ ranges, and test whether the pending deletion /
 *      insertion interval intersects one.
 *
 *   3. On a hit we preventDefault, expand the selection to cover the
 *      whole tag(s), and re-execute through document.execCommand so the
 *      change lands in the browser's NATIVE undo stack as one atomic
 *      step (history-manager.js deliberately leaves in-text undo to the
 *      browser). We never mutate nodes directly — that would corrupt
 *      native undo.
 *
 *   4. Capture-phase `cut` / `paste` listeners pre-expand the selection
 *      as well: table-block.js re-inserts pastes via execCommand, which
 *      never fires beforeinput, so paste must be caught before it.
 *
 * Exposes window.MergeTagGuard { findTagRanges, collectText,
 * expandSelectionToTags } for console testing / future reuse.
 */
(function () {
  'use strict';

  const TAG_RE = /\{\{[^{}\n]*\}\}/g; // \n excluded → no cross-line false matches

  const INSERT_TYPES = new Set([
    'insertText',
    'insertParagraph',
    'insertLineBreak',
    'insertFromPaste',
    'insertFromDrop',
    'insertReplacementText',
  ]);

  // Elements that end a "line" for tag-matching purposes.
  const BLOCK_TAGS = new Set([
    'DIV', 'P', 'LI', 'UL', 'OL', 'TABLE', 'TR', 'TD', 'TH',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'PRE',
  ]);

  // True while we re-execute the edit via execCommand (defensive:
  // execCommand shouldn't fire beforeinput, but browsers differ).
  let applying = false;

  /* ------------------------------------------------------------------ *
   * Pure helpers                                                        *
   * ------------------------------------------------------------------ */

  /**
   * Walks the text nodes under `root` and returns their concatenation
   * plus a node↔offset map. Block/<br> boundaries contribute a '\n'
   * sentinel to `text` with no segment entry, so TAG_RE can't match a
   * `{{` on one line with a `}}` on the next.
   *
   * @returns {{text: string, segments: Array<{node: Text, start: number, end: number}>}}
   */
  function collectText(root) {
    const doc = root.ownerDocument;
    const segments = [];
    let text = '';
    const walker = doc.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(n) {
          if (n.nodeType === 1 && n.getAttribute('contenteditable') === 'false') {
            return NodeFilter.FILTER_REJECT; // skip non-editable chrome entirely
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 1) {
        if ((node.tagName === 'BR' || BLOCK_TAGS.has(node.tagName)) &&
            text && !text.endsWith('\n')) {
          text += '\n'; // sentinel — no segment entry
        }
        continue;
      }
      const val = node.nodeValue;
      if (!val) continue;
      segments.push({ node, start: text.length, end: text.length + val.length });
      text += val;
    }
    return { text, segments };
  }

  /** @returns {Array<{start: number, end: number}>} tag ranges, end exclusive */
  function findTagRanges(text) {
    const out = [];
    TAG_RE.lastIndex = 0;
    let m;
    while ((m = TAG_RE.exec(text))) {
      out.push({ start: m.index, end: m.index + m[0].length });
    }
    return out;
  }

  /** Maps a DOM point to an absolute offset in the collected text (null if unmappable). */
  function domPointToOffset(collected, container, offset) {
    if (container && container.nodeType === 3) {
      for (const s of collected.segments) {
        if (s.node === container) {
          return s.start + Math.min(offset, s.end - s.start);
        }
      }
      return null; // text node in a rejected subtree
    }
    // Element container: absolute offset = start of the first segment
    // at-or-after the point.
    let r;
    try {
      r = container.ownerDocument.createRange();
      r.setStart(container, offset);
      r.collapse(true);
    } catch (err) {
      return null;
    }
    for (const s of collected.segments) {
      if (r.comparePoint(s.node, 0) >= 0) return s.start;
    }
    return collected.text.length;
  }

  /** Maps an absolute offset back to a {node, offset} DOM point. */
  function offsetToDomPoint(collected, offset) {
    const segs = collected.segments;
    for (const s of segs) {
      if (offset >= s.start && offset <= s.end) {
        return { node: s.node, offset: offset - s.start };
      }
    }
    // Offset sits on a sentinel: snap to the next segment start.
    for (const s of segs) {
      if (s.start >= offset) return { node: s.node, offset: 0 };
    }
    const last = segs[segs.length - 1];
    return last ? { node: last.node, offset: last.end - last.start } : null;
  }

  /**
   * Unions [a,b) with every tag it touches. A collapsed interval (a===b,
   * the typing-inside case) only counts when strictly inside a tag, so
   * typing at the edges of a tag stays a normal insert. Half-open
   * intersection means backspace just BEFORE `{{` or forward-delete just
   * AFTER `}}` correctly leave the tag alone.
   *
   * @returns {{start: number, end: number}|null} null when no tag is touched
   */
  function expandInterval(tags, a, b) {
    let start = a;
    let end = b;
    let hit = false;
    for (const t of tags) {
      const intersects = a === b
        ? (a > t.start && a < t.end)
        : (a < t.end && b > t.start);
      if (intersects) {
        hit = true;
        start = Math.min(start, t.start);
        end = Math.max(end, t.end);
      }
    }
    return hit ? { start, end } : null;
  }

  /** Nearest contenteditable root above `node` (the tag-scan scope). */
  function getEditableRoot(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return el ? el.closest('[contenteditable="true"]') : null;
  }

  /* ------------------------------------------------------------------ *
   * Selection surgery                                                   *
   * ------------------------------------------------------------------ */

  /**
   * If the current (non-collapsed) selection partially overlaps any tag,
   * grows the live selection to cover the whole tag(s).
   * @returns {boolean} true if the selection was changed
   */
  function expandSelectionToTags(root) {
    const doc = root.ownerDocument;
    const sel = doc.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return false;
    const collected = collectText(root);
    const tags = findTagRanges(collected.text);
    if (!tags.length) return false;
    const r = sel.getRangeAt(0);
    const a = domPointToOffset(collected, r.startContainer, r.startOffset);
    const b = domPointToOffset(collected, r.endContainer, r.endOffset);
    if (a == null || b == null) return false;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const expanded = expandInterval(tags, lo, hi);
    if (!expanded || (expanded.start === lo && expanded.end === hi)) return false;
    return setSelection(doc, collected, expanded);
  }

  /** Sets the selection to an absolute-offset range. */
  function setSelection(doc, collected, range) {
    const sp = offsetToDomPoint(collected, range.start);
    const ep = offsetToDomPoint(collected, range.end);
    if (!sp || !ep) return false;
    const sel = doc.getSelection();
    const r = doc.createRange();
    r.setStart(sp.node, sp.offset);
    r.setEnd(ep.node, ep.offset);
    sel.removeAllRanges();
    sel.addRange(r);
    return true;
  }

  /* ------------------------------------------------------------------ *
   * Event handlers                                                      *
   * ------------------------------------------------------------------ */

  function onBeforeInput(e) {
    if (applying || !e.cancelable) return; // !cancelable skips IME composition
    const type = e.inputType || '';
    const isDelete = type.startsWith('delete');
    const isInsert = INSERT_TYPES.has(type);
    if (!isDelete && !isInsert) return;

    const root = getEditableRoot(e.target);
    if (!root) return;
    const doc = root.ownerDocument;

    const collected = collectText(root);
    const tags = findTagRanges(collected.text);
    if (!tags.length) return; // fast path — most keystrokes

    // Pending deletion/replacement interval [a,b) in absolute offsets.
    // getTargetRanges() is exact for word/line/selection deletes.
    let a = null;
    let b = null;
    const targetRanges = e.getTargetRanges ? e.getTargetRanges() : [];
    if (targetRanges && targetRanges.length) {
      const first = targetRanges[0];
      const last = targetRanges[targetRanges.length - 1];
      a = domPointToOffset(collected, first.startContainer, first.startOffset);
      b = domPointToOffset(collected, last.endContainer, last.endOffset);
    }
    if (a == null || b == null) {
      const sel = doc.getSelection();
      if (!sel || !sel.rangeCount) return;
      const r = sel.getRangeAt(0);
      a = domPointToOffset(collected, r.startContainer, r.startOffset);
      b = domPointToOffset(collected, r.endContainer, r.endOffset);
      if (a == null || b == null) return;
    }
    if (b < a) { const tmp = a; a = b; b = tmp; }
    if (a === b && isDelete) {
      // Collapsed caret: derive the single char a plain backspace/delete removes.
      if (type.endsWith('Backward')) a = Math.max(0, a - 1);
      else b = Math.min(collected.text.length, b + 1);
    }

    const expanded = expandInterval(tags, a, b);
    if (!expanded) return; // no tag touched — default behaviour
    if (expanded.start === a && expanded.end === b) return; // already tag-aligned

    e.preventDefault();
    if (!setSelection(doc, collected, expanded)) return;

    // Re-execute via execCommand so native undo records one atomic step.
    applying = true;
    try {
      if (isDelete) {
        doc.execCommand('delete');
      } else if (type === 'insertParagraph' || type === 'insertLineBreak') {
        doc.execCommand('delete');
        doc.execCommand(type === 'insertLineBreak' ? 'insertLineBreak' : 'insertParagraph');
      } else {
        let data = e.data;
        if ((data == null || data === '') && e.dataTransfer) {
          try { data = e.dataTransfer.getData('text/plain'); } catch (err) { /* ignore */ }
        }
        if (data) doc.execCommand('insertText', false, data);
        else doc.execCommand('delete');
      }
    } finally {
      applying = false;
    }
  }

  // Cut: expand first so the WHOLE tag is copied to the clipboard and
  // deleted natively (one undo entry). Paste: table-block.js re-inserts
  // via execCommand('insertText'), which never fires beforeinput — the
  // selection must already be tag-aligned before its handler runs.
  function onCutPasteCapture(e) {
    const root = getEditableRoot(e.target);
    if (!root) return;
    expandSelectionToTags(root);
  }

  document.addEventListener('beforeinput', onBeforeInput, true);
  document.addEventListener('cut', onCutPasteCapture, true);
  document.addEventListener('paste', onCutPasteCapture, true);

  window.MergeTagGuard = { findTagRanges, collectText, expandSelectionToTags };
})();
