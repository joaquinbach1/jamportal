/* ============================================================
   drivers/publico.js — la jam que se abre con un link
   ------------------------------------------------------------
   Misma interfaz que PostgresDriver (read / write), así que el
   store y las vistas no se enteran de nada. Lo que cambia es a
   qué le habla: cuatro funciones que la base deja ejecutar sin
   sesión, y todas piden el token.

   Sin sesión no va Authorization: entra como `anon`, y para
   `anon` las tablas están revocadas. Todo lo que se puede hacer
   pasa por esas cuatro funciones, y lo que ninguna deja hacer no
   se puede hacer.

   La diferencia grande con el driver de la banda está en la
   escritura. Aquel manda el catálogo entero a `guardar_catalogo`,
   que BORRA los temas que no vengan en el paquete: por un link
   eso sería regalarle a cualquiera la posibilidad de vaciar el
   repertorio. Acá los temas se dan de alta de a uno y nunca se
   borran ni se renombran.
   ============================================================ */

export class PublicoDriver {
  constructor({ url, key, token }) {
    this.url = (url || '').replace(/\/+$/, '');
    this.key = key || '';
    this.token = token || '';
    this.name = 'link';
    this.jamId = null;         // la única jam que este link abre
    this.version = null;       // la que leímos, para no pisar a nadie
    this.revision = -1;
    this.songs = new Set();    // ids que ya están en la base
    this.ultimaJam = null;     // JSON de la jam, para no reescribir de gusto
  }

  cabeceras() {
    return { apikey: this.key, 'Content-Type': 'application/json' };
  }

  async rpc(fn, args = {}) {
    const res = await fetch(`${this.url}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: this.cabeceras(), body: JSON.stringify(args),
    });
    if (!res.ok) {
      if (res.status === 409) {
        const e = new Error('Alguien más editó esto mientras vos lo editabas.');
        e.conflicto = true;
        throw e;
      }
      const detalle = await res.text().catch(() => '');
      if (/no sirve o fue revocado|no abre esa jam/.test(detalle)) {
        const e = new Error('Este link ya no sirve. Pedí uno nuevo.');
        e.linkMuerto = true;
        throw e;
      }
      throw new Error(`Supabase ${res.status}: ${detalle.slice(0, 200) || res.statusText}`);
    }
    const texto = await res.text();
    return texto ? JSON.parse(texto) : null;
  }

  /* ---------- lectura ---------- */
  async read() {
    const estado = await this.rpc('estado_publico', { t: this.token });
    /* null tiene un solo significado acá, y no es "la base está vacía":
       el token no existe. O nunca existió, o lo revocaron. */
    if (!estado) {
      const e = new Error('Este link ya no sirve. Pedí uno nuevo.');
      e.linkMuerto = true;
      throw e;
    }

    const jam = (estado.jams || [])[0];
    this.jamId = jam ? jam.id : null;
    this.version = jam ? (jam.version ?? null) : null;
    this.ultimaJam = jam ? JSON.stringify(jam) : null;
    this.songs = new Set((estado.songs || []).map(s => s.id));

    /* Los medleys vienen aparte: viven adentro del setlist de las otras
       jams, y por el link llega una sola. Sin esto, la pastilla de Medleys
       se abría vacía. */
    estado.medleys = await this.rpc('medleys_publicos', { t: this.token });

    this.revision = await this.rpc('revision_publica', { t: this.token });
    return estado;
  }

  /* ---------- escritura ---------- */
  /**
   * Solo dos cosas viajan: los temas nuevos, de a uno, y la jam del link.
   * Todo lo demás que el store haya tocado —una categoría, el nombre de
   * una persona, otro tema— se queda en el navegador y se pierde al
   * recargar. Es a propósito: por un link no se edita el repertorio de
   * la banda.
   *
   * @param {object} state
   * @param {Set<string>} [forzar] ids de jam a guardar pisando lo del otro
   */
  async write(state, forzar = null) {
    const jam = (state.jams || []).find(j => j.id === this.jamId);
    if (!jam) return;

    // Los temas que la lista usa y la base todavía no tiene.
    const usados = new Set();
    for (const it of jam.items || []) {
      if (it.tipo === 'medley') (it.songs || []).forEach(x => usados.add(x.songId));
      else if (it.songId) usados.add(it.songId);
    }
    for (const id of usados) {
      if (!id || this.songs.has(id)) continue;
      const s = (state.songs || []).find(x => x.id === id);
      if (!s) continue;
      await this.rpc('crear_song_publica', { t: this.token, s });
      this.songs.add(id);
    }

    const doc = JSON.stringify(jam);
    if (doc === this.ultimaJam) return;

    const pisar = forzar && forzar.has(jam.id);
    try {
      this.revision = await this.rpc('guardar_jam_publica', {
        t: this.token, j: jam,
        version_esperada: (pisar || this.version == null) ? null : this.version,
      });
    } catch (e) {
      if (e.conflicto) { e.jamId = jam.id; e.jamNombre = jam.nombre; }
      throw e;
    }
    this.version = (this.version ?? 0) + 1;
    this.ultimaJam = doc;
  }

  async hayCambiosAjenos() {
    const n = await this.rpc('revision_publica', { t: this.token });
    return typeof n === 'number' && n !== this.revision;
  }

  async clear() { /* por un link no se vacía nada */ }
}
