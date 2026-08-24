# JAM PORTAL

App para armar las listas de temas de las JAMs, sobre el repertorio real:
**374 temas efectivamente tocados** y 26 jams históricas **con su setlist en el
orden original**, con medleys, breaks, bloques y quién cantó cada tema.

Sitio estático: HTML + CSS + JavaScript con módulos ES. Sin build, sin backend,
sin dependencias. Se sube a Vercel como está.

## Online

**<https://jamportal.vercel.app>** — el de siempre. Se despliega solo con cada
push a `main`, así que no hay que correr nada a mano.

<https://jamportal-gules.vercel.app> es un espejo del mismo código, en otra
cuenta de Vercel. Sirve para probar sin tocar el que usa la banda; hay que
desplegarlo a mano con `vercel deploy --prod`.

Entrar es con el mail: llega un link y listo, no hay contraseña. Solo entran los
que están en la tabla `miembro` — ver *Quién puede entrar*, más abajo.

Si aparece una URL nueva, hay que agregarla a **Authentication → URL
Configuration → Redirect URLs** en Supabase, o el link del mail no vuelve a la
app. Hoy están permitidas `localhost:8090` y las dos de arriba.

## Correrlo local

```bash
npx http-server . -p 8090 -c-1
```

Después: <http://localhost:8090>. Tiene que ser por `http://` — con `file://`
el navegador bloquea los módulos ES y no carga `data/seed.json`.

## Cómo está armado

```
index.html            cáscara: sidebar + contenedor de vistas
css/styles.css        todo el estilo, incluida la hoja de impresión
data/seed.json        el repertorio convertido (temas, cantantes, jams históricas)
data/descartados.json el banco de repertorio que nunca se tocó, archivado
js/store.js           capa de datos — lo único que toca el almacenamiento
js/config.js          a qué proyecto de Supabase apunta la app
js/auth.js            entrar con magic link (sin SDK)
js/realtime.js        websocket con Supabase Realtime (protocolo Phoenix a mano)
js/drivers/postgres.js  driver de la base compartida (REST de Supabase, sin SDK)
db/                   el esquema SQL: tablas, vistas y funciones
js/ui.js              helpers de DOM, modales, toasts, autocomplete
js/lookup.js          búsqueda de temas en internet (iTunes / MusicBrainz)
js/cifra.js           links a las cifras (acordes) de Cifra Club
js/magiclist.js       el generador de listas, compartido por el editor y "Nueva Jam"
js/docx.js            escritor de .docx (ZIP + OOXML) sin librerías
js/tempo.js           el BPM de un tema: chip editable, sugerencia, franja
js/app.js             router por hash
js/views/login.js     la puerta: solo aparece contra la base compartida
js/views/             una vista por pantalla
scripts/convert-seed.py       regenera data/seed.json desde el .json original
scripts/migrar-a-sql.py       convierte el seed en db/10-datos.sql
scripts/verificar-migracion.py  prueba la migración entera contra un Postgres local
scripts/probar-store.mjs      ejercita js/store.js en Node, sin navegador
scripts/probar-api.py         prueba la base por HTTP, como la usa el navegador
scripts/probar-imports.py     comprueba que los imports entre módulos resuelvan
```

## Los tres métodos para armar el setlist

1. **Pegar / arrastrar** — paleta lateral con todo DBSongs, filtrable por
   **categoría** y por **franja de tempo**, con buscador y contador. Doble clic
   suma el tema al final; arrastrándolo va a la posición exacta. Abajo, un campo para
   pegar una lista entera de otro lado: reconoce `Título - Artista`,
   `Título (Artista)`, numeración, viñetas y líneas `BREAK`, marca cuáles ya
   están en DBSongs y ofrece crear los que faltan buscándolos en internet.
