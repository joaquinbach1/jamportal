-- ============================================================
-- JAM PORTAL — musicos guarda un objeto, no una lista
-- ------------------------------------------------------------
-- db/22 renombró `guitarras` a `musicos`, pero el default se
-- quedó como estaba: `'[]'::jsonb`. Tenía sentido cuando la
-- columna guardaba dos guitarras en fila; ahora guarda la banda
-- por puesto —{g1:{…}, g2:{…}, …}— y una lista vacía no es una
-- formación vacía, es otra cosa.
--
-- No era cosmético. La app leía `[]`, lo daba por bueno porque
-- en JavaScript un array vacío es truthy, y le colgaba g1, g2…
-- como propiedades nombradas. En memoria se leía bien, pero
-- JSON.stringify descarta las propiedades nombradas de un
-- array: al guardar volvía a salir `[]`. Se editaba, se veía, y
-- se perdía sin un solo error de por medio.
--
-- La app ya no depende de esto —trata cualquier cosa que no sea
-- un objeto como "sin formación"—, pero la columna tiene que
-- decir la verdad igual.
--
-- Es idempotente: correrlo dos veces no rompe nada.
-- ============================================================

alter table setlist_item alter column musicos set default '{}'::jsonb;

update setlist_item
   set musicos = '{}'::jsonb
 where jsonb_typeof(musicos) <> 'object';
