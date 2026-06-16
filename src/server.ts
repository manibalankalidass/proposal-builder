import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

const browserDistFolder = join(import.meta.dirname, '../browser');
const projectRoot = process.cwd();
const publicDir = join(projectRoot, 'public');
const generatedDir = join(projectRoot, 'generated');

if (!fs.existsSync(generatedDir)) {
  fs.mkdirSync(generatedDir, { recursive: true });
}

const app = express();
const angularApp = new AngularNodeAppEngine();

app.use(express.json({ limit: '50mb' }));

// SETTING: When true, overwrites previous PDF. When false, creates new folder per generation.
const DEV_MODE_OVERRIDE = true;

function getTargetInfo() {
  if (DEV_MODE_OVERRIDE) {
    return { path: generatedDir, folderName: null };
  }
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const dateParts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  const items = fs.readdirSync(generatedDir);
  let count = 0;
  for (const item of items) {
    if (item.startsWith('generate_') && fs.statSync(join(generatedDir, item)).isDirectory()) {
      count++;
    }
  }
  const folderName = `generate_${dateParts}_${count + 1}`;
  const targetDir = join(generatedDir, folderName);
  fs.mkdirSync(targetDir, { recursive: true });
  return { path: targetDir, folderName };
}

// Google Fonts CDN links — must mirror GOOGLE_FONTS in
// public/custom-form/js/font-config.js. The editor injects these dynamically,
// but the PDF HTML is rendered fresh, so they must be declared here too or
// fonts like Poppins fall back to a default font in the generated PDF.
const googleFontLinks: string[] = [
  'https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Raleway:wght@300;400;500;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Nunito:wght@300;400;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Source+Sans+Pro:wght@300;400;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&display=swap',
];

function cssLinks(): string[] {
  const localCss = [
    join(publicDir, 'custom-form', 'css', 'custom-form.css'),
    join(publicDir, 'custom-form', 'editor', 'editor.css'),
  ].map((p) => `file://${p}`);
  return [
    ...googleFontLinks,
    localCss[0],
    'https://cdnjs.cloudflare.com/ajax/libs/froala-editor/4.3.1/css/froala_editor.pkgd.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    localCss[1],
  ];
}

