import { h } from '../dom.js';
import { post } from '../api.js';
import { state } from '../state.js';
import { boot } from '../main.js';

export const logout = async () => { try { await post('/api/logout'); } catch {} state.user = null; location.hash = '#/'; boot(); };

export default async function more() {
  return h('div', { class: 'page' }, h('div', { class: 'head' }, h('h1', null, 'Mais')),
    h('div', { class: 'list' },
      h('a', { class: 'row', href: '#/clientes' }, h('strong', null, 'Clientes'), h('span', { class: 'muted' }, '›')),
      h('a', { class: 'row', href: '#/ajustes' }, h('strong', null, 'Ajustes e equipe'), h('span', { class: 'muted' }, '›')),
      h('a', { class: 'row', href: '#/mais', role: 'button', onclick: (e) => { e.preventDefault(); logout(); } }, h('strong', null, 'Sair'), h('span', { class: 'muted' }, state.user.name))));
}
