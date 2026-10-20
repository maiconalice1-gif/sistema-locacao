import { h } from '../dom.js';
import { brl, dayParts, plural } from '../fmt.js';
import { statusChip, payChip } from '../ui.js';

/** Pedido como ingresso: o canhoto amarelo traz o dia da entrega (ou da devolução). */
export function ticket(r, { date, label, extra } = {}) {
  const d = dayParts(date || r.start_date);
  const done = r.status === 'Devolvido' || r.status === 'Cancelado';
  return h('a', { class: 'ticket' + (done ? ' done' : '') + (r.status === 'Cancelado' ? ' cancelled' : ''), href: `#/locacoes/${r.id}` },
    h('div', { class: 'stub' }, h('small', null, d.wd), h('b', null, d.day), h('span', null, d.mon), label ? h('small', null, label) : null),
    h('div', { class: 'body' },
      h('strong', null, r.customer_name),
      h('span', { class: 'items' }, r.items_summary || ''),
      h('span', { class: 'meta' }, statusChip(r.status), payChip(r), h('span', { class: 'money num' }, brl(r.total_cents)),
        r.balance_cents > 0 ? h('span', null, 'falta ' + brl(r.balance_cents)) : null, extra)));
}
export const tickets = (list, opts) => h('div', { class: 'tickets' + (opts?.cols ? ' cols' : '') }, list.map((r) => ticket(r, opts?.each?.(r))));
export { plural };