2. **MagicList** — no elegís qué incluir sino **en qué proporción**:

   - **Categorías**: un % por categoría — por ejemplo 50% latino, 40% nacional,
     10% internacional. En cero, no hay preferencia y usa lo que haya.
   - **Historial**: *Ya tocados*, *🌐 Nunca tocados*, o **⇄ Mix** — que reparte la
     lista entre los dos con el % que le pongas (70/30 por defecto). Con 15 temas
     al 60/40 salen 9 conocidos y 6 para estrenar.

   Los porcentajes se normalizan solos a 100. El armado reparte los lugares según
   esas cuotas y, si para alguna combinación no hay tema disponible, afloja los
   filtros de a poco, así la lista sale completa igual.

   La lista igual sale **ordenada por energía** — los lentos primero y los rápidos
   sobre el final — aunque eso ya no se configura desde la pantalla.

   La propuesta no es todo o nada: cada tema se **arrastra de a uno** a la posición
   que quieras de la lista, o se manda al final con su ＋. Si generaste 15 y te
   sirven 3, te llevás esos 3 y el resto queda en la propuesta.

   *Nunca tocados* **busca en internet** temas de las bandas que ya funcionan en la
   jam: se marcan con 🌐 y se dan de alta en DBSongs (con artista, categoría y año)
   recién al sumarlos a la lista.
3. **Sugerencias** — *Nunca tocados*: como DBSongs ya solo tiene repertorio
   tocado, éstos se buscan **en internet** entre las bandas que ya funcionan en la
   jam, al azar y sin repetir entre tandas. Al sumarlos se dan de alta en DBSongs.
   Abajo, el repertorio de los convocados a esta jam.

En cualquier momento, el buscador debajo de la lista agrega un tema por nombre:
si no está en DBSongs lo busca en internet (iTunes Search API, MusicBrainz de
respaldo), trae banda, género, año y duración, y lo da de alta antes de sumarlo.

La lista admite **temas sueltos, BREAKs, medleys y bloques** (las secciones de la
jam: PIANO BAR, ROCK NACIONAL, 2000s, TROPICALISIMA…). Cualquier ítem se reordena
arrastrando y dos temas seguidos se unen en medley con ⛓ (se desarma con ⊟).

Sobre los medleys se puede soltar: un tema de la paleta, **un tema que ya está en
la lista** (sale de su posición y entra adentro) u **otro medley** (los dos se
funden en uno). El borde se ilumina cuando el medley acepta lo que estás
arrastrando. Adentro del medley, cada tema tiene ⤴ para **sacarlo y dejarlo suelto
en la lista** (si el medley queda con uno solo, se desarma) y ✕ para borrarlo.

**Las filas se arrastran solo desde la manija ⠿.** Con toda la fila arrastrable,
cualquier clic con el mínimo movimiento arrancaba un drag y el clic nunca llegaba:
por eso no se podían apretar los botones de adentro de un medley.

## Armar una jam nueva

Nombre, fecha, horario y lugar; los ensayos (con hora de inicio y de fin); a quién
convocás; y el **punto de partida del setlist**, con tres opciones:

1. **Lista vacía** — arrancás de cero.
2. **MagicList** — los mismos filtros de porcentajes del editor, con vista previa
   antes de crear la jam.
3. **Usar de base otra jam** — copia el setlist de cualquier jam anterior
   (incluidas las 26 históricas) para editarlo.

## Producción: ensayos y convocatoria

El editor va en el orden en que se trabaja: **Datos de la jam → Lista de temas →
Producción**. La producción viene después porque se arma con la lista ya hecha.

*Datos de la jam* y *Producción* arrancan **plegados** — la pantalla es para la
lista — y muestran su resumen en la cabecera (fecha, lugar, convocados, ensayos).
El único caso en que *Datos* se abre solo es una jam recién creada sin fecha.

**Los convocados salen del setlist.** Los cantantes son los que asignaste tema por
tema con el ＋ de cada fila, y la sección los muestra con cuántos temas tiene cada
uno. A eso se le suman a mano los que no cantan (batería, saxo, caños, invitados).
El lugar viene precargado como *Portal*.

