import { bad, one, all, run, audit, nowIso, str, oneOf, HttpError } from './util.js';
import { hashPassword, checkPasswordRules } from './auth.js';
import { listRentals } from './rentals.js';

// ---- Clientes ----
const cust = (b) => ({
  name: str(b.name, 'Nome do cliente', { max: 120 }), doc: str(b.doc, 'CPF/CNPJ', { max: 30, required: false }),
  phone: str(b.phone, 'Telefone', { max: 30, required: false }), email: str(b.email, 'E-mail', { max: 120, required: false }),
  address: str(b.address, 'Endereço', { max: 300, required: false }), notes: str(b.notes, 'Observações', { max: 1000, required: false }),
});
export function listCustomers(db, q = '') {
  const like = `%${String(q).replace(/[%_\\]/g, '\\$&')}%`;
  return all(db, `SELECT id,name,doc,phone,email,address,notes FROM customers WHERE active=1 AND (name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR doc LIKE ? ESCAPE '\\') ORDER BY name LIMIT 500`, like, like, like).map((c) => ({ ...c }));
}
export function createCustomer(db, user, b) {
  const c = cust(b);
  const r = run(db, 'INSERT INTO customers(name,doc,phone,email,address,notes,created_at) VALUES (?,?,?,?,?,?,?)', c.name, c.doc, c.phone, c.email, c.address, c.notes, nowIso());
  audit(db, user.id, 'criar', 'cliente', r.lastInsertRowid, c.name);
  return { id: Number(r.lastInsertRowid), ...c };
}
export function getCustomer(db, id) {
  const c = one(db, 'SELECT id,name,doc,phone,email,address,notes FROM customers WHERE id=? AND active=1', id);
  if (!c) throw new HttpError(404, 'Cliente não encontrado.');
  return { ...c, rentals: listRentals(db, { customer_id: id }) };
}
export function updateCustomer(db, user, id, b) {
  if (!one(db, 'SELECT 1 FROM customers WHERE id=? AND active=1', id)) throw new HttpError(404, 'Cliente não encontrado.');
  const c = cust(b);
  run(db, 'UPDATE customers SET name=?,doc=?,phone=?,email=?,address=?,notes=? WHERE id=?', c.name, c.doc, c.phone, c.email, c.address, c.notes, id);
  audit(db, user.id, 'editar', 'cliente', id, c.name);
  return { id, ...c };
}
export function deleteCustomer(db, user, id) {
  if (one(db, 'SELECT 1 FROM rentals WHERE customer_id=?', id)) throw bad('Este cliente tem locações e não pode ser excluído.');
  run(db, 'UPDATE customers SET active=0 WHERE id=?', id);
  audit(db, user.id, 'excluir', 'cliente', id);
}

// ---- Usuários ----
export const listUsers = (db) => all(db, 'SELECT id,name,email,role,active FROM users ORDER BY name').map((u) => ({ ...u, active: !!u.active }));
export function createUser(db, actor, b) {
  const name = str(b.name, 'Nome', { max: 80 }), email = str(b.email, 'E-mail', { max: 120 }).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('E-mail inválido.');
  const role = oneOf(b.role || 'staff', 'Perfil', ['admin', 'staff']);
  checkPasswordRules(b.password);
  if (one(db, 'SELECT 1 FROM users WHERE email=?', email)) throw bad('Já existe um usuário com esse e-mail.');
  const r = run(db, 'INSERT INTO users(name,email,pass_hash,role,created_at) VALUES (?,?,?,?,?)', name, email, hashPassword(b.password), role, nowIso());
  audit(db, actor?.id, 'criar', 'usuário', r.lastInsertRowid, email);
  return { id: Number(r.lastInsertRowid), name, email, role, active: true };
}
export function updateUser(db, actor, id, b) {
  const u = one(db, 'SELECT * FROM users WHERE id=?', id);
  if (!u) throw new HttpError(404, 'Usuário não encontrado.');
  const role = b.role === undefined ? u.role : oneOf(b.role, 'Perfil', ['admin', 'staff']);
  const active = b.active === undefined ? u.active : b.active ? 1 : 0;
  if ((u.role === 'admin' && (role !== 'admin' || !active)) && one(db, `SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1 AND id!=?`, id).n === 0)
    throw bad('É preciso manter pelo menos um administrador ativo.');
  if (id === actor.id && !active) throw bad('Você não pode desativar o próprio usuário.');
  run(db, 'UPDATE users SET name=?,role=?,active=? WHERE id=?', b.name === undefined ? u.name : str(b.name, 'Nome', { max: 80 }), role, active, id);
  if (b.password) { checkPasswordRules(b.password); run(db, 'UPDATE users SET pass_hash=? WHERE id=?', hashPassword(b.password), id); }
  if (!active || b.password) run(db, 'DELETE FROM sessions WHERE user_id=?', id);
  audit(db, actor.id, 'editar', 'usuário', id);
}

// ---- Configurações da empresa / contrato ----
export const DEFAULT_TERMS = `1. O LOCATÁRIO declara ter recebido os materiais listados neste contrato e se compromete a devolvê-los na data e no local combinados, nas mesmas condições em que os recebeu.
2. Peças quebradas, avariadas, extraviadas ou devolvidas em condições de limpeza inadequadas serão cobradas pelo valor de reposição ou de conserto.
3. O LOCATÁRIO é responsável pelos materiais desde a entrega até a devolução, inclusive contra chuva, furto, perda e mau uso.
4. O atraso na devolução poderá gerar a cobrança de nova diária, conforme combinado entre as partes.
5. A reserva dos materiais é confirmada conforme as condições de pagamento descritas neste contrato.
6. Cancelamentos devem ser comunicados com antecedência; eventuais valores pagos serão tratados conforme combinado entre as partes.`;
export const SETTING_KEYS = ['company_name', 'company_doc', 'company_phone', 'company_address', 'contract_city', 'contract_terms'];
export function getSettings(db) {
  const s = Object.fromEntries(all(db, 'SELECT key,value FROM settings').map((r) => [r.key, r.value]));
  return { company_name: 'Minha Locadora', company_doc: '', company_phone: '', company_address: '', contract_city: '', contract_terms: DEFAULT_TERMS, ...s };
}
export function saveSettings(db, user, b) {
  for (const k of SETTING_KEYS) {
    if (b[k] === undefined) continue;
    const v = str(b[k], k, { max: k === 'contract_terms' ? 5000 : 200, required: k === 'company_name' });
    run(db, 'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, v);
  }
  audit(db, user.id, 'editar', 'configurações', null);
  return getSettings(db);
}
