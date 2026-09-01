# Future Chips ⚡

A premium, futuristic digital product marketplace website with a built-in admin panel, Stripe payment flow, and user IP tracking.

## 🚀 Features

- **Futuristic Aesthetics**: Sleek dark mode, neon glow, custom Google Fonts (`Outfit` + `Inter`), dynamic gradients, and custom vector SVGs.
- **Dynamic Site Branding & Theming**: The admin panel lets you change the site name and colors (Primary, Accent, Background) which sync live to all visitors instantly.
- **Stripe Payments**: Real Stripe Checkout session integration + a built-in **development simulation mode** so you can test successful purchases without configuring API keys.
- **Admin Control Panel**:
  - Add, update, and remove products (name, description, price, category, and image upload).
  - View all transactions (date, customer email, product name, amount paid, and customer IP).
  - Live visitor telemetry (tracking client IP addresses, user agent browser info, and pages visited).
- **IP Address Tracking**: Tracks user IPs during standard page visits and attaches customer IP addresses to transactions.

---

## 🛠️ Getting Started

### 1. Installation
Install server dependencies:
```bash
cd server
npm install
```

### 2. Configure Environment
A default config has been seeded in `server/.env` with local testing defaults.
```env
PORT=3000
JWT_SECRET=future-chips-super-secret-key-2026

# Optional: Add these to enable real Stripe payments
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```
*Note: If `STRIPE_SECRET_KEY` is left blank, the site operates in **Stripe Simulation Mode**. Purchases will show a demo checkout screen and simulate a successful transaction instantly upon confirmation, creating successful order items in the database!*

### 3. Run Development Server
From the project root directory, run:
```bash
npm run dev
```
Or if running directly from the `server/` directory:
```bash
node server.js
```

The system will start on **`http://localhost:3000`**.

---

## 🔐 Credentials

- **Admin Login Page**: `http://localhost:3000/admin`
- **Default Operator ID**: `admin`
- **Default Decryption Key**: `FutureChips2024!`

*(You can update the default site settings directly in the Settings tab!)*

---

## 📁 Project Structure

```text
├── client/
│   ├── admin/
│   │   ├── css/admin.css      # Admin dashboard styles
│   │   ├── js/admin.js        # Admin client side logic
│   │   ├── dashboard.html     # Dashboard layout
│   │   └── index.html         # Admin login screen
│   ├── css/style.css          # Storefront styles & variable theming
│   ├── js/app.js              # Store client side logic & dynamic theme loading
│   ├── index.html             # Store landing page
│   ├── product.html           # Single product detail view
│   └── checkout-status.html   # Stripe success/failure redirect screen
├── server/
│   ├── db/
│   │   ├── database.js        # SQLite table creations & seed defaults
│   │   └── future_chips.db    # Live SQLite DB file (generated on start)
│   ├── middleware/
│   │   ├── auth.js            # JWT Validation middleware
│   │   └── ipTracker.js       # Visitor IP extraction & DB writer
│   ├── routes/
│   │   ├── admin.js           # Admin CRUD, settings & telemetry logs
│   │   ├── payments.js        # Stripe checkout & mock session verify
│   │   └── products.js        # Public products endpoint
│   ├── uploads/               # Product image upload repository (with custom SVGs)
│   ├── .env                   # Configuration
│   ├── server.js              # Express main entrypoint
│   └── package.json           # Node packages list
└── package.json               # Root shortcut package.json
```

---

## 📦 Deployment Instructions

### Frontend (e.g. Vercel / Netlify)
If you want to host the frontend separately:
1. Connect your repository to Vercel/Netlify.
2. Set the build folder or publish directory to `client`.
3. In `client/js/app.js` and `client/admin/js/admin.js`, update any API endpoints to point to your hosted backend URL instead of relative paths if they are deployed on different domains.

### Backend (e.g. Railway / Render / Heroku)
1. Deploy the `server` directory to your hosting provider.
2. Ensure you configure environment variables (`PORT`, `JWT_SECRET`, `STRIPE_SECRET_KEY`) in the provider dashboard.
3. Because this application uses an SQLite database (`server/db/future_chips.db`), make sure to attach a persistent volume disk mount to `/server/db` on your hosting provider so database changes persist across deployments.
