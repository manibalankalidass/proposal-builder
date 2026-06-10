# 📘 Custom Form Editor — Complete Documentation (Tanglish)

> Indha document-a padicha **yaru venalum** indha app epdi work aaguthu nu purinjikalam.
> Drag எங்க irundhu start aaguthu, எங்க pohuthu, drop எங்க land aaguthu, ovvoru
> function enna pannuthu, future-la puthusa onnu add pannanumna enna pannanum —
> ellame inga step-by-step ah irukku.
>
> 🖼️ Flow diagram image: [`docs/flow-diagram.png`](docs/flow-diagram.png) (PNG — எங்கயும் open aagum)
> allathu [`docs/flow-diagram.svg`](docs/flow-diagram.svg) (SVG — zoom panna clear-ah irukkum)

---

## 📑 Contents

1. [App enna pannuthu? (Oru vaarthaila)](#1-app-enna-pannuthu)
2. [Periya padam — 3 pakuthi (Architecture)](#2-architecture)
3. [File Map — ovvoru file-um enna velai](#3-file-map)
4. [Document Model — DOM structure (rombo mukkiyam)](#4-document-model)
5. [Startup Flow — app load aagumbothu enna nadakkuthu](#5-startup-flow)
6. [Drag & Drop — full journey (sidebar → canvas)](#6-drag--drop)
7. [Drop Logic — drop எங்க land aaguthu nu epdi decide pannuthu](#7-drop-logic)
8. [Line Indication — andha blue line எப்படி varudhu](#8-line-indication)
9. [Inline Insert — hover panna varum "+" button](#9-inline-insert)
10. [Block Reorder — already iruka block-a thookki vekrathu](#10-block-reorder)
11. [Column Resize — column width-a maathrathu](#11-column-resize)
12. [Copy / Paste (Ctrl+C / Ctrl+V)](#12-copy--paste)
13. [History — Undo / Redo (Ctrl+Z / Ctrl+Y)](#13-history-undo--redo)
14. [Cleanup — empty column/row-a thaana remove pannrathu](#14-cleanup)
15. [Header / Footer](#15-header--footer)
16. [Multi-page & Page Break](#16-multi-page--page-break)
17. [Data Binding — JSON-a connect pannrathu](#17-data-binding)
18. [Twig Generation — DOM-la irundhu Twig code](#18-twig-generation)
19. [PDF & Twig File Creation — backend logic](#19-pdf--twig-file-creation)
20. [Style Apply — properties panel](#20-style-apply)
21. [⭐ FUTURE: Puthu Block epdi add panrathu](#21-future-puthu-block-add-panrathu)
22. [⭐ FUTURE: Puthu Feature module epdi add panrathu](#22-future-puthu-feature-module)
23. [Quick Reference — important functions & messages](#23-quick-reference)

---

## 1. App enna pannuthu?

Idhu oru **drag-and-drop document/invoice editor**.

- Idathu pakkam (sidebar) la **blocks** iruku — Heading, Text, Image, Table, Section, etc.
- Andha blocks-a **canvas** (oru A4 size paper) mela **drag pannu drop** panrom.
- Block-a click pannina text-a **edit** pannalam (Froala editor), style maathalam.
- JSON data-va block-kooda **bind** pannalam → `{{ customer.name }}` மாதிரி.
- Mudichittu **"Save"** button click panna → **Twig file + HTML + PDF** generate aaguthu.

Simple-ah: **Visual-ah design pannu → Twig template + PDF kedaikum.**

---

## 2. Architecture

App-la **3 periya pakuthi** iruku. Idha purinjika rombo mukkiyam:

```
┌──────────────────────────────────────────────────────────────┐
│  PART 1: ANGULAR SHELL  (src/app/app.ts)                       │
│  - Sidebar (blocks list), Properties panel, Binding modal      │
│  - Save button, PDF settings                                   │
│  - Idhu vெளியே iruku "frame" maathiri                          │
│                                                                │
│   ┌────────────────────────────────────────────────────┐     │
│   │  PART 2: IFRAME — actual CANVAS                       │     │
│   │  (public/custom-form/custom-form.html + js)          │     │
│   │  - Inga thaan drag/drop, edit, block placement ellam │     │
│   │  - Pure JavaScript (Angular illa)                    │     │
│   └────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
                              │
                              │  Save click → twig + data POST
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  PART 3: BACKEND SERVER  (src/server.ts — Express)             │
│  - /api/save-twig-puppeteer endpoint                           │
│  - Twig → PHP render → HTML → PDF                              │
└──────────────────────────────────────────────────────────────┘
```

### Inthe moonu pakuthi epdi pesikuthu? (Communication)

Angular shell-um iframe-um **iru velai different "windows"**. Avanga rendu வழியில் pesikitanga:

**A) `postMessage`** — message anuppurathu (rendu pakkamum):
- Iframe → Parent: `twig:updated`, `selection:changed`, `fields:available`, `binding-modal:open`, `iframe:height` …
- Parent → Iframe: `set-block-style`, `binding-modal:apply`, `set-condition`, `page:add`, `header-footer:toggle` …
- Ellame `source: 'custom-form-twig'` (iframe→parent) allathu `target: 'custom-form-twig'` (parent→iframe) nu tag pannirupanga.

**B) `window.parent` global variables** — drag data + binding data share panna:
- `window.__BROCHURE_FLOW_DRAG__` — ippo enna block drag panranom nu (sidebar drag).
- `window.__BROCHURE_FLOW_BINDING_DATA__` / `__BROCHURE_FLOW_GET_BINDING_DATA__()` — JSON binding data.

> 💡 **Niyabagam vechiko:** "Parent" = Angular shell. "Iframe" = canvas. Reendu pesika
> oru `postMessage` mattum dhaan path. Idha purinja, பாதி confusion poiடum.

---

## 3. File Map

### 🅰️ Angular Shell (vெளியே — parent)

| File | Velai |
|------|-------|
| `src/app/app.ts` (1795 lines) | **Main shell.** Sidebar blocks, dragstart handler, properties panel, binding modal, save/PDF buttons, ellame inga. Iframe-kku message anuppum, iframe-la irundhu message vaangum. |
| `src/app/app.html` / `app.scss` | Shell-oda UI markup + style. |
| `src/app/canvas/canvas.ts` | Iframe-a wrap panra chinna component. |
| `src/server.ts` | **Express backend.** `/api/save-twig`, `/api/save-twig-puppeteer` endpoints. |

### 🅱️ Iframe Canvas — Core JS (`public/custom-form/js/`)

Load order **mukkiyam** (`custom-form.html`-la indha order-la dhaan load aaguthu):

| # | File | Velai (oru line) |
|---|------|------------------|
| 1 | `font-config.js` | Froala-kku fonts setup. |
| 2 | `editor/inline-editor.js` | **Block selection + editing** chrome. Click panna select, double-click panna Froala edit. `window.EditorManager`. |
| 3 | `editor/froala-style-handler.js` | Editing time-la color/font-size apply panna Froala commands. |
| 4 | `block-creator.js` | **Block-oda DOM-a build pannrathu** — Title, Body, Image, Table, Section. `new BlockCreator()`. |
| 5 | `canvas-config.js` | **Settings** — page sizes, row/col gaps, drop sensitivity. `window.CanvasConfig`. |
| 6 | `custom-form.js` | Legacy drop code (off) + **section binding modal** trigger. |
| 7 | `flow/template-data.js` | Predefined ready-made templates HTML. |
| 8 | `flow/block-factory.js` | `FC.createBlock(type)` — type kuduthaa block thiruppi tharum. |
| 9 | `flow/row-col-builder.js` | `makeRow/makeCol/placeBlock` — DOM scaffolding + **block-a place pannrathu**. |
| 10 | `flow/drop-zones.js` | `findDropTarget` — **drop எங்க land aaganum** + blue indicator line. |
| 11 | `flow/col-resize.js` | Column divider-a drag panni resize. |
| 12 | `flow/section-canvas.js` | Old section layout-a one-time migrate panrathu. |
| 13 | `flow/cleanup-observer.js` | **Empty col/row-a thaana neeku.** |
| 14 | `flow/block-reorder.js` | Already iruka block-a grip vechi **thookki vekrathu**. |
| 15 | `flow/field-panel.js` | Selected repeater-oda **bindable fields** list-a parent-kku anuppurathu. |
| 16 | `flow/history-manager.js` | **Undo / Redo** (DOM snapshot). |
| 17 | `flow/inline-insert.js` | Hover panna varum **"+" line + menu**. |
| 18 | `flow/copy-paste.js` | **Ctrl+C / Ctrl+V** block copy. |
| 19 | `flow-canvas.js` (1020 lines) | **ENTRY POINT / orchestrator.** Ellathayum connect pannuthu. Drag/drop listeners, pages, header/footer, postMessage. |
| 20 | `common-twig-generator.js` | **DOM → Twig code** convert pannuthu. |

### 🅲️ Backend Scripts

| File | Velai |
|------|-------|
| `scripts/render_twig.php` | Twig template + JSON data → final HTML (PHP Twig). |
| `scripts/generate_pdf_puppeteer.js` | HTML → PDF (headless Chrome). Header/footer fix, multi-page merge. |

> 🔑 **Naming convention:** `FC` = `window.FlowCanvas`. Ovvoru flow module-um
> `window.FlowCanvas`-la than functions-a podum. Idhu dhaan ellatha connect pannra
> "shared box". Eg: `drop-zones.js` → `FC.findDropTarget`, `row-col-builder.js` →
> `FC.placeBlock`.

---

## 4. Document Model

Canvas-oda DOM structure idhu. Idha purinja ellam puriyum 👇

```
.custom-form-design          ← canvas (oru page wrapper). idhuku class 'cs-flow-canvas' add aaguthu
  └─ .cs-doc[data-page="1"]   ← ORU PAGE (A4 size). page 2,3... extra docs.
       ├─ .cs-row             ← oru horizontal row
       │    ├─ .cs-col        ← row-kkulla oru column (flex width)
       │    │    └─ .cs_block_s   ← ACTUAL BLOCK (heading/text/image/table…)
       │    ├─ .cs-col-divider ← rendu column naduvula resize handle
       │    └─ .cs-col        ← innoru column
       └─ .cs-row             ← innoru row
```

Multi-page-ku:
```
.cs_paper                     ← ellaa pages-um idhukkulla (host HTML-la define aagiruku)
  ├─ .cs_page > .cs-doc[data-page="1"]
  ├─ .cs_page > .cs-doc[data-page="2"]
  └─ ...
```

Header/footer ON aana (default OFF):
```
.cs-doc
  ├─ .cs-row.cs-page-header   ← header (ellaa page-layum same)
  ├─ .body-main-content       ← naduvula main content (rows inga)
  └─ .cs-row.cs-page-footer   ← footer
```

**Mukkiya class names:**
- `.cs_block_s` = oru block (ellame idhu dhaan). Inside-la `.edit_me` (editable text), `.image-container`, `<table>`, `.section-container-content` irukkalam.
- `.cs-flexible-content` / `.section-container-content` = section-oda உள்ளே drop panna idam (nested flow canvas).
- `[data-cs-chrome]` = editor-only decorations (grip, badge, page number) — PDF-la varaadhu, twig-la varaadhu.
- `data-repeat-path`, `data-repeat-alias`, `data-repeat-chain` = binding info (loop).
- `data-twig-if` = condition info ({% if %}).

---

## 5. Startup Flow

App load aagumbothu enna nadakkuthu, order-la:

```
1. custom-form.html load → CSS + scripts load (load order mela paaru)
2. canvas-config.js → window.CanvasConfig set, CSS vars apply (--cs-page-width etc.)
3. block-creator.js → new BlockCreator() ready
4. inline-editor.js → window.EditorManager ready (selection/editing)
5. ovvoru flow/*.js → window.FlowCanvas-la (FC) thanga functions-a register pannum
   (aana INNUM run aagala — vெறும் define mattum)
6. flow-canvas.js (KADAISI, ENTRY POINT) — idhu dhaan ellam start pannuthu:
      a. canvas-a kandupidi (.custom-form-design)
      b. double-init guard (renduvaati run aagaama)
      c. page 1 (.cs-doc) bootstrap
      d. drag/drop listeners attach (paper mela)
      e. FC.initColResize, initFieldPanel, initHistory,
         initInlineInsert, initCopyPaste, initCleanupObserver,
         initBlockReorder — ellam wire pannuthu
      f. overflow observer, height-report observer start
      g. parent-kku initial state message anuppum
7. common-twig-generator.js → DOMContentLoaded-la observer start, first generate()
```

> 💡 **Niyabagam:** flow modules ellam **vெறும் function-a define** pannum (step 5).
> Aana avangala **actual-ah RUN pannrathu** `flow-canvas.js` dhaan (step 6e). So
> entry point = `flow-canvas.js`. Edhachum debug pannumbothu inga irundhu start pannu.

---

## 6. Drag & Drop

Idhu dhaan app-oda **heart**. Sidebar-la irundhu canvas varaikum oru block-oda full journey:

### Step-by-step (sidebar block → canvas-la drop)

```
┌─ PARENT (Angular shell) ──────────────────────────────────────┐
│ 1. User sidebar-la oru block-a drag pannarthu start (dragstart)│
│    → app.ts: onDragStart()                                      │
│    → payload = { blockType: 'heading', label: 'Heading' }      │
│    → event.dataTransfer.setData('application/x-brochure-block') │
│    → window.__BROCHURE_FLOW_DRAG__ = payload  (backup)         │
└────────────────────────────────────────────────────────────────┘
                            │ (mouse iframe-kkulla varuthu)
                            ▼
┌─ IFRAME (flow-canvas.js) ─────────────────────────────────────┐
│ 2. paper 'dragenter' → getDragPayload(event)                  │
│    - dataTransfer-la payload paaru, illana parent global paaru │
│ 3. paper 'dragover' (continuous, mouse nகரும்போது):           │
│    a. findActiveDoc(x,y) → entha page mela iruken              │
│    b. FC.findDropTarget(doc, paper, x, y, blockType)          │
│         → { target, indicator }  ← drop எங்க land aaganum     │
│    c. FC.showIndicator(indicator) → BLUE LINE kaattuthu       │
│    d. paper._pendingDropTarget = target  (drop-la use panna)  │
│ 4. paper 'drop':                                               │
│    a. payload = getDragPayload(event)                          │
│    b. de-dupe check (200ms-kkulla rendu drop aanaa skip)      │
│    c. target = paper._pendingDropTarget                        │
│    d. insertPayloadAtTarget({ payload, activeDoc, target,...}) │
│         → createBlockFromPayload(payload) → FC.createBlock()   │
│         → FC.placeBlock(doc, block, target, x, y, blockType)  │
│         → (repeater-na) showSectionBindingModal()             │
└────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─ AFTER drop (automatic) ──────────────────────────────────────┐
│ 5. MutationObserver-gal trigger aaguthu:                       │
│    - common-twig-generator → twig regenerate → parent-kku send │
│    - history-manager → snapshot save (undo-kku)               │
│    - cleanup-observer → empty col/row irundha neeku           │
│    - block-reorder → puthu block-ku grip handle add           │
└────────────────────────────────────────────────────────────────┘
```

### Mukkiya functions (drag-drop):

- **`app.ts → onDragStart(event, label)`** (parent): drag start aagumbothu payload set pannuthu. `blockTypeFromLabel('Heading')` → `'heading'`. Rendu idathula payload vekkum: `dataTransfer` + `window.__BROCHURE_FLOW_DRAG__`.
- **`flow-canvas.js → getDragPayload(event)`**: payload-a edukkuthu. Mudhalla `dataTransfer`, illana `window.parent.__BROCHURE_FLOW_DRAG__`.
- **`flow-canvas.js → findActiveDoc(x, y)`**: multi-page-la entha page mela mouse iruken nu kandupidikkuthu.
- **`flow-canvas.js → insertPayloadAtTarget({...})`**: block create panni place pannra wrapper. Page-break special case inga handle aaguthu.
- **`flow-canvas.js → createBlockFromPayload(payload)`**: `FC.createBlock(type)` call pannuthu, fa-icon-na icon class set pannuthu.

> ⚠️ **Yen rendu idathula payload?** Some browsers / iframe security-la `dataTransfer`
> read panna mudiyaadhu. Adhanaala `window.__BROCHURE_FLOW_DRAG__` nu oru backup
> global vekrom. Rendulayum try pannrom.

---

## 7. Drop Logic

`flow/drop-zones.js → findDropTarget()` dhaan **drop எங்க land aaganum** nu decide pannuthu. Idhu romba mukkiyam.

### 4 vகை drop "kind":

| kind | Eppo? | Enna aaguthu |
|------|-------|--------------|
| `between-rows` | Mouse rendu row naduvula / page edge-la | **Puthu row** create aagi, adhukkulla col + block. |
| `col-edge` | Mouse oru column-oda edge (left/right) pakkam (24px-kkulla) | Andha row-la **puthu column** add aaguthu (side by side layout). |
| `in-col` | Mouse oru column-oda nadula | Andha column-kkulla, vேற blocks naduvula block insert. |
| `in-section` | Mouse oru section-oda உள்ளே | Section-a oru nested canvas maathiri treat panni, அதே logic. |

### Decision logic (epdi decide pannuthu):

```
findDropTarget(doc, canvas, x, y):
  1. findSectionUnderCursor() → mouse oru section mela irundha,
     andha section-a "root" aakku (nested canvas).
  2. illana root = doc. (header/footer ON-na, entha region nu check)
  3. root-oda rows-a edu.
  4. NO rows? → between-rows (first block).
  5. Mouse first row-oda mela edge-la? (top + 12px) → between-rows (mela insert).
  6. Mouse last row-oda keezha edge-la? → between-rows (keezha insert).
  7. Rendu rows naduvula gap-la? → between-rows (naduvula insert).
  8. Mouse oru row-oda உள்ளே? → findColTarget(row, x, y):
       - column edge pakkam? → col-edge (puthu column)
       - illana → findInColTarget(col, y) → in-col (blocks naduvula)
```

`ROW_EDGE_GAP = 12px`, `COL_EDGE_GAP = 24px` (canvas-config.js-la maathalam).

### Place pannrathu — `row-col-builder.js → placeBlock()`:

`findDropTarget` enna kuduthuchaa, adhuku thகுந்த மாதிரி DOM-la add pannuthu:

```
placeBlock(doc, block, target, x, y, blockType):
  - kind 'between-rows' → makeRow() + makeCol(), col-la block, row-a doc-la add
       (target.beforeRow irundha adhukku munnaadi, illana kadaisila)
  - kind 'col-edge'    → makeCol(), block-a podu, target.row-la add, rebuildDividers()
  - kind 'in-col'      → block-a direct target.col-la add
                          (target.beforeBlock irundha adhukku munnaadi)
  - Flexible container-na → absolute position (free placement)
```

> 💡 **Section = nested canvas.** Munnaadi section-la blocks absolute-ah (free)
> irundhuchu. Ippo section-um doc maathiri row/col flow. Adhanaala table romba
> rows aana section-um valarum (clip aagaadhu). `section-canvas.js` old format-a
> oru thadava migrate pannuthu.

---

## 8. Line Indication

Drag pannumbothu varum andha **blue line** = "block inga land aagum" nu kaattuthu.

- `drop-zones.js → showIndicator(hint)` — `document.body`-la oru `.cs-drop-indicator` div create panni position panuthu.
- 3 vகை:
  - `horizontal` → padukai line (between-rows / in-col).
  - `vertical` → nilavu line (col-edge — puthu column).
  - `flexible-highlight` → section-oda முழு area-vum light highlight (line illa).
- `hideIndicator()` — line-a maraikkuthu (drop / dragleave time).

`indicator` object-la coordinates (top, left, right/bottom) varuthu, adha vechi line-a position pannuthu.

---

## 9. Inline Insert

Block illama, **mouse-a canvas mela hover pannina** oru `+` button + line varum. Click panna block picker menu open aagi block insert pannalam. (Drag panna theveyilla.)

- File: `flow/inline-insert.js`, init: `FC.initInlineInsert(canvas)`.
- `pointermove`-la `refreshHover(x, y, target)`:
  - hovered column irundha `resolveColEdge` / `resolveInColTarget`, illana `FC.findDropTarget` use pannuthu.
  - `computeGeometry()` → line எங்க varanum nu calculate.
  - `showVisuals(geometry)` → `+` button + line kaattuthu.
- `+` click → menu (`INLINE_LIBRARY` — Heading, Text, Image…) open.
- Menu-la oru item click → `chooseItem()` → `FC.insertPayloadAtTarget()` (drag-drop-oda அதே path!).
- Toggle: parent `inline-insert:toggle` message anuppi ON/OFF pannalam.

> 💡 **Reuse:** inline-insert-um, drag-drop-um, copy-paste-um **ellame** `FC.placeBlock`
> / `FC.insertPayloadAtTarget` dhaan use pannuthu. Adhanaala drop logic ஒரே இடத்துல.

---

## 10. Block Reorder

Already canvas-la iruka block-a **grip handle (⋮⋮) vechi thookki வேற இடத்துல** vekrathu.

- File: `flow/block-reorder.js`, init: `FC.initBlockReorder(canvas, doc)`.
- **Yen native HTML drag illa?** Native drag, Froala/inline-editor-oda pointerdown-kooda fight pannum. Adhanaala raw `pointerdown/move/up` use pannrom.
- Ovvoru top-level block-kum `.cs-block-grip` (6-dot icon) add aaguthu (hover-la dhaan theriyum). `ensureGripsOnAll()` + MutationObserver.
- Flow:
  ```
  pointerdown grip mela → drag start, block 40% transparent
  pointermove → FC.findDropTarget() → showIndicator() (drag-drop-oda அதே)
  pointerup → block.remove() → FC.placeBlock(doc, block, target)
  Escape → cancel
  ```

---

## 11. Column Resize

Rendu column naduvula iruka **divider-a drag panni** column width maathuradhu.

- File: `flow/col-resize.js`, init: `FC.initColResize(canvas)`.
- `pointerdown` on `.cs-col-divider` → capture phase (inline-editor-kku munnaadi run aaganum).
- Drag pannumbothu: `prevCol` + `nextCol`-oda combined width same-ah irukkum, divider நகர்ந்த அளவுக்கு width பகிரும்.
- `COL_MIN_WIDTH = 60px` — idhuku keezha shrink aagaadhu.

---

## 12. Copy / Paste

**Ctrl+C** → select panna block copy. **Ctrl+V** → அதே column-la, kீழே paste.

- File: `flow/copy-paste.js`, init: `FC.initCopyPaste(canvas)`.
- `copySelected()` — `EditorManager.getSelected()` block edukum → `cleanClone()` (chrome, selected/editing class neekum) → `clipboardHtml`-la outerHTML store.
- `pasteBlock()` — `buildPasteBlock()` (puthu HTML element) → `regenerateIds()` (**duplicate id varaama** ellaa id-um புதுசா) → `resolvePasteTarget()` → `FC.placeBlock()`.
- **Paste எங்க land aaguthu?**
  - Select panna block-oda row-la **multiple columns** → அதே column-la kீழே.
  - **Single column** → andha row-kku kீழே **புது row**.
  - Onnum select pannala → doc kadaisila புது row.
- Text edit pannumbothu (Froala active) → native copy/paste-ku vidum (intercept pannaadhu).

> ⚠️ **`regenerateIds` mukkiyam.** Copy panna id-um copy aagum → duplicate id →
> inline-editor / Froala confuse aagum. Adhanaala paste-la ellaa id-um புதுசா
> generate pannrom.

---

## 13. History (Undo / Redo)

**Ctrl+Z** = undo, **Ctrl+Y** (allathu Ctrl+Shift+Z) = redo.

- File: `flow/history-manager.js`, init: `FC.initHistory(canvas)`.
- **Technique: DOM snapshot.** Command-pattern illa — `canvas.innerHTML`-a முழுசா snapshot edukurom.
  - **Yen?** Mutation panra இடங்கள் (placeBlock, page split, binding apply, reorder, cleanup…) நிறைய இடத்துல iruku. Ovvonnayum instrument panna miss aagi undo break aagum. DOM-a observe panna **ellaa change-um** automatically capture aaguthu.
- Flow:
  ```
  MutationObserver (childList + select attributes) → change vandha
  → scheduleCommit() (300ms debounce — oru action-oda பல mutations ஒரே entry)
  → commit() → past[] stack-la snapshot push
  Undo → present-a future[] push, past[]-la irundhu pop → restore(html)
  Redo → past[] push, future[]-la irundhu pop → restore(html)
  ```
- `suspended` flag — restore pannumbothu observer record pannaama irukku (loop varaama).
- **Text edits track pannaadhu** — Froala-ku adhukku சொந்த undo iruku. `characterData` + style/class mutations ignore.
- `HISTORY_LIMIT = 50` snapshots.

> 💡 **Idhu purinjikanum:** undo "DOM-a பழைய HTML-ku மாத்துறது" mattum dhaan. So
> oru change undo-la varanum-na, adhu **DOM structure-a maathra mாதிரி** irukkanum
> (childList allathu watched attributes). Vெறும் inline style change-a undo-la
> varaadhu (intentional).

---

## 14. Cleanup

Block delete aanaa, **empty column / row-a thaana** neekuthu.

- File: `flow/cleanup-observer.js`, init: `FC.initCleanupObserver(doc)`.
- MutationObserver — block remove aana `cleanupEmpty(doc)` run aagum:
  - Content illaa column → remove.
  - Column remove aana → `rebuildDividers()` + `resetColFlex()` (மீதி columns width-a பகிர்ந்துக்கும்).
  - Column-e illaa row → row remove.
- Doc + ellaa `.section-container-content` / `.body-main-content`-um clean pannuthu.

---

## 15. Header / Footer

> ⚠️ **Default-la OFF.** `flow-canvas.js`-la `ENABLE_HEADER_FOOTER = false`. Parent
> `header-footer:toggle` message anuppi ON pannalam.

- ON aana ovvoru `.cs-doc`-kum `makeRegion('header')` + `makeRegion('footer')` create aagum (default-la image + text columns).
- Structure: `header` (top) → `body-main-content` (naduvula) → `footer` (kீழே). `wireRegionOrderObserver` idha order-la vச்சிkkum.
- **Sync across pages:** oru page-la header/footer edit pannina, `syncRegion()` மற்ற ellaa page-kum copy pannum (400ms debounce, allathu focus poona udane). `rewriteIds()` — id duplicate aagaama ஒவ்வொரு page-kum unique.
- Edit: header/footer-a **double-click** panna active aagum (`setRegionActive`).
- Double-click → `dblclick` listener → `editing-header`/`editing-footer` class.

**PDF-la header/footer:** `generate_pdf_puppeteer.js → restructureDocsForPrint()` — header-a `position:fixed top`, footer-a `position:fixed bottom` pannuthu. Naduvula content slide aagaama thead/tfoot spacer வைக்குது. (Idhu single-page-la dhaan சரியா varum, adhanaala multi-page-a தனித்தனியா render panni merge pannrom — keezha paaru.)

---

## 16. Multi-page & Page Break

### Pages add/remove:
- `FC.addPage({ headerFooter })` — புது `.cs-doc` create, `renumberPages()`.
- `FC.removePage(docEl)` — page 1-a remove panna mudiyaadhu.
- Parent `page:add` / `page:remove` message anuppalam.

### Page Break block:
- User "Page Break" block drop panna → `insertPayloadAtTarget`-la special case.
- `FC.splitPageAt(doc, breakBlock)`:
  - break-ku **அப்புறம் iruka ellaa rows-ayum** edu.
  - break marker-a remove pannu.
  - புது page create panni andha rows-a அங்க move pannu.
- Result: content இரண்டு page-la flow aagum.

### A4 overflow indicator:
- `updateOverflowMarks()` — oru page-oda content A4 height (1123px) தாண்டினா, dashed mark + "drag a Page Break here" hint kாட்டும்.
- `measureContentBottom()` — content உண்மையில் எவ்வளவு உயரம் என்று அளக்கும்.
- Split panrathu **user choice** — naama auto split pannala.

### Iframe height:
- `reportHeight()` — ellaa pages-oda total height-a parent-kku `iframe:height` message-ah anuppum → parent iframe-a அந்த height-ku grow pannum (scroll illama ellaa page-um theriyum).

---

## 17. Data Binding

JSON data-va block-kooda connect pannrathu. Eg: `{% for item in invoice.items %} {{ item.name }} {% endfor %}`.

### Binding data எங்க இருந்து வருது?
- Parent (Angular) `window.__BROCHURE_FLOW_BINDING_DATA__` allathu `__BROCHURE_FLOW_GET_BINDING_DATA__()`-la JSON-a vச்சிrukkum.
- Iframe `getParentBindingData()` (custom-form.js) / `getBindingData()` (field-panel.js) idha read pannuthu.

### Binding Modal (repeater drop panna):
- Section/Table/List repeater drop panna → `showSectionBindingModal(block)` (custom-form.js).
- Idhu parent-kku `binding-modal:open` message anuppum (modal UI parent-la — full page cover panna).
- Detected arrays:
  - Block oru repeater-oda **உள்ளே** → `FC.computeScopedArrays()` (ancestor loop-ku relative).
  - Root-la → `FC.buildRootArrayTree()` (ellaa nested arrays-um).
- User array select panni "Apply" → parent `binding-modal:apply` message → `common-twig-generator.js` block-la `data-repeat-path`, `data-repeat-alias`, (nested-na) `data-repeat-chain` set pannum.

### Fields Panel (block select panna):
- `flow/field-panel.js` — selected repeater block-ku எந்த fields bind pannalam (`{{ alias.field }}`) nu list panni parent-kku `fields:available` message anuppum.
- `findRepeaterChain(block)` — block-oda mela ellaa ancestor repeater-ayum சேகரிக்கும் (nested loops-ku).
- `resolveChainSample()` — real data-va vச்சி oru iteration எப்படி இருக்கும் nu sample edukum → fields list.

### Conditions:
- `data-twig-if` attribute → `{% if %}` block. Table cell/row-kum condition vekkalam (`data-twig-if` on `<tr>/<td>`).

---

## 18. Twig Generation

`common-twig-generator.js` — canvas-oda DOM-a paathu **Twig template code** generate pannuthu. Idhu romba clever, so கவனமா.

### Eppo run aaguthu?
- MutationObserver — canvas-la edhachum change aana `generate()` run (requestAnimationFrame throttle).
- `generate()` → ஒவ்வொரு page canvas-kum `generateForCanvas()` → join → parent-kku `twig:updated` message.

### `generateForCanvas(canvas)` logic:

```
1. Ellaa blocks-kum temp id (data-twigId) podu.
2. Blocks-a DEEPEST-FIRST sort pannu (உள்ளே block முதல்ல process aaganum).
3. ஒவ்வொரு block-kum:
   a. stripChrome() — clone edu, chrome/selected class neeku.
   b. உள்ளே iruka sub-blocks-a comment marker-ah replace (recursion).
   c. <tr>/<td> data-twig-if → {% if %} marker.
   d. outerHTML edu, markers-a actual block twig-ah replace.
   e. data-repeat-path/alias/chain → {% for %} loop wrap.
        - Table-na: <tbody> mattum loop (thead header ஒரு தடவை).
          (Aana thead-la alias/loop. reference irundha முழு table-um loop.)
        - Non-table loop → DEFER (finalisation-la decide panrom).
   f. data-twig-if → {% if %} wrap.
   g. blockTwigMap-la store.
4. Canvas முழுசா clone, blocks-a markers-ah replace.
5. DEFERRED loops-a "hoist" pannu:
     - Block தனியா oru row/col-la irundha, loop-a ROW level-ku hoist
       (ஒவ்வொரு iteration-um புது row, duplicate id varaama).
6. Final HTML-la markers → {% for %}/{% if %}/{% endfor %} replace.
7. data-* custom attributes ellam clean pannu.
8. Final twig string return.
```

### Mukkiya concepts:
- **Deepest-first:** உள்ளே block-a முதல்ல twig-ah maathi, comment marker-ah parent-la replace pannrom. Idhu nesting-a சரியா handle pannuthu.
- **tbody-only loop:** table loop panna header ஒரே தடவை, data rows mattum repeat.
- **Loop hoisting:** loop-a block level-la podaama, அந்த block தனியா இருக்கிற row level-ku நகர்த்தறோம் — அப்போ ஒவ்வொரு iteration-um முழு row/col stack, duplicate id problem இல்ல.
- **Chain dedup:** child block-oda chain-la, ancestor ஏற்கனவே loop பண்ண steps-a நீக்குறோம் (duplicate nested loops varaama).

### Output example:
```twig
<div class="cs-row">
  {% for item in invoice.items %}
  <div class="cs-col"><div class="cs_block_s">{{ item.name }}</div></div>
  {% endfor %}
</div>
```

---

## 19. PDF & Twig File Creation

Save click panna backend-la nadakkurathu. Full pipeline:

```
┌─ PARENT (app.ts) ─────────────────────────────────────────────┐
│ 1. User "Save" click                                           │
│ 2. twigCode = கடைசியா வந்த twig (twig:updated message-la)     │
│ 3. bindingData = JSON                                          │
│ 4. pdfSettings = { pageSize, margins }                         │
│ 5. POST /api/save-twig-puppeteer { twigCode, bindingData,...} │
└────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─ SERVER (src/server.ts) ──────────────────────────────────────┐
│ 6. generated/generate_<date>_<n>/ folder create               │
│ 7. wrapTwigTemplate() → twig-a முழு HTML doc-la wrap          │
│    → generated_twig.php  எழுது                                 │
│ 8. binding_data.json எழுது                                     │
│ 9. php render_twig.php <php> <json> > generated.html           │
│      (Twig template + data → final HTML)                      │
│ 10. node generate_pdf_puppeteer.js <html> <pdf>               │
│      (env-la PDF_PAGE_SIZE, margins)                          │
│ 11. response: { pdfUrl }                                       │
└────────────────────────────────────────────────────────────────┘
```

### `render_twig.php`:
- PHP Twig library (`vendor/twig`) use pannuthu.
- Template (`tpl`) + JSON data → `$twig->render('tpl', $data)` → final HTML stdout.
- `autoescape: false` (HTML-a escape pannaama output panna).

### `generate_pdf_puppeteer.js`:
- **Yen puppeteer, wkhtmltopdf illama?** wkhtmltopdf-oda WebKit (2014) flexbox/CSS-vars-a சரியா render பண்ணாது. Puppeteer = real headless Chrome → browser-la எப்படி theriyutho அப்படியே PDF.
- `PRINT_OVERRIDES_CSS` — editor-oda fixed height/overflow:hidden-a remove pannuthu (content flow aaganum), chrome (border/shadow/page-number) neekuthu, ஒவ்வொரு `.custom-form-design`-um புது sheet-la start aagum (`break-before: page`).
- `restructureDocsForPrint()` — header `fixed top`, footer `fixed bottom`, table thead/tfoot spacer.
- **Multi-page:** `position:fixed` ஒரே page-la dhaan சரி. So பல page இருந்தா — ஒவ்வொரு page-ayum **தனியா** render panni (மற்றதை remove panni), அப்புறம் `pdfunite` (poppler) வச்சி merge pannrom.
- Page size: `PDF_PAGE_SIZE` env (A4/Letter/landscape) → `PAGE_SIZE_MAP` + `VIEWPORTS`.

### Output files (`generated/generate_<date>_<n>/`):
- `generated_twig.php` — twig template (HTML-la wrap).
- `binding_data.json` — data.
- `generated.html` — rendered HTML.
- `generated.pdf` — final PDF.

> 📦 **Theve (dependencies):** `php` + Twig (composer), `node` + `puppeteer`,
> `pdfunite` (poppler — multi-page merge-kku). `/api/save-twig` (புராண endpoint)
> `wkhtmltopdf` use pannuthu, aana `/api/save-twig-puppeteer` dhaan recommended.

---

## 20. Style Apply

Block select panna properties panel-la color/font/border maathalam.

- Parent panel-la maathina → `set-block-style` message → iframe.
- 2 idathula handle aaguthu:
  - `flow-canvas.js` — layout props (layoutColumns, sectionColor) + editing-time Froala commands.
  - `common-twig-generator.js` — textColor/fontSize/fontWeight (inner `.edit_me`-la) + மற்ற styles (block-la `!important`).
- Block edit pannumbothu (Froala active) → `froala-style-handler.js` commands (color/fontSize/fontWeight selected text-ku).
- Block select aana → `broadcastSelection()` → parent-kku `selection:changed` (current styles உடன்) → panel update.
- Style read: `readBlockStyles()` (StyleManager allathu fallback, RGB→Hex convert).

---

## 21. ⭐ FUTURE: Puthu Block add panrathu

Niyabagam vச்சிko: puthu block add panna **3-4 idam** mattum thொடணும். Step-by-step:

### Step 1 — Sidebar-la add (parent)
`src/app/app.ts`-la sidebar blocks list-la புது item add pannu (label + icon). `blockTypeFromLabel()`-la label → blockType mapping சரியா இருக்கணும் (eg `'My Block'` → `'my-block'`).

### Step 2 — Block factory-la create logic (iframe)
`public/custom-form/js/flow/block-factory.js`-la `FC.createBlock()` switch-la புது case add:
```js
case 'my-block': return createMyBlock();
```
Mela maathiri `createMyBlock()` function எழுது. **Mukkiyam:**
- `makeCsBlock('My Block', 'my-block', 'cs-my-block')` use pannu → `.cs_block_s` wrapper kedaikum (inline-editor automatic-ah handle pannum).
- Editable text venumna `<div class="edit_me" id="dynamic_${hash()}">` add pannu.
- `block.dataset.blockType = 'my-block'` set aagum (makeCsBlock-la).

### Step 3 — Inline insert menu-la add (optional)
`flow/inline-insert.js`-la `INLINE_LIBRARY` array-la item add pannu (hover "+" menu-la varum).

### Step 4 — Complex DOM-na BlockCreator-la (optional)
Table/Section maathiri complex block-na `block-creator.js`-la `createXxxBlock()` method எழுதி, block-factory அதை call பண்ணும்.

### Step 5 — Style props (optional)
`app.ts`-la `blockStyleConfig`-la அந்த blockType-ku எந்த properties panel-la காட்டணும் nu add pannu.

### Verify:
1. `npm start` (allathu dev server) → app open.
2. Sidebar-la புது block drag → canvas-la drop → சரியா varudhா paaru.
3. Block select → edit/style work aaguthா.
4. Save → twig + PDF-la சரியா varudhா paaru.

> ✅ **Test pannina path:** Block drop → DOM-la `.cs_block_s` add aaguthா → twig
> generate aaguthா → PDF-la varudhா. Indha 3-um சரின்னா block ready.

> ⚠️ **Adikkadi miss aaguthu:** `dataset.blockType` set pannaama vittா, panel +
> binding miss aagum. `makeCsBlock` use panna adhu auto set aagum. Editable text-ku
> `class="edit_me"` + unique `id` கட்டாயம்.

---

## 22. ⭐ FUTURE: Puthu Feature module

Drag/resize/shortcut maathiri புது feature add panna:

### Step 1 — புது file create
`public/custom-form/js/flow/my-feature.js`:
```js
(function () {
  window.FlowCanvas = window.FlowCanvas || {};
  window.FlowCanvas.initMyFeature = function (canvas) {
    if (canvas.dataset.myFeatureInit === '1') return; // double-init guard
    canvas.dataset.myFeatureInit = '1';
    // ... உன் logic இங்க (event listeners, observers, etc.)
  };
})();
```

### Step 2 — HTML-la script add
`public/custom-form/custom-form.html`-la `flow-canvas.js`-kku **முன்னாடி** add pannu:
```html
<script src="./js/flow/my-feature.js"></script>
```

### Step 3 — flow-canvas.js-la init call
`flow-canvas.js`-la மற்ற init-கள் இருக்கிற இடத்துல:
```js
FC.initMyFeature?.(canvas);
```
Per-page feature-na `wireDocFeatures(docEl)`-la podu (புது page-kum apply aagum).

### Conventions follow pannu:
- Ellame `window.FlowCanvas` (FC)-la pottு share pannu.
- Drop target venumna `FC.findDropTarget` + `FC.placeBlock` reuse pannu (புதுசா எழுதாதே).
- Indicator venumna `FC.showIndicator/hideIndicator`.
- Chrome (decorations) add panna `data-cs-chrome` attribute podu → twig/PDF/history-la skip aagum.
- Double-init guard (`dataset.xxxInit`) கட்டாயம்.

---

## 23. Quick Reference

### `window.FlowCanvas` (FC) — important functions

| Function | File | Velai |
|----------|------|-------|
| `createBlock(type)` | block-factory.js | Type → block element |
| `placeBlock(doc, block, target, x, y, type)` | row-col-builder.js | Block-a DOM-la place |
| `findDropTarget(doc, canvas, x, y, type)` | drop-zones.js | Drop எங்க land aaganum |
| `showIndicator / hideIndicator` | drop-zones.js | Blue line |
| `makeRow / makeCol / rebuildDividers` | row-col-builder.js | DOM scaffolding |
| `addPage / removePage / splitPageAt` | flow-canvas.js | Pages |
| `undo / redo / suspendHistory` | history-manager.js | History |
| `initCopyPaste / initColResize / ...` | (respective) | Feature init |
| `computeScopedArrays / buildRootArrayTree` | field-panel.js | Binding arrays |

### postMessage — Iframe → Parent (`source: 'custom-form-twig'`)

| type | Eppo |
|------|------|
| `twig:updated` | DOM change aana, புது twig |
| `selection:changed` / `selection:cleared` | Block select/deselect |
| `fields:available` / `fields:cleared` | Repeater fields list |
| `binding-modal:open` | Binding modal open pannu |
| `table-target:changed` | Table cell click |
| `iframe:height` | Iframe height resize |

### postMessage — Parent → Iframe (`target: 'custom-form-twig'`)

| type | Velai |
|------|-------|
| `set-block-style` | Style apply |
| `binding-modal:apply` | Binding select aana |
| `set-condition` | {% if %} set |
| `set-table-border-params` | Table border |
| `page:add` / `page:remove` | Pages |
| `header-footer:toggle` | Header/footer ON/OFF |
| `page-size:change` / `page-bg:change` / `page-margins:change` | Page settings |
| `inline-insert:toggle` | "+" insert ON/OFF |

### Global variables (parent window)

| Variable | Velai |
|----------|-------|
| `__BROCHURE_FLOW_DRAG__` | Current drag payload |
| `__BROCHURE_FLOW_BINDING_DATA__` | JSON binding data |
| `__BROCHURE_FLOW_GET_BINDING_DATA__()` | Binding data getter |

### Key CSS classes

| Class | Enna |
|-------|------|
| `.custom-form-design` | Canvas (page wrapper) |
| `.cs-doc` | Oru A4 page |
| `.cs-row` / `.cs-col` / `.cs-col-divider` | Layout |
| `.cs_block_s` | Block (ellame idhu) |
| `.edit_me` | Editable text |
| `.section-container-content` / `.cs-flexible-content` | Section (nested canvas) |
| `[data-cs-chrome]` | Editor-only (PDF/twig-la varaadhu) |
| `.cs-drop-indicator` | Blue drop line |
| `.cs-block-grip` | Reorder handle |

---

## 🎯 Mudivu (Summary)

- **3 parts:** Angular shell (vெளியே) ↔ iframe canvas (உள்ளே) ↔ Express backend.
- **Entry point:** `flow-canvas.js` — ellatha connect pannuthu.
- **Shared box:** `window.FlowCanvas` (FC) — ellaa module-um இங்க functions podum.
- **Drag flow:** sidebar dragstart → getDragPayload → findDropTarget → showIndicator → drop → createBlock → placeBlock.
- **Drop logic:** `findDropTarget` 4 kinds decide pannuthu (between-rows/col-edge/in-col/in-section).
- **Reuse:** drag, inline-insert, copy-paste, reorder ellame ஒரே `placeBlock` use pannuthu.
- **Twig:** `common-twig-generator` DOM → twig (deepest-first, loop hoisting).
- **PDF:** twig → PHP render → HTML → puppeteer → PDF (multi-page merge).
- **Future block:** sidebar + block-factory + (inline-insert) — 3 idam.

Indha document-a vச்சி எந்த feature-ayum confidence-ah தொடலாம். 🚀
