import { createHash, randomBytes } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const bad = (m) => new HttpError(400, m);
export const nowIso = () => new Date().toISOString();
export const TZ = process.env.APP_TZ || 'America/Sao_Paulo';
/** Data de hoje (AAAA-MM-DD) no fuso do negócio. */
export const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date());
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const token = () => randomBytes(32).toString('base64url');

export const isDate = (s) =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
export const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

export function str(v, name, { max = 300, required = true } = {}) {
  if (v == null) v = '';
  if (typeof v !== 'string') throw bad(`${name} inválido.`);
  v = v.trim();
  if (required && !v) throw bad(`Informe: ${name}.`);
  if (v.length > max) throw bad(`${name} muito longo.`);
  return v;
}
export function int(v, name, { min = 0, max = 1_000_000_000 } = {}) {
  if (typeof v === 'string' && /^-?\d+$/.test(v)) v = Number(v);
  if (!Number.isInteger(v) || v < min || v > max) throw bad(`${name} inválido.`);
  return v;
}
/** Valores em dinheiro trafegam como centavos inteiros (até R$ 1.000.000,00). */
export const money = (v, name, { min = 0 } = {}) => int(v, name, { min, max: 100_000_000 });
export function date(v, name) {
  if (!isDate(v)) throw bad(`${name} inválida.`);
  return v;
}
export function oneOf(v, name, list) {
  if (!list.includes(v)) throw bad(`${name} inválido.`);
  return v;
}
export const one = (db, sql, ...p) => db.prepare(sql).get(...p);
export const all = (db, sql, ...p) => db.prepare(sql).all(...p);
export const run = (db, sql, ...p) => db.prepare(sql).run(...p);

export function audit(db, userId, action, entity, entityId, detail = '') {
  run(db, 'INSERT INTO audit(at,user_id,action,entity,entity_id,detail) VALUES (?,?,?,?,?,?)', nowIso(), userId ?? null, action, entity, entityId ?? null, String(detail).slice(0, 500));
}
