/* ============================================================
   magiclist.js — el generador de listas, compartido
   ------------------------------------------------------------
   Lo usan el editor de una jam (pestaña MagicList) y el paso 4
   de "Armar nueva Jam", con los mismos filtros y la misma lógica.
   ============================================================ */

import { store, norm } from './store.js';
import { h, field, toast, catCorta, grupoPorcentajes } from './ui.js';
import { temasDeArtista, sugerirCategoria, buscarEnWeb } from './lookup.js';
import { buscarLetra } from './letras.js';

/* Presets de energía: reparten el % de cada franja y en qué momento va. */
export const PRESETS = {
  progresiva: { pct: { low: 25, mid: 40, high: 35 }, momento: { low: 'principio', mid: 'medio', high: 'final' } },
  montania:   { pct: { low: 25, mid: 40, high: 35 }, momento: { low: 'repartido', mid: 'repartido', high: 'repartido' } },
  alpalo:     { pct: { low: 10, mid: 30, high: 60 }, momento: { low: 'principio', mid: 'principio', high: 'repartido' } },
  bajon:      { pct: { low: 55, mid: 35, high: 10 }, momento: { low: 'repartido', mid: 'repartido', high: 'medio' } },
};

/* Dónde cae cada franja dentro de la lista. Ya no se elige en la pantalla:
   se usa el reparto progresivo (lentos primero, rápidos sobre el final). */
const MOMENTOS_VALIDOS = ['principio', 'medio', 'final', 'repartido'];

export function estadoInicial() {
  return {
    // % por categoría: { 'Internacional…': 40, … }. Todo en 0 = sin preferencia.
    categorias: {},
    // sin cuota por franja: entra lo que haya. Los `momentos` igual se usan para
    // ordenar la lista (lentos primero, rápidos sobre el final).
    franjas: {},
    momentos: { ...PRESETS.progresiva.momento },
    historial: 'tocados',   // 'tocados' | 'nuevos' | 'mix' | 'tematica'
    tematica: '',           // en 'tematica': lo que escribís vos
    mix: { nuevos: 30 },    // en 'mix': % para estrenar; el resto, ya tocados
    cantidad: 18,
    evitarRepetirArtista: true,
  };
}

/**
 * Cuántos lugares le tocan a cada clave según su porcentaje.
 * Los % son literales: si sumás 60, el 40 restante queda libre y lo llena
 * cualquier tema. Nunca se normaliza para arriba.
 */
function cuotas(pcts, total) {
  const claves = Object.keys(pcts).filter(k => (pcts[k] || 0) > 0);
  const suma = claves.reduce((n, k) => n + pcts[k], 0);
  if (!suma) return null;                          // sin preferencia declarada

  const declarado = Math.min(total, Math.round((suma / 100) * total));
  const exactas = claves.map(k => ({ k, v: (pcts[k] / 100) * total }));
  const out = {};
  let asignado = 0;
  exactas.forEach(({ k, v }) => { out[k] = Math.floor(v); asignado += out[k]; });

  // los lugares que sobran van a los que quedaron con mayor resto
  exactas.sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)));
  for (let i = 0; asignado < declarado; i++, asignado++) out[exactas[i % exactas.length].k]++;
  return out;
}

