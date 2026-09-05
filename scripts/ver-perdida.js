/* Qué formación quedó guardada, jam por jam, y si es la de fábrica o
   una cargada a mano. Sirve para saber si algo pisó el trabajo de
   alguien: si TODOS los temas de una jam tienen exactamente la misma
   formación, es la que pone la app sola, no la que cargó una persona.

   Uso:  node scripts/ver-perdida.js                                  */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const conn = fs.readFileSync(path.join(raiz, '.env.db'), 'utf8')
  .split('\n').map(l => l.trim()).find(l => l.startsWith('postgres'));

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();

const jams = await client.query(`
  select j.id, j.nombre, j.version, j.actualizada,
         count(*) items,
         count(*) filter (where i.musicos <> '{}'::jsonb) conFormacion,
         count(distinct i.musicos::text) filter (where i.musicos <> '{}'::jsonb) distintas
  from   jam j join setlist_item i on i.jam_id = j.id
  group  by j.id, j.nombre, j.version, j.actualizada
  having count(*) filter (where i.musicos <> '{}'::jsonb) > 0
  order  by j.actualizada desc nulls last`);

console.log('jams con formación guardada:\n');
for (const j of jams.rows) {
  console.log(`${j.nombre}`);
  console.log(`  ${j.conformacion} de ${j.items} ítems · ${j.distintas} formación(es) distinta(s)`);
  console.log(`  versión ${j.version} · última escritura ${j.actualizada}`);
  /* Una sola formación distinta en toda la jam = nadie la tocó tema por
     tema, es la que la app pone sola al abrir la vista. */
  console.log(`  → ${j.distintas === '1' ? '⚠ TODOS IGUALES: parece la de fábrica' : 'hay variedad: hay trabajo humano acá'}\n`);
}

const formas = await client.query(`
  select i.musicos::text valor, count(*) n
  from   setlist_item i
  where  i.musicos <> '{}'::jsonb
  group  by 1 order by n desc limit 5`);
console.log('las formaciones que más se repiten:');
for (const f of formas.rows) {
  const m = JSON.parse(f.valor);
  const linea = ['g1', 'g2', 'bajo', 'bat', 't1', 't2', 'saxo']
    .map(k => (m[k] && m[k].nombre ? m[k].nombre : '–')).join(' ');
  console.log(`  ${String(f.n).padStart(3)} × ${linea}`);
}

await client.end();
