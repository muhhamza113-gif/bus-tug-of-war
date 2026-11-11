// TikTok LIVE -> game bridge, also serves the game page.
// Works on a computer or on a cloud host (Render, Railway, etc.).
//
// Local:  npm install   then   TIKTOK_USERNAME=yourname node server.js   (or: node server.js yourname)
// Cloud:  set an environment variable TIKTOK_USERNAME = your TikTok username
//
// NOTE: tiktok-live-connector is an unofficial library. Using it is against
// TikTok's terms and could put your account at risk.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

// ================= SETTINGS: change these =================
const USERNAME = (process.env.TIKTOK_USERNAME || process.argv[2] || '').replace('@', '');
const PORT = process.env.PORT || 8080;
const TEAMS = {
  a: ['blue'],    // words viewers type to join team A (BLUE in game.html)
  b: ['white']    // words viewers type to join team B (WHITE in game.html)
};
// ==========================================================

// Keep the page online even if something unexpected goes wrong; just print it.
process.on('uncaughtException', err => console.error('UNCAUGHT ERROR:', err && err.stack || err));
process.on('unhandledRejection', err => console.error('UNHANDLED REJECTION:', err && err.stack || err));

// --- web server: shows the game at the main address ---
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/' || url === '/game.html') {
    fs.readFile(path.join(__dirname, 'game.html'), (err, data) => {
      if (err) { res.writeHead(500); return res.end('game.html is missing'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else {
    res.writeHead(404); res.end('not found');
  }
});

// --- websocket: sends points to the game page ---
const wss = new WebSocketServer({ server });
server.listen(PORT, '0.0.0.0', () => console.log('Game running on port ' + PORT));

function broadcast(msg) {
  const s = JSON.stringify(msg);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(s); });
}

const userTeam = new Map(); // remembers each viewer's team so their gifts go to it

function teamFromText(text) {
  const t = String(text || '').toLowerCase();
  for (const [team, words] of Object.entries(TEAMS)) {
    if (words.some(w => t.includes(w))) return team;
  }
  return null;
}

// --- TikTok side ---
async function initTikTok() {
  if (!USERNAME) {
    console.log('No TikTok username set. Set TIKTOK_USERNAME. Game page still works in test mode.');
    return;
  }

  let lib;
  try {
    const mod = await import('tiktok-live-connector'); // works for both old and new library styles
    lib = Object.assign({}, mod.default && typeof mod.default === 'object' ? mod.default : {}, mod);
  } catch (err) {
    console.error('Could not load tiktok-live-connector:', err && err.stack || err);
    return;
  }

  const Connection = lib.TikTokLiveConnection || lib.WebcastPushConnection;
  const EV = lib.WebcastEvent || { CHAT: 'chat', GIFT: 'gift' };
  if (!Connection) {
    console.error('tiktok-live-connector loaded but no connection class found. Exports:', Object.keys(lib));
    return;
  }

  const conn = new Connection(USERNAME);

  conn.on(EV.CHAT, d => {
    const id = String(d.user?.userId ?? d.userId ?? '');
    const name = d.user?.uniqueId ?? d.uniqueId ?? 'viewer';
    const team = teamFromText(d.comment);
    if (!team) return;
    userTeam.set(id, team);
    broadcast({ type: 'points', team, points: 1, name });
  });

  conn.on(EV.GIFT, d => {
    const id = String(d.user?.userId ?? d.userId ?? '');
    const name = d.user?.uniqueId ?? d.uniqueId ?? 'viewer';
    const team = userTeam.get(id);
    if (!team) return; // viewer hasn't picked a team yet

    const giftType = d.giftDetails?.giftType ?? d.giftType;
    if (giftType === 1 && !d.repeatEnd) return; // streak gifts: count once, at the end

    const diamonds = d.giftDetails?.diamondCount ?? d.diamondCount ?? 1;
    const points = diamonds * (d.repeatCount || 1);
    broadcast({ type: 'points', team, points, name });
  });

  const start = () => {
    conn.connect()
      .then(() => console.log('Connected to @' + USERNAME + "'s LIVE"))
      .catch(err => {
        console.error('Could not connect (are you LIVE?). Retrying in 20s:', err && err.message || err);
        setTimeout(start, 20000);
      });
  };
  start();
}

initTikTok();