Cada ensayo tiene fecha, hora de inicio, hora de fin y lugar, y su propia
**convocatoria**: se elige quién viene y **a qué hora tiene que estar cada uno**
(sirve para citar escalonado: primero la base, después los cantantes).

Con **varios ensayos**, el diálogo los lista arriba con cuántos van en cada uno y
se salta entre ellos sin cerrar. Para no rearmar la lista cada vez hay dos atajos:
*⇉ A todos los ensayos* copia los de éste a los demás, y *traer la convocatoria
de…* trae la de otro. Al copiar, los horarios se rebasan al inicio del ensayo
destino, salvo los que estaban citados a una hora distinta a propósito, que
conservan la suya. Los avisos no se copian: a cada ensayo hay que avisarle igual.
Debajo de cada nombre se ve a qué otros ensayos está convocado.

Desde cada convocado salen los avisos con el mensaje ya escrito — fecha, horario
de citación, lugar, qué toca y cuándo es la jam:

- **💬 WhatsApp** → abre `wa.me` con el teléfono de la persona y el texto listo.
  Sin teléfono cargado, abre WhatsApp para que elijas el contacto.
- **✉️ Mail** → abre el cliente de correo con asunto y cuerpo armados.
- **📋** copia el mensaje.

El botón queda marcado en verde cuando ya avisaste, y **💬 Avisar a los N que
faltan** abre en fila solo los pendientes — el contador es real y cuando no queda
ninguno el botón se va y dice *✓ ya les avisaste a todos*. Los teléfonos y mails se
cargan en la ficha de cada persona, en **Cantantes**.

Para el productor está la **planilla**: agrupa a los convocados por horario de
citación, con instrumento, teléfono y quién ya fue avisado. Se copia con
**📋 Planilla**, desde el mismo diálogo de convocatoria.

```
ENSAYO — JAM de Septiembre
Sáb, 5 de septiembre de 2026  ·  19:30 a 22:00  ·  Sala Panda
────────────────────────────────────────────────

19:30
   Fabo  (batería)  ✓ avisado
   Charly  (guitarra)

20:00
   Pachu  (+54 9 11 5555-1234)
   Agas

Total: 4 convocados · 1 ya avisados
```

## LIVE VIEW

**▶ LIVE VIEW** abre la lista a pantalla completa para seguirla durante la jam:
tipografía grande, el tema actual resaltado con su cantante, BPM y patch, y los
bloques bien marcados. Se avanza con la **barra espaciadora** o ↓, se vuelve con ↑
y se sale con Esc; tocando cualquier tema saltás ahí. Arriba queda el contador
(12 / 38) y una barra de avance. Mientras está abierta pide *wake lock* para que
la pantalla no se apague sola.

Vive en su propia URL (`#/live/<id>`), así se puede abrir en una tablet o celular
aparte mientras editás en la compu.

Adentro están las descargas:

- **⬇ Word** genera un `.docx` real (ZIP + OOXML armado a mano, sin librerías) con
  el setlist completo, bloques, medleys, cantantes, BPM, patches y los links a las
  cifras como hipervínculos clickeables.
- **🖨** abre el diálogo de impresión: eligiendo *Guardar como PDF* salen los links
  también clickeables, con encabezado y **timestamp** de generación.

**📋 Copiar lista**, en el editor, da la versión en texto para mandar por WhatsApp.

## Ideas

**Ideas** es el cuaderno de temas que todavía no tocaron. Se anota uno por nombre y
la app completa sola artista, categoría, año y género desde internet, y después
busca el tempo aparte — que queda **siempre marcado como sugerido** hasta que lo
confirmes a mano.

Las ideas viven separadas del repertorio: no aparecen en DBSongs, ni en la paleta,
ni en MagicList.

