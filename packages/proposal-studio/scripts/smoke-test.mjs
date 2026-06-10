// Headless smoke test: load the global bundle in a real browser, mount the
// element, and assert the FULL editor UI boots — Angular chrome (toolbar +
// sidebars) AND the nested canvas engine — and that setHtml round-trips.
import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = resolve(__dirname, '..', 'dist');
const bundle = readFileSync(join(dist, 'proposal-studio.global.js'), 'utf8');

const page_html = `<!doctype html><html><head><meta charset="utf-8"></head>
<body>
<proposal-studio id="ed" style="height:700px"></proposal-studio>
<script>${bundle.replace(/<\/script>/gi, '<\\/script>')}<\/script>
</body></html>`;

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).split('\n')[0]));
  await page.setContent(page_html, { waitUntil: 'networkidle2', timeout: 90000 });

  const result = await page.evaluate(() => {
    const el = document.getElementById('ed');
    return new Promise((res) => {
      const done = (ok, info) => res({ ok, info });
      const finish = () => {
        try {
          el.setHtml('<div id="probe" style="padding:8px">hello from proposal-studio</div>');
          const outer = el.contentDocument; // Angular app document
          const chrome = {
            shell: !!outer.querySelector('.editor-shell'),
            topbar: !!outer.querySelector('.topbar'),
            leftSidebar: !!outer.querySelector('.sidebar--left'),
            rightSidebar: !!outer.querySelector('.sidebar--right'),
            paletteItems: outer.querySelectorAll('.library-item').length
          };
          const canvasFrame = outer.querySelector('iframe.canvas-frame__iframe');
          const canvasDoc = canvasFrame && canvasFrame.contentWindow.document;
          const canvas = canvasDoc && canvasDoc.querySelector('.custom-form-design');
          const probe = canvas && canvas.querySelector('#probe');
          done(true, {
            ready: el.ready,
            chrome,
            hasCanvas: !!canvas,
            roundTrip: !!probe,
            valueLen: (el.getHtml() || '').length
          });
        } catch (e) {
          done(false, String(e));
        }
      };
      if (el.ready) finish();
      else el.addEventListener('ready', finish, { once: true });
      setTimeout(() => done(false, 'timeout waiting for ready'), 60000);
    });
  });

  console.log('[smoke] result:', JSON.stringify(result.info, null, 0));
  const i = result.info;
  const pass =
    result.ok && i.ready && i.hasCanvas && i.roundTrip &&
    i.chrome && i.chrome.shell && i.chrome.topbar &&
    i.chrome.leftSidebar && i.chrome.rightSidebar && i.chrome.paletteItems > 0;
  if (!pass) {
    console.error('[smoke] FAILED');
    process.exitCode = 1;
  } else {
    console.log(
      `[smoke] PASSED ✔  full UI boots — chrome + ${i.chrome.paletteItems} palette items + canvas, setHtml round-trips`
    );
  }
} finally {
  await browser.close();
}
