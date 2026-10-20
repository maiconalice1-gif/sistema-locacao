// Regras de dinheiro e parcelas (funções puras, valores em centavos).
export const subtotal = (items) => items.reduce((a, i) => a + i.qty * i.unit_price_cents, 0);
export const rentalTotal = (r, items) => subtotal(items) + r.freight_cents - r.discount_cents;

/** Divide o total em n parcelas mensais (centavos exatos; vencimento no fim do mês quando o dia não existe). */
export function buildSchedule(total, n, firstDue) {
  const [y, m, d] = firstDue.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const last = new Date(Date.UTC(y, m + i, 0)).getUTCDate();
    const due = new Date(Date.UTC(y, m - 1 + i, Math.min(d, last))).toISOString().slice(0, 10);
    return { n: i + 1, due_date: due, amount_cents: Math.floor(total / n) + (i < total % n ? 1 : 0) };
  }).filter((p) => p.amount_cents > 0);
}

/** Aplica o valor já recebido às parcelas, da mais antiga para a mais nova. */
export function coverSchedule(rows, paid) {
  let left = Math.max(0, paid);
  return rows.map((r) => {
    const cover = Math.min(r.amount_cents, left);
    left -= cover;
    return { ...r, paid_cents: cover, open_cents: r.amount_cents - cover };
  });
}
