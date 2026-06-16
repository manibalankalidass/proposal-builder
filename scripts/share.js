#!/usr/bin/env node
/**
 * `npm run share`
 * Angular dev server-ஐ start பண்ணி, public ngrok URL-ஐ print பண்ணும்.
 *
 * இரண்டு சூழ்நிலையையும் handle பண்ணும்:
 *   1. ngrok ஏற்கனவே service-ஆ ஓடுனா (port 4200 tunnel இருந்தா) → அதோட URL-ஐ print பண்ணும்.
 *      (free plan-ல ஒரே agent session தான், அதனால புது ngrok start பண்ண மாட்டோம்.)
 *   2. ngrok ஓடலைனா → namமே `ngrok http 4200` start பண்ணி URL-ஐ print பண்ணும்.
 *
 * Ctrl+C → namம் start பண்ணினதை மட்டும் (ng + namம் start பண்ணின ngrok) clean-ஆ close பண்ணும்.
 * (System service-ஐ touch பண்ணாது.)
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = 4200;
const NG_BIN = path.join(__dirname, '..', 'node_modules', '.bin', 'ng');

const procs = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of procs) {
    try { p.kill('SIGINT'); } catch (_) {}
  }
  setTimeout(() => process.exit(code), 800);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// ── 1) Angular dev server ───────────────────────────────────────────────
console.log('▶  Angular dev server start ஆகுது (port ' + PORT + ') ...\n');
const ng = spawn(NG_BIN, ['serve', '--host', '0.0.0.0', '--port', String(PORT)], {
  stdio: 'inherit',
});
procs.push(ng);
ng.on('exit', () => {
  console.log('\n✖  ng serve நின்னுடுச்சு.');
  shutdown(0);
});

// ── 2) Server up ஆகும் வரை wait ─────────────────────────────────────────
function waitForServer(retries = 90) {
  if (shuttingDown) return;
  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/' }, (res) => {
    res.resume();
    onServerUp();
  });
  req.on('error', () => {
    if (retries <= 0) {
      console.error('✖  Server time-out — start ஆகலை.');
      return shutdown(1);
    }
    setTimeout(() => waitForServer(retries - 1), 1000);
  });
}

// ── 3) ngrok ஏற்கனவே ஓடுதா-ன்னு பார்த்து decide பண்ணு ───────────────────
function onServerUp() {
  findExistingTunnel((url) => {
    if (url) {
      printUrl(url, 'ngrok service (already running)');
    } else {
      startOwnNgrok();
    }
  });
}

function fetchTunnels(cb) {
  const req = http.get('http://127.0.0.1:4040/api/tunnels', (res) => {
    let data = '';
    res.on('data', (d) => (data += d));
    res.on('end', () => {
      try { cb(JSON.parse(data).tunnels || []); }
      catch (_) { cb(null); }
    });
  });
  req.on('error', () => cb(null)); // 4040 இல்ல = ngrok ஓடலை
}

function findExistingTunnel(cb) {
  fetchTunnels((tunnels) => {
    if (!tunnels) return cb(null);
    const match = tunnels.filter((t) => {
      const addr = (t.config && t.config.addr) || '';
      return addr.endsWith(':' + PORT) || addr === String(PORT);
    });
    // https-ஐ முதலில் prefer பண்ணு
    const https = match.find((t) => t.proto === 'https');
    cb((https || match[0] || {}).public_url || null);
  });
}

function startOwnNgrok() {
  if (shuttingDown) return;
  console.log('\n▶  ngrok ஓடலை — namமே tunnel open பண்றோம் ...');
  const ngrok = spawn('ngrok', ['http', String(PORT), '--log', 'stdout'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  procs.push(ngrok);
  ngrok.on('exit', () => {
    console.log('\n✖  ngrok நின்னுடுச்சு.');
    shutdown(0);
  });
  pollOwnUrl();
}

function pollOwnUrl(retries = 40) {
  if (shuttingDown) return;
  findExistingTunnel((url) => {
    if (url) return printUrl(url, 'ngrok (this script)');
    if (retries > 0) setTimeout(() => pollOwnUrl(retries - 1), 1000);
  });
}

function printUrl(url, source) {
  const box = '═'.repeat(Math.max(58, url.length + 16));
  console.log('\n' + box);
  console.log('  🌍  PUBLIC URL : ' + url);
  console.log('       → இந்த URL-ஐ யாரும், எந்த ஊர்லயும், Chrome-ல open பண்ணலாம்');
  console.log('  💻  LOCAL      : http://localhost:' + PORT);
  console.log('  📋  ngrok panel: http://127.0.0.1:4040');
  console.log('  ℹ️   source     : ' + source);
  console.log('');
  console.log('  நிறுத்த: Ctrl + C  (Angular server close ஆகும்; ngrok service-ஆ');
  console.log('          ஓடுனா அது தொடர்ந்து run ஆகும்)');
  console.log(box + '\n');
}

waitForServer();
