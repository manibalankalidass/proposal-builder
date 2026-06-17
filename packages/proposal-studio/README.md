# proposal-studio

A **framework-agnostic** visual form / proposal / brochure editor, shipped as a
standard **Web Component** (`<proposal-studio>`). Drag-and-drop blocks, rich-text
editing, tables, repeaters, vector shapes, multi-page PDF layout, templates and
real-time collaboration — all in one custom element.

Because it is a Web Component, it works **natively in every framework**:

| Environment            | Supported |
| ---------------------- | --------- |
| Angular 7 → 22+        | ✅        |
| React 16 → 19          | ✅        |
| Vue 2.7 / 3            | ✅        |
| Svelte / SolidJS       | ✅        |
| Plain HTML (no build)  | ✅        |

This is the **complete editor UI** — top toolbar, left component palette
(Templates / History), the canvas, and the right Properties / Data Binding /
Style panels — bundled into one self-contained document. The whole thing runs
inside an isolated, same-origin `iframe`, so its internal Angular runtime /
globals **never collide** with your host app (which can be a different Angular
version, React, Vue, …), and you can mount **multiple editors** on one page.

> **Sizing:** the editor is a full app with its own internal scrolling, so give
> it a height — e.g. `<proposal-studio style="height:90vh">`. It defaults to
> `720px` if you don't.
>
> **Bundle size:** ~1.3 MB (≈300 KB gzipped) because it ships the full editor
> application. It loads lazily inside the iframe and never touches your app's
> bundle.

---

## Live Demo

**Try it instantly — no install, no sign-up:**

