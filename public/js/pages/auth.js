import { h } from '../dom.js';
import { post } from '../api.js';
import { field, textInput } from '../ui.js';

export default function authPage(needsSetup, done) {
  const err = h('div', { class: 'err', role: 'alert', hidden: true });
  const btn = h('button', { class: 'btn', type: 'submit' }, needsSetup ? 'Criar acesso' : 'Entrar');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault(); err.hidden = true; btn.disabled = true;
      const f = new FormData(form);
      try {
        if (needsSetup) await post('/api/setup', { name: f.get('name'), email: f.get('email'), password: f.get('password') });
        else await post('/api/login', { email: f.get('email'), password: f.get('password') });
        location.hash = '#/';
        done();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
    },
  },
  needsSetup ? field('Seu nome', textInput('name', '', { required: true, autocomplete: 'name' })) : null,
  field('E-mail', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'username' })),
  field(needsSetup ? 'Crie uma senha' : 'Senha', h('input', { name: 'password', type: 'password', required: true, minlength: needsSetup ? 8 : null, autocomplete: needsSetup ? 'new-password' : 'current-password' }), needsSetup ? 'Pelo menos 8 caracteres.' : null),
  err, btn);
  return h('div', { class: 'auth' }, h('div', { class: 'box' },
    h('h1', null, needsSetup ? 'Vamos começar' : 'Entrar'),
    h('p', { class: 'lead' }, needsSetup ? 'Crie o acesso do administrador. Depois você cadastra a equipe em Ajustes.' : 'Use o e-mail e a senha cadastrados.'),
    form));
}
