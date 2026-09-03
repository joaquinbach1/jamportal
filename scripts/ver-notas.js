/* ¿Las notas privadas se guardan en la base o solo en el navegador?
   Si mis_notas y guardar_nota no existen, la app degrada a localStorage
   sin decir nada: se ven en el equipo donde se escribieron y en ningún
   otro. Vale saberlo antes de contar con ellas en el escenario.

   Uso:  node scripts/ver-notas.js                                    */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const conn = fs.readFileSync(path.join(raiz, '.env.db'), 'utf8')
  .split('\n').map(l => l.trim()).find(l => l.startsWith('postgres'));

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();

const fns = await client.query(`
  select proname, pg_get_function_identity_arguments(p.oid) args
  from   pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where  n.nspname = 'public' and proname in ('mis_notas', 'guardar_nota')
  order  by proname`);
console.log(fns.rows.length ? 'funciones de notas:' : 'funciones de notas: NO EXISTEN');
for (const x of fns.rows) console.log(`  ${x.proname}(${x.args})`);

const tabla = await client.query(`
  select count(*) n from information_schema.tables
  where table_schema = 'public' and table_name = 'nota'`);
console.log(`tabla nota: ${tabla.rows[0].n > 0 ? 'sí' : 'NO'}`);

if (tabla.rows[0].n > 0) {
  /* Las columnas se leen del catálogo en vez de darlas por sabidas:
     el esquema de nota lo escribió otro y adivinarlo salió mal. */
  const cols = await client.query(`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'nota'`);
  const nombres = cols.rows.map(c => c.column_name);
  console.log(`columnas: ${nombres.join(', ')}`);

  const quien = nombres.find(c => /usuario|user|persona|miembro|autor|email|mail/.test(c));
  const g = await client.query(`
    select count(*) total,
           ${quien ? `count(distinct ${quien})` : '0'} gente,
           count(distinct jam_id) jams
    from   nota`);
  const r = g.rows[0];
  console.log(`notas guardadas: ${r.total} — de ${r.gente} persona(s), en ${r.jams} jam(s)`);
}

await client.end();