**Una idea gradúa cuando se tocó de verdad**, no cuando la programás. Al sumarla al
setlist de una jam sigue siendo idea — en la lista se ve con el chip 💡 y en su
tarjeta dice en qué jam está anotada. Cuando la fecha de esa jam queda atrás, pasa
sola al repertorio y se le suma esa jam al historial, así empieza a contar como
*tocada 1×*. También está *→ Al repertorio* para forzarlo a mano.

La consolidación corre al abrir la app y cada vez que cambiás la fecha de una jam.
Es idempotente y se autocorrige: si sacás un tema de una lista después de la fecha,
también le saca esa jam del historial. Nunca toca las 26 jams históricas.

El botón **📥 Traer el banco archivado** carga de una los 177 temas que el
documento original tenía como backlog y que sacamos de DBSongs — ése es su lugar
natural.

## Tempo sugerido

De los 374 temas de DBSongs, 172 traen BPM medido y 202 no. El botón **⏱ Tempos**
del editor busca en internet (API de Deezer, vía JSONP) el pulso de los que faltan.

**Nunca pisa un BPM existente**: lo que ya estaba medido queda intacto. Lo que viene
de internet se guarda marcado como *sugerido* y se muestra distinto — `≈ 117 bpm` en
gris itálica — porque es un dato estimado y a veces cae en otra versión del tema.

El tempo **se cambia en cualquier momento y desde cualquier lado**: el chip es
editable en la fila del setlist, en la tabla de DBSongs y en las tarjetas de Ideas.
Un clic sobre el número y se escribe; en cuanto lo escribís vos deja de ser sugerido
y pasa a ser dato medido. El ⏱ al lado vuelve a pedir una sugerencia a internet.

Sobre una muestra de 16 temas con BPM conocido, Deezer tenía dato para 13 y 10 de
esos caían dentro de ±5 BPM del valor medido.

## Cifras (acordes) de Cifra Club

El botón 🎸 de cada tema resuelve el link a su cifra. La primera vez lo busca en
el buscador de Cifra Club (`solr.sscdn.co`, con CORS abierto: se consulta desde el
navegador, sin clave ni proxy) y guarda la URL en DBSongs; a partir de ahí abre
directo. En el editor de una jam, **🎸 Cifras** resuelve de una vez todas las de
esa lista, y los links viajan en "Copiar lista".

El matcheo limpia paréntesis del título (`Uptown Funk (Mark Ronson ft. …)`) y
prueba cada parte de los artistas con barra (`Pappo / Riff / Pappo's Blues`).
Sobre una muestra de 18 temas del repertorio: 16 exactas, 1 dudosa, 1 sin cifra.

Tres estados en el botón:

| Estado | Qué significa |
|---|---|
| 🎸 apagado | Todavía no se buscó |
| 🎸 encendido | Cifra confirmada del mismo artista |
| 🎸 con subrayado ámbar | Solo hay cifra de **otro** artista (cover) — conviene verificar |
| 🎸 muy tenue | No está en Cifra Club; el clic abre el buscador del sitio |

## Mandar temas desde DBSongs a una jam

Arriba de la tabla hay una barra **Agregar a**, que lista solo las **jams en
preparación** — las 26 históricas no aparecen: son el registro de lo que ya pasó y
no se tocan desde ahí. Se elige la jam destino y después:

- el **＋** al final de cada fila manda ese tema, o
- se tildan varios con los checkboxes y sale **＋ Agregar N temas** de una.

Sirve para armar una jam filtrando por categoría, tempo o cantante en la tabla
grande, en vez de ir buscando de a uno desde el editor.

## Stats

Todo se calcula en vivo desde las jams cargadas — no hay nada precomputado que se
pueda quedar viejo. Se puede ver sobre todas las jams, solo las históricas o solo
las tuyas.

