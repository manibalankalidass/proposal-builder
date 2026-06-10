// Headless smoke test: load the global bundle in a real browser, mount the
// element, and assert the editor boots (ready event + a working canvas).
import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = resolve(__dirname, '..', 'dist');
const bundle = readFileSync(join(dist, 'proposal-studio.global.js'), 'utf8');

const page_html = `<!doctype html><html><head><meta charset="utf-8"></head>
<body>
<proposal-studio id="ed" style="height:400px"></proposal-studio>
<script>${bundle.replace(/<\/script>/gi, '<\\/script>')}<\/script>
</body></html>`;

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
try {
  const page = await browser.newPage();
  page.on('console', (m) => {
    const t = m.text();
    if (/error|fail/i.test(t)) console.log('  [page]', t);
  });
  await page.setContent(page_html, { waitUntil: 'networkidle2', timeout: 60000 });

  // Wait for the element's `ready` event.
  const result = await page.evaluate(() => {
    const el = document.getElementById('ed');
    return new Promise((res) => {
      const done = (ok, info) => res({ ok, info });
      const finish = () => {
        try {
          el.setHtml('<div id="probe" style="padding:8px">hello from proposal-studio</div>');
          const doc = el.contentDocument;
          const canvas = doc && doc.querySelector('.custom-form-design');
          const probe = canvas && canvas.querySelector('#probe');
          const hasEngine = !!(el.contentWindow && el.contentWindow.FlowCanvas);
          done(true, {
            ready: el.ready,
            hasEngine,
            canvasFound: !!canvas,
            roundTrip: !!probe,
            valueLen: (el.getHtml() || '').length
          });
        } catch (e) {
          done(false, String(e));
        }
      };
      if (el.ready) finish();
      else el.addEventListener('ready', finish, { once: true });
      setTimeout(() => done(false, 'timeout waiting for ready'), 30000);
    });
  });

  console.log('[smoke] result:', JSON.stringify(result.info));
  if (!result.ok || !result.info.ready || !result.info.hasEngine || !result.info.roundTrip) {
    console.error('[smoke] FAILED');
    process.exitCode = 1;
  } else {
    console.log('[smoke] PASSED ✔  editor boots, engine present, setHtml round-trips');
  }
} finally {
  await browser.close();
}
