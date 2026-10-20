import { readFileSync, existsSync, statSync, createReadStream, unlinkSync } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { HttpError, bad, one, all, run, audit, nowIso, today, isDate } from './util.js';
import { tx } from './db.js';
import * as A from './auth.js';
import * as C from './catalog.js';
import * as R from './rentals.js';
import * as F from './finance.js';
import * as P from './people.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const SECURITY = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
};

export function createApp({ db, publicDir, dataDir = '.', trustProxy = false, secureCookie = false }) {
  const routes = [];
  const route = (method, path, access, fn, opts = {}) =>
    routes.push({ method, re: new RegExp('^' + path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), access, fn, opts });

  // ---- Autenticação ----
  route('GET', '/api/me', 'public', ({ user }) => ({ user, needs_setup: !user && A.userCount(db) === 0, today: today() }));
  route('POST', '/api/setup', 'public', ({ body, res, req }) => {
    if (A.userCount(db) > 0) throw bad('O sistema já foi configurado.');
    const u = P.createUser(db, null, { ...body, role: 'admin' });
    return startSession(req, res, u);
  });
  route('POST', '/api/login', 'public', ({ body, res, req }) => {
    const { user, token } = A.login(db, body.email, body.password, `${clientIp(req)}|${String(body.email || '').toLowerCase()}`);
    setCookie(req, res, token);
    return { user };
  });
  route('POST', '/api/logout', 'user', ({ req, res }) => { A.destroySession(db, cookies(req).sid); clearCookie(res); return { ok: true }; });
  route('POST', '/api/me/password', 'user', ({ user, body, res }) => {
    const row = one(db, 'SELECT pass_hash FROM users WHERE id=?', user.id);
    if (!A.verifyPassword(String(body.current || ''), row.pass_hash)) throw bad('A senha atual está incorreta.');
    P.updateUser(db, user, user.id, { password: body.password });
    return startSession(null, res, user, true);
  });

  // ---- Usuários e configurações ----
  route('GET', '/api/users', 'admin', () => P.listUsers(db));
  route('POST', '/api/users', 'admin', ({ user, body }) => P.createUser(db, user, body));
  route('PATCH', '/api/users/:id', 'admin', ({ user, params, body }) => { P.updateUser(db, user, +params.id, body); return { ok: true }; });
  route('GET', '/api/settings', 'user', () => P.getSettings(db));
  route('PUT', '/api/settings', 'admin', ({ user, body }) => P.saveSettings(db, user, body));

  // ---- Clientes ----
  route('GET', '/api/customers', 'user', ({ query }) => P.listCustomers(db, query.q || ''));
  route('POST', '/api/customers', 'user', ({ user, body }) => P.createCustomer(db, user, body));
  route('GET', '/api/customers/:id', 'user', ({ params }) => P.getCustomer(db, +params.id));
  route('PUT', '/api/customers/:id', 'user', ({ user, params, body }) => P.updateCustomer(db, user, +params.id, body));
  route('DELETE', '/api/customers/:id', 'admin', ({ user, params }) => { P.deleteCustomer(db, user, +params.id); return { ok: true }; });

  // ---- Materiais ----
  route('GET', '/api/items', 'user', ({ query }) => C.listItems(db, { all: query.all === '1' }));
  route('POST', '/api/items', 'user', ({ user, body }) => C.createItem(db, user, body));
  route('PUT', '/api/items/:id', 'user', ({ user, params, body }) => C.updateItem(db, user, +params.id, body));
  route('GET', '/api/availability', 'user', ({ query }) => C.availability(db, query.start, query.end, +query.exclude || 0));
  route('PUT', '/api/items/:id/photo', 'user', ({ user, params, raw, req }) => { C.setPhoto(db, user, +params.id, String(req.headers['content-type'] || '').split(';')[0], raw); return { ok: true }; }, { raw: true });
  route('DELETE', '/api/items/:id/photo', 'user', ({ user, params }) => { C.removePhoto(db, user, +params.id); return { ok: true }; });
  route('GET', '/api/items/:id/photo', 'user', ({ params }) => {
    const p = C.getPhoto(db, +params.id);
    if (!p) throw new HttpError(404, 'Sem foto.');
    return { raw: Buffer.from(p.photo), type: p.photo_mime, headers: { 'Cache-Control': 'private, max-age=31536000, immutable' } };
  });
  route('GET', '/api/blocks', 'user', () => C.listBlocks(db));
  route('POST', '/api/blocks/:id/resolve', 'user', ({ user, params, body }) => { C.resolveBlock(db, user, +params.id, body.action); return { ok: true }; });

  // ---- Locações ----
  route('GET', '/api/rentals', 'user', ({ query }) => R.listRentals(db, query));
  route('POST', '/api/rentals', 'user', ({ user, body }) => R.createRental(db, user, body));
  route('GET', '/api/rentals/:id', 'user', ({ params }) => R.getRental(db, +params.id));
  route('PUT', '/api/rentals/:id', 'user', ({ user, params, body }) => R.updateRental(db, user, +params.id, body));
  route('POST', '/api/rentals/:id/deliver', 'user', ({ user, params, body }) => R.deliver(db, user, +params.id, body));
  route('POST', '/api/rentals/:id/return', 'user', ({ user, params, body }) => R.returnRental(db, user, +params.id, body));
  route('POST', '/api/rentals/:id/cancel', 'user', ({ user, params }) => R.cancel(db, user, +params.id));
  route('POST', '/api/rentals/:id/payments', 'user', ({ user, params, body }) => R.pay(db, user, +params.id, body));
  route('POST', '/api/rentals/:id/refund', 'user', ({ user, params, body }) => R.refund(db, user, +params.id, body));

  // ---- Caixa e painel ----
  route('GET', '/api/dashboard', 'user', () => F.dashboard(db));
  route('GET', '/api/cash', 'user', ({ query }) => F.listCash(db, query.month || today().slice(0, 7)));
  route('POST', '/api/cash', 'user', ({ user, body }) => F.addCash(db, user, body));
  route('DELETE', '/api/cash/:id', 'admin', ({ user, params }) => { F.deleteCash(db, user, +params.id); return { ok: true }; });
  route('GET', '/api/cash.csv', 'user', ({ query }) => ({ raw: Buffer.from(F.cashCsv(db, query.month || today().slice(0, 7))), type: 'text/csv; charset=utf-8', headers: { 'Content-Disposition': `attachment; filename="caixa-${query.month || today().slice(0, 7)}.csv"` } }));
  route('GET', '/api/meta', 'user', () => ({ methods: R.METHODS, categories: F.CATEGORIES }));

  // ---- Cópia de segurança (somente administrador) ----
  route('GET', '/api/backup', 'admin', ({ user }) => {
    const file = join(tmpdir(), `backup-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    audit(db, user.id, 'backup', 'sistema', null);
    return { file, type: 'application/octet-stream', headers: { 'Content-Disposition': `attachment; filename="locacao-${today()}.sqlite"` } };
  });
  route('GET', '/healthz', 'public', () => { one(db, 'SELECT 1'); return { ok: true }; });

  // ---- Utilidades ----
  const clientIp = (req) => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
  const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
  const isSecure = (req) => secureCookie || (req && trustProxy && req.headers['x-forwarded-proto'] === 'https');
  const setCookie = (req, res, t) => res.setHeader('Set-Cookie', `sid=${encodeURIComponent(t)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${A.SESSION_DAYS * 86400}${isSecure(req) ? '; Secure' : ''}`);
  const clearCookie = (res) => res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  function startSession(req, res, user, reuse = false) {
    const t = A.createSession(db, user.id);
    setCookie(req, res, t);
    return { user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  }

  async function readBody(req, limit) {
    const chunks = []; let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 20_000_000) { req.destroy(); throw new HttpError(413, 'Arquivo ou dados grandes demais.'); }
      if (size <= limit) chunks.push(c); // acima do limite apenas descarta, para poder responder com o erro certo
    }
    if (size > limit) throw new HttpError(413, 'Arquivo ou dados grandes demais.');
    return Buffer.concat(chunks);
  }
  const send = (res, status, body, headers = {}) => { res.writeHead(status, { ...SECURITY, ...headers }); res.end(body); };
  const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });

  function serveStatic(req, res, pathname) {
    let rel;
    try { rel = normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname)); } catch { return send(res, 400, 'Requisição inválida.'); }
    const file = join(publicDir, rel);
    if (!file.startsWith(publicDir + sep) || !existsSync(file) || !statSync(file).isFile()) return send(res, 404, 'Não encontrado.', { 'Content-Type': 'text/plain; charset=utf-8' });
    res.writeHead(200, { ...SECURITY, 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
  }

  return async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://x');
      const isApi = url.pathname.startsWith('/api/') || url.pathname === '/healthz';
      if (!isApi) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método não permitido.');
        return serveStatic(req, res, url.pathname);
      }
      const match = routes.map((r) => ({ r, m: r.method === req.method ? r.re.exec(url.pathname) : null })).find((x) => x.m);
      if (!match) {
        const pathExists = routes.some((r) => r.re.test(url.pathname));
        throw new HttpError(pathExists ? 405 : 404, pathExists ? 'Método não permitido.' : 'Não encontrado.');
      }
      const { r, m } = match;
      if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) {
        let ok = false;
        try { ok = new URL(req.headers.origin).host === req.headers.host; } catch {}
        if (!ok) throw new HttpError(403, 'Origem inválida.');
      }
      const user = A.userFromToken(db, cookies(req).sid);
      if (r.access !== 'public' && !user) throw new HttpError(401, 'Faça login para continuar.');
      if (r.access === 'admin' && user.role !== 'admin') throw new HttpError(403, 'Apenas administradores podem fazer isso.');
      let body = {}, raw = null;
      if (!['GET', 'HEAD', 'DELETE'].includes(req.method)) {
        const buf = await readBody(req, r.opts.raw ? 1_600_000 : 200_000);
        if (r.opts.raw) raw = buf;
        else if (buf.length) {
          try { body = JSON.parse(buf.toString('utf8')); } catch { throw bad('Dados inválidos.'); }
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Dados inválidos.');
        }
      }
      const out = r.fn({ req, res, user, params: m.groups || {}, query: Object.fromEntries(url.searchParams), body, raw });
      if (out && out.file) {
        res.writeHead(200, { ...SECURITY, 'Content-Type': out.type, ...out.headers, 'Cache-Control': 'no-store' });
        const s = createReadStream(out.file);
        const cleanup = () => { try { unlinkSync(out.file); } catch {} };
        s.on('close', cleanup); s.on('error', cleanup); return s.pipe(res);
      }
      if (out && out.raw) { res.writeHead(200, { ...SECURITY, 'Content-Type': out.type, 'Cache-Control': 'no-store', ...(out.headers || {}) }); return res.end(out.raw); }
      sendJson(res, 200, out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
      const msg = String(e && e.message || '');
      if (/UNIQUE constraint/.test(msg)) return sendJson(res, 400, { error: 'Já existe um registro com esses dados.' });
      console.error('[erro]', e);
      sendJson(res, 500, { error: 'Erro interno. Tente novamente.' });
    }
  };
}