| | |
|---|---|
| **Caballitos de batalla** | los temas que más veces sonaron, coloreados por categoría |
| **Bandas que más suenan** | sumando todos los temas de cada una |
| **Cantantes** | cuántos temas y en cuántas jams, con la categoría que más cantan |
| **Mezcla de categorías** | el % real de lo que se toca — el espejo de lo que pedís en MagicList |
| **Energía** | reparto por franja de tempo |
| **Pulso del repertorio** | histograma de BPM, teñido por franja |
| **Rotación** | cuántos sonaron una sola vez, cuántos se repiten, cuántos nunca |
| **Datos cargados** | qué % tiene tempo (medido vs sugerido) y cifra |
| **Estructura de las jams** | medleys, breaks y bloques |

La atribución por cantante sale de los items de cada jam —quién cantó qué en esa
jam— y no del agregado de la canción, que es menos preciso.

## Qué entra en DBSongs

DBSongs tiene **solo temas que se tocaron**: los que figuran en al menos uno de
los 26 setlists reales. El documento original mezclaba esos con un banco grande de
repertorio propuesto — bajo encabezados como *BORRADOR/BACKLOG*, *OTRAS OPCIONES*,
*TBD*, *Extras*, *Full Band Internacional* y *"Otras canciones (nunca las
hicimos)"* — que ensuciaba las búsquedas y las sugerencias.

El generador hace dos pasadas:

1. **Rescate.** El JSON de origen daba por "nunca tocados" a 193 temas, pero a 16
   se les había escapado la marca: el documento los escribe distinto
   (`Traveling Band` por `Travelin' Band`, `Underpressure`) o los mete adentro de un
   medley en la misma línea (`… / Sing It Back / Titanium`). Se recuperan solo con
   coincidencia literal, exigiendo que la línea tenga marcas de ejecución
   (cantante, BPM, CLICK o instrumento), que no esté en una lista de candidatos y
   que ningún título más largo la contenga — así `Crazy` no se roba la línea de
   *Crazy Little Thing Called Love*.
2. **Poda.** Los 177 restantes salen de DBSongs y quedan archivados en
   `data/descartados.json`, con su artista, categoría y todo lo demás. Para
   devolver alguno (o todos), se importa ese archivo desde **Datos → Importar temas**.

## Modelo de datos

```js
Song   { id, titulo, artista, categoria, bpm, franja, cantantes[], patches[],
         invitados[], jams[], notas, origen,
         bpmFuente: ''|'sugerido'|'sin',
         cifraUrl, cifraArtista, cifraConfianza: 'alta'|'media'|'no' }

Jam    { id, nombre, fecha, hora, lugar, ensayos[], musicos[], items[], notas,
         historica, conOrden }

Item   { tipo: 'song',   songId, cantantes[], notas }
     | { tipo: 'break',  label, minutos }
     | { tipo: 'bloque', label }                        // sección del setlist
     | { tipo: 'medley', titulo, songs: [{ songId, cantantes[] }] }

Ensayo { fecha, hora, horaFin, lugar, notas,
         convocados: [{ nombre, hora, instrumento, aviso: ''|'wsp'|'mail' }] }

Persona{ id, nombre, rol: 'voz'|'instrumento', instrumentos[], activo,
         telefono, email, notas }
```

Franja de tempo, igual que en el documento original:
🔵 Low ≤ 99 · 🟢 Mid 100–124 · 🔴 High ≥ 125. Se calcula sola desde el BPM.

## Guardado: solo este navegador o base compartida

Las vistas **nunca** tocan el almacenamiento: hablan solo con `store`, que adentro
usa un driver con dos métodos, `read()` y `write(state)`. Hay dos:

- **`LocalDriver`** — `localStorage`. Es el de arranque: no hay que configurar nada
  pero los datos son de ese navegador.
- **`PostgresDriver`** (`js/drivers/postgres.js`) — una base compartida en
  Postgres, para que entren varios y editen lo mismo. Habla con la API REST de
  Supabase por `fetch`, sin SDK, así el sitio sigue sin dependencias.

