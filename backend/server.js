require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const WebSocket = require('ws');
const cors = require('cors');
const app = express();
const db = new Database('pixels.db');
// ─── DATABASE ───
db.exec(`
CREATE TABLE IF NOT EXISTS pixels (
id INTEGER PRIMARY KEY,
x INTEGER NOT NULL,
y INTEGER NOT NULL,
color TEXT NOT NULL,
UNIQUE(x, y)
);
`);
// ─── MIDDLEWARE ───
app.use(cors());
app.use(express.json());
// ─── WEBSOCKET ───
const wss = new WebSocket.Server({ noServer: true });
const clients = new Set();
wss.on('connection', ws => {
clients.add(ws);
const allPixels = db.prepare('SELECT x, y, color FROM pixels').all();
ws.send(JSON.stringify({ type: 'init', pixels: allPixels }));
ws.on('close', () => clients.delete(ws));
});
function broadcast(data) {
const msg = JSON.stringify(data);
clients.forEach(ws => {
if (ws.readyState === WebSocket.OPEN) ws.send(msg);
});
}
// ─── ROUTES ───
// GET tous les pixels
app.get('/api/pixels', (req, res) => {
const pixels = db.prepare('SELECT x, y, color FROM pixels').all();
res.json({ pixels });
});
// POST placer un pixel (provisoire sans paiement)
app.post('/api/pixels', (req, res) => {
const { x, y, color } = req.body;
if (x === undefined || y === undefined || !color) {
return res.status(400).json({ error: 'x, y et color requis' });
}
const existing = db.prepare('SELECT id FROM pixels WHERE x=? AND y=?').get(x, y);
if (existing) {
return res.status(409).json({ error: 'Pixel déjà pris' });
}
db.prepare('INSERT INTO pixels (x, y, color) VALUES (?, ?, ?)').run(x, y, color);
broadcast({ type: 'pixel', x, y, color });
res.json({ ok: true });
});
// ─── DÉMARRAGE ───
const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, () => {
console.log(`Serveur PixelWar sur le port ${PORT}`);
});
server.on('upgrade', (req, socket, head) => {
wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
