-- ============================================================
-- JAM PORTAL — quién puede entrar
-- ------------------------------------------------------------
-- La lista de la banda. Entrar es con magic link: Supabase manda
-- un mail con un link y listo, no hay contraseña.
--
-- Para sumar a alguien, agregá su mail acá y corré el archivo de
-- nuevo — es idempotente.
-- ============================================================

insert into miembro (email) values
  ('matiasw@gmail.com')
on conflict (email) do nothing;
