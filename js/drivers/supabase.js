/* ============================================================
   drivers/supabase.js — la base compartida
   ------------------------------------------------------------
   Misma interfaz que LocalDriver (read / write / clear), así que
   el resto de la app no se entera de nada.

   En vez de guardar un único documento gigante, parte el estado
   en varios: el catálogo por un lado y CADA JAM por separado.
   Así dos personas editando jams distintas no se pisan.

   No usa el SDK de Supabase: habla con su API REST por fetch,
   para que el sitio siga sin dependencias.
   ============================================================ */

const TABLA = 'jamportal';

export class SupabaseDriver {
  constructor({ url, key }) {
    this.url = (url || '').replace(/\/+$/, '');
    this.key = key || '';
    this.name = 'nube';
    this.ultimo = new Map();      // id → JSON guardado, para no reescribir de gusto
    this.sellos = new Map();      // id → updated_at, para detectar cambios ajenos
  }

  get endpoint() { return `${this.url}/rest/v1/${TABLA}`; }

  get headers() {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      'Content-Type': 'application/json',
    };
  }

  async pedir(ruta, opciones = {}) {
    const res = await fetch(this.endpoint + ruta, { ...opciones, headers: { ...this.headers, ...(opciones.headers || {}) } });
    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      throw new Error(`Supabase ${res.status}: ${detalle.slice(0, 200) || res.statusText}`);
    }
    return res.status === 204 ? null : res.json();
  }

  /** Prueba la conexión y devuelve cuántos documentos hay. */
  async probar() {
    const filas = await this.pedir('?select=id');
    return filas.length;
  }

  /* ---------- lectura ---------- */
  async read() {
    const filas = await this.pedir('?select=id,data,updated_at');
    if (!filas.length) return null;

    this.ultimo.clear(); this.sellos.clear();
    let catalogo = null;
    const jams = [];

    for (const f of filas) {
      this.ultimo.set(f.id, JSON.stringify(f.data));
      this.sellos.set(f.id, f.updated_at);
      if (f.id === 'catalogo') catalogo = f.data;
      else if (f.id.startsWith('jam:')) jams.push(f.data);
    }
    if (!catalogo) return null;

    return { ...catalogo, jams };
  }

  /* ---------- escritura ---------- */
  async write(state) {
    const docs = documentos(state);
    const aEscribir = [];

    for (const [id, data] of docs) {
      const json = JSON.stringify(data);
      if (this.ultimo.get(id) !== json) {
        aEscribir.push({ id, data });
        this.ultimo.set(id, json);
      }
    }

    // jams borradas: sacamos su fila
    const vivos = new Set(docs.keys());
    const aBorrar = [...this.ultimo.keys()].filter(id => !vivos.has(id));

    if (aEscribir.length) {
      // pedimos la fila de vuelta para quedarnos con el updated_at que quedó
      // grabado; si no, la próxima comparación creería que cambió otro
      const guardadas = await this.pedir('?on_conflict=id&select=id,updated_at', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(aEscribir.map(d => ({ ...d, updated_at: new Date().toISOString() }))),
      });
      (guardadas || []).forEach(f => this.sellos.set(f.id, f.updated_at));
    }
    for (const id of aBorrar) {
      await this.pedir(`?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      this.ultimo.delete(id); this.sellos.delete(id);
    }
  }

  /**
   * ¿Alguien más tocó algo? Compara solo las fechas, que es barato.
   * @returns {Promise<boolean>}
   */
  async hayCambiosAjenos() {
    const filas = await this.pedir('?select=id,updated_at');
    if (filas.length !== this.sellos.size) return true;
    return filas.some(f => this.sellos.get(f.id) !== f.updated_at);
  }

  async clear() {
    await this.pedir('?id=neq.__nada__', { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    this.ultimo.clear(); this.sellos.clear();
  }
}

/** Parte el estado en documentos: el catálogo y una fila por jam. */
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

/* ---------- el SQL que hay que correr una vez en Supabase ---------- */
export const SQL_INICIAL = `-- Tabla única para JAM PORTAL
create table if not exists jamportal (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Acceso con la clave anon (sin login): cualquiera con el link edita.
alter table jamportal enable row level security;

drop policy if exists "jamportal abierto" on jamportal;
create policy "jamportal abierto" on jamportal
  for all using (true) with check (true);`;
