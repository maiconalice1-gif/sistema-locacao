import { createServer } from 'node:http';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { _resetFails } from '../src/auth.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

export async function startTestServer() {
  _resetFails();
  const db = openDb(':memory:');
  const server = createServer(createApp({ db, publicDir }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    const call = async (method, path, body, headers = {}) => {
      const isRaw = Buffer.isBuffer(body);
      const res = await fetch(base + path, {
        method, redirect: 'manual',
        headers: { ...(body && !isRaw ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: body ? (isRaw ? body : JSON.stringify(body)) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.startsWith('sid=;') ? '' : set.split(';')[0];
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
      return { status: res.status, data, headers: res.headers };
    };
    return { get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), put: (p, b = {}) => call('PUT', p, b), patch: (p, b) => call('PATCH', p, b), del: (p) => call('DELETE', p), call };
  };
  return { db, base, client, close: () => new Promise((r) => { server.close(r); server.closeAllConnections?.(); }) };
}

/** Cria o servidor, o administrador e devolve um cliente já logado. */
export async function setup() {
  const s = await startTestServer();
  const admin = s.client();
  const r = await admin.post('/api/setup', { name: 'Dona', email: 'dona@teste.com', password: 'senha-forte-123' });
  if (r.status !== 200) throw new Error('setup falhou: ' + JSON.stringify(r.data));
  return { ...s, admin };
}
export const reais = (n) => Math.round(n * 100);