/* ---------- filtros (UI) ---------- */
export function filtrosMagicList(gen, onCambio) {
  const btn = (label, on, onclick) => h('button' + (on ? '.on' : ''), { onclick }, label);

  const totalCats = h('span.pct-total');
  function actualizarTotal() {
    const c = Object.values(gen.categorias).reduce((a, b) => a + (b || 0), 0);
    totalCats.textContent = '';
    return c;
  }

  const cont = h('div.gen-opts', {},
    /* ---- categorías ---- */
    h('div.opt-group', {}, h('span', {}, 'Categorías'),
      grupoPorcentajes({
        objeto: gen.categorias,
        filas: store.categorias.map(c => ({ clave: c, etiqueta: catCorta(c), titulo: c })),
      }),
      h('button.btn.xs.ghost', { style: { marginTop: '8px' },
        onclick: () => { store.categorias.forEach(c => gen.categorias[c] = 0); onCambio(); } }, 'Limpiar'))
  );
  actualizarTotal();

  return h('div', {}, cont, h('div.gen-opts', { style: { marginTop: '13px' } },
    h('div.opt-group', {}, h('span', {}, 'Historial'),
      h('div.seg', {},
        btn('Ya tocados', gen.historial === 'tocados', () => { gen.historial = 'tocados'; onCambio(); }),
        btn('🌐 Nunca tocados', gen.historial === 'nuevos', () => { gen.historial = 'nuevos'; onCambio(); }),
        btn('⇄ Mix', gen.historial === 'mix', () => { gen.historial = 'mix'; onCambio(); }),
        btn('🎯 Temática', gen.historial === 'tematica', () => { gen.historial = 'tematica'; onCambio(); })),

      gen.historial === 'tematica'
        ? h('div', { style: { marginTop: '10px' } },
            h('input', {
              type: 'text', value: gen.tematica, placeholder: 'sale el sol, verano, amanecer…',
              style: { width: '100%' },
              oninput: e => { gen.tematica = e.target.value; },
            }),
            h('div.dim', { style: { fontSize: '11px', marginTop: '6px', lineHeight: '1.45' } },
              'Busca temas nuevos por título y después mira la letra de cada uno para ver si habla de eso. ',
              h('b', {}, 'Separá con comas las palabras de la temática'),
              ': ninguna base gratis busca adentro de las letras, así que el hallazgo sale del título — ',
              'cuantas más palabras le des, más lejos llega.'))
        : null,

      gen.historial === 'nuevos'
        ? h('div.dim', { style: { fontSize: '11px', marginTop: '6px', lineHeight: '1.45' } },
            'Busca en internet temas de las bandas que ya funcionan en la jam y todavía no tocaron. Los que elijas se dan de alta en DBSongs.')
        : null,

      gen.historial === 'mix'
        ? h('div', { style: { marginTop: '10px' } },
            grupoPorcentajes({
              objeto: gen.mix,
              filas: [{ clave: 'nuevos', etiqueta: '🌐 Para estrenar' }],
              textoLibre: libre => `${100 - libre}% nuevos · ${libre}% de lo que ya tocaron`,
            }))
        : null),

    h('div.row', {},
      field('Cantidad de temas', h('input', {
        type: 'number', min: 4, max: 60, value: gen.cantidad,
        oninput: e => gen.cantidad = parseInt(e.target.value, 10) || 18,
      }))),

    h('div.seg', {},
      btn('Sin repetir artista', gen.evitarRepetirArtista,
        () => { gen.evitarRepetirArtista = !gen.evitarRepetirArtista; onCambio(); })),
  ));
}

/* ============================================================
   Selección respetando los porcentajes
   ------------------------------------------------------------
   Armamos N "casilleros", cada uno con la categoría y la franja
   que le tocan según los %, y a cada casillero le buscamos un
   tema. Si no hay ninguno que cumpla las dos condiciones,
   aflojamos primero la franja y después la categoría, así la
   lista siempre sale completa.
   ============================================================ */
function armarCasilleros(gen) {
  const cCat = cuotas(gen.categorias, gen.cantidad);
  const cFra = cuotas(gen.franjas, gen.cantidad);

  const lista = clave => {
    if (!clave) return Array(gen.cantidad).fill(null);
    const out = [];
    for (const [k, n] of Object.entries(clave)) for (let i = 0; i < n; i++) out.push(k);
    while (out.length < gen.cantidad) out.push(null);
    return out.sort(() => Math.random() - 0.5);
  };

  const cats = lista(cCat), fras = lista(cFra);
  return cats.map((cat, i) => ({ cat, franja: fras[i] }));
}

function elegirPara(casillero, pool, usados, gen, artistas) {
  const sirve = (s, exigirCat, exigirFranja) => {
    if (usados.has(s.id)) return false;
    if (exigirCat && casillero.cat && s.categoria !== casillero.cat) return false;
    if (exigirFranja && casillero.franja && (s.franja || 'mid') !== casillero.franja) return false;
    if (gen.evitarRepetirArtista && artistas.has(s.artista)) return false;
    return true;
  };
  // 1) cat + franja · 2) solo cat · 3) solo franja · 4) lo que haya
  const elegida = pool.find(s => sirve(s, true, true))
      || pool.find(s => sirve(s, true, false))
      || pool.find(s => sirve(s, false, true))
      || pool.find(s => sirve(s, false, false));
  if (elegida) return elegida;

  /* Aflojar los filtros de mezcla es aceptable; repetir artista no, si
     pediste que no se repita. Antes esta última pasada lo ignoraba y la
     lista salía con el mismo artista tres veces —sobre todo con los temas
     de internet, que vienen de un puñado de bandas. Mejor traer menos. */
  if (gen.evitarRepetirArtista) return null;
  return pool.find(s => !usados.has(s.id));
}

