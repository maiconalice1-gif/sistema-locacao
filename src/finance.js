import { bad, one, all, run, audit, nowIso, str, money, date, oneOf, HttpError, today, addDays } from './util.js';
import { listRentals } from './rentals.js';
import { coverSchedule } from './money.js';
import { METHODS } from './rentals.js';

export const CATEGORIES = ['Locação', 'Estorno', 'Combustível', 'Manutenção', 'Compra de material', 'Pessoal', 'Aluguel/contas', 'Outros'];
const month = (m) => { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m || '')) throw bad('Mês inválido.'); return m; };

export function listCash(db, m) {
  m = month(m);
  const rows = all(db, `SELECT id,direction,category,description,amount_cents,method,date,rental_id,payment_id FROM cash WHERE date LIKE ? ORDER BY date DESC, id DESC`, m + '-%').map((r) => ({ ...r }));
  const income = rows.filter((r) => r.direction === 'Entrada').reduce((a, r) => a + r.amount_cents, 0);
  const expense = rows.filter((r) => r.direction === 'Saída').reduce((a, r) => a + r.amount_cents, 0);
  const balance = one(db, `SELECT COALESCE(SUM(CASE direction WHEN 'Entrada' THEN amount_cents ELSE -amount_cents END),0) n FROM cash`).n;
  const byCategory = {};
  for (const r of rows) if (r.direction === 'Saída') byCategory[r.category || 'Outros'] = (byCategory[r.category || 'Outros'] || 0) + r.amount_cents;
  return { month: m, rows, income_cents: income, expense_cents: expense, result_cents: income - expense, balance_cents: balance, expense_by_category: byCategory };
}

export function addCash(db, user, b) {
  const direction = oneOf(b.direction, 'Tipo', ['Entrada', 'Saída']);
  const e = {
    direction, category: oneOf(b.category || 'Outros', 'Categoria', CATEGORIES),
    description: str(b.description, 'Descrição', { max: 200 }), amount: money(b.amount_cents, 'Valor', { min: 1 }),
    method: oneOf(b.method, 'Forma', METHODS), date: date(b.date, 'Data'),
  };
  if (e.category === 'Locação' || e.category === 'Estorno') throw bad('Pagamentos de locação são lançados dentro do pedido.');
  const r = run(db, 'INSERT INTO cash(direction,category,description,amount_cents,method,date,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)',
    e.direction, e.category, e.description, e.amount, e.method, e.date, user.id, nowIso());
  audit(db, user.id, 'lançar', 'caixa', r.lastInsertRowid, e.description);
  return { id: Number(r.lastInsertRowid) };
}

export function deleteCash(db, user, id) {
  const c = one(db, 'SELECT * FROM cash WHERE id=?', id);
  if (!c) throw new HttpError(404, 'Lançamento não encontrado.');
  if (c.payment_id) throw bad('Lançamentos de pagamento só podem ser corrigidos com estorno no pedido.');
  run(db, 'DELETE FROM cash WHERE id=?', id);
  audit(db, user.id, 'excluir', 'caixa', id, `${c.description} (${c.amount_cents})`);
}

const csvCell = (v) => '"' + String(v).replace(/"/g, '""').replace(/^[=+@\-\t\r]/, "'$&") + '"';
export function cashCsv(db, m) {
  const { rows } = listCash(db, m);
  const lines = [['Data', 'Tipo', 'Categoria', 'Descrição', 'Forma', 'Valor (R$)']].concat(
    rows.slice().reverse().map((r) => [r.date, r.direction, r.category, r.description, r.method, (r.amount_cents / 100).toFixed(2).replace('.', ',')]));
  return '﻿' + lines.map((l) => l.map(csvCell).join(';')).join('\r\n');
}

/** Resumo da tela inicial. */
export function dashboard(db) {
  const t = today(), m = t.slice(0, 7), week = addDays(t, 7);
  const active = listRentals(db, { active: true });
  const open = listRentals(db, { balance: true });
  const overdueRows = [];
  for (const r of open) {
    const ins = all(db, 'SELECT n,due_date,amount_cents FROM installments WHERE rental_id=? ORDER BY n', r.id).map((x) => ({ ...x }));
    for (const p of coverSchedule(ins, r.paid_cents))
      if (p.open_cents > 0 && p.due_date < t) overdueRows.push({ rental_id: r.id, customer_name: r.customer_name, customer_phone: r.customer_phone, n: p.n, due_date: p.due_date, open_cents: p.open_cents });
  }
  overdueRows.sort((a, b) => a.due_date.localeCompare(b.due_date));
  const monthCash = one(db, `SELECT COALESCE(SUM(CASE WHEN direction='Entrada' THEN amount_cents END),0) inc, COALESCE(SUM(CASE WHEN direction='Saída' THEN amount_cents END),0) exp FROM cash WHERE date LIKE ?`, m + '-%');
  const agenda = [];
  for (const r of active) {
    if (r.status === 'Reservado' && r.start_date >= t && r.start_date <= week) agenda.push({ date: r.start_date, type: 'Entrega', rental: r });
    if (r.end_date >= t && r.end_date <= week) agenda.push({ date: r.end_date, type: 'Devolução', rental: r });
  }
  agenda.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));
  return {
    today: t,
    deliveries_today: active.filter((r) => r.status === 'Reservado' && r.start_date === t),
    deliveries_late: active.filter((r) => r.status === 'Reservado' && r.start_date < t),
    returns_due: active.filter((r) => r.status === 'Entregue' && r.end_date <= t),
    overdue_installments: overdueRows.slice(0, 20),
    overdue_total_cents: overdueRows.reduce((a, r) => a + r.open_cents, 0),
    overdue_count: overdueRows.length,
    receivable_cents: open.reduce((a, r) => a + r.balance_cents, 0),
    month_income_cents: monthCash.inc, month_expense_cents: monthCash.exp,
    cash_balance_cents: one(db, `SELECT COALESCE(SUM(CASE direction WHEN 'Entrada' THEN amount_cents ELSE -amount_cents END),0) n FROM cash`).n,
    blocked_units: one(db, 'SELECT COALESCE(SUM(qty),0) n FROM blocks WHERE resolved_at IS NULL').n,
    agenda,
  };
}