En **Datos → Base compartida** están los pasos. Una vez conectada, todo lo que
edites se guarda ahí y cualquiera con el link ve lo mismo.

**Cómo evita que se pisen.** No manda un documento gigante: parte el estado en
`catalogo` (temas, personas, categorías) y **una jam por vez**. Así dos personas
editando jams distintas no se tocan, y cada guardado manda solo lo que cambió.

Para enterarse de lo que hacen los demás hay un websocket contra Supabase
Realtime que escucha una sola tabla: `revision`, que es una fila con un contador.
Por el socket **no viaja ni un dato del repertorio** — el aviso dice "algo
cambió" y la app vuelve a leer por la vía de siempre, que ya pasa por los
permisos. El aviso llega en unos 100 ms. Si el socket no levanta o se cae, el
sondeo de siempre sigue ahí como red (cada 8 s sin realtime, cada 60 s con él).

Si estás escribiendo en un campo o con un diálogo abierto, la vista no se
refresca hasta que termines.

**Y cuando igual chocan.** Realtime achica la ventana, no la cierra: si dos
guardan la misma jam en el mismo segundo, alguien tiene que perder. Por eso cada
jam tiene un número de `version` que sube en cada guardado. Quien escribe manda
el que leyó, y si no coincide **la base rechaza la escritura** (HTTP 409) en vez
de aceptarla y borrar lo del otro en silencio. La app pregunta qué versión queda:
traer la del otro, o pisarla.

Si la base no responde al arrancar, la app sigue andando con los datos del
navegador y te lo dice, en vez de quedarse en blanco.

En **Datos** también están el respaldo completo en JSON (exportar e importar), la
exportación de DBSongs a CSV y el importador de temas por CSV o pegado desde Excel
/ Google Sheets.

## La base

Del lado del navegador el estado sigue siendo un objeto grande. Del lado de la
base son doce tablas, y la traducción la hace Postgres: `app_estado()` devuelve el
estado con la forma que espera `store.js`, y `guardar_catalogo` / `guardar_jam`
reciben esa misma forma y la desarman en filas. Por eso el paso a SQL no obligó a
tocar ninguna pantalla.

```
db/01-esquema.sql      tablas, tipos e índices
db/02-vistas.sql       lo derivado: historial, músicos de cada jam, contadores
db/03-app-estado.sql   la función que le arma el estado a la app
db/04-escritura.sql    las funciones de guardado
db/05-permisos.sql     magic link + lista de miembros (RLS)
db/06-concurrencia.sql control de versión por jam + realtime
db/07-contrasena.sql   alta de miembros con contraseña
db/10-datos.sql        el repertorio y las jams históricas, generado
```

**La regla que ordena el esquema: nada que se pueda calcular se guarda.** El
historial de cada tema (`song.jams[]`), los músicos de cada jam y los contadores
de cada persona eran campos guardados que había que mantener a mano, y los tres
se habían desincronizado: los contadores de jams estaban mal en 35 de 101
personas, y la lista de músicos estaba incompleta en 17 de 26 jams. Ahora son
vistas. La franja de tempo es una columna generada desde el BPM.

El setlist es una sola tabla que se referencia a sí misma: los temas de un medley
son filas hijas con `parent_id` apuntando al medley, así el orden y los cantantes
se resuelven igual en los dos niveles.

### Sembrarla

```bash
python3 scripts/migrar-a-sql.py          # o: ... respaldo.json, desde un export
```

Genera `db/10-datos.sql`. El script es estricto: si un nombre no resuelve a una
persona o un `songId` no existe, aborta en vez de dejar la base a medias.

Después, contra el proyecto de Supabase — **por el puerto 5432, no el 6543**: el
pooler en modo transacción no aguanta bien DDL ni `create extension`.

