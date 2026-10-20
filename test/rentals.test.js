import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, reais } from './helpers.js';
import { buildSchedule, coverSchedule } from '../src/money.js';
import { addDays, today } from '../src/util.js';

const novoItem = async (c, name, qty, price = 5) => (await c.post('/api/items', { name, qty_total: qty, price_cents: reais(price) })).data;
const novoCliente = async (c, name = 'Ana', phone = '(11) 99999-1234') => (await c.post('/api/customers', { name, phone, address: 'Rua A, 10' })).data;
const pedido = (cliente, itens, ini, fim, extra = {}) => ({ customer_id: cliente.id, start_date: ini, end_date: fim, address: 'Rua A, 10', items: itens.map(([it, qty, price]) => ({ item_id: it.id, qty, unit_price_cents: price ?? it.price_cents })), freight_cents: 0, ...extra });

test('parcelas: soma exata, fim de mês e cobertura pelos pagamentos', () => {
  const s = buildSchedule(10000, 3, '2026-01-31');
  assert.deepEqual(s.map((p) => p.amount_cents), [3334, 3333, 3333]);
  assert.deepEqual(s.map((p) => p.due_date), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.equal(s.reduce((a, p) => a + p.amount_cents, 0), 10000);
  assert.deepEqual(coverSchedule(s, 4000).map((p) => p.open_cents), [0, 2667, 3333]);
  assert.equal(buildSchedule(0, 3, '2026-01-01').length, 0, 'pedido de valor zero não gera parcelas');
});

test('estoque por data: conflitos, períodos que não se cruzam, bloqueio de edição de quantidade', async () => {
  const { admin: c, close } = await setup();
  const cad = await novoItem(c, 'Cadeiras', 10);
  const ana = await novoCliente(c);
  assert.equal((await c.post('/api/rentals', pedido(ana, [[cad, 6]], '2026-10-14', '2026-10-16', { freight_cents: 1000 }))).data.total_cents, 6 * 500 + 1000);
  assert.match((await c.post('/api/rentals', pedido(ana, [[cad, 5]], '2026-10-16', '2026-10-18'))).data.error, /Estoque insuficiente/);
  assert.equal((await c.post('/api/rentals', pedido(ana, [[cad, 10]], '2026-10-17', '2026-10-18'))).status, 200, 'período que não cruza');
  assert.equal((await c.post('/api/rentals', pedido(ana, [[cad, 4]], '2026-10-15', '2026-10-15'))).status, 200, 'cabe no que sobra');
  assert.match((await c.put(`/api/items/${cad.id}`, { qty_total: 5 })).data.error, /reservados ou bloqueados/);
  const disp = (await c.get('/api/availability?start=2026-10-14&end=2026-10-14')).data.find((i) => i.id === cad.id);
  assert.equal(disp.available, 4);
  assert.equal((await c.get('/api/availability?start=2026-10-20&end=2026-10-19')).status, 400, 'fim antes do início');
  await close();
});

test('validações do pedido', async () => {
  const { admin: c, close } = await setup();
  const mesa = await novoItem(c, 'Mesa', 5, 50);
  const ana = await novoCliente(c);
  const ok = pedido(ana, [[mesa, 1]], '2026-11-01', '2026-11-02');
  assert.equal((await c.post('/api/rentals', { ...ok, items: [] })).status, 400, 'sem itens');
  assert.equal((await c.post('/api/rentals', { ...ok, items: [{ item_id: mesa.id, qty: 1, unit_price_cents: 100 }, { item_id: mesa.id, qty: 1, unit_price_cents: 100 }] })).status, 400, 'item repetido');
  assert.equal((await c.post('/api/rentals', { ...ok, start_date: '2026-02-30' })).status, 400, 'data impossível');
  assert.equal((await c.post('/api/rentals', { ...ok, discount_cents: 999999 })).status, 400, 'desconto maior que o valor');
  assert.equal((await c.post('/api/rentals', { ...ok, customer_id: 999 })).status, 400, 'cliente inexistente');
  assert.equal((await c.post('/api/rentals', { ...ok, items: [{ item_id: mesa.id, qty: 1.5, unit_price_cents: 100 }] })).status, 400, 'quantidade quebrada');
  assert.equal((await c.post('/api/rentals', { ...ok, items: [{ item_id: mesa.id, qty: 1, unit_price_cents: -5 }] })).status, 400, 'preço negativo');
  assert.equal((await c.post('/api/rentals', { ...ok, installments: 99 })).status, 400, 'parcelas demais');
  assert.equal((await c.post('/api/items', { name: 'mesa', qty_total: 1, price_cents: 1 })).status, 400, 'nome repetido sem diferenciar maiúsculas');
  await close();
});

test('pagamento parcial, estorno, cancelamento e edição', async () => {
  const { admin: c, close } = await setup();
  const mesa = await novoItem(c, 'Mesa', 10, 50);
  const ana = await novoCliente(c);
  const r = (await c.post('/api/rentals', pedido(ana, [[mesa, 4]], '2026-11-01', '2026-11-02', { freight_cents: 10, installments: 3, first_due: '2026-11-01' }))).data;
  assert.equal(r.total_cents, 20010);
  const pay = (v, extra = {}) => c.post(`/api/rentals/${r.id}/payments`, { amount_cents: v, method: 'Pix', date: '2026-11-01', ...extra });
  assert.equal((await pay(6670)).status, 200);
  assert.match((await pay(99999)).data.error, /maior que o saldo/);
  assert.equal((await pay(5, { method: 'Cheque' })).status, 400, 'forma inválida');
  let d = (await c.get(`/api/rentals/${r.id}`)).data;
  assert.equal(d.paid_cents, 6670); assert.equal(d.balance_cents, 13340);
  assert.deepEqual(d.installments_list.map((p) => p.open_cents), [0, 6670, 6670]);
  // pedido com pagamento: editar para total menor que o recebido falha; cancelar exige estorno
  assert.match((await c.put(`/api/rentals/${r.id}`, pedido(ana, [[mesa, 1, 100]], '2026-11-01', '2026-11-02'))).data.error, /menor que o valor já recebido/);
  assert.equal((await c.get(`/api/rentals/${r.id}`)).data.items.length, 1, 'edição recusada não altera o pedido');
  assert.match((await c.post(`/api/rentals/${r.id}/cancel`)).data.error, /estorno/);
  assert.match((await c.post(`/api/rentals/${r.id}/refund`, { amount_cents: 9999, method: 'Pix', date: '2026-11-01' })).data.error, /maior que o valor recebido/);
  assert.equal((await c.post(`/api/rentals/${r.id}/refund`, { amount_cents: 6670, method: 'Pix', date: '2026-11-02' })).status, 200);
  d = (await c.get(`/api/rentals/${r.id}`)).data;
  assert.equal(d.paid_cents, 0);
  // editar libera/ocupa estoque corretamente
  const e = await c.put(`/api/rentals/${r.id}`, pedido(ana, [[mesa, 10, 50]], '2026-11-01', '2026-11-02', { installments: 1 }));
  assert.equal(e.status, 200, 'pode usar a própria reserva ao editar'); assert.equal(e.data.total_cents, 50 * 10);
  assert.equal((await c.post(`/api/rentals/${r.id}/cancel`)).data.status, 'Cancelado');
  assert.equal((await c.get('/api/availability?start=2026-11-01&end=2026-11-02')).data.find((i) => i.id === mesa.id).available, 10, 'cancelar libera o estoque');
  assert.equal((await pay(1)).status, 400, 'pedido cancelado não recebe');
  // caixa: pagamento e estorno aparecem; lançamentos de pagamento não podem ser apagados
  const cash = (await c.get('/api/cash?month=2026-11')).data;
  assert.equal(cash.income_cents, 6670); assert.equal(cash.expense_cents, 6670); assert.equal(cash.result_cents, 0);
  assert.equal((await c.del(`/api/cash/${cash.rows[0].id}`)).status, 400);
  await close();
});

test('entrega, devolução com falta e avaria, bloqueados e baixa', async () => {
  const { admin: c, close } = await setup();
  const mesa = await novoItem(c, 'Mesa', 10, 50);
  const ana = await novoCliente(c);
  const r = (await c.post('/api/rentals', pedido(ana, [[mesa, 5]], '2026-11-01', '2026-11-02'))).data;
  assert.match((await c.post(`/api/rentals/${r.id}/return`, { items: [{ item_id: mesa.id, returned: 5 }] })).data.error, /entrega/);
  assert.match((await c.post(`/api/rentals/${r.id}/deliver`, { checked: [], delivered_by: 'João', received_by: 'Ana' })).data.error, /Confira/);
  assert.equal((await c.post(`/api/rentals/${r.id}/deliver`, { checked: [mesa.id], delivered_by: 'João', received_by: 'Ana' })).data.status, 'Entregue');
  assert.match((await c.post(`/api/rentals/${r.id}/deliver`, { checked: [mesa.id], delivered_by: 'João', received_by: 'Ana' })).data.error, /já validada/);
  assert.match((await c.put(`/api/rentals/${r.id}`, pedido(ana, [[mesa, 1]], '2026-11-01', '2026-11-02'))).data.error, /ainda não foram entregues/);
  // entregue continua ocupando estoque até devolver
  assert.match((await c.post('/api/rentals', pedido(ana, [[mesa, 6]], '2026-12-01', '2026-12-02'))).data.error, /Estoque insuficiente/);
  assert.match((await c.post(`/api/rentals/${r.id}/return`, { items: [{ item_id: mesa.id, returned: 6 }] })).data.error, /inválido/);
  assert.match((await c.post(`/api/rentals/${r.id}/return`, { items: [{ item_id: mesa.id, returned: 3, damaged: 4 }] })).data.error, /inválido/);
  const dev = (await c.post(`/api/rentals/${r.id}/return`, { items: [{ item_id: mesa.id, returned: 4, damaged: 1 }], notes: 'uma sumiu, uma quebrou' })).data;
  assert.equal(dev.status, 'Devolvido');
  const blocks = (await c.get('/api/blocks')).data;
  assert.deepEqual(blocks.map((b) => [b.reason, b.qty]).sort(), [['Avariado', 1], ['Faltante', 1]]);
  assert.equal((await c.get('/api/items')).data[0].blocked, 2);
  assert.equal((await c.get('/api/availability?start=2026-12-01&end=2026-12-01')).data[0].available, 8);
  await c.post(`/api/blocks/${blocks.find((b) => b.reason === 'Avariado').id}/resolve`, { action: 'reparado' });
  await c.post(`/api/blocks/${blocks.find((b) => b.reason === 'Faltante').id}/resolve`, { action: 'baixa' });
  const item = (await c.get('/api/items')).data[0];
  assert.equal(item.blocked, 0); assert.equal(item.qty_total, 9);
  assert.equal((await c.post(`/api/blocks/${blocks[0].id}/resolve`, { action: 'baixa' })).status, 404, 'já resolvido');
  await close();
});

test('painel: atrasos, a receber e agenda; caixa manual, CSV seguro e backup', async () => {
  const { admin: c, close } = await setup();
  const mesa = await novoItem(c, 'Mesa', 10, 50);
  const ana = await novoCliente(c, 'Ana');
  const hoje = today();
  const venc = (await c.post('/api/rentals', pedido(ana, [[mesa, 2]], addDays(hoje, -10), addDays(hoje, -9), { installments: 2, first_due: addDays(hoje, -5) }))).data;
  await c.post('/api/rentals', pedido(ana, [[mesa, 1]], addDays(hoje, 2), addDays(hoje, 3)));
  await c.post(`/api/rentals/${venc.id}/payments`, { amount_cents: 2000, method: 'Pix', date: hoje });
  const d = (await c.get('/api/dashboard')).data;
  assert.equal(d.deliveries_late.length, 1, 'reserva com data de entrega passada');
  assert.equal(d.overdue_count, 1);
  assert.equal(d.overdue_total_cents, 3000, '1ª parcela (5000) paga em 2000 + 2ª ainda não vence');
  assert.equal(d.receivable_cents, 10000 - 2000 + 5000);
  assert.equal(d.agenda.length, 2, 'entrega e devolução da próxima locação');
  assert.equal(d.month_income_cents, 2000);
  // caixa manual
  assert.equal((await c.post('/api/cash', { direction: 'Saída', category: 'Combustível', description: '=HYPERLINK("http://x")', amount_cents: 1000, method: 'Pix', date: hoje })).status, 200);
  assert.equal((await c.post('/api/cash', { direction: 'Entrada', category: 'Locação', description: 'x', amount_cents: 1, method: 'Pix', date: hoje })).status, 400, 'locação só pelo pedido');
  assert.equal((await c.post('/api/cash', { direction: 'Saída', category: 'Outros', description: 'x', amount_cents: 0, method: 'Pix', date: hoje })).status, 400, 'valor zero');
  const csv = (await c.get('/api/cash.csv?month=' + hoje.slice(0, 7))).data.toString('utf8');
  assert.match(csv, /"'=HYPERLINK/, 'fórmula neutralizada no CSV'); assert.match(csv, /10,00/);
  const m = (await c.get('/api/cash?month=' + hoje.slice(0, 7))).data;
  assert.equal(m.expense_by_category['Combustível'], 1000);
  assert.equal((await c.get('/api/cash?month=2026-13')).status, 400);
  // backup é um SQLite válido
  const bk = (await c.get('/api/backup')).data;
  assert.equal(bk.subarray(0, 15).toString(), 'SQLite format 3');
  // busca
  assert.equal((await c.get('/api/rentals?q=ana')).data.length, 2);
  assert.equal((await c.get('/api/rentals?q=%25')).data.length, 0, 'curinga % é literal');
  assert.equal((await c.get('/api/rentals?balance=1')).data.length, 2);
  await close();
});

test('foto do material: aceita imagem válida, recusa arquivo disfarçado', async () => {
  const { admin: c, close } = await setup();
  const mesa = await novoItem(c, 'Mesa', 1);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(50, 1)]);
  assert.equal((await c.call('PUT', `/api/items/${mesa.id}/photo`, png, { 'Content-Type': 'image/png' })).status, 200);
  const got = await c.get(`/api/items/${mesa.id}/photo`);
  assert.equal(got.status, 200); assert.equal(got.headers.get('content-type'), 'image/png'); assert.equal(got.data.length, png.length);
  assert.equal((await c.call('PUT', `/api/items/${mesa.id}/photo`, Buffer.from('<script>alert(1)</script>'), { 'Content-Type': 'image/png' })).status, 400, 'conteúdo não é PNG');
  assert.equal((await c.call('PUT', `/api/items/${mesa.id}/photo`, png, { 'Content-Type': 'text/html' })).status, 400, 'tipo não permitido');
  assert.equal((await c.call('PUT', `/api/items/${mesa.id}/photo`, Buffer.alloc(1_700_000, 1), { 'Content-Type': 'image/png' })).status, 413, 'grande demais');
  assert.equal((await c.get('/api/items')).data[0].has_photo, true);
  await c.del(`/api/items/${mesa.id}/photo`);
  assert.equal((await c.get(`/api/items/${mesa.id}/photo`)).status, 404);
  await close();
});
