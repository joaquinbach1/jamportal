-- ============================================================
-- Cerrar los permisos después de re-correr db/04
-- ------------------------------------------------------------
-- `create or replace` conserva los grants, pero `drop function`
-- no: la función recreada nace con los defaults del proyecto,
-- que dejan ejecutar a `anon`. db/04 dropea cinco funciones, y
-- estas son esas cinco.
--
-- guardar_jam no está acá a propósito: db/06 la dropea y vuelve
-- a cerrarla él mismo al final (sus líneas 130-131), así que
-- correr db/06 después de db/04 ya la deja bien.
--
-- El grant a `authenticated` va junto con el revoke y no se
-- puede omitir: si el único permiso venía de PUBLIC, revocarlo
-- también se lo saca a los que sí tienen que poder. Es el mismo
-- par que hace db/05, que no se puede re-correr tal cual porque
-- todavía nombra guardar_jam(jsonb), que ya no existe.
--
-- Verificá antes y después con:  node scripts/ver-estado.js
-- ============================================================

revoke all on function
    persona_id(text), guardar_catalogo(jsonb), borrar_jam(text),
    cerrar_jam(text, text), abrir_jam(text, text)
  from public, anon;

grant execute on function
    persona_id(text), guardar_catalogo(jsonb), borrar_jam(text),
    cerrar_jam(text, text), abrir_jam(text, text)
  to authenticated;
