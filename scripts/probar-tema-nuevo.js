/* El tema que se da de alta y después desaparece de la lista.
   Reproduce la secuencia del driver —catálogo primero, jam después— y
   la carrera con otro navegador que guarda en el medio con su catálogo
   viejo, que es cuando el tema recién creado todavía no cuelga de
   ningún setlist y nada lo protege de la limpieza de guardar_catalogo.

   Deja todo como estaba.

   Uso:  node scripts/probar-tema-nuevo.js                            */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const conn = fs.readFileSync(path.join(raiz, '.env.db'), 'utf8')
  .split('\n').map(l => l.trim()).find(l => l.startsWith('postgres'));

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();

const JAM = 'jam-prueba-tema-nuevo';
const NUEVO = 'song-prueba-recien-creada';

/* El catálogo tal como lo manda la app: todos los temas que tiene. */
async function catalogoActual() {
  const r = await client.query(`
    select s.id, s.titulo, s.artista, c.nombre categoria, s.estado = 'idea' "esIdea"
    from song s join categoria c on c.id = s.categoria_id
    where s.estado <> 'descartado'`);
  return r.rows;
}

const guardarCatalogo = songs =>
  client.query('select guardar_catalogo($1::jsonb)',
    [JSON.stringify({ songs, cantantes: [], musicos: [], categorias: [], porConfirmar: [] })]);

const existe = async id =>
  (await client.query('select 1 from song where id = $1', [id])).rowCount > 0;

try {
  await client.query('delete from jam where id = $1', [JAM]);
  await client.query('delete from song where id = $1', [NUEVO]);

  const base = await catalogoActual();
  const unTema = base[0];

  await client.query(`insert into jam (id, nombre, fecha) values ($1, 'Prueba tema nuevo', '2026-12-31')`, [JAM]);
  const jam = {
    id: JAM, nombre: 'Prueba tema nuevo', fecha: '2026-12-31', hora: '21:00',
    lugar: '', notas: '', historica: false, conOrden: true, cerrada: false,
    codigo: '', vivoIndice: 0, mes: '', dia: '', musicos: [], musicosExtra: [],
    ensayos: [], items: [{ tipo: 'song', songId: unTema.id, cantantes: [], notas: '' }],
  };
  await client.query('select guardar_jam($1::jsonb, null)', [JSON.stringify(jam)]);
  console.log(`jam de prueba lista, con «${unTema.titulo}»\n`);

  /* ---- 1. el camino normal: catálogo con el tema nuevo, después la jam ---- */
  const conNuevo = [...base, { id: NUEVO, titulo: 'Tema Recién Creado', artista: 'Prueba',
                               categoria: unTema.categoria, esIdea: false }];
  await guardarCatalogo(conNuevo);
  console.log(`1. alta en DBSongs            → ${await existe(NUEVO) ? 'está' : 'NO está'}`);

  jam.items.push({ tipo: 'song', songId: NUEVO, cantantes: [], notas: '' });
  await client.query('select guardar_jam($1::jsonb, null)', [JSON.stringify(jam)]);
  const enLista = async () =>
    (await client.query('select 1 from setlist_item where jam_id = $1 and song_id = $2', [JAM, NUEVO])).rowCount > 0;
  console.log(`   y agregado a la lista      → ${await enLista() ? 'está' : 'NO está'}`);

  /* ---- 2. la carrera: otro guarda con su catálogo viejo ---- */
  console.log('\n2. otro navegador guarda con su catálogo de antes…');
  await guardarCatalogo(base);
  console.log(`   el tema nuevo              → ${await existe(NUEVO) ? '✓ sobrevive (lo salva el setlist)' : '✗ BORRADO'}`);
  console.log(`   el ítem de la lista        → ${await enLista() ? '✓ sigue' : '✗ SE PERDIÓ'}`);

  /* ---- 3. la misma carrera, pero antes de que la jam se guarde ---- */
  console.log('\n3. la carrera en el hueco entre las dos escrituras:');
  /* Se saca de la lista primero: si no, la clave foránea no deja
     borrarlo —que es justo lo que protege al tema en el paso 2. */
  jam.items = jam.items.filter(i => i.songId !== NUEVO);
  await client.query('select guardar_jam($1::jsonb, null)', [JSON.stringify(jam)]);
  await client.query('delete from song where id = $1', [NUEVO]);
  jam.items.push({ tipo: 'song', songId: NUEVO, cantantes: [], notas: '' });
  await guardarCatalogo(conNuevo);
  console.log(`   alta del tema              → ${await existe(NUEVO) ? 'está' : 'NO está'}`);
  await guardarCatalogo(base);          // el otro guarda ANTES de que llegue la jam
  console.log(`   otro guarda en el medio    → ${await existe(NUEVO) ? '✓ sigue' : '✗ BORRADO: nada lo protegía'}`);
  try {
    await client.query('select guardar_jam($1::jsonb, null)', [JSON.stringify(jam)]);
    console.log(`   y ahora sí la jam          → ${await enLista() ? '✓ el tema está en la lista' : '✗ el ítem no quedó'}`);
  } catch (e) {
    console.log(`   y ahora sí la jam          → ✗ FALLA ENTERA: ${e.message.slice(0, 70)}`);
    console.log('     (la jam no se guarda, así que se pierde todo lo que se editó)');
  }
} finally {
  await client.query('delete from jam where id = $1', [JAM]);
  await client.query('delete from song where id = $1', [NUEVO]);
  await client.end();
}
