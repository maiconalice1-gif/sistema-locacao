import { h } from '../dom.js';
import { get } from '../api.js';
import { empty } from '../ui.js';
import { tickets } from './shared.js';

const FILTERS = [['', 'Todas'], ['Reservado', 'Reservadas'], ['Entregue', 'Entregues'], ['receber', 'A receber'], ['Devolvido', 'Devolvidas'], ['Cancelado', 'Canceladas']];

export default async function rentals(ctx) {
  let filtro = ctx.query.get('filtro') || '', q = '', timer;
  const list = h('div'), search = h('input', { type: 'search', placeholder: 'Buscar cliente, telefone, endereço ou material', 'aria-label': 'Buscar locações' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrar por situação' });
  async function load() {
    const p = new URLSearchParams();
    if (filtro === 'receber') p.set('balance', '1'); else if (filtro) p.set('status', filtro);
    if (q) p.set('q', q);
    const rows = await get('/api/rentals?' + p);
    list.replaceChildren(rows.length ? tickets(rows, { cols: true }) : empty('Nenhuma locação encontrada', q || filtro ? 'Tente outro filtro ou outra busca.' : 'Cadastre a primeira locação para ela aparecer aqui.', h('a', { class: 'btn', href: '#/locacoes/nova' }, 'Nova locação')));
  }
  function drawChips() {
    chips.replaceChildren(...FILTERS.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(filtro === v), onclick: () => { filtro = v; drawChips(); load(); } }, l)));
  }
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { q = search.value.trim(); load(); }, 250); });
  drawChips();
  await load();
  return h('div', { class: 'page' }, h('div', { class: 'head' }, h('h1', null, 'Locações'), h('a', { class: 'btn yellow', href: '#/locacoes/nova' }, 'Nova locação')), h('div', { class: 'search' }, search), chips, list);
}
