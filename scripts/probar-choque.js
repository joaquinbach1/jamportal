/* Dos personas editando la misma jam, contra la base de verdad.
   Simula lo que hace el driver —leer la versión, guardar contra ella— y
   comprueba que la fusión no pierda el tema de ninguno.

   Deja la jam de prueba borrada al terminar.

   Uso:  node scripts/probar-choque.js                                */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { fusionarJam } from '../js/fusionar-jam.js';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const conn = fs.readFileSync(path.join(raiz, '.env.db'), 'utf8')
  .split('\n').map(l => l.trim()).find(l => l.startsWith('postgres'));

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();

const ID = 'jam-prueba-choque';
const S = id => ({ tipo: 'song', songId: id, cantantes: [], notas: '' });

/* Dos temas que existan de verdad, para no romper la foreign key. */
const temas = (await client.query('select id, titulo from song limit 4')).rows;
const [t1, t2, mio, suyo] = temas;

const jamBase = {
  id: ID, nombre: 'Prueba de choque', fecha: '2026-12-31', hora: '21:00',
  lugar: '', notas: '', historica: false, conOrden: true, cerrada: false,
  codigo: '', vivoIndice: 0, mes: '', dia: '', musicos: [], musicosExtra: [],
  ensayos: [], items: [S(t1.id), S(t2.id)],
};

const guardar = async (jam, versionEsperada) => {
  const r = await client.query('select guardar_jam($1::jsonb, $2::bigint)', [JSON.stringify(jam), versionEsperada]);
  return r.rows[0];
};
const leer = async () => {
  const r = await client.query('select to_jsonb(j) datos, j.version from jam j where j.id = $1', [ID]);
  if (!r.rows[0]) return null;
  const items = await client.query(`
    select i.tipo, i.song_id "songId", i.notas, i.orden
    from setlist_item i where i.jam_id = $1 and i.parent_id is null order by i.orden`, [ID]);
  return { ...jamBase, version: r.rows[0].version,
           items: items.rows.map(x => ({ tipo: x.tipo, songId: x.songId, cantantes: [], notas: x.notas })) };
};

try {
  await client.query('delete from jam where id = $1', [ID]);
  await guardar(jamBase, null);
  const base = await leer();
  console.log(`base      v${base.version}  ${base.items.map(i => i.songId.slice(0, 12)).join(' ')}`);

  /* Los dos arrancan de la misma versión. */
  const deAle = { ...base, items: [...base.items, S(suyo.id)] };
  const deJoaco = { ...base, items: [...base.items, S(mio.id)] };

  /* Ale guarda primero y pasa. */
  await guardar(deAle, base.version);
  const trasAle = await leer();
  console.log(`Ale  →    v${trasAle.version}  ${trasAle.items.map(i => i.songId.slice(0, 12)).join(' ')}`);

  /* Joaco guarda contra la versión vieja: la base lo tiene que frenar. */
  let choco = false;
  try { await guardar(deJoaco, base.version); }
  catch (e) { choco = true; console.log(`Joaco →   rechazado: ${e.message.slice(0, 60)}`); }
  if (!choco) { console.log('⚠ la base NO frenó la segunda escritura'); process.exit(1); }

  /* Y acá entra la fusión, que es lo que se está probando. */
  const { jam, resumen } = fusionarJam(base, deJoaco, trasAle);
  await guardar(jam, trasAle.version);
  const final = await leer();

  const ids = final.items.map(i => i.songId);
  console.log(`fusión →  v${final.version}  ${ids.map(i => i.slice(0, 12)).join(' ')}`);
  console.log(`\n«${suyo.titulo}» (de Ale)   ${ids.includes(suyo.id) ? '✓ está' : '✗ SE PERDIÓ'}`);
  console.log(`«${mio.titulo}» (de Joaco) ${ids.includes(mio.id) ? '✓ está' : '✗ SE PERDIÓ'}`);
  console.log(`los dos originales          ${ids.includes(t1.id) && ids.includes(t2.id) ? '✓ están' : '✗ falta alguno'}`);
  console.log(`\nresumen para el cartel: ${JSON.stringify(resumen)}`);
} finally {
  await client.query('delete from jam where id = $1', [ID]);
  await client.end();
}
