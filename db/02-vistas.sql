-- ============================================================
-- JAM PORTAL — lo derivado
-- ------------------------------------------------------------
-- Todo lo de este archivo se guardaba a mano en el JSON. Cada
-- vista de acá borra código de js/store.js.
-- ============================================================

-- Dónde sonó cada tema. Reemplaza a song.jams[] y hace innecesaria
-- a consolidarJamsPasadas(), que existía solo para mantenerlo.
--
-- El criterio es el de la app: cuenta la jam si es histórica, o si
-- es propia y su fecha ya pasó. Los temas de un medley cuentan
-- igual que los sueltos, por eso no se filtra parent_id.
create or replace view song_jam as
select distinct
       i.song_id,
       j.id     as jam_id,
       j.nombre as jam_nombre,
       j.fecha
from   setlist_item i
join   jam j on j.id = i.jam_id
where  i.tipo = 'song'
  and  i.song_id is not null
  and (j.historica or (j.fecha is not null and j.fecha < current_date));

-- Quién figura en la jam: los que cantaron algo en el setlist más los
-- sumados a mano. Es exactamente lo que jam-editor.js arma hoy en
-- jam.musicos, y por eso NO incluye a los invitados: que Fabo toque la
-- batería en un tema no lo pone en la lista de esa noche.
create or replace view jam_musico as
  select i.jam_id, ic.persona_id
  from   setlist_item i
  join   item_cantante ic on ic.item_id = i.id
union
  select jam_id, persona_id
  from   jam_musico_extra;

-- La otra noción: en qué jams sonó un tema donde esta persona figura
-- como invitada. Sirve para contar en cuántas jams participó un músico
-- —que es como el documento original contaba sus jams— sin ensuciar la
-- lista de gente de cada jam.
create or replace view jam_invitado as
select distinct i.jam_id, si.persona_id
from   setlist_item i
join   song_invitado si on si.song_id = i.song_id
where  i.tipo = 'song' and si.persona_id is not null;

-- Los contadores que hoy son columnas de persona y ya divergieron:
-- temas está mal en 12 de 101 personas, jams en 35 de 101. El motivo
-- es que singers.js los recalcula para los cantantes pero para los
-- músicos lee el valor guardado, que nadie actualiza nunca.
--
-- Un músico "canta" pocos temas y toca en muchos: su cuenta de temas
-- sale de song_invitado, la del cantante de song_cantante.
create or replace view persona_stats as
select p.id,
       p.nombre,
       (select count(*) from song_cantante sc
         where sc.persona_id = p.id)                        as temas_cantados,
       (select count(*) from song_invitado si
         where si.persona_id = p.id)                        as temas_invitado,
       (select count(*) from song_cantante sc
         where sc.persona_id = p.id)
     + (select count(*) from song_invitado si
         where si.persona_id = p.id)                        as temas,
       (select count(*) from (
          select jam_id from jam_musico   where persona_id = p.id
          union
          select jam_id from jam_invitado where persona_id = p.id) t)  as jams
from persona p;

-- Los tres baldes del repertorio. Hoy viven en tres representaciones
-- distintas: una bandera esIdea, "los que no la tienen", y un archivo
-- JSON aparte que ni siquiera está en la base.
create or replace view repertorio as select * from song where estado = 'repertorio';
create or replace view idea       as select * from song where estado = 'idea';
create or replace view descartado as select * from song where estado = 'descartado';
