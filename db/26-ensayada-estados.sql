-- ============================================================
-- JAM PORTAL — ensayada deja de ser sí/no
-- ------------------------------------------------------------
-- db/25 la hizo booleana, y para marcar «esto ya está» alcanza.
-- Pero organizando ensayos hace falta el medio: el tema que se
-- tocó y todavía no sale. Sin ese estado no hay con qué decidir
-- a qué darle tiempo, que es de lo que se trata un ensayo.
--
--   no     · no lo tocamos todavía
--   falta  · lo tocamos, no está
--   listo  · sale
--
-- Se convierte sin perder nada: lo que estaba marcado pasa a
-- 'listo' y el resto a 'no'. Cuando se corrió esto no había una
-- sola fila marcada, así que en la práctica no había qué migrar.
--
-- Es idempotente: el `do` mira el tipo antes de tocar nada.
--
-- Después de esto, la función que la escribe —que la venía
-- casteando a boolean:
--
--   psql "$CONN" -v ON_ERROR_STOP=1 -f db/06-concurrencia.sql
--
-- db/03 y db/15 la leen tal cual y no hace falta re-correrlas.
-- db/04 también la nombra, pero su guardar_jam lo reemplaza
-- db/06: alcanza con esa. Mejor así, porque re-correr db/04
-- abre permisos que después hay que volver a cerrar.
-- ============================================================

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'setlist_item'
                and column_name = 'ensayada'
                and data_type = 'boolean')
  then
    alter table setlist_item alter column ensayada drop default;
    alter table setlist_item alter column ensayada type text
      using (case when ensayada then 'listo' else 'no' end);
    alter table setlist_item alter column ensayada set default 'no';
  end if;
end $$;

alter table setlist_item drop constraint if exists setlist_item_ensayada_ck;
alter table setlist_item add  constraint setlist_item_ensayada_ck
  check (ensayada in ('no', 'falta', 'listo'));
