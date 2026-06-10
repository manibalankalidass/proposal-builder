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

The whole editor engine runs inside an isolated, same-origin `iframe`, so its
internal jQuery / Froala / globals **never collide** with your app, and you can
mount **multiple editors** on one page.

---

## Install

```bash
npm install proposal-studio
```

Or use it straight from a CDN, no build step:

```html
<script src="https://unpkg.com/proposal-studio"></script>
```

> **Internet note:** rich-text editing loads Froala + Font Awesome + jQuery from
> a CDN at runtime. The editor needs network access on first paint. Froala is a
> commercial product — see [Licensing](#licensing).

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

The editor engine lives in [`public/custom-form/`](../../public/custom-form) of
the monorepo. The build inlines those assets into one self-contained document
and bundles the element.

```bash
cd packages/proposal-studio
npm run build          # → dist/  (esm, cjs, global, .d.ts, editor-document.html)
node scripts/smoke-test.mjs   # headless browser sanity check
```

Edit the engine under `public/custom-form/js/`, then re-run `npm run build`.
PRs welcome.

## Licensing

This package is MIT licensed. It loads the **Froala** WYSIWYG editor from a CDN
at runtime for rich-text editing; Froala is a commercial product and production
use may require a license from <https://froala.com>. The MIT license here covers
only the `proposal-studio` code, not third-party Froala/jQuery/Font Awesome.
