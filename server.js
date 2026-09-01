require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./db/database');
const ipTracker = require('./middleware/ipTracker');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Database
initDatabase();

// CORS configurations
app.use(cors({
  origin: '*', // Allow all origins for easy local/distributed development
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Route for Stripe webhooks must use raw body, so we set it up before express.json()
const paymentsRouter = require('./routes/payments');
// We mount payments under /api/checkout. Note: within paymentsRouter, webhook is POST /webhook
app.use('/api/checkout', paymentsRouter);

// Standard JSON body parser for all other requests
app.use(express.json());

// Serve static assets first, so they bypass IP logging
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/admin', express.static(path.join(__dirname, '..', 'client', 'admin')));
app.use(express.static(path.join(__dirname, '..', 'client')));

// Apply IP tracking middleware to API requests (to log visitor traffic details)
app.use('/api', ipTracker);

// API Routers
const productsRouter = require('./routes/products');
const adminRouter = require('./routes/admin');

app.use('/api/products', productsRouter);
app.use('/api/admin', adminRouter);

// Fallback index.html for page routing
app.get('*', (req, res) => {
  // If the path looks like an API call, return 404
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  // Otherwise, serve storefront
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({ error: 'An unexpected error occurred on the server.' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 Future Chips Server running on http://localhost:${PORT}`);
    console.log(`🔐 Admin Panel available at http://localhost:${PORT}/admin`);
    console.log(`====================================================`);
  });
}

module.exports = app;
