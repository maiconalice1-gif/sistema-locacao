export const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/** Texto digitado ("1.234,56", "50", "50,5") para centavos; NaN se for inválido. */
export function parseMoney(s) {
  s = String(s ?? '').trim().replace(/[R$\s]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}
export const moneyInput = (c) => (c / 100).toFixed(2).replace('.', ',');
export const dmy = (s) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '');
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const dayParts = (s) => { const [y, m, d] = s.split('-'); return { day: String(+d), mon: MESES[+m - 1], wd: DIAS[new Date(s + 'T12:00:00').getDay()], y }; };
export const stamp = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
export const monthLabel = (m) => { const [y, mm] = m.split('-'); return `${['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][+mm - 1]} de ${y}`; };
export function waLink(phone) {
  const n = String(phone || '').replace(/\D/g, '');
  return n.length >= 10 ? 'https://wa.me/' + (n.startsWith('55') ? n : '55' + n) : '';
}
export const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
