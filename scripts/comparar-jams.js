/* Compara la formación de dos jams tema por tema. Sirve cuando hay un
   backup y la sospecha de que algo pisó el trabajo cargado a mano: lo
   que en el backup tiene nombres y en la viva quedó de fábrica es
   exactamente lo que se perdió.

   Uso:  node scripts/comparar-jams.js "Septiembre" "BACK UP"          */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const conn = fs.readFileSync(path.join(raiz, '.env.db'), 'utf8')
  .split('\n').map(l => l.trim()).find(l => l.startsWith('postgres'));

const [buscaA, buscaB] = [process.argv[2] || 'Septiembre', process.argv[3] || 'BACK UP'];
const PUESTOS = ['g1', 'g2', 'bajo', 'bat', 't1', 't2', 'saxo'];
const DEFECTO = 'Tomi Nano Nahue Joaco Mati Alva Fede';

const linea = m => PUESTOS.map(k => (m && m[k] && m[k].nombre ? m[k].nombre : '–')).join(' ');

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();

async function temasDe(busca, excluir) {
  const j = await client.query(
    `select id, nombre from jam
      where nombre ilike '%' || $1 || '%'
        and ($2 = '' or nombre not ilike '%' || $2 || '%')
      order by actualizada desc nulls last limit 1`, [busca, excluir || '']);
  if (!j.rows[0]) return null;
  const it = await client.query(`
    select coalesce(s.titulo, i.titulo, i.label, '—') titulo, i.musicos, i.orden,
           i.parent_id is not null hijo
    from   setlist_item i left join song s on s.id = i.song_id
    where  i.jam_id = $1 and i.song_id is not null
    order  by i.orden`, [j.rows[0].id]);
  return { nombre: j.rows[0].nombre, temas: it.rows };
}

/* La viva no tiene que ser el backup: se lo excluye por nombre. */
const A = await temasDe(buscaA, 'BACK UP');
const B = await temasDe(buscaB, '');
if (!A || !B) { console.log('No encontré alguna de las dos jams'); await client.end(); process.exit(1); }

console.log(`A (viva)   ${A.nombre} — ${A.temas.length} temas`);
console.log(`B (backup) ${B.nombre} — ${B.temas.length} temas\n`);

/* Se cruza por título: los ids de ítem cambian en cada guardado. */
const porTitulo = new Map();
for (const t of B.temas) if (!porTitulo.has(t.titulo)) porTitulo.set(t.titulo, t);

let perdidos = 0, iguales = 0, soloEnA = 0;
for (const a of A.temas) {
  const b = porTitulo.get(a.titulo);
  if (!b) { soloEnA++; continue; }
  const la = linea(a.musicos), lb = linea(b.musicos);
  if (la === lb) { iguales++; continue; }
  /* Lo que importa: en el backup había algo distinto de la de fábrica y
     en la viva quedó la de fábrica. Eso es trabajo que desapareció. */
  const sePerdio = la === DEFECTO && lb !== DEFECTO && lb !== '– – – – – – –';
  if (sePerdio) perdidos++;
  console.log(`${sePerdio ? '⚠' : ' '} ${a.titulo.slice(0, 30).padEnd(31)}`);
  console.log(`    viva   ${la}`);
  console.log(`    backup ${lb}`);
}

console.log(`\n${iguales} iguales · ${perdidos} donde la viva quedó de fábrica y el backup no · ${soloEnA} solo en la viva`);

await client.end();
