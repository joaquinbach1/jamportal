/* ============================================================
   store.js — capa de datos
   ------------------------------------------------------------
   Toda la app habla con `store`, nunca con el almacenamiento
   directo. Del otro lado hay una sola cosa: la base compartida
   de la banda (`PostgresDriver`).

   Antes había también un driver de localStorage, y arrancar con
   él cuando la base fallaba parecía prudente. No lo era: si la
   sesión vencía, la app caía sin decir nada al repertorio viejo
   de ese navegador —otro repertorio, otras jams— y todo lo que
   se editaba desde ahí no llegaba a ningún lado. Ahora si la
   base no contesta, la app lo dice y no inventa datos.
   ============================================================ */

const KEY_NUBE = 'jamportal.nube';    // { url, key } para apuntar a otro proyecto
const LUGAR_POR_DEFECTO = 'Portal';   // casi todas las jams son ahí

import { NUBE } from './config.js';

/* ---------- estado ---------- */
let driver = null;       // se arma en init(), contra la base de la banda
let sondeo = null;
let auth = null;         // la sesión
let sinPermiso = false;  // entraste bien, pero tu mail no está en `miembro`
/* Por qué no se pudo arrancar, si no se pudo. La app lo muestra y frena:
   { tipo: 'sesion' | 'red' | 'vacia', mensaje } */
let problema = null;

let state = {
  version: 1,
  songs: [],
  cantantes: [],
  musicos: [],
  jams: [],
  categorias: [],
  porConfirmar: [],
};

const listeners = new Set();
let saveTimer = null;

function emit() { listeners.forEach(fn => fn()); }

/* Jams que hay que guardar pisando lo que haya, porque quien edita ya
   decidió que su versión gana. Se vacía en cuanto se usa. */
let aPisar = new Set();

function persist() {
  if (!driver) return;          // todavía no arrancamos, o la base no contestó
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const pisar = aPisar;
    aPisar = new Set();
    try {
      await driver.write(state, pisar);
    } catch (e) {
      // Un choque no es un error a loguear y olvidar: alguien tiene que
      // decidir qué versión queda, y eso no lo puede decidir el store.
      if (e.conflicto && alChocar) alChocar(e);
      else console.error('No se pudo guardar', e);
    }
  }, 120);
}

function touch() { persist(); emit(); }

/* ---------- sincronización con la base compartida ----------
   Cada tanto preguntamos si alguien más tocó algo. Es solo una consulta de
   ids y fechas, así que es barata. Si hay novedades, avisamos y la vista se
   refresca — salvo que estés escribiendo en un campo, para no interrumpirte. */
const SONDEO_MS = 8000;         // sin realtime, este es el ritmo
const SONDEO_RED = 60_000;      // con realtime, el sondeo es solo una red
const TIC_MS = 2000;

let alSincronizar = null;
let alChocar = null;
let rt = null;                  // el websocket, si levantó
let ultimoSondeo = 0;

export function alHaberCambiosAjenos(fn) { alSincronizar = fn; }
/** Se llama cuando otro guardó la misma jam mientras vos la editabas. */
export function alChocarConOtro(fn) { alChocar = fn; }
export function realtimeConectado() { return !!(rt && rt.conectado); }

function detenerSondeo() {
  clearInterval(sondeo); sondeo = null;
  if (rt) { rt.desconectar(); rt = null; }
}

/** Trae lo que hayan cambiado otros. Lo usan el websocket y el sondeo. */
async function traerCambios() {
  try {
    if (!driver.hayCambiosAjenos || !(await driver.hayCambiosAjenos())) return false;
    const remoto = await driver.read();
    if (!remoto) return false;
    state = { ...state, ...remoto };
    emit();
    if (alSincronizar) alSincronizar();
    return true;
  } catch (e) {
    console.warn('No pude sincronizar:', e.message);
    return false;
  }
}

