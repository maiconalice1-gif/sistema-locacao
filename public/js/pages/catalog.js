import { h } from '../dom.js';
import { get, post, put, del, api } from '../api.js';
import { state } from '../state.js';
import { brl, parseMoney, moneyInput, plural } from '../fmt.js';
import { field, textInput, moneyField, openForm, confirmBox, toast, shrinkPhoto, empty } from '../ui.js';

export default async function catalog(ctx) {
  let start = state.today, end = state.today;
  const [blocks, all] = await Promise.all([get('/api/blocks'), get('/api/items?all=1')]);
  const inactive = all.filter((i) => !i.active);
  const listBox = h('div');
  const startIn = h('input', { type: 'date', value: start }), endIn = h('input', { type: 'date', value: end });

  const itemForm = (it) => openForm({
    title: it ? 'Editar material' : 'Novo material',
    build: () => [
      field('Nome', textInput('name', it?.name || '', { required: true, maxlength: 120, placeholder: 'Ex.: Cadeira dobrável branca' })),
      field('Categoria (opcional)', textInput('category', it?.category || '', { maxlength: 60, placeholder: 'Ex.: Cadeiras e mesas' })),
      h('div', { class: 'grid2' }, field('Quantidade total', h('input', { name: 'qty', type: 'number', min: '0', step: '1', value: it ? it.qty_total : '', required: true })), field('Preço padrão (R$)', moneyField('price', it ? moneyInput(it.price_cents) : '', { required: true }))),
      it ? h('label', { class: 'row' }, h('span', { class: 'main' }, h('strong', null, 'Material ativo'), h('span', { class: 'muted small' }, 'Desmarque para esconder das novas locações.')), h('input', { type: 'checkbox', name: 'active', checked: it.active })) : null,
    ],
    onSubmit: async (f) => {
      const fd = new FormData(f), price = parseMoney(fd.get('price'));
      if (Number.isNaN(price)) throw new Error('Preço inválido. Use números, como 5 ou 5,50.');
      const body = { name: fd.get('name'), category: fd.get('category'), qty_total: Number(fd.get('qty')), price_cents: price };
      if (it) await put('/api/items/' + it.id, { ...body, active: fd.get('active') === 'on' }); else await post('/api/items', body);
    },
  }).then((ok) => ok && (toast('Material salvo.'), ctx.rerender()));

  async function photo(it, file) {
    try {
      const blob = await shrinkPhoto(file);
      const res = await fetch(`/api/items/${it.id}/photo`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob, credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json()).error || 'Não foi possível enviar a foto.');
      toast('Foto salva.'); ctx.rerender();
    } catch (e) { toast(e.message, true); }
  }

  function card(a) {
    const file = h('input', { type: 'file', accept: 'image/*', class: 'sr', tabindex: '-1', onchange: () => file.files[0] && photo(a, file.files[0]) });
    return h('article', { class: 'item' + (a.active === false ? ' off' : '') },
      a.has_photo ? h('img', { class: 'photo', src: `/api/items/${a.id}/photo?v=${a.photo_v}`, alt: a.name, loading: 'lazy' }) : h('div', { class: 'photo', 'aria-hidden': 'true' }, a.name.slice(0, 1).toUpperCase()),
      h('div', null,
        h('h3', null, a.name), h('p', { class: 'muted small' }, [a.category, brl(a.price_cents)].filter(Boolean).join(' · ')),
        a.available != null ? h('p', { class: 'avail' }, a.available, ' ', h('small', null, 'disponíveis')) : null,
        h('p', { class: 'stats' }, a.reserved != null ? `Total ${a.qty_total} · reservados ${a.reserved} · bloqueados ${a.blocked}` : `Total ${a.qty_total}`),
        h('div', { class: 'actions' }, h('button', { class: 'btn ghost small', onclick: () => itemForm(a) }, 'Editar'), h('button', { class: 'btn ghost small', onclick: () => file.click() }, a.has_photo ? 'Trocar foto' : 'Adicionar foto'), file,
          a.has_photo ? h('button', { class: 'btn ghost small', onclick: async () => { await del(`/api/items/${a.id}/photo`); ctx.rerender(); } }, 'Tirar foto') : null)));
  }

  async function load() {
    if (!start || !end || end < start) { listBox.replaceChildren(h('p', { class: 'err' }, 'A devolução não pode ser antes da entrega.')); return; }
    const av = await get(`/api/availability?start=${start}&end=${end}`);
    listBox.replaceChildren(av.length ? h('div', { class: 'items' }, av.map(card)) : empty('Nenhum material cadastrado', 'Cadastre mesas, cadeiras, toalhas e o que mais você aluga.', h('button', { class: 'btn', onclick: () => itemForm() }, 'Cadastrar material')));
  }
  startIn.addEventListener('input', () => { start = startIn.value; if (end < start) { end = start; endIn.value = start; } endIn.min = start; load(); });
  endIn.addEventListener('input', () => { end = endIn.value; load(); });
  await load();

  const resolve = (b, action) => async () => {
    const ok = await confirmBox(action === 'baixa' ? 'Dar baixa neste material?' : 'Material consertado ou encontrado?', action === 'baixa' ? `${plural(b.qty, 'unidade', 'unidades')} de ${b.item_name} saem do estoque definitivamente.` : `${plural(b.qty, 'unidade', 'unidades')} de ${b.item_name} voltam a ficar disponíveis.`, action === 'baixa' ? 'Dar baixa' : 'Voltar ao estoque', action === 'baixa');
    if (ok) { try { await post(`/api/blocks/${b.id}/resolve`, { action }); toast('Pronto.'); ctx.rerender(); } catch (e) { toast(e.message, true); } }
  };

  return h('div', { class: 'page' },
    h('div', { class: 'head' }, h('div', null, h('h1', null, 'Catálogo'), h('p', { class: 'sub' }, 'Veja o que está livre em qualquer período.')), h('button', { class: 'btn yellow', onclick: () => itemForm() }, 'Novo material')),
    blocks.length ? h('section', { class: 'block' }, h('div', { class: 'title' }, h('h2', null, 'Avariados e faltantes')),
      h('div', { class: 'list' }, blocks.map((b) => h('div', { class: 'row' }, h('span', { class: 'main' }, h('strong', null, `${b.qty} × ${b.item_name}`), h('span', { class: 'muted small' }, `${b.reason}${b.rental_id ? ' · locação ' + b.rental_id : ''}`)),
        h('span', { class: 'side actions' }, h('button', { class: 'btn ghost small', onclick: resolve(b, 'reparado') }, 'Consertado'), h('button', { class: 'btn danger small', onclick: resolve(b, 'baixa') }, 'Dar baixa')))))) : null,
    h('section', { class: 'block' }, h('div', { class: 'title' }, h('h2', null, 'Disponibilidade por data')), h('div', { class: 'grid2' }, field('Entrega', startIn), field('Devolução', endIn)), listBox),
    inactive.length ? h('section', { class: 'block' }, h('div', { class: 'title' }, h('h2', null, 'Desativados')), h('div', { class: 'items' }, inactive.map(card))) : null);
}
