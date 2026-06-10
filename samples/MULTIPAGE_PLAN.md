# Auto-Pagination Plan — Word-Style Editor

Goal: when body content overflows one A4 page, the editor automatically creates additional pages below. Each new page repeats the same header and footer the user defined on page 1. Deleting content shrinks pages back. Final PDF export already paginates correctly via Puppeteer.

This document is a **plan, not code**. Review it, mark up anything you disagree with, and we'll then build in phases.

---

## 1. Current state (what we have today)

| Piece | Where | Status |
|---|---|---|
| Two **separate iframes** rendering `custom-form.html` | [src/app/canvas/canvas.html](src/app/canvas/canvas.html), `pages = [1, 2]` | Working but each iframe is a separate world — no JS access between them |
| `.cs-doc` flex column with header + footer | [public/custom-form/css/custom-form.css:831-844](public/custom-form/css/custom-form.css#L831) | Header + footer render correctly inside one `.cs-doc` |
| `flow-canvas.js` bootstraps `.cs-doc` and inserts header/footer | [public/custom-form/js/flow-canvas.js:47-107](public/custom-form/js/flow-canvas.js#L47) | Works for one iframe |
| Body block placement (drag/drop) | `flow/drop-zones.js`, `flow/row-col-builder.js` | Existing, untouched |
| Twig generator (drives PDF export) | `js/common-twig-generator.js` | Reads from canvas → posts to parent |
| PDF export (Puppeteer) | [scripts/generate_pdf_puppeteer.js](scripts/generate_pdf_puppeteer.js), [src/server.ts](src/server.ts) | Already paginates content across PDF pages |

### Why two iframes is wrong for auto-pagination

JS in iframe 1 cannot read/write DOM in iframe 2 (same-origin, but they're separate `window` contexts). To detect overflow on page 1 and **move a block to page 2**, the script must access both pages. We need to collapse to **one iframe (or no iframe) containing N stacked `.cs-doc` elements**.

---

## 2. Target architecture

```
┌─ <iframe custom-form.html> (just ONE iframe) ──────────────────┐
│   <body>                                                        │
│     <div class="custom-form-design">                            │
│       <div class="cs-doc" data-page="1">                        │
│         <div class="cs-row cs-page-header">…header…</div>       │
│         <div class="cs-row">…body…</div>                        │
│         <div class="cs-row">…body…</div>                        │
│         <div class="cs-row cs-page-footer">…footer…</div>       │
│       </div>                                                    │
│       <div class="cs-doc" data-page="2">                        │
│         <div class="cs-row cs-page-header">…header (mirrored)…</│
│         <div class="cs-row">…overflowed body…</div>             │
│         <div class="cs-row cs-page-footer">…footer (mirrored)…</│
│       </div>                                                    │
│       …more .cs-doc as needed…                                  │
│     </div>                                                      │
│   </body>                                                       │
└─────────────────────────────────────────────────────────────────┘
```

### Key concepts

| Concept | Behavior |
|---|---|
| **Master page** | Always `.cs-doc[data-page="1"]`. User edits the header/footer here. Body blocks added/removed here too. |
| **Continuation pages** | `data-page="2"`, `3`, … created automatically when body of master page overflows. |
| **Header/footer mirroring** | Every continuation page's header/footer is a **read-only clone** of the master's. Edit master → mirrors update via `MutationObserver`. |
| **Overflow detection** | After each DOM mutation in any page's body, measure `body.scrollHeight` vs available height. If overflowing → move the last body row to the next page. If underflowing → pull the first body row from the next page back into this page. |
| **Empty page cleanup** | After overflow rebalancing, any continuation page with no body rows gets removed. |
| **Page numbers** | Footer can contain `<span class="cs-page-num"></span>` / `<span class="cs-page-total"></span>` placeholders. JS replaces them on each page after pagination settles. |

---

## 3. Pagination algorithm

After every mutation observed in any `.cs-doc`'s body (between header and footer):

```
function balance() {
  while (overflowing(any page)) {
    page  = first overflowing page
    next  = ensureNextPage(page)
    block = last body block of page
    next.body.prepend(block)
  }
  while (underflowing(any page) and there is a next page) {
    page  = first underflowing page
    next  = the page after it
    if (next has no body rows) {
      remove(next)
      continue
    }
    block = first body block of next
    page.body.append(block)
    if (overflowing(page)) {
      // we pulled too much — push it back
      next.body.prepend(block)
      break
    }
  }
  renumberPages()
}
```

### Subtleties

| Subtlety | Handling |
|---|---|
| A single block taller than one page | Allow visual overflow — split is out-of-scope phase 1. Add warning chip "Block too tall for one page." |
| Image loading asynchronously changes height | Listen to `load` events on all `<img>` and re-run `balance()` |
| Web fonts loading | Listen to `document.fonts.ready` once, re-run `balance()` |
| User typing in a contenteditable | Debounce `balance()` 150ms so it doesn't fight the cursor |
| Drag-and-drop placeholder during drop | Pause balancing while drag is active, resume on `drop` |
| Section Container blocks (absolute children) | They have their own internal coordinate system — exclude them from pagination splitting (keep entire section on one page) |

---

## 4. Header/footer sync (master → mirrors)

```js
const master = doc1.querySelector('.cs-page-header');
const observer = new MutationObserver(() => {
  document.querySelectorAll('.cs-doc:not([data-page="1"]) .cs-page-header')
    .forEach(mirror => {
      mirror.innerHTML = master.innerHTML;
      mirror.setAttribute('aria-readonly', 'true');
    });
});
observer.observe(master, { childList: true, subtree: true, characterData: true });
```

### Edit protection on mirrors

- Mirrors have `pointer-events: none` and `contenteditable="false"` so double-click on a mirror does nothing.
- If user double-clicks a mirror, redirect: scroll to master + activate it (small UX nicety).

---

## 5. Files to touch

| File | Change | Risk |
|---|---|---|
| [src/app/canvas/canvas.ts](src/app/canvas/canvas.ts) | `pages = [1]` (remove duplicate iframe). Multi-page is now inside the iframe, not multiple iframes. | Low |
| [src/app/canvas/canvas.html](src/app/canvas/canvas.html) | Drop the `@for` loop; render single iframe. | Low |
| [src/app/canvas/canvas.scss](src/app/canvas/canvas.scss) | Let `.canvas-frame` grow tall enough to show all pages stacked. Use `height: auto`, lift `overflow: hidden`. | Low |
| [public/custom-form/custom-form.html](public/custom-form/custom-form.html) | No change — same iframe loads. | None |
| [public/custom-form/css/custom-form.css](public/custom-form/css/custom-form.css) | New rules: `.cs-doc + .cs-doc { margin-top: 28px }` so stacked pages have a visual gap. Lift body `overflow: hidden` so multiple `.cs-doc` can show. | Low |
| [public/custom-form/js/flow-canvas.js](public/custom-form/js/flow-canvas.js) | New `pagination.js` companion module. Replaces single `ensureRegion` with `createPage(n)` factory. | **High** — central change |
| New [public/custom-form/js/flow/pagination.js](public/custom-form/js/flow/pagination.js) | The whole `balance()` + mirror logic. | High |
| [public/custom-form/js/common-twig-generator.js](public/custom-form/js/common-twig-generator.js) | When generating Twig, **only emit page 1** (master). Continuation pages are presentation-only — Puppeteer will re-paginate from the original body. | Medium |

---

## 6. Phase breakdown

| Phase | Deliverable | Time estimate |
|---|---|---|
| **A. Collapse to one iframe** | Editor renders one iframe with one `.cs-doc`. Header/footer still work. Drop the placeholder page 2. | 1 hr |
| **B. Multiple `.cs-doc` stacked** | Inside the iframe, support 1+ `.cs-doc` elements stacked vertically. Adjust CSS so they each look like an A4 page with a gap between. | 1 hr |
| **C. Master/mirror header & footer** | Master is page 1. Pages 2+ get cloned header/footer that update via MutationObserver. Mirrors are read-only. | 1.5 hr |
| **D. Overflow detection + block migration** | `balance()` function. Add blocks to page 1 → overflow pushes to page 2. Delete → page 2 content migrates back. Empty page 2 gets removed. | 2 hr |
| **E. Page numbering** | `<span class="cs-page-num"></span>` / `<span class="cs-page-total"></span>` populated after balance. | 30 min |
| **F. Edge cases + polish** | Images that load late, fonts, drag-during-balance, undo/redo. | 1.5 hr |
| **G. Twig generator changes** | Only emit master page's content. Skip mirrors so Twig isn't duplicated. | 1 hr |

**Total: ~8.5 hours** spread across these phases. Each phase ends with something testable, so we can pause/redirect between any two.

---

## 7. Things explicitly NOT in scope (phase 1)

- **Splitting a single tall block across pages** (e.g. a 2000px image). Block stays whole. If a block is taller than a page, we show a warning chip and let it visually overflow.
- **Different headers/footers per page section** (e.g. "First page different" like Word). All pages share one header and one footer.
- **Margins differ per page**. All pages share the same PDF Settings margins.
- **Drag-drop a block from page 1 to page 5 manually**. Users add to the end of page 1; pagination handles the rest. (Could be added in a phase 2.)

---

## 8. Risks & open questions

| Risk | Mitigation |
|---|---|
| Performance: `balance()` runs on every keystroke | Debounce 150ms. Memoize page heights. |
| Block reorder + balance fighting each other | Reorder operations set a `reordering` lock; balance skips while lock is held. |
| Mirror DOM gets out of sync if master mutation skips a beat | After each pagination cycle, force a one-shot resync of all mirrors. |
| `cs-doc` height is fixed (1123px) but content needs to know how much room it has after header/footer | `availableBodyHeight = 1123 - paddingY*2 - header.offsetHeight - footer.offsetHeight - margins` — measure at runtime. |
| Existing inline-editor.js / Froala features may interfere with mirrors | Mirrors set `contenteditable=false` and explicitly skip Froala init. |

---

## 9. Open questions for you

1. **Should mirrors be visually identical to the master, or slightly faded** (to hint "this is a copy")? Word does fully opaque.
2. **What happens when the user wants page 2 to be a "fresh" page with no header/footer?** (E.g. a full-bleed image cover.) Out of scope phase 1, but worth flagging.
3. **Page numbers** — do you want `Page 1 of 3` placeholders or just `1`, `2`, `3`?
4. **PDF settings panel** — should it show "Total pages: 3" as live info, or stay quiet?

---

## 10. Decision points

After you review this:

- [ ] Approve phases A–G as scoped, or remove/reorder?
- [ ] Confirm "no per-page header overrides" assumption?
- [ ] Confirm "no block splitting" assumption?
- [ ] Answer the 4 open questions above?

Once you sign off, I'll start with **Phase A** (collapse to one iframe) — the safest, smallest change — and stop after that for review before continuing.
