/* ============================================================
   drivers/postgres.js — la base compartida
   ------------------------------------------------------------
   Misma interfaz que LocalDriver (read / write / clear), así que
   el resto de la app no se entera de nada.

   Del otro lado ya no hay documentos JSON sino doce tablas. La
   traducción la hace la base: `app_estado()` devuelve el estado
   con la forma que espera store.js, y `guardar_catalogo` /
   `guardar_jam` reciben esa misma forma y la desarman en filas.

   Se sigue mandando de a documentos enteros —el catálogo por un
   lado, cada jam por otro— para que dos personas editando jams
   distintas no se pisen, y se manda solo lo que cambió.

   No usa el SDK de Supabase: habla con su API REST por fetch,
   para que el sitio siga sin dependencias.
   ============================================================ */

export class PostgresDriver {
  constructor({ url, key, auth }) {
    this.url = (url || '').replace(/\/+$/, '');
    this.key = key || '';
    this.auth = auth || null;  // sesión del usuario; sin ella no se ve nada
    this.name = 'nube';
    this.ultimo = new Map();   // id → JSON guardado, para no reescribir de gusto
    this.versiones = new Map();// jamId → versión que leímos, para no pisar a nadie
    this.revision = -1;        // contador de la base, para detectar cambios ajenos
  }

