import { bad, one, all, run, audit, nowIso, str, int, money, date, HttpError } from './util.js';
import { tx } from './db.js';

/** Maior quantidade do material ocupada em algum dia do período (entregues continuam ocupando até a devolução). */
export function reservedMax(db, itemId, start, end, excludeRentalId = 0) {
  const rows = all(db, `SELECT r.start_date s, r.end_date e, r.status st, ri.qty FROM rental_items ri
      JOIN rentals r ON r.id=ri.rental_id
      WHERE ri.item_id=? AND r.id!=? AND r.status IN('Reservado','Entregue')
        AND r.start_date<=? AND (r.status='Entregue' OR r.end_date>=?)`, itemId, excludeRentalId, end, start);
  const points = [start, ...rows.map((r) => r.s).filter((s) => s >= start && s <= end)];
  return Math.max(...points.map((p) => rows.filter((r) => r.s <= p && (r.st === 'Entregue' || r.e >= p)).reduce((a, r) => a + r.qty, 0)));
}
export const blockedQty = (db, itemId) => one(db, 'SELECT COALESCE(SUM(qty),0) n FROM blocks WHERE item_id=? AND resolved_at IS NULL', itemId).n;
export const availableFor = (db, item, start, end, excl = 0) => item.qty_total - blockedQty(db, item.id) - reservedMax(db, item.id, start, end, excl);

const publicItem = (db, i) => ({
  id: i.id, name: i.name, category: i.category, qty_total: i.qty_total, price_cents: i.price_cents, active: !!i.active,
  has_photo: !!i.photo_mime, photo_v: i.photo_v, blocked: blockedQty(db, i.id),
});

export function listItems(db, { all: includeInactive = false } = {}) {
  return all(db, `SELECT id,name,category,qty_total,price_cents,active,photo_mime,photo_v FROM items ${includeInactive ? '' : 'WHERE active=1'} ORDER BY name`)
    .map((i) => publicItem(db, i));
}

export function availability(db, start, end, excl = 0) {
  date(start, 'Data de entrega'); date(end, 'Data de devolução');
  if (end < start) throw bad('A devolução não pode ser antes da entrega.');
  return all(db, 'SELECT * FROM items WHERE active=1 ORDER BY name').map((i) => {
    const blocked = blockedQty(db, i.id), reserved = reservedMax(db, i.id, start, end, excl);
    return { ...publicItem(db, i), reserved, available: Math.max(0, i.qty_total - blocked - reserved) };
  });
}

function itemFields(b) {
  return {
    name: str(b.name, 'Nome do material', { max: 120 }),
    category: str(b.category, 'Categoria', { max: 60, required: false }),
    qty_total: int(b.qty_total, 'Quantidade', { max: 100000 }),
    price_cents: money(b.price_cents, 'Preço'),
  };
}
export function createItem(db, user, b) {
  const f = itemFields(b);
  if (one(db, 'SELECT 1 FROM items WHERE name=?', f.name)) throw bad('Já existe um material com esse nome.');
  const r = run(db, 'INSERT INTO items(name,category,qty_total,price_cents,created_at) VALUES (?,?,?,?,?)', f.name, f.category, f.qty_total, f.price_cents, nowIso());
  audit(db, user.id, 'criar', 'material', r.lastInsertRowid, f.name);
  return publicItem(db, one(db, 'SELECT * FROM items WHERE id=?', r.lastInsertRowid));
}

export function updateItem(db, user, id, b) {
  return tx(db, () => {
    const cur = one(db, 'SELECT * FROM items WHERE id=?', id);
    if (!cur) throw new HttpError(404, 'Material não encontrado.');
    const f = itemFields({ ...cur, ...b });
    const active = b.active === undefined ? cur.active : b.active ? 1 : 0;
    if (one(db, 'SELECT 1 FROM items WHERE name=? AND id!=?', f.name, id)) throw bad('Já existe um material com esse nome.');
    if (f.qty_total !== cur.qty_total) {
      const need = blockedQty(db, id) + reservedMax(db, id, '0000-01-01', '9999-12-31');
      if (f.qty_total < need) throw bad(`Quantidade menor que o necessário: ${need} já estão reservados ou bloqueados.`);
    }
    run(db, 'UPDATE items SET name=?,category=?,qty_total=?,price_cents=?,active=? WHERE id=?', f.name, f.category, f.qty_total, f.price_cents, active, id);
    audit(db, user.id, 'editar', 'material', id, f.name);
    return publicItem(db, one(db, 'SELECT * FROM items WHERE id=?', id));
  });
}

const MIMES = { 'image/jpeg': [[0xff, 0xd8, 0xff]], 'image/png': [[0x89, 0x50, 0x4e, 0x47]], 'image/webp': [[0x52, 0x49, 0x46, 0x46]] };
export function setPhoto(db, user, id, mime, buf) {
  const magic = MIMES[mime];
  if (!magic) throw bad('Use uma foto JPG, PNG ou WebP.');
  if (!buf.length || buf.length > 1_500_000) throw bad('Foto muito grande. Escolha outra imagem.');
  if (!magic.some((m) => m.every((b, i) => buf[i] === b))) throw bad('O arquivo não parece ser uma imagem válida.');
  if (!one(db, 'SELECT 1 FROM items WHERE id=?', id)) throw new HttpError(404, 'Material não encontrado.');
  run(db, 'UPDATE items SET photo=?,photo_mime=?,photo_v=photo_v+1 WHERE id=?', buf, mime, id);
  audit(db, user.id, 'foto', 'material', id);
}
export function removePhoto(db, user, id) {
  run(db, 'UPDATE items SET photo=NULL,photo_mime=NULL,photo_v=photo_v+1 WHERE id=?', id);
  audit(db, user.id, 'remover foto', 'material', id);
}
export const getPhoto = (db, id) => one(db, 'SELECT photo,photo_mime FROM items WHERE id=? AND photo IS NOT NULL', id);

// ---- Materiais bloqueados (avariados / faltantes) ----
export const listBlocks = (db) => all(db, `SELECT b.id,b.item_id,i.name item_name,b.qty,b.reason,b.created_at,b.rental_id
    FROM blocks b JOIN items i ON i.id=b.item_id WHERE b.resolved_at IS NULL ORDER BY b.created_at`);

export function resolveBlock(db, user, id, action) {
  if (!['reparado', 'baixa'].includes(action)) throw bad('Ação inválida.');
  return tx(db, () => {
    const b = one(db, 'SELECT * FROM blocks WHERE id=? AND resolved_at IS NULL', id);
    if (!b) throw new HttpError(404, 'Bloqueio não encontrado.');
    run(db, 'UPDATE blocks SET resolved_at=?,resolution=? WHERE id=?', nowIso(), action, id);
    if (action === 'baixa') run(db, 'UPDATE items SET qty_total=qty_total-? WHERE id=?', b.qty, b.item_id);
    audit(db, user.id, action === 'baixa' ? 'baixa de estoque' : 'reparo', 'material', b.item_id, `${b.qty} un.`);
  });
}
