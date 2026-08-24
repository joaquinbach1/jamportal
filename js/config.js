/* ============================================================
   config.js — a qué base apunta la app
   ------------------------------------------------------------
   La clave publicable está pensada para vivir en el navegador:
   no da acceso a nada por sí sola. Identifica al proyecto, y
   nada más. Quién ve qué lo decide el RLS contra la tabla
   `miembro`, con el JWT que devuelve el login.

   Comprobado contra este proyecto: con esta clave y sin sesión,
   la base contesta `permission denied` a todo.

   Si alguien quiere apuntar la app a otro proyecto, lo hace
   desde Datos → Base compartida y eso pisa lo de acá.
   ============================================================ */

export const NUBE = {
  url: 'https://qvqrwjzbfenupkqjrhli.supabase.co',
  key: 'sb_publishable__uhmgdmoIAqP6ar_oJqXFQ_b9GnG_JH',
};
