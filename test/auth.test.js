import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, setup } from './helpers.js';

test('primeiro acesso, login, permissões e bloqueio de tentativas', async () => {
  const s = await startTestServer();
  const c = s.client();
  let me = await c.get('/api/me');
  assert.equal(me.data.needs_setup, true);
  assert.equal(me.data.user, null);
  assert.equal((await c.get('/api/items')).status, 401, 'sem login não acessa');
  assert.equal((await c.post('/api/setup', { name: 'A', email: 'a@a.com', password: 'curta' })).status, 400, 'senha fraca');
  assert.equal((await c.post('/api/setup', { name: 'Dona', email: 'dona@teste.com', password: 'senha-forte-123' })).status, 200);
  me = await c.get('/api/me');
  assert.equal(me.data.user.role, 'admin');
  assert.equal(me.data.needs_setup, false);
  assert.equal((await s.client().post('/api/setup', { name: 'X', email: 'x@x.com', password: 'outra-senha-123' })).status, 400, 'setup só uma vez');

  // funcionário
  assert.equal((await c.post('/api/users', { name: 'Ana', email: 'ana@teste.com', password: 'senha-da-ana-1', role: 'staff' })).status, 200);
  const staff = s.client();
  assert.equal((await staff.post('/api/login', { email: 'ANA@teste.com', password: 'senha-da-ana-1' })).status, 200, 'e-mail sem diferenciar maiúsculas');
  assert.equal((await staff.get('/api/users')).status, 403, 'funcionário não vê usuários');
  assert.equal((await staff.get('/api/backup')).status, 403, 'funcionário não baixa backup');
  assert.equal((await staff.post('/api/customers', { name: 'Cliente' })).status, 200, 'funcionário cadastra cliente');

  // logout invalida o cookie
  await staff.post('/api/logout');
  assert.equal((await staff.get('/api/customers')).status, 401);

  // bloqueio após 5 erros
  const bad = s.client();
  for (let i = 0; i < 5; i++) assert.equal((await bad.post('/api/login', { email: 'ana@teste.com', password: 'errada-errada' })).status, 401);
  const locked = await bad.post('/api/login', { email: 'ana@teste.com', password: 'senha-da-ana-1' });
  assert.equal(locked.status, 429, 'bloqueado mesmo com a senha certa');

  // não pode desativar o único admin
  const users = (await c.get('/api/users')).data;
  const admin = users.find((u) => u.role === 'admin');
  assert.equal((await c.patch(`/api/users/${admin.id}`, { active: false })).status, 400);
  assert.equal((await c.patch(`/api/users/${admin.id}`, { role: 'staff' })).status, 400);
  await s.close();
});

test('proteções: origem diferente, caminho fora da pasta pública, cabeçalhos', async () => {
  const { admin, base, close } = await setup();
  const evil = await admin.call('POST', '/api/customers', { name: 'X' }, { Origin: 'https://site-malicioso.com' });
  assert.equal(evil.status, 403, 'origem diferente é recusada');
  const ok = await admin.call('POST', '/api/customers', { name: 'X' }, { Origin: base });
  assert.equal(ok.status, 200);
  assert.equal((await fetch(base + '/..%2f..%2fetc/passwd')).status, 404);
  assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
  const home = await fetch(base + '/');
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  assert.equal((await admin.call('POST', '/api/customers', Buffer.from('{nao json'), { 'Content-Type': 'application/json' })).status, 400);
  await close();
});

test('trocar a senha mantém o usuário logado e exige a senha atual', async () => {
  const { admin, base, close } = await setup();
  assert.equal((await admin.post('/api/me/password', { current: 'errada', password: 'nova-senha-123' })).status, 400);
  assert.equal((await admin.post('/api/me/password', { current: 'senha-forte-123', password: 'nova-senha-123' })).status, 200);
  assert.equal((await admin.get('/api/items')).status, 200, 'continua logado');
  assert.equal((await base_login(base, 'nova-senha-123')).status, 200, 'a senha nova funciona');
  await close();
});

async function base_login(base, password) {
  return fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'dona@teste.com', password }) });
}
