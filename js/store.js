/* ============================================================
   store.js — capa de datos
   ------------------------------------------------------------
   Toda la app habla con `store`, nunca con el almacenamiento
   directo. Hay dos drivers con la misma interfaz (read / write):
   `LocalDriver` (este navegador) y `PostgresDriver` (base
   compartida). Se elige al arrancar y ninguna vista se entera.
   ============================================================ */

const KEY = 'jamportal.v1';
const KEY_NUBE = 'jamportal.nube';   // { url, key } de la base compartida
const LUGAR_POR_DEFECTO = 'Portal';   // casi todas las jams son ahí
const SEED_URL = 'data/seed.json';

import { NUBE } from './config.js';

/* ---------- driver: localStorage ---------- */
class LocalDriver {
  constructor(key) { this.key = key; this.name = 'local'; }

  async read() {
    const raw = localStorage.getItem(this.key);
    if (!raw) return null;
    try { return JSON.parse(raw); }
    catch (e) { console.error('Estado corrupto en localStorage', e); return null; }
  }

  async write(state) {
    localStorage.setItem(this.key, JSON.stringify(state));
  }

  async clear() { localStorage.removeItem(this.key); }
}

/* ---------- estado ----------
   El driver se elige al arrancar: si hay una base compartida configurada
   vamos contra ella, y si no, contra el navegador. */
let driver = new LocalDriver(KEY);
let sondeo = null;
let auth = null;      // la sesión, solo cuando trabajamos contra la nube
let sinPermiso = false;  // entraste bien, pero tu mail no está en `miembro`

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
let alCaerNube = null;
let alChocar = null;
let rt = null;                  // el websocket, si levantó
let ultimoSondeo = 0;

