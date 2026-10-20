// Teste de ponta a ponta no navegador (opcional): precisa do pacote "playwright" instalado.
//   node test/e2e.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = createRequire('/opt/npm-tools/node_modules/')('playwright'); }

const dir = mkdtempSync(join(tmpdir(), 'loc-e2e-')), PORT = 4100 + Math.floor(Math.random() * 500);
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.on('data', (d) => String(d).includes('rodando') && r()));
const base = `http://localhost:${PORT}`;
const browser = await pw.chromium.launch();
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('FALHOU', m); } else console.log('ok  ', m); };
const errors = [];
const watch = (page) => { page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); }); };

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, acceptDownloads: true });
  const page = await ctx.newPage(); watch(page);
  const shot = (n) => page.screenshot({ path: join(dir, n + '.png') });
  // 1. primeiro acesso
  await page.goto(base);
  await page.waitForSelector('text=Vamos começar');
  await page.fill('input[name=name]', 'Maria Souza'); await page.fill('input[name=email]', 'maria@loja.com'); await page.fill('input[name=password]', 'senha-bem-forte-1');
  await page.click('button:has-text("Criar acesso")');
  await page.waitForSelector('h1:has-text("Olá, Maria")');
  ok(true, 'primeiro acesso cria o administrador e abre o início');
  await shot('01-inicio-vazio');
  // 2. ajustes da empresa
  await page.goto(base + '/#/ajustes'); await page.waitForSelector('text=Empresa e contrato');
  await page.fill('input[name=company_name]', 'Festa Fácil Locações'); await page.fill('input[name=company_doc]', '12.345.678/0001-90'); await page.fill('input[name=contract_city]', 'Campinas');
  await page.click('button:has-text("Salvar ajustes")'); await page.waitForSelector('.toast:has-text("Ajustes salvos")');
  // 3. catálogo + foto
  await page.goto(base + '/#/catalogo'); await page.waitForSelector('text=Nenhum material cadastrado');
  await page.click('button:has-text("Novo material") >> nth=0');
  await page.fill('input[name=name]', 'Mesa quadrada'); await page.fill('input[name=category]', 'Mesas'); await page.fill('input[name=qty]', '10'); await page.fill('input[name=price]', '50');
  await page.click('dialog button:has-text("Salvar")'); await page.waitForSelector('.item h3:has-text("Mesa quadrada")');
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1600; c.height = 1200; const x = c.getContext('2d'); x.fillStyle = '#e0a'; x.fillRect(0, 0, 1600, 1200); return c.toDataURL('image/png').split(',')[1]; });
  writeFileSync(join(dir, 'foto.png'), Buffer.from(png, 'base64'));
  await page.setInputFiles('.item input[type=file]', join(dir, 'foto.png'));
  await page.waitForSelector('img.photo');
  const loaded = await page.$eval('img.photo', (i) => i.complete && i.naturalWidth > 0 && i.naturalWidth <= 800);
  ok(loaded, 'foto enviada, reduzida para até 800 px e exibida');
  await page.click('button:has-text("Novo material") >> nth=0');
  await page.fill('input[name=name]', 'Cadeira dobrável'); await page.fill('input[name=qty]', '40'); await page.fill('input[name=price]', '3,50');
  await page.click('dialog button:has-text("Salvar")'); await page.waitForSelector('.item h3:has-text("Cadeira dobrável")');
  // 4. cliente
  await page.goto(base + '/#/clientes'); await page.click('button:has-text("Novo cliente") >> nth=0');
  await page.fill('input[name=name]', 'Ana Paula'); await page.fill('input[name=phone]', '(19) 98888-7777'); await page.fill('input[name=address]', 'Rua das Flores, 120');
  await page.click('dialog button:has-text("Salvar")'); await page.waitForSelector('.row:has-text("Ana Paula")');
  // 5. nova locação
  await page.goto(base + '/#/locacoes/nova'); await page.waitForSelector('.picker .name:has-text("Mesa quadrada")');
  await page.selectOption('select[name=customer]', { label: 'Ana Paula · (19) 98888-7777' });
  ok((await page.inputValue('input[name=address]')) === 'Rua das Flores, 120', 'endereço do cliente preenche sozinho');
  const dias = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 3); const f = (x) => x.toISOString().slice(0, 10); const e = new Date(d); e.setDate(e.getDate() + 1); return [f(d), f(e)]; });
  await page.fill('form input[type=date] >> nth=0', dias[0]); await page.fill('form input[type=date] >> nth=1', dias[1]);
  await page.waitForTimeout(500);
  await page.fill('input[aria-label="Quantidade de Mesa quadrada"]', '4'); await page.fill('input[aria-label="Quantidade de Cadeira dobrável"]', '20');
  await page.fill('input[name=freight]', '30'); await page.fill('input[name=discount]', '10');
  await page.fill('input[type=number][max="36"]', '2');
  const tot = await page.textContent('.totals');
  ok(/R\$\s*290,00/.test(tot), 'total calculado na tela: 4×50 + 20×3,50 + 30 − 10 = 290 (' + tot.replace(/\s+/g, ' ') + ')');
  await shot('02-nova-locacao');
  await page.click('button:has-text("Reservar materiais")'); await page.waitForSelector('h1:has-text("Ana Paula")');
  ok(await page.isVisible('text=R$ 290,00'), 'locação criada com total correto');
  // estoque descontado nas datas
  // 6. pagamento parcial
  await page.click('button:has-text("Receber pagamento")'); await page.fill('input[name=amount]', '100'); await page.click('dialog button:has-text("Registrar pagamento")');
  await page.waitForSelector('.toast:has-text("Pagamento registrado")');
  ok(await page.isVisible('text=Falta R$ 45,00') && await page.isVisible('text=A receber') , 'parcelas refletem o pagamento (1ª de 145 paga em 100)');
  await shot('03-pedido');
  // 7. contrato
  await page.click('a:has-text("Contrato")'); await page.waitForSelector('.doc');
  const contrato = (await page.textContent('.doc')).replace(/\s/g, ' ');
  ok(contrato.includes('Festa Fácil Locações') && contrato.includes('Ana Paula') && contrato.includes('Campinas') && contrato.includes('R$ 290,00'), 'contrato traz empresa, cliente, cidade e total');
  await page.emulateMedia({ media: 'print' });
  ok(!(await page.isVisible('.tabbar')) && !(await page.isVisible('.doc-bar')), 'ao imprimir, menus e botões somem');
  await page.emulateMedia({ media: 'screen' });
  await page.goBack();
  // 8. entrega e devolução com falta
  await page.click('button:has-text("Entregar")');
  await page.check('input[name=checked] >> nth=0'); await page.check('input[name=checked] >> nth=1');
  await page.fill('input[name=received_by]', 'Ana'); await page.click('dialog button:has-text("Confirmar entrega")');
  await page.waitForSelector('.toast:has-text("Entrega registrada")');
  await page.click('button:has-text("Receber devolução")');
  const rets = page.locator('input[name^=ret-]'); await rets.nth(0).fill('3'); await page.locator('input[name^=dam-]').nth(1).fill('2');
  await page.click('dialog button:has-text("Concluir devolução")'); await page.waitForSelector('.toast:has-text("Devolução registrada")');
  await page.goto(base + '/#/catalogo'); await page.waitForSelector('text=Avariados e faltantes');
  ok(await page.isVisible('.row:has-text("1 × Mesa quadrada")') && await page.isVisible('.row:has-text("2 × Cadeira dobrável")'), 'faltante e quebrados ficam bloqueados no catálogo');
  await page.click('.row:has-text("2 × Cadeira dobrável") >> button:has-text("Consertado")'); await page.click('dialog button:has-text("Voltar ao estoque")');
  await page.waitForSelector('.toast:has-text("Pronto")');
  await shot('04-catalogo');
  // 9. caixa
  await page.goto(base + '/#/caixa'); await page.waitForSelector('.row:has-text("Locação")');
  ok(await page.isVisible('dd:has-text("R$ 100,00")'), 'caixa mostra a entrada de R$ 100,00');
  await page.click('button:has-text("Nova saída")'); await page.fill('input[name=description]', 'Combustível da van'); await page.fill('input[name=amount]', '85,50'); await page.click('dialog button:has-text("Lançar")');
  await page.waitForSelector('.row:has-text("Combustível da van")');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('a:has-text("Baixar CSV")')]);
  ok(/caixa-\d{4}-\d{2}\.csv/.test(dl.suggestedFilename()), 'CSV do caixa baixa com nome correto');
  await shot('05-caixa');
  await page.goto(base + '/#/locacoes'); await page.waitForSelector('.ticket'); await shot('08-lista');
  // 10. início com dados
  await page.goto(base + '/#/'); await page.waitForSelector('h1:has-text("Olá")'); await shot('06-inicio');
  // 11. equipe: funcionário não vê ajustes de empresa
  await page.goto(base + '/#/ajustes'); await page.click('button:has-text("Novo usuário")');
  await page.fill('input[name=name]', 'Carlos'); await page.fill('input[name=email]', 'carlos@loja.com'); await page.fill('input[name=password]', 'senha-do-carlos-9'); await page.click('dialog button:has-text("Salvar")');
  await page.waitForSelector('.toast:has-text("Usuário salvo")');
  await page.click('button:has-text("Sair")'); await page.waitForSelector('h1:has-text("Entrar")');
  await page.fill('input[name=email]', 'carlos@loja.com'); await page.fill('input[name=password]', 'errada'); await page.click('button:has-text("Entrar")');
  await page.waitForSelector('.err:has-text("incorretos")'); ok(true, 'senha errada mostra mensagem clara'); errors.length = 0; // o 401 é esperado aqui
  await page.fill('input[name=password]', 'senha-do-carlos-9'); await page.click('button:has-text("Entrar")'); await page.waitForSelector('h1:has-text("Olá, Carlos")');
  await page.goto(base + '/#/ajustes'); await page.waitForSelector('text=Minha conta');
  ok(!(await page.isVisible('text=Empresa e contrato')) && !(await page.isVisible('text=Cópia de segurança')), 'funcionário não vê empresa, equipe nem backup');
  // 12. desktop
  const big = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const p2 = await big.newPage(); watch(p2);
  await p2.goto(base); await p2.fill('input[name=email]', 'maria@loja.com'); await p2.fill('input[name=password]', 'senha-bem-forte-1'); await p2.click('button:has-text("Entrar")'); await p2.waitForSelector('h1:has-text("Olá")');
  await p2.screenshot({ path: join(dir, '07-desktop.png') });
  ok(await p2.isVisible('.rail') && !(await p2.isVisible('.tabbar')), 'no computador aparece o menu lateral');
  const hasCsp = errors.filter((e) => /Content Security Policy|Refused to/i.test(e));
  ok(hasCsp.length === 0, 'nenhuma violação da política de segurança (CSP) ' + JSON.stringify(hasCsp));
  ok(errors.length === 0, 'sem erros no console: ' + JSON.stringify(errors));
} catch (e) { failed++; console.log('EXCEÇÃO', e.message); errors.length && console.log(errors); try { const pg = browser.contexts()[0].pages()[0]; await pg.screenshot({ path: join(dir, 'erro.png') }); console.log('tela no erro:', (await pg.textContent('main')).replace(/\s+/g, ' ').slice(0, 400)); } catch {} }
finally { await browser.close(); srv.kill(); console.log('capturas em', dir); process.exit(failed ? 1 : 0); }
