/* Escupe los renglones de una función de la base que nombran algo.
   Sirve para comparar lo que está corriendo de verdad contra lo que
   dice el repo, que no siempre es lo mismo.

   Uso:  node scripts/ver-fuente.js guardar_jam musicos               */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const conn = fs.readFileSync(path.join(raiz, '.env.db'), 'utf8')
  .split('\n').map(l => l.trim()).find(l => l.startsWith('postgres'));

const [fn, aguja] = [process.argv[2], process.argv[3] || ''];

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();

const r = await client.query(`
  select pg_get_function_identity_arguments(p.oid) args, p.prosrc
  from   pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where  n.nspname = 'public' and p.proname = $1`, [fn]);

for (const f of r.rows) {
  console.log(`--- ${fn}(${f.args})`);
  f.prosrc.split('\n').forEach((l, i) => {
    if (!aguja || l.includes(aguja)) console.log(`${String(i + 1).padStart(4)}  ${l}`);
  });
}

await client.end();
