import { h } from '../dom.js';
import { get, post, del } from '../api.js';
import { state, isAdmin } from '../state.js';
import { brl, dmy, monthLabel, parseMoney } from '../fmt.js';
import { field, textInput, moneyField, select, openForm, confirmBox, toast, empty } from '../ui.js';

export default async function cash(ctx) {
  const month = ctx.query.get('mes') || state.today.slice(0, 7);
  const [c, meta] = await Promise.all([get('/api/cash?month=' + month), state.meta ? state.meta : get('/api/meta').then((m) => (state.meta = m))]);
  const go = (m) => ctx.navigate('/caixa?mes=' + m);
  const monthIn = h('input', { type: 'month', value: month, 'aria-label': 'Mês', onchange: (e) => e.target.value && go(e.target.value) });

  const add = (direction) => openForm({
    title: direction === 'Entrada' ? 'Nova entrada' : 'Nova saída', submit: 'Lançar',
    build: () => [
      field('Descrição', textInput('description', '', { required: true, maxlength: 200, placeholder: direction === 'Saída' ? 'Ex.: Combustível da van' : 'Ex.: Venda avulsa' })),
      h('div', { class: 'grid2' }, field('Valor (R$)', moneyField('amount', '', { required: true })), field('Data', h('input', { type: 'date', name: 'date', value: state.today, required: true }))),
      h('div', { class: 'grid2' }, field('Categoria', select('category', meta.categories.filter((x) => !['Locação', 'Estorno'].includes(x)), direction === 'Saída' ? 'Combustível' : 'Outros')), field('Forma', select('method', meta.methods, 'Pix'))),
      h('p', { class: 'muted small' }, 'Pagamentos de clientes são lançados dentro do pedido, para ficarem ligados às parcelas.'),
    ],
    onSubmit: async (f) => {
      const fd = new FormData(f), cents = parseMoney(fd.get('amount'));
      if (!cents || Number.isNaN(cents)) throw new Error('Informe um valor maior que zero.');
      await post('/api/cash', { direction, description: fd.get('description'), amount_cents: cents, date: fd.get('date'), category: fd.get('category'), method: fd.get('method') });
    },
  }).then((ok) => { if (ok) { toast('Lançamento salvo.'); ctx.rerender(); } });

  const remove = async (e) => {
    if (!(await confirmBox('Excluir lançamento?', `${e.description} · ${brl(e.amount_cents)}`, 'Excluir', true))) return;
    try { await del('/api/cash/' + e.id); toast('Lançamento excluído.'); ctx.rerender(); } catch (ex) { toast(ex.message, true); }
  };
  const cats = Object.entries(c.expense_by_category).sort((a, b) => b[1] - a[1]);

  return h('div', { class: 'page' },
    h('div', { class: 'head' }, h('div', null, h('h1', null, 'Caixa'), h('p', { class: 'sub' }, monthLabel(month))),
      h('div', { class: 'actions' }, h('button', { class: 'btn yellow', onclick: () => add('Saída') }, 'Nova saída'), h('button', { class: 'btn ghost', onclick: () => add('Entrada') }, 'Nova entrada'))),
    h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', null, 'Mês'), monthIn), h('div', { class: 'field' }, h('span', null, 'Planilha'), h('a', { class: 'btn ghost', href: '/api/cash.csv?month=' + month, download: '' }, 'Baixar CSV do mês'))),
    h('dl', { class: 'figures' },
      h('div', null, h('dt', null, 'Entradas'), h('dd', { class: 'pos num' }, brl(c.income_cents))), h('div', null, h('dt', null, 'Saídas'), h('dd', { class: 'num' }, brl(c.expense_cents))),
      h('div', null, h('dt', null, 'Resultado do mês'), h('dd', { class: 'num ' + (c.result_cents < 0 ? 'neg' : '') }, brl(c.result_cents))), h('div', null, h('dt', null, 'Saldo total do caixa'), h('dd', { class: 'num ' + (c.balance_cents < 0 ? 'neg' : '') }, brl(c.balance_cents)))),
    cats.length ? h('section', { class: 'block' }, h('div', { class: 'title' }, h('h2', null, 'Saídas por categoria')), h('div', { class: 'list' }, cats.map(([k, v]) => h('div', { class: 'row' }, h('span', null, k), h('span', { class: 'num' }, brl(v)))))) : null,
    h('section', { class: 'block' }, h('div', { class: 'title' }, h('h2', null, 'Movimentações')),
      c.rows.length ? h('div', { class: 'list' }, c.rows.map((e) => h('div', { class: 'row' },
        h('span', { class: 'main' }, e.rental_id ? h('a', { href: '#/locacoes/' + e.rental_id }, h('strong', null, e.description)) : h('strong', null, e.description), h('span', { class: 'muted small' }, `${dmy(e.date)} · ${e.category} · ${e.method}`)),
        h('span', { class: 'side' }, h('span', { class: 'num ' + (e.direction === 'Entrada' ? 'pos' : '') }, (e.direction === 'Entrada' ? '' : '− ') + brl(e.amount_cents)), isAdmin() && !e.payment_id ? [' ', h('button', { class: 'btn ghost small', 'aria-label': 'Excluir lançamento', onclick: () => remove(e) }, 'Excluir')] : null))))
        : empty('Nenhum lançamento neste mês', 'Pagamentos de pedidos e despesas lançadas aparecem aqui.')));
}
