/**
 * Ejercita js/store.js en Node, con stubs mínimos de localStorage,
 * fetch y document. No necesita navegador ni base: prueba la lógica
 * de la capa de datos, que es la que más se toca.
 *
 *   node scripts/probar-store.mjs
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const mem = new Map();
globalThis.localStorage = {
  getItem: k => mem.has(k) ? mem.get(k) : null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: k => mem.delete(k),
};
globalThis.fetch = async (u) => {
  const path = join(RAIZ, String(u).replace(/^.*?(data\/)/, '$1'));
  try { return { ok: true, json: async () => JSON.parse(readFileSync(path, 'utf8')) }; }
  catch { return { ok: false, json: async () => null }; }
};
globalThis.document = { hidden: true };
// forzamos modo local: con base de fábrica, init() saldría a la red
mem.set('jamportal.nube', JSON.stringify({ local: true }));

const { store, franjaDeBpm } = await import(join(RAIZ, 'js/store.js'));

const ok = (c, t) => console.log(`  ${c ? '✓' : '✗'} ${t}`) || (c || process.exit(1));

await store.init();
ok(store.songs.length === 374, `init(): ${store.songs.length} temas`);
ok(store.jams.length === 26, `${store.jams.length} jams`);
ok(store.repertorio.length + store.ideas.length === 374, 'repertorio + ideas = total');

// alta de tema
const s = store.addSong({ titulo: 'Prueba', artista: 'Zzz Test', bpm: 130 });
ok(store.song(s.id).franja === 'high', 'addSong calcula la franja al vuelo');

// jam nueva + fecha pasada (el camino que tocaba consolidarJamsPasadas)
const j = store.createJam({ nombre: 'Jam de prueba' });
store.updateJam(j.id, { fecha: '2020-01-01', items: [{ tipo: 'song', songId: s.id, cantantes: [], notas: '' }] });
ok(store.jam(j.id).fecha === '2020-01-01', 'updateJam con fecha pasada no explota');
ok(store.jamsPasadas().some(x => x.id === j.id), 'la jam queda como pasada');

// ideas
const idea = store.addSong({ titulo: 'Idea test', artista: 'Zzz', esIdea: true });
ok(store.ideas.some(x => x.id === idea.id), 'la idea entra en ideas');
store.promoverIdea(idea.id);
ok(!store.ideas.some(x => x.id === idea.id), 'promoverIdea la saca de ideas');

// búsqueda y export
ok(store.searchSongs('take on me').length > 0, 'searchSongs encuentra');
ok(store.matchSong('Take On Me', 'a-ha') !== null, 'matchSong encuentra');
const exp = JSON.parse(store.exportJSON());
ok(exp.songs.length === store.songs.length, 'exportJSON completo');

// borrado limpia setlists
store.removeSong(s.id);
ok(!store.jam(j.id).items.some(i => i.songId === s.id), 'removeSong limpia el setlist');
ok(store.song(s.id) === undefined, 'removeSong borra el tema');

// el driver nuevo se puede importar
const { PostgresDriver, PASOS_SQL } = await import(join(RAIZ, 'js/drivers/postgres.js'));
const d = new PostgresDriver({ url: 'https://x.supabase.co/', key: 'k' });
ok(d.name === 'nube' && d.url === 'https://x.supabase.co', 'PostgresDriver se construye');
ok(PASOS_SQL.length === 6, `${PASOS_SQL.length} pasos de instalación`);
console.log('\n✓ store.js anda\n');
