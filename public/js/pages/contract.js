import { h } from '../dom.js';
import { get } from '../api.js';
import { brl, dmy, plural } from '../fmt.js';

export default async function contract(ctx) {
  const [r, s] = await Promise.all([get('/api/rentals/' + ctx.params[0]), get('/api/settings')]);
  const hoje = new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  const sec = (t) => h('h2', null, t);
  return h('div', { class: 'page' },
    h('div', { class: 'doc-bar' }, h('a', { class: 'btn ghost', href: '#/locacoes/' + r.id }, 'Voltar ao pedido'), h('button', { class: 'btn', onclick: () => window.print() }, 'Imprimir ou salvar em PDF')),
    h('article', { class: 'doc' },
      h('h1', null, `Contrato de locação nº ${r.id}`),
      h('p', { class: 'company' }, [s.company_name, s.company_doc && 'CPF/CNPJ ' + s.company_doc, s.company_phone, s.company_address].filter(Boolean).join(' · ')),
      sec('Partes'),
      h('p', null, h('strong', null, 'LOCADOR: '), s.company_name, s.company_doc ? `, CPF/CNPJ ${s.company_doc}` : '', s.company_address ? `, ${s.company_address}` : '', '.'),
      h('p', null, h('strong', null, 'LOCATÁRIO: '), r.customer_name, r.customer_doc ? `, CPF/CNPJ ${r.customer_doc}` : '', r.customer_phone ? `, telefone ${r.customer_phone}` : '', r.customer_address ? `, ${r.customer_address}` : '', '.'),
      sec('Período e local'),
      h('p', null, `Entrega em ${dmy(r.start_date)} e devolução em ${dmy(r.end_date)}. Local de entrega: ${r.address}.`),
      sec('Materiais locados'),
      h('table', null, h('thead', null, h('tr', null, h('th', null, 'Qtde'), h('th', null, 'Descrição'), h('th', { class: 'r' }, 'Valor unit.'), h('th', { class: 'r' }, 'Total'))),
        h('tbody', null, r.items.map((i) => h('tr', null, h('td', null, i.qty), h('td', null, i.name), h('td', { class: 'r' }, brl(i.unit_price_cents)), h('td', { class: 'r' }, brl(i.qty * i.unit_price_cents)))))),
      sec('Valores'),
      h('table', null, h('tbody', null,
        h('tr', null, h('td', null, 'Materiais'), h('td', { class: 'r' }, brl(r.subtotal_cents))),
        h('tr', null, h('td', null, 'Frete'), h('td', { class: 'r' }, brl(r.freight_cents))),
        r.discount_cents ? h('tr', null, h('td', null, 'Desconto'), h('td', { class: 'r' }, '− ' + brl(r.discount_cents))) : null,
        h('tr', null, h('td', null, h('strong', null, 'Total')), h('td', { class: 'r' }, h('strong', null, brl(r.total_cents)))))),
      r.installments_list.length ? [sec(`Pagamento em ${plural(r.installments_list.length, 'parcela', 'parcelas')}`),
        h('table', null, h('tbody', null, r.installments_list.map((p) => h('tr', null, h('td', null, `${p.n}ª parcela`), h('td', null, 'vencimento ' + dmy(p.due_date)), h('td', { class: 'r' }, brl(p.amount_cents))))))] : null,
      r.notes ? [sec('Observações'), h('p', null, r.notes)] : null,
      sec('Condições'),
      h('p', { class: 'terms' }, s.contract_terms),
      h('p', null, `${s.contract_city ? s.contract_city + ', ' : ''}${hoje}.`),
      h('div', { class: 'sign' }, h('div', null, 'Locador — ' + s.company_name), h('div', null, 'Locatário — ' + r.customer_name))));
}