export function alHaberCambiosAjenos(fn) { alSincronizar = fn; }
export function alFallarNube(fn) { alCaerNube = fn; }
/** Se llama cuando otro guardó la misma jam mientras vos la editabas. */
export function alChocarConOtro(fn) { alChocar = fn; }
export function realtimeConectado() { return !!(rt && rt.conectado); }
function avisarCaida(msg) { if (alCaerNube) alCaerNube(msg); }

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
  get driverName() { return driver.name; },
  get enLaNube() { return driver.name === 'nube'; },

  /** La sesión, si estamos contra la nube. */
  get auth() { return auth; },
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

    // Marca explícita de "quiero trabajar solo en este navegador". Hace
    // falta porque con una base de fábrica no alcanza con borrar la
    // config: volvería a caer en ella en el próximo arranque.
    if (propia && propia.local) return null;

    if (propia && propia.url && propia.key) return propia;
    return (NUBE && NUBE.url && NUBE.key) ? NUBE : null;
  },

  /** ¿Está apuntando a otra base distinta de la de fábrica? */
  get nubePropia() {
    const c = this.configNube();
    return !!(c && NUBE && c.url !== NUBE.url);
  },

  /**
   * Conecta la app a una base compartida. Si `subirLocal`, empuja lo que hay
   * en este navegador como contenido inicial (para el primero que conecta).
   */
  async conectarNube({ url, key }, { subirLocal = false } = {}) {
    const { PostgresDriver } = await import('./drivers/postgres.js');
    const { Auth } = await import('./auth.js');
    auth = new Auth({ url, key });
    const nuevo = new PostgresDriver({ url, key, auth });
    const filas = await nuevo.probar();          // valida credenciales y permisos

    if (!filas || subirLocal) {
      await nuevo.write(state);                  // sembramos la base
    } else {
      const remoto = await nuevo.read();
      if (remoto) state = { ...state, ...remoto };
    }

    localStorage.setItem(KEY_NUBE, JSON.stringify({ url, key }));
    driver = nuevo;
    arrancarSondeo();
    emit();
    return state;
  },

  /** Vuelve a trabajar solo en este navegador (no borra nada de la nube). */
  desconectarNube() {
    localStorage.setItem(KEY_NUBE, JSON.stringify({ local: true }));
    if (auth) { auth.cerrarSesion(); auth = null; }
    detenerSondeo();
    driver = new LocalDriver(KEY);
    driver.write(state);
    emit();
  },

  /** Deshace el "trabajar solo acá" y vuelve a la base de la banda. */
  volverALaNube() {
    localStorage.removeItem(KEY_NUBE);
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
    if (driver.name !== 'nube') return false;
    const remoto = await driver.read();
    if (!remoto) return false;
    state = { ...state, ...remoto };
    emit();
    return true;
  },

  async init() {
    const nube = this.configNube();
    if (nube) {
      try {
        const { PostgresDriver } = await import('./drivers/postgres.js');
        const { Auth } = await import('./auth.js');
        auth = new Auth(nube);
        driver = new PostgresDriver({ ...nube, auth });
        const remoto = await driver.read();
        if (remoto) {
          state = { ...state, ...remoto };
          arrancarSondeo();
          return state;
        }
        // la base está vacía: la sembramos con el repertorio base
        await this.loadSeed();
        arrancarSondeo();
        return state;
      } catch (e) {
        if (e.sinPermiso) {
          // Acá no hay a qué caer. Los datos de este navegador no son los
          // de la banda, y sembrarlos pisaría la base compartida. Dejamos
          // el estado vacío y que la app explique qué pasa.
          sinPermiso = true;
          return state;
        }
        console.error('No se pudo usar la base compartida, sigo local:', e.message);
        driver = new LocalDriver(KEY);
        avisarCaida(e.message);
      }
    }

    const saved = await driver.read();
    if (saved && Array.isArray(saved.songs) && saved.songs.length) {
      state = { ...state, ...saved };
      const nuevo = await fetch(SEED_URL).then(r => r.ok ? r.json() : null).catch(() => null);
      if (nuevo && (nuevo.version || 1) > (state.version || 1)) await this.actualizarSeed(nuevo);
    } else {
      await this.loadSeed();
    }
    return state;
  },

  /**
   * Trae un repertorio nuevo sin pisar el trabajo propio: conserva las jams
   * que armaste, los temas que cargaste a mano y las ideas, y solo reemplaza
   * la parte que viene del documento original.
   */
  async actualizarSeed(seed = null) {
    if (!seed) {
      const res = await fetch(SEED_URL);
      if (!res.ok) throw new Error('No se pudo leer ' + SEED_URL);
      seed = await res.json();
    }

    const propias = state.jams.filter(j => !j.historica);
    const mios = state.songs.filter(s => s.origen !== 'import' || s.esIdea);   // cargados por vos
    const nuevos = new Map((seed.songs || []).map(s => [s.id, s]));

    // los temas propios que no estén en el seed nuevo se conservan tal cual
    for (const s of mios) if (!nuevos.has(s.id)) nuevos.set(s.id, s);

    // y los que una jam tuya usa pero el seed nuevo ya no trae, también
    const usados = new Set(propias.flatMap(j => (j.items || []).flatMap(it =>
      it.tipo === 'medley' ? (it.songs || []).map(x => x.songId) : [it.songId])));
    const previos = new Map(state.songs.map(s => [s.id, s]));
    for (const id of usados) if (id && !nuevos.has(id) && previos.has(id)) nuevos.set(id, previos.get(id));

    // conservamos teléfono, mail y notas de las personas
    const personasViejas = new Map([...state.cantantes, ...state.musicos].map(p => [p.id, p]));
    const conservar = p => {
      const v = personasViejas.get(p.id);
      return v ? { ...p, telefono: v.telefono || '', email: v.email || '', notas: v.notas || '', activo: v.activo } : p;
    };

    state = {
      version: seed.version || 1,
      songs: [...nuevos.values()].sort((a, b) => a.artista.localeCompare(b.artista) || a.titulo.localeCompare(b.titulo)),
      cantantes: (seed.cantantes || []).map(conservar),
      musicos: (seed.musicos || []).map(conservar),
      jams: [...propias, ...(seed.jamsHistoricas || [])],
      categorias: seed.categorias || state.categorias,
      porConfirmar: seed.porConfirmar || [],
    };
    await driver.write(state);
    emit();
    return state;
  },

  /** Carga (o recarga) el repertorio base desde data/seed.json */
  async loadSeed() {
    const res = await fetch(SEED_URL);
    if (!res.ok) throw new Error('No se pudo leer ' + SEED_URL);
    const seed = await res.json();
    state = {
      version: seed.version || 1,
      songs: seed.songs || [],
      cantantes: seed.cantantes || [],
      musicos: seed.musicos || [],
      jams: (seed.jamsHistoricas || []).map(j => ({ ...j })),
      categorias: seed.categorias || [],
      porConfirmar: seed.porConfirmar || [],
    };
    await driver.write(state);
    emit();
    return state;
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
      cantantes: [], patches: [], invitados: [], jams: [], anio: null,
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
      if (found && norm(found.artista) === norm(r.artista || found.artista)) {
        Object.assign(found, Object.fromEntries(Object.entries(r).filter(([, v]) => v !== '' && v != null)));
        if (found.bpm) found.franja = found.franja || franjaDeBpm(found.bpm);
        actualizadas++;
      } else {
        state.songs.push({
          id: uid('song'), titulo: '', artista: '', categoria: state.categorias[0],
          bpm: null, bpmRaw: '', franja: null, cantantes: [], patches: [], invitados: [], jams: [], anio: null,
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

  async reset() { await driver.clear(); await this.loadSeed(); },
};