```bash
export PGPASSWORD='...'
CONN="postgresql://postgres.<ref>@aws-0-<region>.pooler.supabase.com:5432/postgres"
for f in 01-esquema 02-vistas 03-app-estado 04-escritura 05-permisos 10-datos 11-miembros; do
  psql "$CONN" -v ON_ERROR_STOP=1 -f "db/$f.sql" || break
done
```

`db/00-local.sql` **no** se corre en Supabase: es un andamio que imita el esquema
`auth` para poder probar los permisos en un Postgres de escritorio.

### Lo que hay que tocar en el panel de Supabase

Tres cosas que no se pueden hacer por SQL:

1. **Authentication → URL Configuration**: agregar a *Redirect URLs* las
   direcciones desde las que se entra — `http://localhost:8090` para desarrollo y
   la de producción. Si no están, el link del mail te manda a la Site URL.
2. **Authentication → Providers → Email tiene que estar prendido**, aunque se
   entre con contraseña: el `grant_type=password` de Supabase también lo exige.
   Apagarlo devuelve `email_provider_disabled` y no entra nadie.
3. **El correo sale por Resend**, no por el SMTP incluido de Supabase (que
   manda 2 mails por hora). Está configurado en *Project Settings → Auth → SMTP*
   contra `smtp.resend.com:587`, con remitente `jam@emails.portalbosque.org`, y
   el límite subido a 50/hora. Con contraseña igual no se manda ningún mail: eso
   solo importa para el link de emergencia.

Los passkeys no sirven como única puerta: Supabase exige estar logueado para
registrar uno, así que hace falta otra forma de entrar primero.

Son **dos cosas separadas**, y hacen falta las dos:

1. **Tener cuenta.** Cada uno se la crea desde la pantalla de entrada, con
   *¿Primera vez? Creá tu cuenta*. Elige su contraseña y confirma por mail.
2. **Estar en `miembro`.** Eso lo hace alguien con acceso a la base:

   ```sql
   insert into miembro (email) values ('quien@sea.com') on conflict do nothing;
   delete from miembro where email = 'quien@sea.com';   -- baja
   ```

Tener cuenta sin estar en `miembro` da una app vacía con un cartel que lo
explica. Estar en `miembro` sin cuenta no sirve hasta que se registren.

**Lo que hace seguro dejar el registro abierto** es que Supabase no confirma la
cuenta sola: manda un mail y hasta que no se abra ese link, no entra. Sin esa
confirmación, cualquiera que supiera que `joaco@ejemplo.com` está en `miembro`
podría adelantarse y quedarse con esa cuenta. Por eso **`mailer_autoconfirm`
tiene que quedar apagado**.

Para dar de alta a alguien sin que pase por el registro —o si se olvidó la
contraseña y no le llegan los mails— están las funciones de `db/07-contrasena.sql`:

```sql
select crear_miembro('quien@sea.com', 'una-clave-larga');  -- cuenta + miembro
select poner_clave('quien@sea.com', 'otra-clave');         -- resetear
```

Cada uno se la cambia después desde **Datos → Cambiar contraseña**.

La lista **no** se versiona: son mails de personas y este repo es público.
`db/11-miembros.sql` es solo la plantilla con los comandos.

Cualquiera puede pedir un magic link, pero si su mail no está en `miembro` la base
no le devuelve ni una fila. Sacar a alguien de la lista lo deja afuera en el acto.

### La clave en el código

`js/config.js` trae la URL del proyecto y la clave publicable
(`sb_publishable_…`). Está pensada para vivir en el navegador: identifica al
proyecto y nada más. Comprobado contra este proyecto — con esa clave y sin
sesión, la base contesta `permission denied` a todo, tablas y funciones.

Lo que sí habilita es crear una cuenta y pedir magic links. Crear una cuenta no
da acceso a nada —para eso hay que estar en `miembro`— pero sí ensucia la lista
de usuarios y consume cupo de mails. Si eso empieza a molestar, apagar
*Authentication → Sign Ups* cierra el registro y las altas vuelven a pasar solo
por `crear_miembro()`.

