/* Qué formación tiene guardada cada tema de una jam, leyendo la tabla
   directo. Sirve para saber si un cambio hecho en la app llegó o no.

   Uso:  node scripts/ver-jam.js [pedazo del nombre de la jam]        */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const conn = fs.readFileSync(path.join(raiz, '.env.db'), 'utf8')
  .split('\n').map(l => l.trim()).find(l => l.startsWith('postgres'));

const busca = process.argv[2] || '';

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();

const jams = await client.query(`
  select id, nombre, historica, cerrada, actualizada
  from   jam
  where  ($1 = '' or nombre ilike '%' || $1 || '%')
  order  by actualizada desc nulls last
  limit  5`, [busca]);

for (const j of jams.rows) {
  console.log(`\n=== ${j.nombre}  ${j.historica ? '(histórica)' : ''}${j.cerrada ? '(cerrada)' : ''}`);
  console.log(`    tocada por última vez: ${j.actualizada}`);
  const items = await client.query(`
    select i.orden, i.tipo, i.parent_id is not null hijo,
           coalesce(s.titulo, i.titulo, i.label, '—') titulo, i.musicos
    from   setlist_item i left join song s on s.id = i.song_id
    where  i.jam_id = $1
    order  by coalesce((select p.orden from setlist_item p where p.id = i.parent_id), i.orden),
              i.parent_id nulls first, i.orden
    limit  12`, [j.id]);

  for (const it of items.rows) {
    const m = it.musicos || {};
    const banda = ['g1', 'g2', 'bajo', 'bat', 't1', 't2', 'saxo']
      .map(k => (m[k] && m[k].nombre ? m[k].nombre + (m[k].solo ? '*' : '') : '–'))
      .join(' ');
    console.log(`  ${it.hijo ? '  ·' : String(it.orden).padStart(3)} ${it.titulo.slice(0, 26).padEnd(27)} ${banda}`);
  }
}

await client.end();
