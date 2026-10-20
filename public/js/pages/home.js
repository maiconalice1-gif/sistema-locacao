import { h, icon } from '../dom.js';
import { get } from '../api.js';
import { state } from '../state.js';
import { brl, dmy, dayParts, plural } from '../fmt.js';
import { empty } from '../ui.js';
import { ticket } from './shared.js';

export default async function home() {
  const d = await get('/api/dashboard');
  const todo = [
    ...d.deliveries_late.map((r) => ({ r, date: r.start_date, label: 'atrasada', tag: 'entrega' })),
    ...d.deliveries_today.map((r) => ({ r, date: r.start_date, label: 'entrega', tag: 'entrega' })),
    ...d.returns_due.map((r) => ({ r, date: r.end_date, label: 'devolução', tag: 'devolução' })),
  ];
  const wd = dayParts(d.today);
  const fig = (label, value, cls = '', href) => { const inner = [h('dt', null, label), h('dd', { class: cls }, value)]; return h('div', null, href ? h('a', { href }, inner) : inner); };
  return h('div', { class: 'page' },
    h('div', { class: 'head' }, h('div', null, h('h1', null, `Olá, ${state.user.name.split(' ')[0]}`), h('p', { class: 'sub' }, `${wd.wd}, ${wd.day} de ${wd.mon}`))),
    d.overdue_count > 0 ? h('a', { class: 'alert', href: '#/locacoes?filtro=receber' }, h('span', null, `${plural(d.overdue_count, 'parcela vencida', 'parcelas vencidas')} · ${brl(d.overdue_total_cents)} para cobrar`), h('span', null, 'Ver pedidos')) : null,
    h('section', { class: 'block' }, h('div', { class: 'title' }, h('h2', null, 'Para fazer hoje')),
      todo.length ? h('div', { class: 'tickets cols' }, todo.map((t) => ticket(t.r, { date: t.date, label: t.label })))
        : empty('Nada para entregar ou receber hoje', 'Quando houver entregas ou devoluções do dia, elas aparecem aqui.', h('a', { class: 'btn', href: '#/locacoes/nova' }, 'Nova locação'))),
    d.agenda.filter((a) => !(a.date === d.today)).length ? h('section', { class: 'block' }, h('div', { class: 'title' }, h('h2', null, 'Próximos 7 dias')),
      h('div', { class: 'tickets cols' }, d.agenda.filter((a) => a.date !== d.today).map((a) => ticket(a.rental, { date: a.date, label: a.type === 'Entrega' ? 'entrega' : 'devolução' })))) : null,
    h('section', { class: 'block' }, h('div', { class: 'title' }, h('h2', null, 'Dinheiro')),
      h('dl', { class: 'figures' },
        fig('A receber', brl(d.receivable_cents), '', '#/locacoes?filtro=receber'),
        fig('Saldo do caixa', brl(d.cash_balance_cents), d.cash_balance_cents < 0 ? 'neg' : '', '#/caixa'),
        fig('Entradas do mês', brl(d.month_income_cents), 'pos', '#/caixa'),
        fig('Saídas do mês', brl(d.month_expense_cents), '', '#/caixa'))),
    d.blocked_units > 0 ? h('section', { class: 'block' }, h('a', { class: 'alert', href: '#/catalogo' }, h('span', null, `${plural(d.blocked_units, 'item avariado ou faltando', 'itens avariados ou faltando')}`), h('span', null, 'Resolver no catálogo'))) : null);
}
