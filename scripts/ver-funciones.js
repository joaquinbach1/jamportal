/* ¿Las funciones que mueven el setlist saben de `musicos`? Mirar la
   columna no alcanza: puede existir y que app_estado no la devuelva
   ni guardar_jam la escriba, que es justo el caso que rompe.

   Uso:  node scripts/ver-funciones.js                                */

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
  select p.proname, pg_get_function_identity_arguments(p.oid) args, p.prosrc
  from   pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where  n.nspname = 'public'
    and  p.proname in ('app_estado','guardar_jam')
  order  by p.proname`);

for (const f of fns.rows) {
  const src = f.prosrc;
  console.log(`${f.proname}(${f.args})`);
  console.log(`  nombra 'musicos':   ${/musicos/.test(src) ? 'sí' : 'NO'}`);
  console.log(`  nombra 'guitarras': ${/guitarras/.test(src) ? 'sí (quedó vieja)' : 'no'}`);
  /* En el medley los temas son hijos: si la función no los toca, se
     ve en pantalla y se pierde al recargar. */
  const enHijos = /h\.musicos|sub->'musicos'/.test(src);
  console.log(`  llega al medley:    ${enHijos ? 'sí' : 'NO'}`);
}

/* Y lo que de verdad importa: ¿hay algo guardado? */
const con = await client.query(`
  select count(*) filter (where musicos is not null and musicos <> '{}'::jsonb) cargados,
         count(*) total
  from   setlist_item`);
console.log(`\nítems con formación guardada: ${con.rows[0].cargados} de ${con.rows[0].total}`);

await client.end();
