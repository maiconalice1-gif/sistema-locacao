import { bad, one, all, run, audit, nowIso, str, int, money, date, oneOf, HttpError, today } from './util.js';
import { tx } from './db.js';
import { rentalTotal, subtotal, buildSchedule, coverSchedule } from './money.js';
import { availableFor } from './catalog.js';

export const METHODS = ['Pix', 'Dinheiro', 'Débito', 'Crédito', 'Transferência', 'Boleto'];

const TOTAL_SQL = `(SELECT COALESCE(SUM(qty*unit_price_cents),0) FROM rental_items WHERE rental_id=r.id)+r.freight_cents-r.discount_cents`;
const PAID_SQL = `(SELECT COALESCE(SUM(CASE kind WHEN 'pagamento' THEN amount_cents ELSE -amount_cents END),0) FROM payments WHERE rental_id=r.id)`;

/** Lista de locações com total, valor recebido e saldo. */
export function listRentals(db, q = {}) {
  const where = [], params = [];
  if (q.status) { where.push('status=?'); params.push(q.status); }
  if (q.active) where.push(`status IN ('Reservado','Entregue')`);
  if (q.customer_id) { where.push('customer_id=?'); params.push(Number(q.customer_id)); }
  if (q.from) { where.push('start_date>=?'); params.push(q.from); }
  if (q.to) { where.push('start_date<=?'); params.push(q.to); }
  if (q.balance) where.push(`status!='Cancelado' AND total_cents>paid_cents`);
  if (q.q) {
    const like = `%${String(q.q).replace(/[%_\\]/g, '\\$&')}%`;
    where.push(`(customer_name LIKE ? ESCAPE '\\' OR customer_phone LIKE ? ESCAPE '\\' OR address LIKE ? ESCAPE '\\' OR items_summary LIKE ? ESCAPE '\\' OR CAST(id AS TEXT)=?)`);
    params.push(like, like, like, like, String(q.q).replace(/^#/, ''));
  }
  return all(db, `SELECT * FROM (
      SELECT r.id,r.status,r.start_date,r.end_date,r.address,r.customer_id,c.name customer_name,c.phone customer_phone,
             r.freight_cents,r.discount_cents,r.installments,
             ${TOTAL_SQL} AS total_cents, ${PAID_SQL} AS paid_cents,
             (SELECT group_concat(qty||' × '||name, ', ') FROM rental_items WHERE rental_id=r.id) AS items_summary
      FROM rentals r JOIN customers c ON c.id=r.customer_id)
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY start_date DESC, id DESC LIMIT 500`, ...params).map((r) => ({ ...r, balance_cents: r.status === 'Cancelado' ? 0 : Math.max(0, r.total_cents - r.paid_cents) }));
}

export function getRental(db, id) {
  const r = one(db, `SELECT r.*, c.name customer_name, c.phone customer_phone, c.doc customer_doc, c.email customer_email, c.address customer_address
                     FROM rentals r JOIN customers c ON c.id=r.customer_id WHERE r.id=?`, id);
  if (!r) throw new HttpError(404, 'Locação não encontrada.');
  const items = all(db, 'SELECT id,item_id,name,qty,unit_price_cents,returned_qty,damaged_qty FROM rental_items WHERE rental_id=? ORDER BY id', id).map((x) => ({ ...x }));
  const payments = all(db, `SELECT p.id,p.kind,p.amount_cents,p.method,p.date,p.note,u.name created_by_name
      FROM payments p LEFT JOIN users u ON u.id=p.created_by WHERE p.rental_id=? ORDER BY p.date,p.id`, id).map((x) => ({ ...x }));
  const total = rentalTotal(r, items);
  const paid = payments.reduce((a, p) => a + (p.kind === 'pagamento' ? p.amount_cents : -p.amount_cents), 0);
  const sched = coverSchedule(all(db, 'SELECT n,due_date,amount_cents FROM installments WHERE rental_id=? ORDER BY n', id).map((x) => ({ ...x })), paid);
  const t = today();
  return {
    ...r, items, payments,
    subtotal_cents: subtotal(items), total_cents: total, paid_cents: paid,
    balance_cents: r.status === 'Cancelado' ? 0 : Math.max(0, total - paid),
    installments_list: sched.map((p) => ({ ...p, overdue: r.status !== 'Cancelado' && p.open_cents > 0 && p.due_date < t })),
  };
}

function parseInput(b) {
  const start = date(b.start_date, 'Data de entrega'), end = date(b.end_date, 'Data de devolução');
  if (end < start) throw bad('A devolução não pode ser antes da entrega.');
  if (!Array.isArray(b.items) || !b.items.length) throw bad('Adicione pelo menos um material.');
  if (b.items.length > 100) throw bad('Materiais demais neste pedido.');
  const items = b.items.map((i) => ({
    item_id: int(i.item_id, 'Material', { min: 1 }),
    qty: int(i.qty, 'Quantidade', { min: 1, max: 100000 }),
    unit_price_cents: money(i.unit_price_cents, 'Preço unitário'),
  }));
  if (new Set(items.map((i) => i.item_id)).size !== items.length) throw bad('Material repetido no pedido.');
  const installments = int(b.installments ?? 1, 'Parcelas', { min: 1, max: 36 });
  return {
    customer_id: int(b.customer_id, 'Cliente', { min: 1 }), start, end, items, installments,
    address: str(b.address, 'Endereço de entrega', { max: 300 }),
    freight_cents: money(b.freight_cents ?? 0, 'Frete'),
    discount_cents: money(b.discount_cents ?? 0, 'Desconto'),
    notes: str(b.notes, 'Observações', { max: 2000, required: false }),
    first_due: b.first_due ? date(b.first_due, 'Primeiro vencimento') : start,
  };
}

function writeBody(db, rentalId, f, excl) {
  const sub = f.items.reduce((a, i) => a + i.qty * i.unit_price_cents, 0);
  if (f.discount_cents > sub) throw bad('O desconto é maior que o valor dos materiais.');
  for (const it of f.items) {
    const item = one(db, 'SELECT * FROM items WHERE id=? AND active=1', it.item_id);
    if (!item) throw bad('Material não encontrado ou inativo.');
    if (availableFor(db, item, f.start, f.end, excl) < it.qty) throw bad(`Estoque insuficiente: ${item.name}.`);
    run(db, 'INSERT INTO rental_items(rental_id,item_id,name,qty,unit_price_cents) VALUES (?,?,?,?,?)', rentalId, it.item_id, item.name, it.qty, it.unit_price_cents);
  }
  const total = sub + f.freight_cents - f.discount_cents;
  run(db, 'DELETE FROM installments WHERE rental_id=?', rentalId);
  for (const p of buildSchedule(total, f.installments, f.first_due))
    run(db, 'INSERT INTO installments(rental_id,n,due_date,amount_cents) VALUES (?,?,?,?)', rentalId, p.n, p.due_date, p.amount_cents);
  return total;
}

export function createRental(db, user, b) {
  const f = parseInput(b);
  return tx(db, () => {
    const c = one(db, 'SELECT id FROM customers WHERE id=? AND active=1', f.customer_id);
    if (!c) throw bad('Cliente não encontrado.');
    const r = run(db, `INSERT INTO rentals(customer_id,status,start_date,end_date,address,freight_cents,discount_cents,notes,installments,created_by,created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)`, f.customer_id, 'Reservado', f.start, f.end, f.address, f.freight_cents, f.discount_cents, f.notes, f.installments, user.id, nowIso());
    const id = Number(r.lastInsertRowid);
    writeBody(db, id, f, id);
    audit(db, user.id, 'criar', 'locação', id);
    return getRental(db, id);
  });
}

/** Só reservas ainda não entregues podem ser editadas. */
export function updateRental(db, user, id, b) {
  const f = parseInput(b);
  return tx(db, () => {
    const cur = one(db, 'SELECT * FROM rentals WHERE id=?', id);
    if (!cur) throw new HttpError(404, 'Locação não encontrada.');
    if (cur.status !== 'Reservado') throw bad('Só é possível editar reservas que ainda não foram entregues.');
    if (!one(db, 'SELECT id FROM customers WHERE id=? AND active=1', f.customer_id)) throw bad('Cliente não encontrado.');
    run(db, 'DELETE FROM rental_items WHERE rental_id=?', id);
    const total = writeBody(db, id, f, id);
    const paid = one(db, `SELECT COALESCE(SUM(CASE kind WHEN 'pagamento' THEN amount_cents ELSE -amount_cents END),0) n FROM payments WHERE rental_id=?`, id).n;
    if (total < paid) throw bad('O novo total ficaria menor que o valor já recebido. Faça o estorno antes.');
    run(db, `UPDATE rentals SET customer_id=?,start_date=?,end_date=?,address=?,freight_cents=?,discount_cents=?,notes=?,installments=? WHERE id=?`,
      f.customer_id, f.start, f.end, f.address, f.freight_cents, f.discount_cents, f.notes, f.installments, id);
    audit(db, user.id, 'editar', 'locação', id);
    return getRental(db, id);
  });
}

export function deliver(db, user, id, b) {
  return tx(db, () => {
    const r = one(db, 'SELECT * FROM rentals WHERE id=?', id);
    if (!r) throw new HttpError(404, 'Locação não encontrada.');
    if (r.status !== 'Reservado') throw bad('Entrega já validada ou pedido encerrado.');
    const items = all(db, 'SELECT item_id FROM rental_items WHERE rental_id=?', id).map((i) => i.item_id);
    const checked = Array.isArray(b.checked) ? b.checked.map(Number) : [];
    if (!items.every((i) => checked.includes(i))) throw bad('Confira todos os materiais antes de confirmar a entrega.');
    run(db, 'UPDATE rentals SET status=?,delivered_at=?,delivered_by=?,received_by=?,delivery_notes=? WHERE id=?', 'Entregue', nowIso(),
      str(b.delivered_by, 'Responsável pela entrega', { max: 120 }), str(b.received_by, 'Quem recebeu', { max: 120 }), str(b.notes, 'Observações', { max: 2000, required: false }), id);
    audit(db, user.id, 'entregar', 'locação', id);
    return getRental(db, id);
  });
}

export function returnRental(db, user, id, b) {
  return tx(db, () => {
    const r = one(db, 'SELECT * FROM rentals WHERE id=?', id);
    if (!r) throw new HttpError(404, 'Locação não encontrada.');
    if (r.status !== 'Entregue') throw bad('Valide a entrega antes da devolução.');
    const rows = all(db, 'SELECT * FROM rental_items WHERE rental_id=?', id);
    const given = Array.isArray(b.items) ? b.items : [];
    if (given.length !== rows.length) throw bad('Confira todos os materiais.');
    const now = nowIso();
    for (const row of rows) {
      const g = given.find((x) => Number(x.item_id) === row.item_id);
      if (!g) throw bad('Confira todos os materiais.');
      const returned = int(g.returned, 'Devolvidos', { max: row.qty }), damaged = int(g.damaged ?? 0, 'Avariados', { max: returned });
      run(db, 'UPDATE rental_items SET returned_qty=?,damaged_qty=? WHERE id=?', returned, damaged, row.id);
      if (row.qty - returned > 0) run(db, 'INSERT INTO blocks(item_id,rental_id,qty,reason,created_at) VALUES (?,?,?,?,?)', row.item_id, id, row.qty - returned, 'Faltante', now);
      if (damaged > 0) run(db, 'INSERT INTO blocks(item_id,rental_id,qty,reason,created_at) VALUES (?,?,?,?,?)', row.item_id, id, damaged, 'Avariado', now);
    }
    run(db, 'UPDATE rentals SET status=?,returned_at=?,return_notes=? WHERE id=?', 'Devolvido', now, str(b.notes, 'Observações', { max: 2000, required: false }), id);
    audit(db, user.id, 'devolver', 'locação', id);
    return getRental(db, id);
  });
}

export function cancel(db, user, id) {
  return tx(db, () => {
    const r = getRental(db, id);
    if (r.status !== 'Reservado') throw bad('Só reservas podem ser canceladas.');
    if (r.paid_cents !== 0) throw bad('Pedido com pagamento: registre o estorno antes de cancelar.');
    run(db, 'UPDATE rentals SET status=?,cancelled_at=? WHERE id=?', 'Cancelado', nowIso(), id);
    audit(db, user.id, 'cancelar', 'locação', id);
    return getRental(db, id);
  });
}

function money_in(db, user, id, b, kind) {
  return tx(db, () => {
    const r = getRental(db, id);
    if (r.status === 'Cancelado') throw bad('Pedido cancelado.');
    const amount = money(b.amount_cents, 'Valor', { min: 1 }), method = oneOf(b.method, 'Forma de pagamento', METHODS), d = date(b.date, 'Data');
    const note = str(b.note, 'Observação', { max: 300, required: false });
    if (kind === 'pagamento' && amount > r.total_cents - r.paid_cents) throw bad('Pagamento maior que o saldo pendente.');
    if (kind === 'estorno' && amount > r.paid_cents) throw bad('Estorno maior que o valor recebido.');
    const p = run(db, 'INSERT INTO payments(rental_id,kind,amount_cents,method,date,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)', id, kind, amount, method, d, note, user.id, nowIso());
    run(db, `INSERT INTO cash(direction,category,description,amount_cents,method,date,rental_id,payment_id,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      kind === 'pagamento' ? 'Entrada' : 'Saída', kind === 'pagamento' ? 'Locação' : 'Estorno',
      `${kind === 'pagamento' ? 'Locação' : 'Estorno'} #${id} · ${r.customer_name}`, amount, method, d, id, p.lastInsertRowid, user.id, nowIso());
    audit(db, user.id, kind, 'locação', id, `${amount} centavos`);
    return getRental(db, id);
  });
}
export const pay = (db, user, id, b) => money_in(db, user, id, b, 'pagamento');
export const refund = (db, user, id, b) => money_in(db, user, id, b, 'estorno');