👉 **[proposal-studio live demo](https://proposal-builder-mani.vercel.app/)**

The demo runs the full editor in the browser. You can drag blocks, edit rich text,
resize images, draw shapes, use zoom shortcuts, and measure distances between
elements — everything described below works live.

---

## Install

```bash
npm install proposal-studio
```

Or use it straight from a CDN, no build step:

```html
<script src="https://unpkg.com/proposal-studio"></script>
```

---

## Quick start (plain HTML)

```html
<proposal-studio id="editor" style="display:block;min-height:600px"></proposal-studio>

<script type="module">
  import 'proposal-studio';

  const editor = document.getElementById('editor');
  editor.addEventListener('ready', () => {
    editor.loadTemplate('<h1>Hello 👋</h1><p>Edit me.</p>');
  });
  editor.addEventListener('change', (e) => {
    console.log('html length:', e.detail.html.length);
  });
</script>
```

## React

```jsx
import { useEffect, useRef } from 'react';
import 'proposal-studio';

export function Editor({ value, onChange }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    const h = (e) => onChange?.(e.detail.html);
    el.addEventListener('change', h);
    el.whenReady().then(() => value && el.setHtml(value));
    return () => el.removeEventListener('change', h);
  }, [value, onChange]);
  return <proposal-studio ref={ref} style={{ display: 'block', minHeight: 600 }} />;
}
```

## Vue 3

```vue
<template><proposal-studio ref="el" /></template>
<script setup>
import { ref, onMounted } from 'vue';
import 'proposal-studio';
const el = ref(null);
onMounted(() => el.value.addEventListener('change', (e) => console.log(e.detail.html)));
</script>
```

In `vite.config.js`, mark it a custom element:

```js
vue({ template: { compilerOptions: { isCustomElement: (t) => t === 'proposal-studio' } } })
```

## Angular (7 → 22+)

```ts
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import 'proposal-studio';

@Component({
  standalone: true,                 // omit on Angular 7–14
  schemas: [CUSTOM_ELEMENTS_SCHEMA], // the one required line
  template: `<proposal-studio (change)="onChange($event)"></proposal-studio>`,
})
export class EditorComponent {
  onChange(e: Event) { console.log((e as CustomEvent).detail.html); }
}
```

On Angular 7–14 add `CUSTOM_ELEMENTS_SCHEMA` to your `@NgModule` instead.

See [`examples/`](./examples) for complete, copy-pasteable wrappers for each
framework.

---

## Features

### Custom Rich Text Editor (no licence required)

The editor ships a **built-in, dependency-free rich-text engine** (`CustomRichEditor`)
that replaces the commercial Froala editor. No CDN calls, no third-party licence.
The engine is controlled by a single flag in `canvas-config.js`:

```js
// canvas-config.js
editor: {
  useFroala: false,   // default — uses the built-in CustomRichEditor
  // useFroala: true  // opt back in to Froala (requires a Froala licence)
}
```

**`useFroala: false` (default)** — fully self-contained:
- Bold · italic · underline · strikethrough · subscript · superscript
- Heading styles (H1–H6, applied inline so only the selected run is styled)
- Font family · font size · line height · letter spacing
- Text case (UPPER / Capitalize / lower / as-typed)
- Text colour · highlight colour
- Align left / center / right / justify
- Ordered / unordered lists · outdent / indent
- Insert / edit / remove links
- Clear formatting · undo / redo
- Toolbar placement: **inline** (floats above the active block) or **docked**
  (sticky strip pinned to the top of the canvas — toggled from Page Settings)

**`useFroala: true`** — reverts to the legacy Froala engine (commercial licence
required; jQuery + Font Awesome loaded from CDN).

### Figma-style Distance Measurement

Hold **Ctrl** (or **⌘** on Mac) while hovering another free-positioned block to
see the pixel gap between the two elements — exactly like Figma's measure mode:

- Selected block gets a solid reference outline
- Hovered block gets a dashed marching-ants outline
- Red measurement lines + px value badges appear between them
- **Smart geometry:** side-by-side → horizontal gap; stacked → vertical gap;
  diagonal → both gaps + dotted extension lines; overlapping → four inset distances

The overlay is editor-only chrome and never appears in the exported HTML/PDF.

### Canvas Zoom Shortcuts

Ctrl/⌘ + `+` / `-` / `0` zoom the canvas regardless of where focus sits — even
when the cursor is inside the editor iframe (where the browser would otherwise
hijack the shortcut for page zoom):

| Shortcut                  | Action       |
| ------------------------- | ------------ |
| `Ctrl / ⌘  +` or `=`     | Zoom in      |
| `Ctrl / ⌘  -`             | Zoom out     |
| `Ctrl / ⌘  0`             | Reset to 100%|
| `Ctrl / ⌘  + mouse wheel` | Zoom in/out  |

The zoom label in the toolbar stays in sync in real time.

### Inline Block Insert (`+` button)

A hover-activated **`+`** button appears on the left edge of the current
insertion line in flow-canvas mode. Clicking it opens a block picker and inserts
the chosen block at that exact position — the same create/place path used by
sidebar drag-and-drop.

### Rulers and Alignment Guides

Horizontal and vertical rulers line the canvas edge. Drag from either ruler to
create a **draggable alignment guide** that snaps blocks during positioning.
Toggle the feature via the `EditorFeatures.rulersGuides` flag:

```js
window.EditorFeatures = { rulersGuides: false }; // hide rulers + guides
```

### Image Cropper

Double-click an image block to enter crop mode — drag the crop handles to trim
the image, then confirm. The original asset is preserved; the crop is applied as
CSS `object-fit` / `object-position`, so re-cropping is always non-destructive.

### Image Frame Shape Picker

Images can be masked into custom shapes (circle, rounded rectangle, polygon,
star, and more) using the frame shape picker in the right Properties panel.
Switching shapes re-applies the mask without disturbing the image or crop state.

### Feature Flags

Every major sub-feature can be switched off without touching editor code:

```js
// Set BEFORE the editor loads (e.g. in a <script> tag before the import).
window.EditorFeatures = {
  rulersGuides:    false, // hide rulers + guides
  measureDistance: false, // disable Figma-style distance overlay
  zoomShortcuts:   false, // disable Ctrl/⌘ zoom keyboard shortcuts
};
```

---

## API

### Properties

| Property          | Type              | Description                                  |
| ----------------- | ----------------- | -------------------------------------------- |
| `value`           | `string`          | Get/set the canvas HTML.                     |
| `ready`           | `boolean`         | `true` once the engine has booted.           |
| `contentWindow`   | `Window \| null`  | The editor iframe window (same-origin).      |
| `contentDocument` | `Document \| null`| The editor iframe document.                  |

### Methods

| Method                  | Description                                              |
| ----------------------- | ------------------------------------------------------- |
| `whenReady()`           | `Promise<this>` that resolves when the editor is ready. |
| `getHtml()`             | Current canvas HTML.                                     |
| `setHtml(html)`         | Replace canvas content (queued if called before ready). |
| `loadTemplate(html)`    | Alias of `setHtml`.                                      |
| `post(message)`         | Low-level: post a message to the editor iframe.         |
| `focus()`               | Focus the editor canvas.                                |

### Events  (all `CustomEvent`)

| Event     | `detail`                       | Fired when                            |
| --------- | ------------------------------ | ------------------------------------- |
| `ready`   | `{ editor }`                   | the engine has booted                 |
| `change`  | `{ html }`                     | canvas content changes                |
| `resize`  | `{ height }`                   | the editor reports a new height       |
| `message` | the raw iframe message object  | any internal message (advanced use)   |

### Attributes

| Attribute     | Default | Description                                       |
| ------------- | ------- | ------------------------------------------------- |
| `height`      | —       | Fixed/initial height (`"800"` or any CSS length). |
| `auto-height` | `true`  | Auto-grow to fit content; set `"false"` to lock.  |

---

## Build from source / contribute

The editor is the monorepo's Angular app (`src/app/`) driving the pure-JS canvas
engine (`public/custom-form/`). The build:

1. runs `ng build` (the Angular app → `dist/custom-form/browser/`),
2. inlines the canvas engine into one self-contained document (the canvas
   iframe's `srcdoc`),
3. inlines the Angular build + that canvas doc into one portable "outer"
   document, and
4. bundles the `<proposal-studio>` element (esm / cjs / global / `.d.ts`).

```bash
cd packages/proposal-studio
npm run build               # reuses an existing Angular build if present
PS_NG_BUILD=1 npm run build # force a fresh `ng build` first
npm test                    # headless browser sanity check (full UI boots)
```

Edit the Angular UI under `src/app/` or the canvas engine under
`public/custom-form/js/`, then re-run the build. PRs welcome.

## Licensing

This package is MIT licensed. The default rich-text engine (`useFroala: false`)
is fully self-contained and carries no third-party obligations.

If you opt in to `useFroala: true`, the editor loads the commercial **Froala**
WYSIWYG editor from a CDN at runtime; Froala production use requires a licence
from <https://froala.com>. The MIT licence here covers only the
`proposal-studio` code, not third-party Froala / jQuery / Font Awesome.
