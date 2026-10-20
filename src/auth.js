import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError, bad, one, run, sha256, token, nowIso } from './util.js';

const N = 16384, R = 8, P = 1;
export function hashPassword(pw) {
  const salt = randomBytes(16);
  const h = scryptSync(pw, salt, 32, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${h.toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  const [alg, n, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const h = scryptSync(pw, Buffer.from(salt, 'base64'), 32, { N: +n, r: +r, p: +p });
  const want = Buffer.from(hash, 'base64');
  return h.length === want.length && timingSafeEqual(h, want);
}
const DUMMY = hashPassword('senha-falsa-para-igualar-o-tempo');

export function checkPasswordRules(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw bad('A senha precisa ter pelo menos 8 caracteres.');
  if (pw.length > 200) throw bad('Senha muito longa.');
}

export const SESSION_DAYS = 30;
export function createSession(db, userId) {
  const t = token();
  run(db, 'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)', sha256(t), userId, Date.now() + SESSION_DAYS * 86400000);
  run(db, 'DELETE FROM sessions WHERE expires_at < ?', Date.now());
  return t;
}
export function userFromToken(db, t) {
  if (!t) return null;
  const row = one(db, `SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id
                       WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`, sha256(t), Date.now());
  return row ? { ...row } : null;
}
export const destroySession = (db, t) => t && run(db, 'DELETE FROM sessions WHERE token_hash=?', sha256(t));

// Bloqueio de tentativas de login: 5 erros => 10 minutos de espera (por IP + e-mail).
const fails = new Map();
const LIMIT = 5, LOCK_MS = 10 * 60 * 1000;
export function assertNotLocked(key) {
  const f = fails.get(key);
  if (f && f.count >= LIMIT && Date.now() - f.last < LOCK_MS)
    throw new HttpError(429, 'Muitas tentativas. Aguarde 10 minutos e tente de novo.');
}
export const registerFail = (key) => { const f = fails.get(key) || { count: 0 }; fails.set(key, { count: f.count + 1, last: Date.now() }); };
export const clearFails = (key) => fails.delete(key);
export const _resetFails = () => fails.clear();

export function login(db, email, password, key) {
  assertNotLocked(key);
  const u = one(db, 'SELECT * FROM users WHERE email=? AND active=1', String(email || '').trim());
  const ok = verifyPassword(String(password || ''), u ? u.pass_hash : DUMMY) && !!u;
  if (!ok) { registerFail(key); throw new HttpError(401, 'E-mail ou senha incorretos.'); }
  clearFails(key);
  return { user: { id: u.id, name: u.name, email: u.email, role: u.role }, token: createSession(db, u.id) };
}
export const userCount = (db) => one(db, 'SELECT COUNT(*) n FROM users').n;
export const created = nowIso;
