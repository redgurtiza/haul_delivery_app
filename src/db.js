const Database = require('better-sqlite3');
const path = require('path');
const { DEFAULTS } = require('./pricing');

const db = new Database(process.env.DB_PATH || path.join(__dirname, '..', 'haul.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('client','driver','admin')),
  name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT, address TEXT,
  password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS drivers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  vehicle TEXT, plate TEXT, availability TEXT NOT NULL DEFAULT 'offline',
  lat REAL, lng REAL, located_at TEXT
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES users(id),
  driver_id INTEGER REFERENCES users(id),
  item TEXT NOT NULL,
  pickup_name TEXT NOT NULL, pickup_lat REAL NOT NULL, pickup_lng REAL NOT NULL,
  drop_name TEXT NOT NULL, drop_lat REAL NOT NULL, drop_lng REAL NOT NULL,
  l REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL, kg REAL NOT NULL,
  distance_km REAL NOT NULL,
  base REAL NOT NULL, dist_fee REAL NOT NULL, weight_fee REAL NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0, priority_fee REAL NOT NULL DEFAULT 0,
  vat REAL NOT NULL, total REAL NOT NULL,
  payment_method TEXT, payment_status TEXT NOT NULL DEFAULT 'UNPAID', payment_ref TEXT,
  status TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT',
  rank INTEGER NOT NULL DEFAULT 0,
  est_pickup TEXT, est_delivery TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id);
CREATE INDEX IF NOT EXISTS idx_orders_driver ON orders(driver_id, status);
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL, note TEXT, lat REAL, lng REAL,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

db.getSettings = () => {
  const row = db.prepare("SELECT value FROM settings WHERE key='pricing'").get();
  return { ...DEFAULTS, ...(row ? JSON.parse(row.value) : {}) };
};
db.saveSettings = (cfg) =>
  db.prepare("INSERT INTO settings(key,value) VALUES('pricing',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(cfg));

module.exports = db;
