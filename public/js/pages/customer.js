import { h, icon } from '../dom.js';
import { get, del } from '../api.js';
import { isAdmin } from '../state.js';
import { waLink } from '../fmt.js';
import { confirmBox, toast, empty } from '../ui.js';
import { tickets } from './shared.js';
import { customerForm } from './customers.js';

export default async function customer(ctx) {
  const c = await get('/api/customers/' + ctx.params[0]);
  const wa = waLink(c.phone);
  const remove = async () => {
    if (!(await confirmBox('Excluir este cliente?', 'O cadastro some da lista. Clientes com locações não podem ser excluídos.', 'Excluir', true))) return;
    try { await del('/api/customers/' + c.id); toast('Cliente excluído.'); ctx.navigate('/clientes'); } catch (e) { toast(e.message, true); }
  };
  return h('div', { class: 'page' },
    h('a', { class: 'back', href: '#/clientes' }, icon('back'), 'Clientes'),
    h('div', { class: 'head' }, h('div', null, h('h1', null, c.name), h('p', { class: 'sub' }, [c.phone, c.email, c.doc].filter(Boolean).join(' · ') || 'Sem dados de contato')),
      h('div', { class: 'actions' }, h('a', { class: 'btn yellow', href: '#/locacoes/nova?cliente=' + c.id }, 'Nova locação'), wa ? h('a', { class: 'btn ghost', href: wa, target: '_blank', rel: 'noopener noreferrer' }, 'WhatsApp') : null, h('button', { class: 'btn ghost', onclick: () => customerForm(c, ctx) }, 'Editar'))),
    c.address ? h('p', null, c.address) : null, c.notes ? h('p', { class: 'muted' }, c.notes) : null,
    h('section', { class: 'block' }, h('div', { class: 'title' }, h('h2', null, 'Locações')),
      c.rentals.length ? tickets(c.rentals, { cols: true }) : empty('Ainda sem locações', 'As locações deste cliente aparecem aqui.')),
    isAdmin() && !c.rentals.length ? h('section', { class: 'block' }, h('button', { class: 'btn danger', onclick: remove }, 'Excluir cliente')) : null);
}
