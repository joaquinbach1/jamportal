/* Qué hay literalmente en la columna musicos, agrupado. Distingue el
   `[]` que dejó el renombre —ítems que nunca se volvieron a guardar—
   del `{}` que escribe guardar_jam cuando la app no manda nada.

   Uso:  node scripts/ver-crudo.js                                    */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const conn = fs.readFileSync(path.join(raiz, '.env.db'), 'utf8')
  .split('\n').map(l => l.trim()).find(l => l.startsWith('postgres'));

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();

const r = await client.query(`
  select jsonb_typeof(musicos) tipo, musicos::text valor, count(*) n
  from   setlist_item
  group  by 1, 2
  order  by n desc
  limit  8`);
console.log('valores en setlist_item.musicos:');
for (const x of r.rows) console.log(`  ${String(x.n).padStart(4)} × ${x.tipo}  ${x.valor.slice(0, 90)}`);

const d = await client.query(`
  select column_name, column_default
  from   information_schema.columns
  where  table_name = 'setlist_item' and column_name = 'musicos'`);
console.log(`\ndefault de la columna: ${d.rows[0].column_default}`);

const j = await client.query(`
  select j.nombre, j.actualizada, j.version,
         count(*) filter (where jsonb_typeof(i.musicos) = 'object') objetos,
         count(*) items
  from   jam j join setlist_item i on i.jam_id = j.id
  group  by j.id, j.nombre, j.actualizada, j.version
  order  by j.actualizada desc nulls last
  limit  5`);
console.log('\npor jam (objetos = formación de verdad):');
for (const x of j.rows) {
  console.log(`  ${x.nombre.slice(0, 26).padEnd(27)} v${String(x.version).padEnd(4)} ${x.objetos}/${x.items} objetos   ${x.actualizada}`);
}

await client.end();
