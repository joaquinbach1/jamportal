/* Las filas crudas de una jam: cuándo se insertaron, de qué tipo son
   y qué tienen en musicos. Sirve para ver si guardar_jam las está
   reescribiendo todas o solo algunas.

   Uso:  node scripts/ver-filas.js [pedazo del nombre]                */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const conn = fs.readFileSync(path.join(raiz, '.env.db'), 'utf8')
  .split('\n').map(l => l.trim()).find(l => l.startsWith('postgres'));

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();

const j = await client.query(
  `select id, nombre from jam where nombre ilike '%' || $1 || '%'
   order by actualizada desc nulls last limit 1`, [process.argv[2] || 'Septiembre']);
const jam = j.rows[0];
console.log(`jam: ${jam.nombre}  (${jam.id})\n`);

const r = await client.query(`
  select i.tipo, i.parent_id is not null hijo, jsonb_typeof(i.musicos) t,
         count(*) n
  from   setlist_item i
  where  i.jam_id = $1
  group  by 1,2,3 order by n desc`, [jam.id]);
console.log('filas de esta jam:');
for (const x of r.rows) {
  console.log(`  ${String(x.n).padStart(3)} × ${x.tipo}${x.hijo ? ' (hijo)' : ''} → musicos ${x.t}`);
}

/* ¿Son todas de esta jam, o hay ítems apuntando a jams que ya no están? */
const huerfanas = await client.query(`
  select count(*) n from setlist_item i
  where  not exists (select 1 from jam j where j.id = i.jam_id)`);
console.log(`\nítems apuntando a una jam inexistente: ${huerfanas.rows[0].n}`);

const total = await client.query(`
  select j.nombre, count(*) n
  from   setlist_item i join jam j on j.id = i.jam_id
  group  by j.nombre order by n desc limit 3`);
console.log('\nítems por jam (las 3 más grandes):');
for (const x of total.rows) console.log(`  ${String(x.n).padStart(3)}  ${x.nombre}`);

await client.end();