Quien quiera apuntar a otro proyecto lo hace desde Datos → Base compartida, y eso
pisa lo de `config.js`. El botón "trabajar solo en este navegador" deja una marca
explícita, así que la config de fábrica no vuelve a aplicarse sola.

### Quién puede entrar

Antes la política era `for all using (true)` con la clave anónima en el
navegador: cualquiera con la URL podía leer y borrar todo. Ahora la clave
anónima identifica al proyecto y el JWT del usuario identifica a la persona, y
las policies miran el segundo.

| Quién sos | Qué ves |
|---|---|
| Sin sesión (solo la clave anónima) | `permission denied` en todo |
| Logueado pero fuera de `miembro` | cero filas, y no podés escribir |
| Logueado y en `miembro` | todo |

El código de cada jam se guarda con `crypt()`, nunca en claro.

### Probarla

```bash
createdb jamportal_test
python3 scripts/verificar-migracion.py
```

Levanta el esquema de cero en un Postgres local y corre 34 comprobaciones en seis
bloques: que `app_estado()` devuelve lo mismo que `data/seed.json` (los 645 ítems
de setlist tienen que salir idénticos), que leer → escribir → leer no pierde ni
inventa nada, que no quedan referencias rotas, y que los permisos hacen lo que
dicen. Sale con código 1 si algo no cierra.

Y la que prueba lo que ese script no puede ver, contra el proyecto de verdad:

```bash
export JAMPORTAL_CONN='postgresql://postgres.<ref>@...:5432/postgres'
export JAMPORTAL_URL='https://<ref>.supabase.co'
export JAMPORTAL_KEY='sb_publishable_...'
python3 scripts/probar-api.py
```

Crea un usuario descartable directo en la base (no manda mails, para no gastar el
cupo), prueba leer, escribir, el conflicto de versión y los permisos, y lo borra.

**Una advertencia sobre el alcance del verificador local:** prueba por SQL, y hay cosas
que solo se rompen por HTTP. Supabase carga `supautils` en la conexión de
PostgREST, que rechaza los `DELETE` sin `WHERE` — por `psql` pasan igual, así que
un round-trip por SQL les da el visto bueno y después la app falla en producción
con `DELETE requires a WHERE clause`. Por eso el bloque 5 es un lint sobre los
`.sql` en vez de una consulta, y por eso conviene probar el camino de escritura
también contra la API real antes de cantar victoria.

## Regenerar el repertorio base

```bash
python3 scripts/convert-seed.py
```

Cruza las dos fuentes originales y reescribe `data/seed.json`:

| Fuente | Qué aporta |
|---|---|
| `~/Downloads/jams-canciones.json` | los 551 temas con BPM, franja, cantantes, patch e invitados, y **qué** se tocó en cada jam |
| `~/Downloads/JAMs - Lista Canciones.docx` | **en qué orden**, con sus medleys, breaks y bloques |

Del primero salen los temas, la base de cantantes y la de músicos invitados
(derivadas de quién cantó y quién tocó cada tema). Del segundo, el orden real de
cada jam: recorre las líneas del documento y las matchea contra los temas que el
JSON le asigna a esa jam, así las líneas de arreglo ("Verso", "Caños LEMOTIVE",
"Corte final") se descartan solas porque no matchean con ningún tema.

Los medleys se leen tal como están escritos: `Medley X` abre un grupo y lo cierra
un renglón en blanco (o un BREAK, otro medley o un bloque nuevo); y varios temas
separados por `/` en un mismo renglón son un medley de una línea.

Cobertura actual: **662 de 690** posiciones ubicadas (96%). Los 28 que no
aparecen en el documento se agregan al final de su jam con la nota
*"sin posición en el documento"*, así no se pierde ninguno.

Al subir la versión del seed, la app recarga el repertorio automáticamente en
quienes todavía no armaron jams propias; el resto lo puede hacer desde
**Datos → Reiniciar a la base original**.
