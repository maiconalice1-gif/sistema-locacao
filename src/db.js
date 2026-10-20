import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MIGRATIONS = [
  `
CREATE TABLE users(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN('admin','staff')),
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE sessions(
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE customers(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, doc TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE items(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, category TEXT NOT NULL DEFAULT '',
  qty_total INTEGER NOT NULL CHECK(qty_total>=0), price_cents INTEGER NOT NULL CHECK(price_cents>=0),
  active INTEGER NOT NULL DEFAULT 1, photo BLOB, photo_mime TEXT, photo_v INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE rentals(
  id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL CHECK(status IN('Reservado','Entregue','Devolvido','Cancelado')),
  start_date TEXT NOT NULL, end_date TEXT NOT NULL, address TEXT NOT NULL,
  freight_cents INTEGER NOT NULL DEFAULT 0, discount_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '', installments INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL,
  delivered_at TEXT, delivered_by TEXT, received_by TEXT, delivery_notes TEXT,
  returned_at TEXT, return_notes TEXT, cancelled_at TEXT);
CREATE TABLE rental_items(
  id INTEGER PRIMARY KEY, rental_id INTEGER NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id), name TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK(qty>0), unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0),
  returned_qty INTEGER, damaged_qty INTEGER, UNIQUE(rental_id,item_id));
CREATE TABLE installments(
  id INTEGER PRIMARY KEY, rental_id INTEGER NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  n INTEGER NOT NULL, due_date TEXT NOT NULL, amount_cents INTEGER NOT NULL);
CREATE TABLE payments(
  id INTEGER PRIMARY KEY, rental_id INTEGER NOT NULL REFERENCES rentals(id),
  kind TEXT NOT NULL CHECK(kind IN('pagamento','estorno')), amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  method TEXT NOT NULL, date TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_by INTEGER, created_at TEXT NOT NULL);
CREATE TABLE cash(
  id INTEGER PRIMARY KEY, direction TEXT NOT NULL CHECK(direction IN('Entrada','Saída')),
  category TEXT NOT NULL DEFAULT '', description TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  method TEXT NOT NULL, date TEXT NOT NULL, rental_id INTEGER REFERENCES rentals(id),
  payment_id INTEGER REFERENCES payments(id), created_by INTEGER, created_at TEXT NOT NULL);
CREATE TABLE blocks(
  id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES items(id), rental_id INTEGER REFERENCES rentals(id),
  qty INTEGER NOT NULL CHECK(qty>0), reason TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT, resolution TEXT);
CREATE TABLE audit(
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, user_id INTEGER, action TEXT NOT NULL,
  entity TEXT NOT NULL, entity_id INTEGER, detail TEXT NOT NULL DEFAULT '');
CREATE INDEX idx_rentals_dates ON rentals(start_date, end_date);
CREATE INDEX idx_rentals_customer ON rentals(customer_id);
CREATE INDEX idx_rental_items_item ON rental_items(item_id);
CREATE INDEX idx_payments_rental ON payments(rental_id);
CREATE INDEX idx_cash_date ON cash(date);
CREATE INDEX idx_blocks_item ON blocks(item_id);
`,
];

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  const v = db.prepare('PRAGMA user_version').get().user_version;
  for (let i = v; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try { db.exec(MIGRATIONS[i]); db.exec(`PRAGMA user_version = ${i + 1}`); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return db;
}

/** Executa várias alterações como uma só: ou grava tudo ou nada. */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
