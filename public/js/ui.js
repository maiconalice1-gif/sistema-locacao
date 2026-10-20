import { h, mount } from './dom.js';

let toastTimer;
export function toast(msg, bad = false) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), bad ? 6000 : 3200);
}

export const field = (label, input, hint) => h('label', { class: 'field' }, h('span', null, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
export const textInput = (name, v = '', o = {}) => h('input', { name, value: v, type: 'text', autocomplete: 'off', ...o });
export const moneyField = (name, v = '', o = {}) => h('input', { name, value: v, inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', ...o });
export const select = (name, options, current, o = {}) =>
  h('select', { name, ...o }, options.map((x) => { const [val, label] = Array.isArray(x) ? x : [x, x]; return h('option', { value: val, selected: String(val) === String(current) }, label); }));

/**
 * Abre uma janela de formulário. `build(form)` devolve os campos; `onSubmit(form)` é async e,
 * se lançar erro, a mensagem aparece na janela sem fechá-la. Resolve true se salvou.
 */
export function openForm({ title, build, onSubmit, submit = 'Salvar', danger = false, extra = null }) {
  return new Promise((resolve) => {
    const dlg = h('dialog');
    const err = h('div', { class: 'err', role: 'alert', hidden: true });
    const btn = h('button', { class: 'btn' + (danger ? ' danger' : ''), type: 'submit' }, submit);
    const form = h('form', { novalidate: false });
    const close = (ok) => { dlg.close(); dlg.remove(); resolve(ok); };
    mount(form,
      h('div', { class: 'dlg-head' }, h('h2', null, title), h('button', { class: 'x', type: 'button', 'aria-label': 'Fechar', onclick: () => close(false) }, '×')),
      h('div', { class: 'dlg-body' }, build(form), err),
      h('div', { class: 'dlg-foot' }, extra, h('button', { class: 'btn ghost', type: 'button', onclick: () => close(false) }, 'Cancelar'), btn));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true; btn.disabled = true;
      try { await onSubmit(form); close(true); }
      catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; err.scrollIntoView({ block: 'nearest' }); }
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(false); });
    dlg.append(form);
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector('input:not([type=hidden]),select,textarea')?.focus();
  });
}

export const confirmBox = (title, message, ok = 'Confirmar', danger = false) =>
  openForm({ title, submit: ok, danger, build: () => h('p', null, message), onSubmit: async () => {} });

export const empty = (title, text, action) => h('div', { class: 'empty' }, h('h3', null, title), text ? h('p', null, text) : null, action);
export const chip = (cls, text) => h('span', { class: 'chip ' + cls }, text);
export const statusChip = (s) => chip(s.toLowerCase(), s);
export function payChip(r) {
  if (r.status === 'Cancelado' || r.total_cents <= 0) return null;
  if (r.paid_cents >= r.total_cents) return chip('pago', 'Pago');
  return r.paid_cents > 0 ? chip('parcial', 'Pago em parte') : null;
}
export const busy = async (btn, fn) => { btn.disabled = true; try { return await fn(); } finally { btn.disabled = false; } };

/** Redimensiona a foto no aparelho (máx. 800 px, JPEG) antes de enviar. */
export async function shrinkPhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20_000_000) throw new Error('Escolha uma foto JPG, PNG ou WebP de até 20 MB.');
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
  if (!blob) throw new Error('Não foi possível preparar a foto.');
  return blob;
}
