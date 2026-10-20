import { h, icon } from '../dom.js';
import { get, post, put } from '../api.js';
import { state } from '../state.js';
import { brl, parseMoney, moneyInput, plural } from '../fmt.js';
import { field, textInput, moneyField, openForm, toast } from '../ui.js';

export default async function rentalForm(ctx) {
  const editId = ctx.params[0];
  const [customers, existing] = await Promise.all([get('/api/customers'), editId ? get('/api/rentals/' + editId) : null]);
  if (existing && existing.status !== 'Reservado') throw new Error('Só é possível editar reservas que ainda não foram entregues.');

  const s = existing
    ? { customer_id: existing.customer_id, start: existing.start_date, end: existing.end_date, address: existing.address, freight: moneyInput(existing.freight_cents), discount: moneyInput(existing.discount_cents), installments: existing.installments, first_due: existing.installments_list[0]?.due_date || existing.start_date, notes: existing.notes,
        items: Object.fromEntries(existing.items.map((i) => [i.item_id, { qty: i.qty, price: moneyInput(i.unit_price_cents) }])) }
    : { customer_id: Number(ctx.query.get('cliente')) || '', start: state.today, end: state.today, address: '', freight: '0,00', discount: '0,00', installments: 1, first_due: state.today, notes: '', items: {} };
  let avail = [], lastAuto = '';
  const customerOf = (id) => customers.find((c) => c.id === Number(id));
  if (!existing && s.customer_id) { s.address = customerOf(s.customer_id)?.address || ''; lastAuto = s.address; }

  const err = h('div', { class: 'err', role: 'alert', hidden: true });
  const matBox = h('div'), totals = h('div', { class: 'totals' });
  const customerSel = h('select', { name: 'customer', required: true });
  const addressIn = textInput('address', s.address, { required: true, maxlength: 300 });
  const startIn = h('input', { type: 'date', required: true, value: s.start }), endIn = h('input', { type: 'date', required: true, value: s.end, min: s.start });

  function drawCustomers() {
    customerSel.replaceChildren(h('option', { value: '' }, 'Selecione o cliente'), ...customers.map((c) => h('option', { value: c.id, selected: c.id === Number(s.customer_id) }, c.name + (c.phone ? ' · ' + c.phone : ''))));
  }
  customerSel.addEventListener('change', () => {
    s.customer_id = Number(customerSel.value) || '';
    const c = customerOf(s.customer_id);
    if (c && (!addressIn.value || addressIn.value === lastAuto)) { addressIn.value = c.address || ''; lastAuto = addressIn.value; s.address = addressIn.value; }
  });
  async function newCustomer() {
    await openForm({
      title: 'Novo cliente',
      build: () => [field('Nome', textInput('name', '', { required: true })), field('Telefone (WhatsApp)', h('input', { name: 'phone', type: 'tel', autocomplete: 'off' })), field('Endereço', textInput('address')), field('CPF ou CNPJ', textInput('doc'))],
      onSubmit: async (f) => {
        const fd = new FormData(f);
        const c = await post('/api/customers', Object.fromEntries(fd));
        customers.push(c); customers.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
        s.customer_id = c.id; drawCustomers(); customerSel.dispatchEvent(new Event('change'));
      },
    });
  }

  async function loadAvail() {
    if (!s.start || !s.end || s.end < s.start) { matBox.replaceChildren(h('p', { class: 'muted' }, 'Informe as datas de entrega e devolução para ver o que está disponível.')); return; }
    try {
      avail = await get(`/api/availability?start=${s.start}&end=${s.end}${editId ? '&exclude=' + editId : ''}`);
      for (const [id, it] of Object.entries(s.items)) { const a = avail.find((x) => x.id === Number(id)); if (!a) delete s.items[id]; else it.qty = Math.min(it.qty, a.available); if (it.qty <= 0) delete s.items[id]; }
      drawMaterials();
    } catch (e) { matBox.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }
  function drawMaterials() {
    if (!avail.length) { matBox.replaceChildren(h('p', { class: 'muted' }, 'Nenhum material cadastrado. Cadastre no Catálogo antes de criar uma locação.')); recompute(); return; }
    matBox.replaceChildren(
      h('div', { class: 'picker head' }, h('span', null, 'Material'), h('span', null, 'Qtde'), h('span', null, 'Preço (R$)')),
      ...avail.map((a) => {
        const cur = s.items[a.id];
        const qty = h('input', { type: 'number', min: '0', max: String(a.available), step: '1', inputmode: 'numeric', value: cur ? cur.qty : '', placeholder: '0', 'aria-label': 'Quantidade de ' + a.name, disabled: a.available === 0 && !cur });
        const price = h('input', { inputmode: 'decimal', value: cur ? cur.price : moneyInput(a.price_cents), 'aria-label': 'Preço unitário de ' + a.name });
        const sync = () => {
          const n = Math.floor(Number(qty.value) || 0);
          if (n > 0) s.items[a.id] = { qty: Math.min(n, a.available), price: price.value }; else delete s.items[a.id];
          recompute();
        };
        qty.addEventListener('input', sync); price.addEventListener('input', sync);
        return h('div', { class: 'picker' }, h('span', { class: 'name' }, a.name, h('small', null, a.available === 0 ? 'Indisponível nessas datas' : `${a.available} disponíveis`)), qty, price);
      }));
    recompute();
  }
  function compute() {
    const chosen = Object.entries(s.items).map(([id, it]) => ({ item_id: Number(id), qty: it.qty, unit_price_cents: parseMoney(it.price) }));
    const sub = chosen.reduce((a, i) => a + i.qty * (Number.isNaN(i.unit_price_cents) ? 0 : i.unit_price_cents), 0);
    const fr = parseMoney(s.freight), di = parseMoney(s.discount);
    const f = Number.isNaN(fr) ? 0 : fr, d = Number.isNaN(di) ? 0 : di;
    return { chosen, sub, f, d, total: sub + f - d, bad: [fr, di, ...chosen.map((i) => i.unit_price_cents)].some(Number.isNaN) };
  }
  function recompute() {
    const c = compute(), n = Math.max(1, Math.floor(Number(s.installments) || 1));
    totals.replaceChildren(h('dl', { class: 'kv' },
      h('dt', null, plural(c.chosen.reduce((a, i) => a + i.qty, 0), 'unidade', 'unidades') + ' de materiais'), h('dd', { class: 'num' }, brl(c.sub)),
      h('dt', null, 'Frete'), h('dd', { class: 'num' }, brl(c.f)),
      h('dt', null, 'Desconto'), h('dd', { class: 'num' }, '− ' + brl(c.d)),
      h('dt', { class: 'total' }, 'Total'), h('dd', { class: 'total num' }, brl(c.total)),
      n > 1 ? [h('dt', null, `${n} parcelas de`), h('dd', { class: 'num' }, brl(Math.ceil(c.total / n)))] : null));
  }

  const bind = (input, key, after) => { input.addEventListener('input', () => { s[key] = input.value; after?.(); }); return input; };
  let t;
  const dates = () => { endIn.min = s.start; clearTimeout(t); t = setTimeout(loadAvail, 200); };
  bind(startIn, 'start', () => { if (s.end < s.start) { s.end = s.start; endIn.value = s.start; } dates(); });
  bind(endIn, 'end', dates);
  bind(addressIn, 'address');
  const freight = bind(moneyField('freight', s.freight), 'freight', recompute), discount = bind(moneyField('discount', s.discount), 'discount', recompute);
  const inst = bind(h('input', { type: 'number', min: '1', max: '36', step: '1', value: s.installments }), 'installments', recompute);
  const firstDue = bind(h('input', { type: 'date', value: s.first_due, required: true }), 'first_due');
  const notes = bind(h('textarea', { maxlength: '2000' }, s.notes), 'notes');
  notes.value = s.notes;

  const btn = h('button', { class: 'btn yellow', type: 'submit' }, existing ? 'Salvar alterações' : 'Reservar materiais');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault(); err.hidden = true;
      const c = compute();
      const fail = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'center' }); };
      if (!s.customer_id) return fail('Escolha o cliente.');
      if (!c.chosen.length) return fail('Informe a quantidade de pelo menos um material.');
      if (c.bad) return fail('Confira os valores digitados: use apenas números, como 50 ou 50,00.');
      if (c.d > c.sub) return fail('O desconto não pode ser maior que o valor dos materiais.');
      btn.disabled = true;
      try {
        const body = { customer_id: s.customer_id, start_date: s.start, end_date: s.end, address: s.address, items: c.chosen, freight_cents: c.f, discount_cents: c.d, installments: Math.max(1, Math.floor(Number(s.installments) || 1)), first_due: s.first_due, notes: s.notes };
        const r = existing ? await put('/api/rentals/' + editId, body) : await post('/api/rentals', body);
        toast(existing ? 'Alterações salvas.' : 'Locação reservada.');
        ctx.navigate('/locacoes/' + r.id);
      } catch (ex) { fail(ex.message); btn.disabled = false; }
    },
  },
  h('section', { class: 'block' }, h('h2', null, 'Cliente'), h('div', { class: 'actions' }, h('div', { class: 'grow' }, field('Quem está alugando', customerSel)), h('button', { class: 'btn ghost small', type: 'button', onclick: newCustomer }, 'Novo cliente'))),
  h('section', { class: 'block' }, h('h2', null, 'Datas e local'), h('div', { class: 'grid2' }, field('Entrega', startIn), field('Devolução', endIn)), field('Endereço da entrega', addressIn)),
  h('section', { class: 'block' }, h('h2', null, 'Materiais'), h('p', { class: 'muted small' }, 'A quantidade já considera o que está reservado, entregue ou bloqueado nessas datas.'), matBox),
  h('section', { class: 'block' }, h('h2', null, 'Valores e pagamento'), h('div', { class: 'grid2' }, field('Frete (R$)', freight), field('Desconto (R$)', discount), field('Número de parcelas', inst), field('Vencimento da 1ª parcela', firstDue)), totals),
  h('section', { class: 'block' }, field('Observações do pedido', notes)),
  err, h('div', { class: 'actions' }, btn, h('a', { class: 'btn ghost', href: existing ? '#/locacoes/' + editId : '#/locacoes' }, 'Cancelar')));

  drawCustomers(); recompute(); await loadAvail();
  return h('div', { class: 'page' }, h('a', { class: 'back', href: existing ? '#/locacoes/' + editId : '#/locacoes' }, icon('back'), 'Voltar'),
    h('div', { class: 'head' }, h('h1', null, existing ? `Editar locação ${existing.id}` : 'Nova locação')), form);
}