  /**
   * La clave anónima identifica al proyecto; el Bearer identifica a la
   * persona. Las policies miran el segundo: con la clave sola, la base
   * no devuelve ni una fila.
   */
  async cabeceras() {
    const token = this.auth ? await this.auth.token() : null;
    const h = { apikey: this.key, 'Content-Type': 'application/json' };
    // Sin sesión no mandamos Authorization: que la petición entre como
    // anónima y la frene el RLS, en vez de mandar la clave publicable
    // como si fuera un token de persona.
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  /** Llama a una función de la base. */
  async rpc(fn, args = {}) {
    const res = await fetch(`${this.url}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: await this.cabeceras(), body: JSON.stringify(args),
    });
    if (!res.ok) {
      if (res.status === 401) throw new Error('La sesión venció. Entrá de nuevo.');
      if (res.status === 409) {
        const e = new Error('Alguien más editó esto mientras vos lo editabas.');
        e.conflicto = true;
        throw e;
      }
      const detalle = await res.text().catch(() => '');
      throw new Error(`Supabase ${res.status}: ${detalle.slice(0, 200) || res.statusText}`);
    }
    const texto = await res.text();
    return texto ? JSON.parse(texto) : null;
  }

  /**
   * Prueba la conexión y devuelve cuántos temas hay cargados.
   *
   * Cero puede significar dos cosas muy distintas: que la base está
   * vacía, o que estás logueado pero tu mail no está en `miembro` y el
   * RLS te esconde todo. Para separarlas preguntamos por la revisión,
   * que un miembro siempre puede leer.
   */
  async probar() {
    const estado = await this.rpc('app_estado');
    const temas = (estado && estado.songs ? estado.songs.length : 0);
    if (temas) return temas;
    const n = await this.rpc('revision_actual');
    if (n === null) throw new Error('SIN_PERMISO');
    return 0;
  }

  /* ---------- lectura ---------- */
  async read() {
    const estado = await this.rpc('app_estado');
    if (!estado || !Array.isArray(estado.songs) || !estado.songs.length) {
      // Que no venga nada puede ser dos cosas muy distintas: que la base
      // esté recién creada, o que estés logueado pero fuera de `miembro`
      // y el RLS te esconda todo. Confundirlas es peligroso — la app cree
      // que le toca sembrar la base y trata de sobrescribir el repertorio
      // de todos, que es lo que hacía antes de esta comprobación.
      //
      // revision_actual() las separa: un miembro siempre lee un número;
      // alguien fuera de la lista lee null, porque el RLS le tapa la fila.
      const n = await this.rpc('revision_actual');
      if (n === null) {
        const e = new Error('Tu mail no está habilitado en esta base.');
        e.sinPermiso = true;
        throw e;
      }
      return null;   // la base está vacía de verdad: sembrarla es correcto
    }

    // Guardamos lo leído para poder comparar en la próxima escritura.
    this.ultimo.clear();
    for (const [id, doc] of documentos(estado)) this.ultimo.set(id, JSON.stringify(doc));

    this.versiones.clear();
    for (const j of estado.jams || []) this.versiones.set(j.id, j.version ?? null);

    this.revision = await this.rpc('revision_actual');

    return estado;
  }

  /* ---------- escritura ---------- */
  /**
   * @param {object} state
   * @param {Set<string>} [forzar] ids de jam a guardar pisando lo del otro
   */
  async write(state, forzar = null) {
    const docs = documentos(state);
    let ultimaRevision = this.revision;

    for (const [id, doc] of docs) {
      const json = JSON.stringify(doc);
      if (this.ultimo.get(id) === json) continue;

      if (id === 'catalogo') {
        ultimaRevision = await this.rpc('guardar_catalogo', { c: doc });
      } else {
        // Mandamos la versión que leímos: si en la base hay otra, es que
        // alguien guardó en el medio y la escritura se rechaza.
        const v = this.versiones.get(doc.id);
        const pisar = forzar && forzar.has(doc.id);
        try {
          ultimaRevision = await this.rpc('guardar_jam', {
            j: doc, version_esperada: (pisar || v == null) ? null : v,
          });
        } catch (e) {
          if (e.conflicto) { e.jamId = doc.id; e.jamNombre = doc.nombre; }
          throw e;
        }
        // La base hace version + 1 y solo llegamos acá si coincidían.
        this.versiones.set(doc.id, (v ?? 0) + 1);
      }
      this.ultimo.set(id, json);
    }

    // jams borradas: se les saca la fila
    for (const id of [...this.ultimo.keys()]) {
      if (docs.has(id)) continue;
      ultimaRevision = await this.rpc('borrar_jam', { jid: id.slice(4) });
      this.ultimo.delete(id);
    }

    // Nos quedamos con la revisión que dejó nuestra propia escritura, para
    // que el sondeo no la confunda con un cambio de otro.
    if (typeof ultimaRevision === 'number') this.revision = ultimaRevision;
  }

  /**
   * ¿Alguien más tocó algo? Es un contador, no la base entera.
   * @returns {Promise<boolean>}
   */
  async hayCambiosAjenos() {
    const n = await this.rpc('revision_actual');
    return typeof n === 'number' && n !== this.revision;
  }

  /* ---------- administrar la lista ----------
     La base decide si quien llama puede: estas funciones comprueban por
     su cuenta y devuelven 403 si no. El cliente no gana nada mintiendo. */
  /* notas privadas: el email lo pone la base desde el JWT, no el cliente */
  misNotas()                   { return this.rpc('mis_notas'); }
  guardarNota(jam, song, txt)  { return this.rpc('guardar_nota', { p_jam: jam, p_song: song, p_texto: txt }); }

  listarMiembros()             { return this.rpc('listar_miembros'); }
  agregarMiembro(email, admin) { return this.rpc('agregar_miembro', { p_email: email, p_admin: !!admin }); }
  sacarMiembro(email)          { return this.rpc('sacar_miembro', { p_email: email }); }
  setAdmin(email, admin)       { return this.rpc('set_admin', { p_email: email, p_admin: !!admin }); }

  /** Cierra una jam guardando el hash del código, nunca el código. */
  async cerrarJam(jamId, codigo) {
    this.revision = await this.rpc('cerrar_jam', { jid: jamId, codigo });
  }

  /** ¿Este código abre esa jam? La comparación la hace la base. */
  async abrirJam(jamId, codigo) {
    return this.rpc('abrir_jam', { jid: jamId, codigo });
  }

  async clear() {
    await this.rpc('vaciar_todo');
    this.ultimo.clear();
    this.revision = -1;
  }
}

/**
 * Parte el estado en documentos: el catálogo y uno por jam. Es el
 * mismo corte que se manda a la base, así que también es la unidad
 * de comparación para no reescribir lo que no cambió.
 */
function documentos(state) {
  const docs = new Map();
  docs.set('catalogo', {
    version: state.version,
    songs: state.songs,
    cantantes: state.cantantes,
    musicos: state.musicos,
    categorias: state.categorias,
    porConfirmar: state.porConfirmar,
  });
  for (const jam of state.jams || []) docs.set('jam:' + jam.id, jam);
  return docs;
}

/* ---------- lo que hay que correr una vez en Supabase ---------- */
export const PASOS_SQL = [
  { archivo: 'db/01-esquema.sql',     que: 'las tablas, los tipos y los índices' },
  { archivo: 'db/02-vistas.sql',      que: 'lo derivado: historial, músicos, contadores' },
  { archivo: 'db/03-app-estado.sql',  que: 'la función que le arma el estado a la app' },
  { archivo: 'db/04-escritura.sql',   que: 'las funciones de guardado' },
  { archivo: 'db/05-permisos.sql',    que: 'quién puede entrar' },
  { archivo: 'db/10-datos.sql',       que: 'el repertorio y las jams históricas' },
];
