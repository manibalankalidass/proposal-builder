// Build script for proposal-studio  (Strategy B: ship the built Angular app).
//
// Pipeline:
//   1. Ensure the Angular browser build exists (run `ng build` if missing or
//      when PS_NG_BUILD=1).
//   2. Inline the pure-JS canvas engine (public/custom-form/*) into one
//      self-contained HTML document — this becomes the canvas iframe's srcdoc.
//   3. Inline the Angular browser build (index.csr.html + its hashed main.js +
//      styles + block-registry.js) into one self-contained "outer" document,
//      injecting the canvas srcdoc as a global so the whole editor is portable
//      with zero static assets. CDN deps (jQuery/Froala/Font Awesome) stay
//      remote.
//   4. Embed that outer document as a JS module string and bundle the
//      <proposal-studio> web component (esm + cjs + iife) with esbuild.
//
// Run with Node 18+ (Node 22 recommended).
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');
const repoRoot = resolve(pkgRoot, '..', '..');
const editorRoot = join(repoRoot, 'public', 'custom-form'); // canvas engine source
const ngBrowserDir = join(repoRoot, 'dist', 'custom-form', 'browser');

const distDir = join(pkgRoot, 'dist');
const genDir = join(pkgRoot, 'src', '_generated');

// ---------------------------------------------------------------------------
// 0.  Ensure the Angular browser build exists.
// ---------------------------------------------------------------------------
function ensureAngularBuild() {
  const csr = join(ngBrowserDir, 'index.csr.html');
  if (existsSync(csr) && process.env.PS_NG_BUILD !== '1') {
    console.log('[proposal-studio] reusing existing Angular build (set PS_NG_BUILD=1 to rebuild)');
    return;
  }
  console.log('[proposal-studio] running `ng build` …');
  execSync('node_modules/.bin/ng build --configuration production', {
    cwd: repoRoot,
    stdio: 'inherit'
  });
}

// ---------------------------------------------------------------------------
// Generic asset inliner.
// ---------------------------------------------------------------------------
const escapeScript = (js) => js.replace(/<\/script>/gi, '<\\/script>');
const isRemote = (url) => /^https?:\/\//i.test(url);

/**
 * Inline every LOCAL <link rel=stylesheet> and <script src> in `html`,
 * resolving relative/absolute paths against `baseDir`. Remote URLs are kept.
 */
function inlineAssets(html, baseDir) {
  const readAsset = (url) => {
    const clean = url.split(/[?#]/)[0].replace(/^\//, '');
    return readFileSync(join(baseDir, clean), 'utf8');
  };

  html = html.replace(
    /<link\b[^>]*?href=("|')([^"']+)\1[^>]*?>/gi,
    (tag, _q, href) => {
      if (!/stylesheet/i.test(tag) || isRemote(href)) return tag;
      try {
        return `<style data-src="${href}">\n${readAsset(href)}\n</style>`;
      } catch {
        return tag; // leave anything we can't resolve (e.g. print-media shim)
      }
    }
  );

  html = html.replace(
    /<script\b([^>]*?)\bsrc=("|')([^"']+)\2([^>]*?)>\s*<\/script>/gi,
    (tag, pre, _q, src, post) => {
      if (isRemote(src)) return tag;
      let js;
      try {
        js = readAsset(src);
      } catch {
        return tag;
      }
      const isModule = /type=("|')module\1/.test(pre + post);
      const typeAttr = isModule ? ' type="module"' : '';
      return `<script data-src="${src}"${typeAttr}>\n${escapeScript(js)}\n</script>`;
    }
  );

  return html;
}

// ---------------------------------------------------------------------------
// 2.  Canvas engine document (iframe srcdoc).
// ---------------------------------------------------------------------------
function buildCanvasHtml() {
  const html = readFileSync(join(editorRoot, 'custom-form.html'), 'utf8');
  return inlineAssets(html, editorRoot);
}

// ---------------------------------------------------------------------------
// 3.  Outer Angular app document, with the canvas srcdoc injected.
// ---------------------------------------------------------------------------
function buildOuterHtml(canvasHtml) {
  let html = readFileSync(join(ngBrowserDir, 'index.csr.html'), 'utf8');

  // Strip the print-media stylesheet swap shim + its <noscript> fallback; we
  // inline the real stylesheet below, so the shim only causes a duplicate.
  html = html.replace(/<link\b[^>]*media="print"[^>]*>/i, '');
  html = html.replace(/<noscript>\s*<link\b[^>]*>\s*<\/noscript>/i, '');

  html = inlineAssets(html, ngBrowserDir);

  // Inject the canvas engine HTML as a global *before* the Angular module runs.
  // app.ts reads window.__PS_CANVAS_SRCDOC__ in its constructor and feeds it to
  // the canvas iframe via [srcdoc], making the whole editor self-contained.
  // The canvas HTML contains literal </script> closing tags; embedded inside a
  // JS string literal they would still terminate THIS <script> for the HTML
  // parser, so escape them (\/script decodes back to /script in the string).
  const inject =
    `<script data-injected="proposal-studio-canvas">\n` +
    `window.__PS_CANVAS_SRCDOC__ = ${escapeScript(JSON.stringify(canvasHtml))};\n` +
    `</script>\n`;
  // Place it right before the first module script (the Angular entry).
  html = html.replace(/<script\b[^>]*type="module"[^>]*>/i, (m) => inject + m);

  return html;
}

// ---------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------
ensureAngularBuild();

console.log('[proposal-studio] inlining canvas engine …');
const canvasHtml = buildCanvasHtml();
console.log(`[proposal-studio]   canvas document: ${(canvasHtml.length / 1024).toFixed(0)} KB`);

console.log('[proposal-studio] inlining Angular app …');
const outerHtml = buildOuterHtml(canvasHtml);
console.log(`[proposal-studio]   editor document: ${(outerHtml.length / 1024).toFixed(0)} KB`);

mkdirSync(genDir, { recursive: true });
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

writeFileSync(
  join(genDir, 'editor-html.js'),
  `// AUTO-GENERATED by scripts/build.mjs — do not edit.\n` +
    `export default ${JSON.stringify(outerHtml)};\n`
);
writeFileSync(join(distDir, 'editor-document.html'), outerHtml);

// ---------------------------------------------------------------------------
// 4.  Bundle the Web Component.
// ---------------------------------------------------------------------------
const entry = join(pkgRoot, 'src', 'index.js');
const shared = {
  entryPoints: [entry],
  bundle: true,
  target: ['es2019'],
  legalComments: 'none',
  logLevel: 'info'
};

await build({ ...shared, format: 'esm', outfile: join(distDir, 'proposal-studio.esm.js') });
// CommonJS build uses a real .cjs extension so Node treats it as CommonJS even
// though the package is "type": "module" (where a bare .js would be ESM).
await build({ ...shared, format: 'cjs', outfile: join(distDir, 'proposal-studio.cjs') });
await build({
  ...shared,
  format: 'iife',
  globalName: 'ProposalStudio',
  outfile: join(distDir, 'proposal-studio.global.js')
});
await build({
  ...shared,
  format: 'iife',
  globalName: 'ProposalStudio',
  minify: true,
  outfile: join(distDir, 'proposal-studio.global.min.js')
});

const dts = readFileSync(join(pkgRoot, 'types', 'index.d.ts'), 'utf8');
writeFileSync(join(distDir, 'proposal-studio.d.ts'), dts);

console.log('[proposal-studio] build complete → dist/');
