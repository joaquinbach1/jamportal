/* Mira cómo está la base antes y después de tocarla: qué columnas
   tiene setlist_item y quién puede ejecutar cada función. Solo lee.

   Uso:  npx -y -p pg node scripts/ver-estado.js                     */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const conn = fs.readFileSync(path.join(raiz, '.env.db'), 'utf8')
  .split('\n').map(l => l.trim()).find(l => l.startsWith('postgres'));

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();

const cols = await client.query(`
  select column_name, data_type
  from   information_schema.columns
  where  table_name = 'setlist_item'
  order  by ordinal_position`);
console.log('setlist_item:');
for (const c of cols.rows) console.log(`  ${c.column_name.padEnd(12)} ${c.data_type}`);

const items = await client.query('select count(*) n from setlist_item');
const jams = await client.query('select count(*) n from jam');
console.log(`\nfilas: ${items.rows[0].n} ítems en ${jams.rows[0].n} jams`);

/* Sin ACL explícita, Postgres da los defaults —que dejan ejecutar a
   todo el mundo, `anon` incluido—, así que eso también se marca. */
const perms = await client.query(`
  select p.proname, pg_get_function_identity_arguments(p.oid) args,
         coalesce(array_to_string(p.proacl, ' '), '(defaults: los ejecuta cualquiera)') acl
  from   pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where  n.nspname = 'public'
    and  p.proname in ('guardar_catalogo','borrar_jam','cerrar_jam','abrir_jam',
                       'persona_id','subir_revision','guardar_jam','app_estado',
                       'vaciar_todo','revision_actual')
  order  by p.proname`);
console.log('\npermisos de las funciones:');
for (const r of perms.rows) {
  const abierta = r.acl.startsWith('(defaults') || /(^|\s)(anon|=)[^ ]*=X/.test(r.acl);
  console.log(`  ${abierta ? '⚠' : ' '} ${(r.proname + '(' + r.args + ')').padEnd(34)} ${r.acl}`);
}

await client.end();
