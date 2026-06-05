// server.js — Backend PixelWar
// npm install express stripe better-sqlite3 ws cors dotenv

require('dotenv').config();
const express = require('express');
const Stripe = require('stripe');
const Database = require('better-sqlite3');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const db = new Database('pixels.db');

// ─── DATABASE ───
db.exec(`
  CREATE TABLE IF NOT EXISTS pixels (
    id INTEGER PRIMARY KEY,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    color TEXT NOT NULL,
    owner_email TEXT,
    paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(x, y)
  );
`);

// ─── MIDDLEWARE ───
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── WEBSOCKET (temps réel) ───
const wss = new WebSocket.Server({ noServer: true });
const clients = new Set();

wss.on('connection', ws => {
  clients.add(ws);

  // Envoyer tous les pixels au nouveau client
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
  res.json({ pixels, total: pixels.length });
});

// POST créer une session de paiement Stripe
app.post('/api/checkout', async (req, res) => {
  const { x, y, color, email } = req.body;

  // Vérifier que le pixel est libre
  const existing = db.prepare('SELECT id FROM pixels WHERE x=? AND y=?').get(x, y);
  if (existing) {
    return res.status(409).json({ error: 'Pixel déjà pris' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `Pixel (${x}, ${y})`,
            description: `Couleur ${color} — permanent sur PixelWar.fr`,
          },
          unit_amount: 100, // 1,00 €
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: email || undefined,
      success_url: `${process.env.BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/`,
      metadata: { x: String(x), y: String(y), color },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur Stripe' });
  }
});

// POST webhook Stripe (confirmation de paiement)
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { x, y, color } = session.metadata;
    const email = session.customer_email;

    try {
      db.prepare('INSERT OR IGNORE INTO pixels (x,y,color,owner_email) VALUES (?,?,?,?)')
        .run(parseInt(x), parseInt(y), color, email);

      // Broadcast à tous les clients connectés
      broadcast({ type: 'pixel', x: parseInt(x), y: parseInt(y), color });
      console.log(`✅ Pixel (${x},${y}) vendu à ${email}`);
    } catch (err) {
      console.error('DB error:', err);
    }
  }

  res.json({ received: true });
});

// GET page succès
app.get('/success', (req, res) => {
  res.send(`<!DOCTYPE html>
  <html><head><title>Pixel acheté !</title>
  <style>body{background:#050508;color:#00f5ff;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:20px;}
  a{color:#aaff00;}</style></head>
  <body><h1>✓ PIXEL ACQUIS !</h1><p>Ton pixel est maintenant permanent sur la grille.</p>
  <a href="/">← Retour à la grille</a></body></html>`);
});

// ─── DÉMARRAGE ───
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`🚀 PixelWar server running on port ${PORT}`);
});

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