function seleccionar(pool, gen, yaUsados = null, yaArtistas = null) {
  const casilleros = armarCasilleros(gen);
  /* En el mix esto se llama dos veces —tocados y estrenos—: si cada tanda
     lleva su propia cuenta de artistas, el mismo entra una vez por cada
     una. Por eso los conjuntos se pueden pasar de afuera. */
  const usados = yaUsados || new Set();
  const artistas = yaArtistas || new Set();
  const elegidas = [];

  for (const c of casilleros) {
    const s = elegirPara(c, pool, usados, gen, artistas);
    if (!s) break;
    usados.add(s.id); artistas.add(s.artista);
    elegidas.push(s);
  }
  return elegidas;
}

/* ============================================================
   Orden según en qué momento va cada franja
   ============================================================ */
export function ordenarPorMomento(songs, momentos) {
  const zonas = { principio: [], medio: [], final: [], repartido: [] };
  songs.forEach(s => {
    const m = momentos[s.franja || 'mid'] || 'repartido';
    zonas[m].push(s);
  });

  // dentro de cada zona, de menos a más pulso
  const porBpm = arr => arr.sort((a, b) => (a.bpm || 110) - (b.bpm || 110));
  porBpm(zonas.principio); porBpm(zonas.medio); porBpm(zonas.final);

  const base = [...zonas.principio, ...zonas.medio, ...zonas.final];
  const sueltos = zonas.repartido.sort(() => Math.random() - 0.5);
  if (!sueltos.length) return base;
  if (!base.length) return sueltos;

  // los "repartidos" se intercalan parejo a lo largo de la lista
  const total = base.length + sueltos.length;
  const cada = total / sueltos.length;
  const out = [];
  let iBase = 0, iSuelto = 0;
  for (let pos = 0; pos < total; pos++) {
    if (iSuelto < sueltos.length && pos >= Math.floor(iSuelto * cada + cada / 2)) out.push(sueltos[iSuelto++]);
    else if (iBase < base.length) out.push(base[iBase++]);
    else if (iSuelto < sueltos.length) out.push(sueltos[iSuelto++]);
  }
  return out;
}

/* ============================================================
   Pool por temática
   ------------------------------------------------------------
   Ninguna base gratis busca adentro de las letras, así que el
   hallazgo sale del título: se buscan los términos que escribiste
   y lo que aparece se contrasta contra la letra. Los que además
   la nombran en la letra van primero.
   ============================================================ */
function terminosDe(tematica) {
  return (tematica || '')
    .split(/[,;]+/)
    .map(t => t.trim())
    .filter(t => t.length >= 3)
    .slice(0, 6);
}

/** ¿La letra (o el título) nombra alguno de los términos? */
function nombraLaTematica(texto, terminos) {
  const t = norm(texto || '');
  return terminos.some(x => t.includes(norm(x)));
}

