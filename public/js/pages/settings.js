import { h } from '../dom.js';
import { get, post, put, patch } from '../api.js';
import { state, isAdmin } from '../state.js';
import { field, textInput, select, openForm, toast } from '../ui.js';
import { logout } from './more.js';

export default async function settings(ctx) {
  const admin = isAdmin();
  const [s, users] = admin ? await Promise.all([get('/api/settings'), get('/api/users')]) : [null, []];
  const err = h('div', { class: 'err', role: 'alert', hidden: true });

  const changePassword = () => openForm({
    title: 'Trocar minha senha', submit: 'Trocar senha',
    build: () => [field('Senha atual', h('input', { name: 'current', type: 'password', required: true, autocomplete: 'current-password' })), field('Nova senha', h('input', { name: 'password', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' }), 'Pelo menos 8 caracteres.')],
    onSubmit: async (f) => { const fd = new FormData(f); await post('/api/me/password', { current: fd.get('current'), password: fd.get('password') }); },
  }).then((ok) => ok && toast('Senha trocada.'));

  const userForm = (u) => openForm({
    title: u ? 'Editar usuário' : 'Novo usuário', submit: 'Salvar',
    build: () => [
      field('Nome', textInput('name', u?.name || '', { required: true })),
      u ? null : field('E-mail (será o login)', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'off' })),
      field('Perfil', select('role', [['staff', 'Funcionário — usa o dia a dia'], ['admin', 'Administrador — também gerencia equipe e ajustes']], u?.role || 'staff')),
      field(u ? 'Nova senha (deixe em branco para manter)' : 'Senha', h('input', { name: 'password', type: 'password', minlength: 8, required: !u, autocomplete: 'new-password' }), 'Pelo menos 8 caracteres.'),
      u ? h('label', { class: 'row' }, h('span', { class: 'main' }, h('strong', null, 'Acesso ativo')), h('input', { type: 'checkbox', name: 'active', checked: u.active })) : null,
    ],
    onSubmit: async (f) => {
      const fd = new FormData(f);
      if (u) await patch('/api/users/' + u.id, { name: fd.get('name'), role: fd.get('role'), active: fd.get('active') === 'on', ...(fd.get('password') ? { password: fd.get('password') } : {}) });
      else await post('/api/users', { name: fd.get('name'), email: fd.get('email'), role: fd.get('role'), password: fd.get('password') });
    },
  }).then((ok) => { if (ok) { toast('Usuário salvo.'); ctx.rerender(); } });

  let company = null;
  if (admin) {
    const f = (k, label, o = {}) => field(label, textInput(k, s[k], o));
    company = h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); err.hidden = true;
        try { const saved = await put('/api/settings', Object.fromEntries(new FormData(e.target))); state.company = saved.company_name; toast('Ajustes salvos.'); }
        catch (ex) { err.textContent = ex.message; err.hidden = false; }
      },
    }, f('company_name', 'Nome da empresa', { required: true }), h('div', { class: 'grid2' }, f('company_doc', 'CNPJ ou CPF'), f('company_phone', 'Telefone')), f('company_address', 'Endereço'), f('contract_city', 'Cidade (aparece no fim do contrato)'),
    field('Condições do contrato', h('textarea', { name: 'contract_terms', rows: '10', maxlength: '5000' }, s.contract_terms), 'Cada linha vira um item impresso no contrato. Revise com um advogado se precisar de validade jurídica específica.'),
    err, h('button', { class: 'btn', type: 'submit' }, 'Salvar ajustes'));
    company.querySelector('textarea').value = s.contract_terms;
  }

  return h('div', { class: 'page' }, h('div', { class: 'head' }, h('h1', null, 'Ajustes')),
    h('section', { class: 'block' }, h('div', { class: 'title' }, h('h2', null, 'Minha conta')),
      h('div', { class: 'list' }, h('div', { class: 'row' }, h('span', { class: 'main' }, h('strong', null, state.user.name), h('span', { class: 'muted small' }, `${state.user.email} · ${admin ? 'Administrador' : 'Funcionário'}`)), h('span', { class: 'side actions' }, h('button', { class: 'btn ghost small', onclick: changePassword }, 'Trocar senha'), h('button', { class: 'btn ghost small', onclick: logout }, 'Sair')))))
    , admin ? [
      h('section', { class: 'block' }, h('div', { class: 'title' }, h('h2', null, 'Empresa e contrato')), company),
      h('section', { class: 'block' }, h('div', { class: 'title' }, h('h2', null, 'Equipe'), h('button', { class: 'btn yellow small', onclick: () => userForm(null) }, 'Novo usuário')),
        h('div', { class: 'list' }, users.map((u) => h('div', { class: 'row' }, h('span', { class: 'main' }, h('strong', null, u.name + (u.active ? '' : ' (desativado)')), h('span', { class: 'muted small' }, `${u.email} · ${u.role === 'admin' ? 'Administrador' : 'Funcionário'}`)), h('button', { class: 'btn ghost small', onclick: () => userForm(u) }, 'Editar'))))),
      h('section', { class: 'block' }, h('div', { class: 'title' }, h('h2', null, 'Cópia de segurança')),
        h('p', { class: 'muted' }, 'O servidor guarda uma cópia por dia (últimas 14). Baixe também uma cópia para o seu computador de vez em quando.'),
        h('p', null, h('a', { class: 'btn', href: '/api/backup', download: '' }, 'Baixar cópia dos dados'))),
    ] : null);
}
