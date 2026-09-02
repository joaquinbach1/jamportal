/* ============================================================
   correr-sql.js — aplicar migraciones a la base
   ------------------------------------------------------------
   Hace lo que haría `psql -v ON_ERROR_STOP=1 -f uno -f otro`,
   que en esta máquina no está instalado.

   El string de conexión se lee de .env.db —que está en el
   .gitignore— y nunca se imprime ni se pasa por argumento: por
   argumento quedaría en el historial del shell y a la vista de
   cualquier `ps`.

   Cada archivo va en su propia transacción: si uno falla, ese
   queda entero afuera y los anteriores quedan aplicados. Es lo
   mismo que hace psql con ON_ERROR_STOP, y es lo que se quiere
   acá —son pasos que se corren en orden, no un todo o nada.

   Uso:  npx -y -p pg node scripts/correr-sql.js a.sql b.sql …
   ============================================================ */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const archivos = process.argv.slice(2);
if (!archivos.length) { console.error('Decime qué archivos correr'); process.exit(1); }

const conn = fs.readFileSync(path.join(raiz, '.env.db'), 'utf8')
  .split('\n').map(l => l.trim()).find(l => l.startsWith('postgres'));
if (!conn) { console.error('No encontré el string de conexión en .env.db'); process.exit(1); }

/* Nunca loguear la contraseña, ni siquiera si algo falla feo. */
const tapar = t => String(t).replace(/:\/\/[^@]*@/g, '://····@');

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log('conectado\n');

try {
  for (const f of archivos) {
    const sql = fs.readFileSync(path.join(raiz, f), 'utf8');
    process.stdout.write(`→ ${f} … `);
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('commit');
      console.log('ok');
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  }
  console.log('\nlisto, todo aplicado');
} catch (e) {
  console.error(`\nFALLÓ, y ese archivo quedó sin aplicar: ${tapar(e.message)}`);
  if (e.position) console.error(`  posición ${e.position}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