async function poolTematica(gen, excluir, btn) {
  const terminos = terminosDe(gen.tematica);
  if (!terminos.length) return { pool: [], sinTerminos: true };

  const enBase = new Set(store.songs.map(s => norm(s.titulo) + '|' + norm(s.artista)));
  const textoOriginal = btn ? btn.textContent : '';

  /* Un montón por término, para después repartir parejo entre todos */
  const porTermino = [];
  const titulosVistos = new Set();

  for (let i = 0; i < terminos.length; i++) {
    if (btn) btn.textContent = `🌐 buscando "${terminos[i]}"…`;
    let res = [];
    /* pedimos de más: al quedarnos con un tema por título, la mitad se cae */
    try { res = await buscarEnWeb(terminos[i], 25); } catch { /* seguimos con los otros */ }

    const míos = [];
    for (const r of res) {
      if (!r.titulo || !r.artista) continue;
      if (enBase.has(norm(r.titulo) + '|' + norm(r.artista))) continue;   // la gracia es que sean nuevos
      /* Buscando "lluvia" vuelven ocho temas llamados Lluvia de ocho
         artistas distintos. Uno por título alcanza: el resto es ruido. */
      const soloTitulo = norm(r.titulo);
      if (titulosVistos.has(soloTitulo)) continue;
      titulosVistos.add(soloTitulo);
      míos.push(r);
    }
    porTermino.push(míos);
  }

  /* Intercalados: si pediste tres temáticas, que aparezcan las tres y no
     quince de la primera. */
  const candidatos = [];
  for (let v = 0; v < 12; v++) {
    for (const lista of porTermino) if (lista[v]) candidatos.push(lista[v]);
  }

  /* Miramos la letra de los primeros: es lo que más tarda, así que se
     acota. Los que la nombran en la letra suben; el resto queda por el
     título, que ya matcheó al buscarlos. */
  const aMirar = candidatos.slice(0, 16);
  const conLetra = new Set();
  for (let i = 0; i < aMirar.length; i += 3) {
    const tanda = aMirar.slice(i, i + 3);
    if (btn) btn.textContent = `📖 leyendo letras ${Math.min(i + 3, aMirar.length)}/${aMirar.length}…`;
    const letras = await Promise.all(tanda.map(c => buscarLetra(c).catch(() => ({ ok: false }))));
    tanda.forEach((c, k) => {
      if (letras[k].ok && nombraLaTematica(letras[k].texto, terminos)) conLetra.add(c);
    });
  }
  if (btn) btn.textContent = textoOriginal;

  const aSong = (r, enLaLetra) => ({
    id: 'web-' + norm(r.artista).replace(/ /g, '-') + '--' + norm(r.titulo).replace(/ /g, '-'),
    titulo: r.titulo, artista: r.artista,
    categoria: sugerirCategoria(r.genero, r.artista),
    franja: null, bpm: null, jams: [], cantantes: [],
    esWeb: true, enLaLetra,
    datos: { titulo: r.titulo, artista: r.artista, categoria: sugerirCategoria(r.genero, r.artista),
             anio: r.anio, generoWeb: r.genero, origen: 'web:tematica' },
  });

  const pool = [
    ...aMirar.filter(c => conLetra.has(c)).map(c => aSong(c, true)),
    ...candidatos.filter(c => !conLetra.has(c)).map(c => aSong(c, false)),
  ];

  return { pool, enLaLetra: conLetra.size, mirados: aMirar.length };
}

/**
 * Arma la propuesta.
 * @param gen      estado de los filtros
 * @param excluir  Set de songIds que ya están en la lista
 * @param btn      botón opcional, para mostrar el progreso de la búsqueda web
 */
/** Pool de lo que ya se tocó. */
function poolTocados(excluir) {
  return store.repertorio
    .filter(s => (s.jams || []).length && !excluir.has(s.id))
    .sort(() => Math.random() - 0.5);
}

/**
 * Pool de lo que nunca se tocó: lo que hay en DBSongs sin tocar más lo que
 * encontramos en internet entre las bandas que ya funcionan en la jam.
 */
async function poolNuevos(gen, excluir, btn) {
  const deLaBase = store.repertorio
    .filter(s => !(s.jams || []).length && !excluir.has(s.id))
    .sort(() => Math.random() - 0.5);

  // solo consultamos bandas de las categorías que pesan en la mezcla
  const catsPedidas = Object.keys(gen.categorias).filter(c => gen.categorias[c] > 0);
  const bandas = [...new Set(store.repertorio
    .filter(s => (s.jams || []).length && (!catsPedidas.length || catsPedidas.includes(s.categoria)))
    .map(s => s.artista))].sort(() => Math.random() - 0.5);

  const enBase = new Set(store.songs.map(s => norm(s.titulo) + '|' + norm(s.artista)));
  const delaWeb = [];
  /* Cada banda consultada es un artista distinto disponible. Si pediste
     15 temas sin repetir artista, con 9 bandas no alcanza ni queriendo:
     miramos unas cuantas más. */
  const cuantasBandas = gen.evitarRepetirArtista
    ? Math.min(bandas.length, Math.max(9, (gen.cantidad || 0) + 4))
    : Math.min(9, bandas.length);
  const aConsultar = bandas.slice(0, cuantasBandas);
  const textoOriginal = btn ? btn.textContent : '';

  for (let i = 0; i < aConsultar.length; i += 3) {      // de a tres en paralelo
    const tanda = aConsultar.slice(i, i + 3);
    if (btn) btn.textContent = `🌐 ${Math.min(i + 3, aConsultar.length)}/${aConsultar.length}…`;
    const respuestas = await Promise.all(tanda.map(b => temasDeArtista(b, 10)));

    tanda.forEach((banda, k) => {
      const categoria = sugerirCategoria('', banda);
      for (const r of respuestas[k]) {
        const clave = norm(r.titulo) + '|' + norm(banda);
        if (!r.titulo || enBase.has(clave)) continue;
        enBase.add(clave);
        delaWeb.push({
          id: 'web-' + norm(banda).replace(/ /g, '-') + '--' + norm(r.titulo).replace(/ /g, '-'),
          titulo: r.titulo, artista: banda, categoria,
          franja: null, bpm: null, jams: [], cantantes: [],
          esWeb: true,
          datos: { titulo: r.titulo, artista: banda, categoria, anio: r.anio, generoWeb: r.genero, origen: 'web:itunes' },
        });
      }
    });
  }
  if (btn) btn.textContent = textoOriginal;
  /* Vienen apilados banda por banda, y como se elige el primero que sirve,
     sin mezclar salían diez temas seguidos del mismo artista. */
  delaWeb.sort(() => Math.random() - 0.5);
  return { pool: [...delaWeb, ...deLaBase], deInternet: delaWeb.length };
}

