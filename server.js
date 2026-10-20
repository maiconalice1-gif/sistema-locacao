import { createServer } from 'node:http';
import { mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './src/db.js';
import { createApp } from './src/app.js';
import { today } from './src/util.js';

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(process.env.DATA_DIR || join(root, 'data'));
const port = Number(process.env.PORT || 3000);
mkdirSync(join(dataDir, 'backups'), { recursive: true });

const db = openDb(join(dataDir, 'locacao.sqlite'));
const handler = createApp({
  db, publicDir: join(root, 'public'), dataDir,
  trustProxy: process.env.TRUST_PROXY === '1', secureCookie: process.env.COOKIE_SECURE === '1',
});

// Cópia automática diária (guarda as últimas 14) em DATA_DIR/backups.
function dailyBackup() {
  try {
    const file = join(dataDir, 'backups', `locacao-${today()}.sqlite`);
    if (!existsSync(file)) db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const old = readdirSync(join(dataDir, 'backups')).filter((f) => f.endsWith('.sqlite')).sort().slice(0, -14);
    for (const f of old) unlinkSync(join(dataDir, 'backups', f));
  } catch (e) { console.error('[backup] falhou:', e.message); }
}
dailyBackup();
setInterval(dailyBackup, 6 * 3600 * 1000).unref();

const server = createServer(handler);
server.listen(port, () => console.log(`Sistema de locação rodando em http://localhost:${port}  (dados em ${dataDir})`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); });