function wrapTwigTemplate(twigBody: string): string {
  const links = cssLinks()
    .map((href) => `  <link rel="stylesheet" href="${href}">`)
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Custom Form</title>
${links}
</head>
<body>
${twigBody}
</body>
</html>`;
}

function runCommand(cmd: string, args: string[], outFile?: string, env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const stdoutStream = outFile ? fs.createWriteStream(outFile) : undefined;
    const child = spawn(cmd, args, env ? { env } : undefined);
    let stderr = '';
    if (stdoutStream) {
      child.stdout.pipe(stdoutStream);
    } else {
      child.stdout.on('data', () => { });
    }
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      const done = () => {
        if (code === 0) resolve();
        else reject(new Error(`${cmd} exited with code ${code}: ${stderr}`));
      };
      if (stdoutStream) stdoutStream.end(done); else done();
    });
  });
}

app.post('/api/save-twig', async (req, res) => {
  const { twigCode, bindingData } = req.body ?? {};
  if (!twigCode) {
    res.status(400).json({ error: 'No twig code provided' });
    return;
  }

  const targetInfo = getTargetInfo();
  const phpPath = join(targetInfo.path, 'generated_twig.php');
  const dataPath = join(targetInfo.path, 'binding_data.json');
  const htmlPath = join(targetInfo.path, 'generated.html');
  const pdfPath = join(targetInfo.path, 'generated.pdf');
  const renderScript = join(projectRoot, 'scripts', 'render_twig.php');

  try {
    fs.writeFileSync(phpPath, wrapTwigTemplate(twigCode), 'utf8');
    fs.writeFileSync(dataPath, JSON.stringify(bindingData ?? {}, null, 2), 'utf8');

    await runCommand('php', [renderScript, phpPath, dataPath], htmlPath);

    await runCommand('wkhtmltopdf', [
      '--enable-local-file-access',
      '--page-width', '210mm',
      '--page-height', '297mm',
      '--margin-top', '0mm',
      '--margin-bottom', '0mm',
      '--margin-left', '0mm',
      '--margin-right', '0mm',
      '--disable-smart-shrinking',
      '--zoom', '1.0',
      '--viewport-size', '794x1123',
      htmlPath,
      pdfPath,
    ]);

    res.json({
      success: true,
      phpPath,
      htmlPath,
      pdfPath,
      pdfUrl: targetInfo.folderName ? `/generated/${targetInfo.folderName}/generated.pdf?t=${Date.now()}` : `/generated.pdf?t=${Date.now()}`,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/save-twig-puppeteer', async (req, res) => {
  const { twigCode, bindingData, pdfSettings } = req.body ?? {};
  if (!twigCode) {
    res.status(400).json({ error: 'No twig code provided' });
    return;
  }

  const targetInfo = getTargetInfo();
  const phpPath = join(targetInfo.path, 'generated_twig.php');
  const dataPath = join(targetInfo.path, 'binding_data.json');
  const htmlPath = join(targetInfo.path, 'generated.html');
  const pdfPath = join(targetInfo.path, 'generated.pdf');
  const renderScript = join(projectRoot, 'scripts', 'render_twig.php');
  const puppeteerScript = join(projectRoot, 'scripts', 'generate_pdf_puppeteer.js');

  try {
    fs.writeFileSync(phpPath, wrapTwigTemplate(twigCode), 'utf8');
    fs.writeFileSync(dataPath, JSON.stringify(bindingData ?? {}, null, 2), 'utf8');

    await runCommand('php', [renderScript, phpPath, dataPath], htmlPath);

    // Pass page settings to the puppeteer script via env vars. Default to
    // 0mm margins so the editor's cs_margin padding is the single source of
    // page inset (no double-padding in the PDF).
    const env = {
      ...process.env,
      PDF_PAGE_SIZE: String(pdfSettings?.pageSize ?? 'A4'),
      PDF_MARGIN_TOP: String(pdfSettings?.marginTop ?? 0),
      PDF_MARGIN_RIGHT: String(pdfSettings?.marginRight ?? 0),
      PDF_MARGIN_BOTTOM: String(pdfSettings?.marginBottom ?? 0),
      PDF_MARGIN_LEFT: String(pdfSettings?.marginLeft ?? 0),
    };
    await runCommand('node', [puppeteerScript, htmlPath, pdfPath], undefined, env);

    res.json({
      success: true,
      phpPath,
      htmlPath,
      pdfPath,
      pdfUrl: targetInfo.folderName ? `/generated/${targetInfo.folderName}/generated.pdf?t=${Date.now()}` : `/generated.pdf?t=${Date.now()}`,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/generated.pdf', (_req, res) => {
  const pdfPath = join(generatedDir, 'generated.pdf');
  if (!fs.existsSync(pdfPath)) {
    res.status(404).send('PDF not generated yet');
    return;
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="generated.pdf"');
  res.sendFile(pdfPath);
});

app.get('/generated.html', (_req, res) => {
  const htmlPath = join(generatedDir, 'generated.html');
  if (!fs.existsSync(htmlPath)) {
    res.status(404).send('HTML not generated yet');
    return;
  }
  res.sendFile(htmlPath);
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

// Serve generated files (PDFs, HTML) from the generated/ root AND subfolders.
app.use('/generated', express.static(generatedDir, { index: false, redirect: false }));

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Collaboration relay (real-time multi-user + comments).
 *
 * A tiny per-document room relay: clients connect to ws://host/collab?doc=<id>
 * and every JSON message is forwarded to the other peers in the same room.
 * Presence (cursors/selection) and comment events all ride this one channel —
 * the server stays dumb (pure fan-out), so adding message types needs no
 * server change. Comments are also persisted to disk so they survive reloads.
 */
const collabDir = join(generatedDir, 'collab');
const commentsFile = (docId: string) =>
  join(collabDir, `comments-${docId.replace(/[^a-z0-9_-]/gi, '_')}.json`);

const readComments = (docId: string): unknown[] => {
  try { return JSON.parse(fs.readFileSync(commentsFile(docId), 'utf8')); } catch { return []; }
};
const writeComments = (docId: string, list: unknown[]) => {
  try { fs.mkdirSync(collabDir, { recursive: true }); fs.writeFileSync(commentsFile(docId), JSON.stringify(list), 'utf8'); }
  catch (e) { console.warn('[collab] failed to persist comments:', e); }
};

// REST: load/replace the comment list for a document (persistence layer).
app.get('/api/comments', (req, res) => {
  res.json({ comments: readComments(String(req.query['doc'] || 'default')) });
});
app.post('/api/comments', (req, res) => {
  const { doc, comments } = req.body ?? {};
  writeComments(String(doc || 'default'), Array.isArray(comments) ? comments : []);
  res.json({ ok: true });
});

function setupCollab(server: HttpServer): void {
  const wss = new WebSocketServer({ server, path: '/collab' });
  const rooms = new Map<string, Set<any>>();
  const OPEN = WebSocket.OPEN;

  wss.on('connection', (ws: any, req: { url?: string }) => {
    const url = new URL(req.url || '', 'http://localhost');
    const docId = url.searchParams.get('doc') || 'default';
    ws._docId = docId;

    let room = rooms.get(docId);
    if (!room) { room = new Set(); rooms.set(docId, room); }
    room.add(ws);

    const relay = (data: string, includeSelf = false) => {
      room!.forEach((peer: any) => {
        if ((includeSelf || peer !== ws) && peer.readyState === OPEN) peer.send(data);
      });
    };

    ws.on('message', (buf: any) => {
      const raw = buf.toString();
      let msg: any;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg?.user?.id) ws._userId = msg.user.id;
      relay(raw); // fan-out to peers
    });

    ws.on('close', () => {
      room!.delete(ws);
      relay(JSON.stringify({ type: 'presence:leave', userId: ws._userId }));
      if (room!.size === 0) rooms.delete(docId);
    });
  });

  console.log('[collab] WebSocket relay attached at ws://<host>/collab');
}

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  const server = app.listen(port, (error?: Error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
  setupCollab(server as unknown as HttpServer);
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