/**
 * Arma la propuesta.
 * @param gen      estado de los filtros
 * @param excluir  Set de songIds que ya están en la lista
 * @param btn      botón opcional, para mostrar el progreso de la búsqueda web
 */
export async function generarPropuesta(gen, excluir = new Set(), btn = null) {
  const ordenar = temas => ordenarPorMomento(temas, gen.momentos);

  /* Si salieron menos de los pedidos por no repetir artista, hay que
     decirlo: si no, parece que el generador se quedó corto porque sí. */
  const avisarSiFaltan = res => {
    if (gen.evitarRepetirArtista && res.length && res.length < gen.cantidad) {
      toast(`Salieron ${res.length} de ${gen.cantidad}: no hay más artistas distintos para completar`);
    }
    return res;
  };

  if (gen.historial === 'tocados') {
    const res = ordenar(seleccionar(poolTocados(excluir), gen));
    if (!res.length) toast('No hay temas tocados para esa mezcla', 'err');
    return avisarSiFaltan(res);
  }

  if (gen.historial === 'tematica') {
    const { pool, sinTerminos, enLaLetra, mirados } = await poolTematica(gen, excluir, btn);
    if (sinTerminos) { toast('Escribí la temática que querés buscar', 'err'); return []; }
    const res = ordenar(seleccionar(pool, gen));
    if (!res.length) toast(`No encontré temas sobre «${gen.tematica}»`, 'err');
    else toast(`${enLaLetra} de los ${mirados} que miré la nombran en la letra`, enLaLetra ? 'ok' : '');
    return avisarSiFaltan(res);
  }

  if (gen.historial === 'nuevos') {
    const { pool, deInternet } = await poolNuevos(gen, excluir, btn);
    const res = ordenar(seleccionar(pool, gen));
    if (!res.length) toast('No encontré temas nuevos con esos filtros', 'err');
    else if (deInternet) toast('Los temas de internet no traen BPM: se reparten como franja media');
    return avisarSiFaltan(res);
  }

  /* mix: el % elegido va a estrenos y el resto sale del repertorio tocado */
  const nNuevos = Math.round(((gen.mix.nuevos || 0) / 100) * gen.cantidad);
  const nTocados = gen.cantidad - nNuevos;

  const usados = new Set(), artistas = new Set();

  const conocidos = nTocados
    ? seleccionar(poolTocados(excluir), { ...gen, cantidad: nTocados }, usados, artistas)
    : [];

  let estrenos = [];
  if (nNuevos) {
    const { pool } = await poolNuevos(gen, excluir, btn);
    estrenos = seleccionar(pool, { ...gen, cantidad: nNuevos }, usados, artistas);
  }

  const res = ordenar([...conocidos, ...estrenos]);
  if (!res.length) toast('No salió nada con esa mezcla', 'err');
  else toast(`${conocidos.length} ya tocados + ${estrenos.length} para estrenar`, 'ok');
  return res;
}

/** Convierte la propuesta en ítems de setlist, dando de alta lo que vino de la web. */
export function propuestaAItems(propuesta) {
  return propuesta.map(s => ({
    tipo: 'song',
    songId: s.esWeb ? store.addSong(s.datos).id : s.id,
    cantantes: [], notas: '',
  }));
}
