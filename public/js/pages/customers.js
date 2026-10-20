import { h } from '../dom.js';
import { get, post, put } from '../api.js';
import { field, textInput, openForm, toast, empty } from '../ui.js';

export const customerForm = (c, ctx) => openForm({
  title: c ? 'Editar cliente' : 'Novo cliente',
  build: () => [
    field('Nome', textInput('name', c?.name || '', { required: true, maxlength: 120 })),
    h('div', { class: 'grid2' }, field('Telefone (WhatsApp)', h('input', { name: 'phone', type: 'tel', value: c?.phone || '', autocomplete: 'off' })), field('CPF ou CNPJ', textInput('doc', c?.doc || ''))),
    field('Endereço', textInput('address', c?.address || '', { maxlength: 300 })),
    field('E-mail', h('input', { name: 'email', type: 'email', value: c?.email || '' })),
    field('Observações', h('textarea', { name: 'notes', maxlength: 1000 }, c?.notes || '')),
  ],
  onSubmit: async (f) => {
    const body = Object.fromEntries(new FormData(f));
    if (c) await put('/api/customers/' + c.id, body); else await post('/api/customers', body);
  },
}).then((ok) => { if (ok) { toast('Cliente salvo.'); ctx.rerender(); } });

export default async function customers(ctx) {
  let q = '', timer;
  const list = h('div'), search = h('input', { type: 'search', placeholder: 'Buscar por nome, telefone ou CPF/CNPJ', 'aria-label': 'Buscar clientes' });
  async function load() {
    const rows = await get('/api/customers?q=' + encodeURIComponent(q));
    list.replaceChildren(rows.length ? h('div', { class: 'list' }, rows.map((c) => h('a', { class: 'row', href: '#/clientes/' + c.id }, h('span', { class: 'main' }, h('strong', null, c.name), h('span', { class: 'muted small' }, [c.phone, c.address].filter(Boolean).join(' · ') || 'Sem contato')), h('span', { class: 'muted' }, '›'))))
      : empty('Nenhum cliente encontrado', q ? 'Tente outro nome ou telefone.' : 'Cadastre seu primeiro cliente para criar locações.', h('button', { class: 'btn', onclick: () => customerForm(null, ctx) }, 'Novo cliente')));
  }
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { q = search.value.trim(); load(); }, 250); });
  await load();
  return h('div', { class: 'page' }, h('div', { class: 'head' }, h('h1', null, 'Clientes'), h('button', { class: 'btn yellow', onclick: () => customerForm(null, ctx) }, 'Novo cliente')), h('div', { class: 'search' }, search), list);
}
