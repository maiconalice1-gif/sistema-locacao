import { h, mount, icon, $ } from './dom.js';
import { get, setUnauthHandler } from './api.js';
import { state } from './state.js';
import { toast } from './ui.js';
import authPage from './pages/auth.js';
import home from './pages/home.js';
import rentals from './pages/rentals.js';
import rentalForm from './pages/rentalForm.js';
import rental from './pages/rental.js';
import catalog from './pages/catalog.js';
import customers from './pages/customers.js';
import customer from './pages/customer.js';
import cash from './pages/cash.js';
import more from './pages/more.js';
import settings from './pages/settings.js';
import contract from './pages/contract.js';

const routes = [
  [/^\/$/, home, 'Início'], [/^\/locacoes$/, rentals, 'Locações'], [/^\/locacoes\/nova$/, rentalForm, 'Nova locação'],
  [/^\/locacoes\/(\d+)\/editar$/, rentalForm, 'Editar locação'], [/^\/locacoes\/(\d+)$/, rental, 'Locação'],
  [/^\/catalogo$/, catalog, 'Catálogo'], [/^\/clientes$/, customers, 'Clientes'], [/^\/clientes\/(\d+)$/, customer, 'Cliente'],
  [/^\/caixa$/, cash, 'Caixa'], [/^\/mais$/, more, 'Mais'], [/^\/ajustes$/, settings, 'Ajustes'], [/^\/contrato\/(\d+)$/, contract, 'Contrato'],
];
const NAV = [['/', 'Início', 'home'], ['/locacoes', 'Locações', 'calendar'], ['/catalogo', 'Catálogo', 'box'], ['/clientes', 'Clientes', 'users'], ['/caixa', 'Caixa', 'wallet'], ['/ajustes', 'Ajustes', 'settings']];
const TABS = [['/', 'Início', 'home'], ['/locacoes', 'Locações', 'calendar'], ['/catalogo', 'Catálogo', 'box'], ['/caixa', 'Caixa', 'wallet'], ['/mais', 'Mais', 'more']];

const root = $('#app');
let view = null, seq = 0;

export function navigate(path) { location.hash = '#' + path; }
export function currentRoute() {
  const raw = location.hash.slice(1) || '/';
  const [path, qs] = raw.split('?');
  return { path, query: new URLSearchParams(qs || '') };
}

async function renderRoute() {
  if (!state.user || !view) return;
  const { path, query } = currentRoute();
  const found = routes.map(([re, fn, title]) => ({ m: re.exec(path), fn, title })).find((x) => x.m);
  document.body.classList.toggle('doc-mode', /^\/contrato\//.test(path));
  const my = ++seq;
  if (!found) { mount(view, h('div', { class: 'page' }, h('h1', null, 'Página não encontrada'), h('p', { class: 'muted' }, 'Use o menu para voltar.'))); return; }
  document.title = found.title + ' · ' + (state.company || 'Locação');
  for (const a of document.querySelectorAll('[data-nav]')) {
    const p = a.getAttribute('data-nav');
    const on = p === '/' ? path === '/' : path === p || path.startsWith(p + '/');
    on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  }
  mount(view, h('p', { class: 'muted' }, 'Carregando…'));
  const ctx = { params: found.m.slice(1), query, rerender: renderRoute, navigate };
  try {
    const node = await found.fn(ctx);
    if (my !== seq) return; // o usuário já foi para outra tela
    mount(view, node);
    window.scrollTo(0, 0);
  } catch (e) {
    if (my !== seq) return;
    mount(view, h('div', { class: 'empty' }, h('h3', null, 'Não foi possível abrir esta tela'), h('p', null, e.message), h('button', { class: 'btn', onclick: renderRoute }, 'Tentar de novo')));
  }
}

function shell() {
  const navLink = (cls, [path, label, ic]) => h('a', { class: cls, href: '#' + path, 'data-nav': path }, icon(ic), label);
  mount(root, h('div', { class: 'app' },
    h('nav', { class: 'rail', 'aria-label': 'Menu principal' },
      h('div', { class: 'brand' }, state.company || 'Locação'),
      h('a', { class: 'btn yellow', href: '#/locacoes/nova' }, icon('plus'), 'Nova locação'),
      h('div', { class: 'grow-top' }),
      NAV.map((n) => navLink('nav', n)),
      h('div', { class: 'grow' }),
      h('div', { class: 'who' }, state.user.name)),
    (view = h('main', { id: 'view', tabindex: '-1' })),
    h('a', { class: 'fab', href: '#/locacoes/nova' }, icon('plus'), 'Nova locação'),
    h('nav', { class: 'tabbar', 'aria-label': 'Menu principal' }, TABS.map(([p, l, i]) => h('a', { href: '#' + p, 'data-nav': p }, icon(i), l)))));
}

export async function boot() {
  let me;
  try { me = await get('/api/me'); } catch (e) { mount(root, h('div', { class: 'auth' }, h('div', { class: 'box' }, h('h1', null, 'Sem conexão'), h('p', { class: 'lead' }, e.message), h('button', { class: 'btn', onclick: boot }, 'Tentar de novo')))); return; }
  state.today = me.today;
  if (!me.user) { state.user = null; mount(root, authPage(me.needs_setup, boot)); return; }
  state.user = me.user;
  try { const s = await get('/api/settings'); state.company = s.company_name; } catch {}
  shell();
  if (!location.hash) location.hash = '#/';
  renderRoute();
}

setUnauthHandler(() => { if (state.user) { state.user = null; toast('Sua sessão terminou. Entre de novo.', true); boot(); } });
window.addEventListener('hashchange', renderRoute);
boot();
