import { h, icon } from '../dom.js';
import { get, post } from '../api.js';
import { state } from '../state.js';
import { brl, dmy, parseMoney, moneyInput, stamp, waLink, plural } from '../fmt.js';
import { field, textInput, moneyField, select, openForm, confirmBox, statusChip, chip, toast } from '../ui.js';

export default async function rental(ctx) {
  const id = ctx.params[0];
  const [r, meta] = await Promise.all([get('/api/rentals/' + id), state.meta ? state.meta : get('/api/meta').then((m) => (state.meta = m))]);
  const done = async (msg) => { toast(msg); await ctx.rerender(); };

  const payForm = (kind) => openForm({
    title: kind === 'pagamento' ? 'Receber pagamento' : 'Estornar pagamento', submit: kind === 'pagamento' ? 'Registrar pagamento' : 'Registrar estorno', danger: kind === 'estorno',
    build: () => [
      h('p', { class: 'muted' }, kind === 'pagamento' ? `Saldo a receber: ${brl(r.balance_cents)}` : `Já recebido: ${brl(r.paid_cents)}`),
      field('Valor (R$)', moneyField('amount', moneyInput(kind === 'pagamento' ? r.balance_cents : r.paid_cents), { required: true })),
      h('div', { class: 'grid2' }, field('Forma', select('method', meta.methods, 'Pix')), field('Data', h('input', { name: 'date', type: 'date', value: state.today, required: true }))),
      field('Observação (opcional)', textInput('note', '', { maxlength: 300 })),
    ],
    onSubmit: async (f) => {
      const fd = new FormData(f), cents = parseMoney(fd.get('amount'));
      if (!cents || Number.isNaN(cents)) throw new Error('Informe um valor maior que zero.');
      await post(`/api/rentals/${id}/${kind === 'pagamento' ? 'payments' : 'refund'}`, { amount_cents: cents, method: fd.get('method'), date: fd.get('date'), note: fd.get('note') });
    },
  }).then((ok) => ok && done(kind === 'pagamento' ? 'Pagamento registrado.' : 'Estorno registrado.'));

  const deliver = () => openForm({
    title: 'Conferir e entregar', submit: 'Confirmar entrega',
    build: () => [
      h('p', { class: 'muted' }, 'Marque cada material depois de contar a quantidade entregue.'),
      r.items.map((i) => h('label', { class: 'row' }, h('span', { class: 'main' }, h('strong', null, `${i.qty} × ${i.name}`)), h('input', { type: 'checkbox', name: 'checked', value: i.item_id, required: true }))),
      field('Quem está entregando', textInput('delivered_by', state.user.name, { required: true })),
      field('Quem recebeu', textInput('received_by', r.customer_name, { required: true })),
      field('Observações da entrega', h('textarea', { name: 'notes', maxlength: 2000 })),
    ],
    onSubmit: async (f) => { const fd = new FormData(f); await post(`/api/rentals/${id}/deliver`, { checked: fd.getAll('checked').map(Number), delivered_by: fd.get('delivered_by'), received_by: fd.get('received_by'), notes: fd.get('notes') }); },
  }).then((ok) => ok && done('Entrega registrada.'));

  const giveBack = () => openForm({
    title: 'Conferir devolução', submit: 'Concluir devolução',
    build: () => [
      h('p', { class: 'muted' }, 'Informe o que voltou. O que faltar ou estiver quebrado fica bloqueado no catálogo até você resolver.'),
      r.items.map((i) => h('div', { class: 'field' }, h('span', null, `${i.name} — ${i.qty} saíram`),
        h('div', { class: 'grid2' }, field('Voltaram', h('input', { name: 'ret-' + i.item_id, type: 'number', min: '0', max: String(i.qty), step: '1', value: String(i.qty), required: true })),
          field('Quebrados (entre os que voltaram)', h('input', { name: 'dam-' + i.item_id, type: 'number', min: '0', max: String(i.qty), step: '1', value: '0', required: true }))))),
      field('Observações da devolução', h('textarea', { name: 'notes', maxlength: 2000 })),
    ],
    onSubmit: async (f) => { const fd = new FormData(f); await post(`/api/rentals/${id}/return`, { notes: fd.get('notes'), items: r.items.map((i) => ({ item_id: i.item_id, returned: Number(fd.get('ret-' + i.item_id)), damaged: Number(fd.get('dam-' + i.item_id)) })) }); },
  }).then((ok) => ok && done('Devolução registrada.'));

  const cancel = async () => {
    if (await confirmBox('Cancelar esta reserva?', 'Os materiais voltam a ficar disponíveis nessas datas. Esta ação não pode ser desfeita.', 'Cancelar reserva', true)) { await post(`/api/rentals/${id}/cancel`); done('Reserva cancelada.'); }
  };
  const act = (fn) => async () => { try { await fn(); } catch (e) { toast(e.message, true); } };

  const wa = waLink(r.customer_phone);
  const canPay = r.status !== 'Cancelado' && r.balance_cents > 0;
  return h('div', { class: 'page' },
    h('a', { class: 'back', href: '#/locacoes' }, icon('back'), 'Locações'),
    h('div', { class: 'head' }, h('div', null, h('h1', null, r.customer_name), h('p', { class: 'sub' }, `Locação ${r.id} · ${dmy(r.start_date)} a ${dmy(r.end_date)}`)), statusChip(r.status)),
    h('div', { class: 'actions' },
      r.status === 'Reservado' ? h('button', { class: 'btn yellow', onclick: act(deliver) }, 'Entregar') : null,
      r.status === 'Entregue' ? h('button', { class: 'btn yellow', onclick: act(giveBack) }, 'Receber devolução') : null,
      canPay ? h('button', { class: 'btn', onclick: act(() => payForm('pagamento')) }, 'Receber pagamento') : null,
      h('a', { class: 'btn ghost', href: '#/contrato/' + r.id }, 'Contrato'),
      r.status === 'Reservado' ? h('a', { class: 'btn ghost', href: `#/locacoes/${r.id}/editar` }, 'Editar') : null),

    h('section', { class: 'block' }, h('div', { class: 'title' }, h('h2', null, 'Cliente e local')),
      h('div', { class: 'list' },
        h('div', { class: 'row' }, h('span', { class: 'main' }, h('strong', null, r.customer_name), h('span', { class: 'muted' }, [r.customer_phone, r.customer_doc].filter(Boolean).join(' · ') || 'Sem telefone')),
          h('span', { class: 'side actions' }, r.customer_phone ? h('a', { class: 'btn ghost small', href: 'tel:' + r.customer_phone.replace(/[^\d+]/g, '') }, 'Ligar') : null, wa ? h('a', { class: 'btn ghost small', href: wa, target: '_blank', rel: 'noopener noreferrer' }, 'WhatsApp') : null)),
        h('div', { class: 'row' }, h('span', { class: 'main' }, h('span', { class: 'muted' }, 'Entrega em'), h('strong', null, r.address))),
        r.notes ? h('div', { class: 'row' }, h('span', { class: 'main' }, h('span', { class: 'muted' }, 'Observações'), r.notes)) : null)),

    h('section', { class: 'block' }, h('div', { class: 'title' }, h('h2', null, 'Materiais')),
      h('div', { class: 'list' }, r.items.map((i) => h('div', { class: 'row' }, h('span', { class: 'main' }, h('strong', null, `${i.qty} × ${i.name}`), i.returned_qty != null ? h('span', { class: 'muted small' }, `Voltaram ${i.returned_qty}${i.damaged_qty ? ` (${i.damaged_qty} quebrados)` : ''}${i.qty - i.returned_qty ? ` · faltaram ${i.qty - i.returned_qty}` : ''}`) : null), h('span', { class: 'side num' }, brl(i.qty * i.unit_price_cents)))))),

    h('section', { class: 'block' }, h('div', { class: 'title' }, h('h2', null, 'Valores')),
      h('div', { class: 'list' }, h('div', { class: 'row' }, h('dl', { class: 'kv' },
        h('dt', null, 'Materiais'), h('dd', { class: 'num' }, brl(r.subtotal_cents)), h('dt', null, 'Frete'), h('dd', { class: 'num' }, brl(r.freight_cents)),
        r.discount_cents ? [h('dt', null, 'Desconto'), h('dd', { class: 'num' }, '− ' + brl(r.discount_cents))] : null,
        h('dt', { class: 'total' }, 'Total'), h('dd', { class: 'total num' }, brl(r.total_cents)),
        h('dt', null, 'Recebido'), h('dd', { class: 'num pos' }, brl(r.paid_cents)),
        h('dt', null, 'A receber'), h('dd', { class: 'num' + (r.balance_cents ? ' neg' : '') }, brl(r.balance_cents)))))),

    r.installments_list.length ? h('section', { class: 'block' }, h('div', { class: 'title' }, h('h2', null, plural(r.installments_list.length, 'parcela', 'parcelas'))),
      h('div', { class: 'list' }, r.installments_list.map((p) => h('div', { class: 'row' }, h('span', { class: 'main' }, h('strong', null, `${p.n}ª · vence ${dmy(p.due_date)}`), h('span', { class: 'muted small' }, p.open_cents === 0 ? 'Paga' : p.paid_cents > 0 ? `Falta ${brl(p.open_cents)}` : 'Em aberto')),
        h('span', { class: 'side' }, h('span', { class: 'num' }, brl(p.amount_cents)), ' ', p.open_cents === 0 ? chip('pago', 'Paga') : p.overdue ? chip('atrasado', 'Vencida') : null))))) : null,

    h('section', { class: 'block' }, h('div', { class: 'title' }, h('h2', null, 'Pagamentos'), r.paid_cents > 0 ? h('button', { class: 'btn danger small', onclick: act(() => payForm('estorno')) }, 'Estornar') : null),
      r.payments.length ? h('div', { class: 'list' }, r.payments.map((p) => h('div', { class: 'row' }, h('span', { class: 'main' }, h('strong', null, p.kind === 'pagamento' ? 'Pagamento' : 'Estorno'), h('span', { class: 'muted small' }, `${dmy(p.date)} · ${p.method}${p.note ? ' · ' + p.note : ''}`)), h('span', { class: 'side num ' + (p.kind === 'pagamento' ? 'pos' : 'neg') }, (p.kind === 'pagamento' ? '' : '− ') + brl(p.amount_cents)))))
        : h('p', { class: 'muted' }, 'Nenhum pagamento registrado ainda.')),

    r.delivered_at ? h('section', { class: 'block' }, h('div', { class: 'title' }, h('h2', null, 'Entrega')),
      h('div', { class: 'list' }, h('div', { class: 'row' }, h('span', { class: 'main' }, h('strong', null, `Recebido por ${r.received_by}`), h('span', { class: 'muted small' }, `Entregue por ${r.delivered_by} em ${stamp(r.delivered_at)}${r.delivery_notes ? ' · ' + r.delivery_notes : ''}`))))) : null,
    r.returned_at ? h('section', { class: 'block' }, h('div', { class: 'title' }, h('h2', null, 'Devolução')),
      h('div', { class: 'list' }, h('div', { class: 'row' }, h('span', { class: 'main' }, h('strong', null, `Conferida em ${stamp(r.returned_at)}`), r.return_notes ? h('span', { class: 'muted small' }, r.return_notes) : null)))) : null,

    r.status === 'Reservado' ? h('section', { class: 'block' }, h('button', { class: 'btn danger', onclick: act(cancel) }, 'Cancelar reserva')) : null);
}