async function arrancarSondeo() {
  detenerSondeo();

  /* Realtime avisa en el momento; el sondeo queda igual, pero espaciado,
     porque el websocket se puede caer sin que nos enteremos. */
  if (auth) {
    try {
      const { Realtime } = await import('./realtime.js');
      const cfg = store.configNube();
      rt = new Realtime({
        url: cfg.url, key: cfg.key, auth,
        alCambiar: () => { if (!document.hidden) traerCambios(); },
      });
      await rt.conectar();
    } catch (e) {
      console.warn('Realtime no levantó, sigo con el sondeo:', e.message);
      rt = null;
    }
  }

  sondeo = setInterval(async () => {
    if (document.hidden) return;
    const cada = (rt && rt.conectado) ? SONDEO_RED : SONDEO_MS;
    if (Date.now() - ultimoSondeo < cada) return;
    ultimoSondeo = Date.now();
    if (rt) rt.refrescarToken();
    await traerCambios();
  }, TIC_MS);
}

export function uid(prefix = 'x') {
  return prefix + '-' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
}

/* ---------- normalización / búsqueda ---------- */
export function norm(s) {
  return (s || '')
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Franja de tempo según la convención del repertorio.
 *
 * En la base es una columna generada, así que el valor autoritativo lo
 * calcula Postgres. Esto queda para pintar la franja en el acto, sin
 * esperar a releer: lo que la app manda en `franja` se ignora al guardar.
 */
export function franjaDeBpm(bpm) {
  const n = parseInt(bpm, 10);
  if (!n) return null;
  if (n <= 99) return 'low';
  if (n <= 124) return 'mid';
  return 'high';
}

export const FRANJA_LABEL = { low: '🔵 Low', mid: '🟢 Mid', high: '🔴 High' };

/* ============================================================
   API pública
   ============================================================ */

export const store = {
  /** La sesión. */
  get auth() { return auth; },
  /** ¿Entramos por un link compartido y no con cuenta? */
  get publico() { return !!state.publico; },
  /** Por qué no se pudo arrancar, si no se pudo. La app frena y lo cuenta. */
  get problema() { return problema; },
  /** Entraste bien, pero tu mail no está habilitado en esta base. */
  get sinPermiso() { return sinPermiso; },
  /** ¿Podés manejar la lista de miembros? Lo dice la base, no el cliente. */
  get esAdmin() { return !!state.esAdmin; },
  /** El driver, para las operaciones que no pasan por el estado. */
  get driver() { return driver; },
  get email() { return auth && auth.email; },

  /**
   * Guarda a qué base apuntamos, sin conectarse.
   *
   * Va separado de conectarNube() por un problema de orden: validar la
   * conexión ahora requiere sesión, y para conseguir sesión hay que
   * saber contra qué proyecto pedirla. Así que primero se guarda el
   * destino, después se entra, y recién ahí se lee.
   */
  guardarConfigNube({ url, key }) {
    const limpia = (url || '').trim().replace(/\/+$/, '');
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(limpia)) {
      throw new Error('La URL tiene que ser https://xxxx.supabase.co');
    }
    // Dos formatos conviven: el nuevo `sb_publishable_…` y el JWT `anon`
    // de siempre, que empieza con `ey`. Los dos sirven.
    const k = (key || '').trim();
    if (!k.startsWith('sb_publishable_') && !k.startsWith('ey')) {
      throw new Error('Esa no parece la clave publicable (sb_publishable_…) ni la anon (ey…)');
    }
    localStorage.setItem(KEY_NUBE, JSON.stringify({ url: limpia, key: k }));
    return { url: limpia, key: k };
  },

  /**
   * Prepara la sesión sin conectarse todavía. La usa la pantalla de
   * entrada, que necesita poder mandar el mail antes de que haya con
   * qué leer la base.
   */
  async prepararAuth() {
    const nube = this.configNube();
    if (!nube) return null;
    if (!auth) {
      const { Auth } = await import('./auth.js');
      auth = new Auth(nube);
    }
    return auth;
  },

  /** Cierra la sesión y vuelve a la pantalla de entrada. */
  cerrarSesion() {
    if (auth) auth.cerrarSesion();
    detenerSondeo();
  },

  /**
   * A qué base apuntamos. Gana lo que haya en este navegador; si no
   * hay nada, el proyecto que viene configurado en js/config.js.
   */
  configNube() {
    let propia = null;
    try { propia = JSON.parse(localStorage.getItem(KEY_NUBE) || 'null'); }
    catch { /* config corrupta: seguimos con la de fábrica */ }

    if (propia && propia.url && propia.key) return propia;
    return (NUBE && NUBE.url && NUBE.key) ? NUBE : null;
  },

  /** ¿Está apuntando a otra base distinta de la de fábrica? */
  get nubePropia() {
    const c = this.configNube();
    return !!(c && NUBE && c.url !== NUBE.url);
  },

  /**
   * Apunta la app a otra base. No siembra nada: una base vacía se llena
   * corriendo los archivos de `db/`, que es lo único que garantiza que
   * el esquema y los datos entren juntos y en orden.
   */
  async conectarNube({ url, key }) {
    const { PostgresDriver } = await import('./drivers/postgres.js');
    const { Auth } = await import('./auth.js');
    auth = new Auth({ url, key });
    const nuevo = new PostgresDriver({ url, key, auth });
    await nuevo.probar();                        // valida credenciales y permisos
    const remoto = await nuevo.read();
    if (remoto) state = { ...state, ...remoto };

    localStorage.setItem(KEY_NUBE, JSON.stringify({ url, key }));
    driver = nuevo;
    arrancarSondeo();
    emit();
    return state;
  },

  /**
   * Guarda una jam pisando lo que haya en la base. Es lo que se elige
   * cuando hubo un choque y quien edita decide que su versión queda.
   */
  pisarJam(jamId) {
    aPisar.add(jamId);
    touch();
  },

  /** Trae los cambios que hicieron otros. */
  async sincronizar() {
    if (!driver) return false;
    const remoto = await driver.read();
    if (!remoto) return false;
    state = { ...state, ...remoto };
    emit();
    return true;
  },

  /**
   * Arranca desde un link compartido, sin cuenta.
   *
   * La base devuelve UNA jam y el repertorio, y nada de lo que es de la
   * banda: teléfonos, mails, ensayos, las otras jams. Lo que se puede
   * escribir lo decide la base, no esto.
   */
  async initPublico(token) {
    const nube = this.configNube();
    if (!nube) {
      problema = { tipo: 'config', mensaje: 'Falta configurar la base en js/config.js.' };
      return state;
    }
    const { PublicoDriver } = await import('./drivers/publico.js');
    driver = new PublicoDriver({ ...nube, token });
    try {
      state = { ...state, ...(await driver.read()) };
      arrancarSondeo();
      return state;
    } catch (e) {
      problema = { tipo: e.linkMuerto ? 'link' : 'red', mensaje: e.message };
      console.error('No se pudo abrir el link:', e.message);
      return state;
    }
  },

  /**
   * Arranca contra la base de la banda. No hay a dónde caerse: si algo
   * falla, deja el motivo en `problema` y devuelve el estado vacío, para
   * que la app lo cuente en pantalla en vez de mostrar datos de otro lado.
   */
  async init() {
    const nube = this.configNube();
    if (!nube) {
      problema = { tipo: 'config', mensaje: 'Falta configurar la base en js/config.js.' };
      return state;
    }

    const { PostgresDriver } = await import('./drivers/postgres.js');
    const { Auth } = await import('./auth.js');
    auth = new Auth(nube);
    driver = new PostgresDriver({ ...nube, auth });

    try {
      const remoto = await driver.read();
      if (!remoto) {
        /* La base contesta y te deja leer, pero no hay nada. Sembrarla desde
           el navegador es lo que antes pisaba el repertorio de todos: se
           siembra corriendo los archivos de `db/`, que es lo único que
           garantiza que el esquema y los datos entren juntos. */
        problema = { tipo: 'vacia', mensaje: 'La base está creada pero vacía.' };
        return state;
      }
      state = { ...state, ...remoto };
      arrancarSondeo();
      return state;
    } catch (e) {
      if (e.sinPermiso) { sinPermiso = true; return state; }
      /* La sesión vencida y la falta de red se cuentan distinto: una se
         arregla entrando de nuevo y la otra esperando. */
      problema = { tipo: e.sesion ? 'sesion' : 'red', mensaje: e.message };
      console.error('No se pudo leer la base:', e.message);
      return state;
    }
  },

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /* ---------- lecturas ---------- */
  get songs()      { return state.songs; },
  get cantantes()  { return state.cantantes; },
  get musicos()    { return state.musicos; },
  get jams()       { return state.jams; },
  get categorias() { return state.categorias; },
  get porConfirmar(){ return state.porConfirmar; },
  get all()        { return state; },

  /** Repertorio de verdad: lo que se toca. Las ideas viven aparte. */
  get repertorio() { return state.songs.filter(s => !s.esIdea); },
  /** Temas anotados para probar algún día, todavía sin tocar. */
  get ideas()      { return state.songs.filter(s => s.esIdea); },

  /** Saca a mano un tema de Ideas y lo pasa al repertorio. */
  promoverIdea(id) {
    const s = this.song(id);
    if (!s || !s.esIdea) return null;
    delete s.esIdea;
    touch();
    return s;
  },

  /** Jams propias cuya fecha ya pasó: lo que estaba en su lista, se tocó. */
  jamsPasadas() {
    const hoy = new Date().toISOString().slice(0, 10);
    return state.jams.filter(j => !j.historica && j.fecha && j.fecha < hoy);
  },

  /** En qué jams futuras está programado un tema. */
  programadoEn(id) {
    const hoy = new Date().toISOString().slice(0, 10);
    return state.jams.filter(j => !j.historica && (!j.fecha || j.fecha >= hoy)
      && (j.items || []).some(it => it.tipo === 'medley'
        ? (it.songs || []).some(x => x.songId === id)
        : it.songId === id));
  },

  song(id)   { return state.songs.find(s => s.id === id); },
  jam(id)    { return state.jams.find(j => j.id === id); },
  cantante(id) { return state.cantantes.find(c => c.id === id); },

  /** Artistas únicos, ordenados. */
  artistas() {
    return [...new Set(state.songs.map(s => s.artista))].sort((a, b) => a.localeCompare(b));
  },

  /** Nombres de cantantes que aparecen en el repertorio + los cargados a mano. */
  nombresCantantes() {
    return state.cantantes.map(c => c.nombre).sort((a, b) => a.localeCompare(b));
  },

  /* ---------- canciones ---------- */
  addSong(data) {
    const song = {
      id: uid('song'),
      titulo: '', artista: '', categoria: state.categorias[0] || 'Internacional (rock / pop / funk / soul)',
      bpm: null, bpmRaw: '', franja: null,
      cantantes: [], patches: [], invitados: [], jams: [], anio: null, album: '', albumId: null, cover: '',
      notas: '', origen: 'manual',
      ...data,
    };
    if (!song.franja) song.franja = franjaDeBpm(song.bpm);
    state.songs.push(song);
    state.songs.sort((a, b) => a.artista.localeCompare(b.artista) || a.titulo.localeCompare(b.titulo));
    touch();
    return song;
  },

  updateSong(id, patch) {
    const s = this.song(id);
    if (!s) return null;
    Object.assign(s, patch);
    if (patch.bpm !== undefined && !patch.franja) s.franja = franjaDeBpm(s.bpm);
    touch();
    return s;
  },

  removeSong(id) {
    state.songs = state.songs.filter(s => s.id !== id);
    // limpia referencias en los setlists
    state.jams.forEach(j => {
      j.items = j.items.filter(it => it.songId !== id);
      j.items.forEach(it => {
        if (it.tipo === 'medley') it.songs = (it.songs || []).filter(m => m.songId !== id);
      });
    });
    touch();
  },

  /* ---------- categorías ---------- */

  /** Cada categoría con cuántos temas la usan. Incluye las que quedaron vacías. */
  usoDeCategorias() {
    const cuenta = new Map(state.categorias.map(c => [c, 0]));
    for (const s of state.songs) {
      const c = s.categoria;
      if (c) cuenta.set(c, (cuenta.get(c) || 0) + 1);
    }
    return [...cuenta.entries()].map(([categoria, temas]) => ({
      categoria, temas, enLaLista: state.categorias.includes(categoria),
    }));
  },

  /**
   * Saca una categoría de la lista. Solo si no la usa ningún tema.
   *
   * Hay que borrarla en la base explícitamente: `guardar_catalogo` solo
   * agrega categorías, nunca saca las que faltan, así que sacarla del
   * array local no alcanza — al refrescar volvía.
   */
  async quitarCategoria(categoria) {
    if (state.songs.some(s => s.categoria === categoria)) {
      return { ok: false, motivo: 'todavía hay temas en esa categoría' };
    }
    if (!state.categorias.includes(categoria)) {
      return { ok: false, motivo: 'no estaba en la lista' };
    }

    if (driver.borrarCategoria) {
      try {
        await driver.borrarCategoria(categoria);
      } catch (e) {
        return { ok: false, motivo: e.message };
      }
    }

    state.categorias = state.categorias.filter(c => c !== categoria);
    touch();
    return { ok: true };
  },

  /* ============================================================
     Duplicados
     ------------------------------------------------------------
     Importar una planilla con el artista, cuando el tema ya estaba
     cargado sin artista, dejaba dos filas del mismo tema. Esto los
     junta en uno.

     La regla es estricta a propósito: mismo título Y (mismo artista
     o uno de los dos vacío). "Crazy" de Aerosmith y "Crazy" de
     Gnarls Barkley NO son el mismo tema y no se tocan.
     ============================================================ */

  /** Qué tan completo está un tema: gana el que más sabe. */
  _riqueza(s) {
    let n = 0;
    for (const c of ['artista', 'categoria', 'bpm', 'franja', 'anio', 'cifraUrl', 'notas']) {
      if (s[c] !== '' && s[c] != null) n++;
    }
    for (const c of ['cantantes', 'patches', 'invitados']) n += (s[c] || []).length ? 1 : 0;
    return n;
  },

  /** Los grupos de duplicados, sin tocar nada. Para poder mirarlos antes. */
  duplicados() {
    const porTitulo = new Map();
    for (const s of state.songs) {
      const t = norm(s.titulo);
      if (!t) continue;
      if (!porTitulo.has(t)) porTitulo.set(t, []);
      porTitulo.get(t).push(s);
    }

    const grupos = [];
    for (const candidatos of porTitulo.values()) {
      if (candidatos.length < 2) continue;

      /* Los que tienen artista se agrupan por artista, y nada más.
         Los que no tienen se suman SOLO si para ese título hay un único
         artista posible: con dos o más no hay forma de saber a cuál
         pertenecen, y meterlos en cualquiera arrastraba a los otros.
         Ese era el bug: un tema sin artista hacía de puente y fusionaba
         "Crazy" de Aerosmith con "Crazy" de Gnarls Barkley. */
      const conArtista = candidatos.filter(x => norm(x.artista));
      const sinArtista = candidatos.filter(x => !norm(x.artista));
      const artistas = [...new Set(conArtista.map(x => norm(x.artista)))];

      const porArtista = new Map();
      for (const x of conArtista) {
        const k = norm(x.artista);
        if (!porArtista.has(k)) porArtista.set(k, []);
        porArtista.get(k).push(x);
      }
      /* los huérfanos solo se enganchan si no hay ambigüedad */
      if (artistas.length === 1 && sinArtista.length) {
        porArtista.get(artistas[0]).push(...sinArtista);
      } else if (!artistas.length && sinArtista.length > 1) {
        porArtista.set('', sinArtista);          // todos sin artista: son el mismo
      }

      for (const grupo of porArtista.values()) {
        if (grupo.length > 1) {
          /* se queda el que más historia tiene; a igualdad, el más completo */
          grupo.sort((x, y) =>
            (y.jams || []).length - (x.jams || []).length ||
            this._riqueza(y) - this._riqueza(x));
          grupos.push({ queda: grupo[0], sobran: grupo.slice(1) });
        }
      }
    }
    return grupos;
  },

  /** Junta los duplicados: completa el que queda y redirige las jams. */
  fusionarDuplicados() {
    const grupos = this.duplicados();
    let fusionados = 0;

    for (const { queda, sobran } of grupos) {
      for (const otro of sobran) {
        /* lo que el que queda no tiene y el otro sí, se lo lleva */
        for (const c of ['artista', 'categoria', 'bpm', 'bpmRaw', 'bpmFuente', 'franja',
                         'anio', 'cifraUrl', 'cifraArtista', 'cifraConfianza', 'notas', 'letra', 'letraUrl']) {
          if ((queda[c] === '' || queda[c] == null) && otro[c] !== '' && otro[c] != null) queda[c] = otro[c];
        }
        for (const c of ['cantantes', 'patches', 'invitados', 'jams']) {
          queda[c] = [...new Set([...(queda[c] || []), ...(otro[c] || [])])];
        }

        /* las jams que apuntaban al que se va, ahora apuntan al que queda */
        for (const j of state.jams) {
          for (const it of j.items || []) {
            if (it.songId === otro.id) it.songId = queda.id;
            if (it.tipo === 'medley') {
              for (const m of it.songs || []) if (m.songId === otro.id) m.songId = queda.id;
            }
          }
        }

        state.songs = state.songs.filter(s => s.id !== otro.id);
        fusionados++;
      }
    }

    if (fusionados) touch();
    return { grupos: grupos.length, fusionados };
  },

  /** Busca un tema por título (+ artista opcional). Devuelve el más parecido o null. */
  matchSong(titulo, artista = '') {
    const nt = norm(titulo), na = norm(artista);
    if (!nt) return null;
    let exact = state.songs.find(s => norm(s.titulo) === nt && (!na || norm(s.artista) === na));
    if (exact) return exact;
    exact = state.songs.find(s => norm(s.titulo) === nt);
    if (exact) return exact;
    // contiene
    const cands = state.songs.filter(s => norm(s.titulo).includes(nt) || nt.includes(norm(s.titulo)));
    if (!cands.length) return null;
    if (na) {
      const byArt = cands.find(s => norm(s.artista).includes(na) || na.includes(norm(s.artista)));
      if (byArt) return byArt;
    }
    return cands.sort((a, b) => a.titulo.length - b.titulo.length)[0];
  },

  /** Búsqueda para autocompletar: prioriza el que empieza igual. */
  searchSongs(q, limit = 12) {
    const n = norm(q);
    if (!n) return [];
    const terms = n.split(' ');
    const scored = [];
    for (const s of state.songs) {
      const t = norm(s.titulo), a = norm(s.artista);
      const hay = t + ' ' + a;
      if (!terms.every(term => hay.includes(term))) continue;
      let score = 0;
      if (t === n) score = 100;
      else if (t.startsWith(n)) score = 80;
      else if (t.includes(n)) score = 60;
      else if (a.startsWith(n)) score = 45;
      else if (a.includes(n)) score = 35;
      else score = 20;
      score += Math.min((s.jams || []).length, 10); // los más tocados primero
      scored.push({ s, score });
    }
    return scored.sort((x, y) => y.score - x.score).slice(0, limit).map(x => x.s);
  },

  /* ---------- cantantes / músicos ---------- */
  addCantante(data) {
    const c = {
      id: uid('cant'), nombre: '', temas: 0, jams: 0, categorias: [],
      rol: 'voz', activo: true, contacto: '', notas: '', ...data,
    };
    state.cantantes.push(c);
    touch();
    return c;
  },
  updateCantante(id, patch) {
    const c = this.cantante(id) || state.musicos.find(m => m.id === id);
    if (!c) return null;
    Object.assign(c, patch); touch(); return c;
  },
  removeCantante(id) {
    state.cantantes = state.cantantes.filter(c => c.id !== id);
    state.musicos = state.musicos.filter(m => m.id !== id);
    touch();
  },
  addMusico(data) {
    const m = { id: uid('mus'), nombre: '', temas: 0, jams: 0, instrumentos: [], rol: 'instrumento', activo: true, contacto: '', notas: '', ...data };
    state.musicos.push(m); touch(); return m;
  },

  /* ---------- jams ---------- */
  createJam(data = {}) {
    const jam = {
      nombre: '', fecha: '', hora: '', lugar: LUGAR_POR_DEFECTO,
      ensayos: [], musicos: [], items: [], notas: '',
      historica: false,
      ...data,
      creada: new Date().toISOString(),
    };
    jam.id = uid('jam');   // siempre nuevo, aunque `data` venga de una jam clonada
    state.jams.unshift(jam);
    touch();
    return jam;
  },

  updateJam(id, patch) {
    const j = this.jam(id);
    if (!j) return null;
    Object.assign(j, patch);
    // Si la fecha quedó en el pasado, los temas de la lista cuentan como
    // tocados: eso lo resuelve la base al guardar (guardar_jam), y el
    // historial de cada tema sale de la vista song_jam.
    touch();
    return j;
  },

  removeJam(id) {
    state.jams = state.jams.filter(j => j.id !== id);
    touch();
  },

  duplicateJam(id) {
    const j = this.jam(id);
    if (!j) return null;
    return this.createJam({
      ...structuredClone(j),
      nombre: j.nombre + ' (copia)',
      historica: false, fecha: '',
      cerrada: false, codigo: '',   // la copia nace abierta: para eso se duplica
    });
  },

  /** Guarda cambios hechos directamente sobre objetos del estado. */
  commit() { touch(); },

  /* ---------- import / export ---------- */
  exportJSON() {
    return JSON.stringify({ app: 'jamportal', version: 1, exportado: new Date().toISOString(), ...state }, null, 1);
  },

  async importJSON(text) {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.songs)) throw new Error('El archivo no tiene un array "songs".');
    state = {
      version: data.version || 1,
      songs: data.songs,
      cantantes: data.cantantes || [],
      musicos: data.musicos || [],
      jams: data.jams || data.jamsHistoricas || [],
      categorias: data.categorias || state.categorias,
      porConfirmar: data.porConfirmar || [],
    };
    await driver.write(state);
    emit();
  },

  /** Importa filas {titulo, artista, ...} fusionando con lo existente. */
  importSongRows(rows) {
    let nuevas = 0, actualizadas = 0;
    for (const r of rows) {
      if (!r.titulo) continue;
      const found = this.matchSong(r.titulo, r.artista);
      /* Si el que está en la base no tiene artista y el que llega sí, es el
         mismo tema al que le venís a completar el dato — siempre que el
         título coincida exacto. Sin esto se creaba un duplicado en vez de
         completarlo, que es justo lo contrario de lo que uno quiere al
         importar una planilla con los datos que faltaban. */
      const completaElArtista = found && !norm(found.artista) && norm(r.artista)
        && norm(found.titulo) === norm(r.titulo);
      if (found && (completaElArtista || norm(found.artista) === norm(r.artista || found.artista))) {
        Object.assign(found, Object.fromEntries(Object.entries(r).filter(([, v]) => v !== '' && v != null)));
        if (found.bpm) found.franja = found.franja || franjaDeBpm(found.bpm);
        actualizadas++;
      } else {
        state.songs.push({
          id: uid('song'), titulo: '', artista: '', categoria: state.categorias[0],
          bpm: null, bpmRaw: '', franja: null, cantantes: [], patches: [], invitados: [], jams: [], anio: null, album: '', albumId: null, cover: '',
          notas: '', origen: 'import', ...r,
          franja: r.franja || franjaDeBpm(r.bpm),
        });
        nuevas++;
      }
    }
    state.songs.sort((a, b) => a.artista.localeCompare(b.artista) || a.titulo.localeCompare(b.titulo));
    touch();
    return { nuevas, actualizadas };
  },

};
