/* ============================================================
   views/stats.js — los números del repertorio
   ------------------------------------------------------------
   Todo se calcula en vivo desde las jams y DBSongs: no hay nada
   precomputado que se pueda quedar viejo.

   La atribución por cantante sale de los items de cada jam (quién
   cantó qué en esa jam), no del agregado de la canción, que es
   menos preciso.
   ============================================================ */

import { store, norm, FRANJA_LABEL } from '../store.js';
import { h, frag, clear, catPill, catCorta, franjaDot, avatar, select } from '../ui.js';

/* ---------- helpers de dibujo ---------- */

/** Lista de barras horizontales: etiqueta, barra proporcional y número. */
function ranking(filas, { max, color = 'var(--acc)', unidad = '' } = {}) {
  const tope = max ?? Math.max(1, ...filas.map(f => f.valor));
  return h('div.rank', {}, filas.map(f =>
    h('div.rank-fila', { title: f.titulo || null },
      h('div.rank-etq', {}, f.etiqueta),
      h('div.rank-pista', {}, h('div.rank-barra', {
        style: { width: (f.valor / tope) * 100 + '%', background: f.color || color },
      })),
      h('div.rank-val', {}, f.valor + unidad))));
}

/** Una barra sola, partida en tramos de colores. */
function barraApilada(partes) {
  const total = partes.reduce((n, p) => n + p.valor, 0) || 1;
  return frag(
    h('div.apilada', {}, partes.filter(p => p.valor).map(p =>
      h('div', { style: { flex: p.valor, background: p.color }, title: `${p.etiqueta}: ${p.valor}` }))),
    h('div.apilada-leyenda', {}, partes.filter(p => p.valor).map(p =>
      h('span', {}, h('i', { style: { background: p.color } }),
        `${p.etiqueta} ${Math.round((p.valor / total) * 100)}%`))));
}

function tarjeta(titulo, bajada, contenido) {
  return h('div.card.stat-card', {},
    h('div.card-head', {}, h('h3', {}, titulo),
      bajada ? h('span.dim', { style: { fontSize: '11.5px' } }, bajada) : null),
    contenido);
}

const COLOR_CAT = c => c.match(/nacional|rioplatense/i) ? '#c79bff'
  : c.match(/latino|espa/i) ? '#ffab6b'
  : c.match(/cumbia|tropical/i) ? '#6fd99a' : '#7fb4ff';

/* ============================================================
   Vista
   ============================================================ */
export function vistaStats() {
  let alcance = 'todas';                 // 'todas' | 'historicas' | 'mias'
  const cont = h('div');

  function jamsElegidas() {
    if (alcance === 'historicas') return store.jams.filter(j => j.historica);
    if (alcance === 'mias') return store.jams.filter(j => !j.historica);
    return store.jams;
  }

  function pintar() {
    clear(cont);
    const jams = jamsElegidas();
    const songs = store.repertorio;

    /* ---------- recorremos las jams una sola vez ---------- */
    const vecesTema = new Map();         // songId → en cuántas jams sonó
    const porCantante = new Map();       // nombre → { temas, jams:Set, cats:Map }
    let totalTemas = 0, medleys = 0, breaks = 0, bloques = 0;

    for (const jam of jams) {
      for (const it of jam.items || []) {
        if (it.tipo === 'bloque') { bloques++; continue; }
        if (it.tipo === 'break') { breaks++; continue; }
        const sub = it.tipo === 'medley' ? (medleys++, it.songs || []) : [it];
        for (const x of sub) {
          const s = store.song(x.songId);
          if (!s) continue;
          totalTemas++;
          vecesTema.set(s.id, (vecesTema.get(s.id) || 0) + 1);
          for (const nombre of x.cantantes || []) {
            if (!porCantante.has(nombre)) porCantante.set(nombre, { temas: 0, jams: new Set(), cats: new Map() });
            const e = porCantante.get(nombre);
            e.temas++; e.jams.add(jam.id);
            e.cats.set(s.categoria, (e.cats.get(s.categoria) || 0) + 1);
          }
        }
      }
    }

    const distintos = vecesTema.size;
    const unaVez = [...vecesTema.values()].filter(n => n === 1).length;
    const conTempo = songs.filter(s => s.bpm);
    const sugeridos = conTempo.filter(s => s.bpmFuente === 'sugerido');
    const conCifra = songs.filter(s => s.cifraUrl);
    const sinTocar = songs.length - distintos;

    /* ---------- resumen ---------- */
    const resumen = h('div.stat-row', {},
      [['Jams', jams.length], ['Temas sonados', totalTemas],
       ['Distintos', distintos],
       ['Por jam', jams.length ? Math.round(totalTemas / jams.length) : 0],
       ['Cantantes', porCantante.size], ['Medleys', medleys]]
        .map(([et, v]) => h('div.stat', {}, h('b', {}, v), h('span', {}, et))));

    /* ---------- caballitos de batalla ---------- */
    const masTocados = [...vecesTema.entries()]
      .map(([id, n]) => ({ s: store.song(id), n })).filter(x => x.s)
      .sort((a, b) => b.n - a.n).slice(0, 12)
      .map(({ s, n }) => ({
        etiqueta: s.titulo, valor: n, titulo: `${s.titulo} — ${s.artista}`,
        color: COLOR_CAT(s.categoria),
      }));

    /* ---------- bandas ---------- */
    const porBanda = new Map();
    for (const [id, n] of vecesTema) {
      const s = store.song(id);
      if (s) porBanda.set(s.artista, (porBanda.get(s.artista) || 0) + n);
    }
    const bandas = [...porBanda.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([nombre, n]) => ({ etiqueta: nombre, valor: n }));

    /* ---------- cantantes ---------- */
    const cantantes = [...porCantante.entries()]
      .filter(([n]) => n.toLowerCase() !== 'todos')
      .sort((a, b) => b[1].temas - a[1].temas).slice(0, 14);

    const filaCantante = ([nombre, e]) => {
      const fuerte = [...e.cats.entries()].sort((a, b) => b[1] - a[1])[0];
      return h('div.cantante-fila', {},
        avatar(nombre),
        h('div', { style: { minWidth: 0, flex: 1 } },
          h('div', { style: { fontWeight: 600, fontSize: '13.5px' } }, nombre),
          h('div.dim', { style: { fontSize: '11px' } },
            `${e.temas} temas · ${e.jams.size} jam${e.jams.size > 1 ? 's' : ''}`)),
        fuerte ? h('span', { title: `Lo que más canta: ${fuerte[0]}` }, catPill(fuerte[0])) : null);
    };

    /* ---------- mezcla de categorías y franjas ---------- */
    const porCat = new Map(), porFranja = new Map();
    for (const [id, n] of vecesTema) {
      const s = store.song(id);
      if (!s) continue;
      porCat.set(s.categoria, (porCat.get(s.categoria) || 0) + n);
      const f = s.franja || 'sin';
      porFranja.set(f, (porFranja.get(f) || 0) + n);
    }

    const mezclaCat = store.categorias.map(c => ({
      etiqueta: catCorta(c), valor: porCat.get(c) || 0, color: COLOR_CAT(c),
    }));
    const mezclaFranja = [
      { etiqueta: 'Low', valor: porFranja.get('low') || 0, color: 'var(--low)' },
      { etiqueta: 'Mid', valor: porFranja.get('mid') || 0, color: 'var(--mid)' },
      { etiqueta: 'High', valor: porFranja.get('high') || 0, color: 'var(--high)' },
      { etiqueta: 'Sin tempo', valor: porFranja.get('sin') || 0, color: '#3b3b4a' },
    ];

    /* ---------- histograma de BPM ---------- */
    const cubos = new Map();
    conTempo.forEach(s => {
      const c = Math.floor(s.bpm / 10) * 10;
      cubos.set(c, (cubos.get(c) || 0) + 1);
    });
    const desde = Math.min(...cubos.keys()), hasta = Math.max(...cubos.keys());
    const barrasBpm = [];
    for (let b = desde; b <= hasta; b += 10) {
      const n = cubos.get(b) || 0;
      barrasBpm.push({ b, n });
    }
    const topBpm = Math.max(1, ...barrasBpm.map(x => x.n));

    const histograma = h('div', {},
      h('div.histo', {}, barrasBpm.map(({ b, n }) =>
        h('div.histo-col', { title: `${b}–${b + 9} bpm: ${n} temas` },
          h('div.histo-barra', {
            style: {
              height: Math.max(n ? 4 : 0, (n / topBpm) * 100) + '%',
              background: b <= 99 ? 'var(--low)' : b <= 124 ? 'var(--mid)' : 'var(--high)',
            },
          })))),
      h('div.histo-eje', {},
        h('span', {}, desde + ' bpm'),
        h('span', {}, '99'), h('span', {}, '124'),
        h('span', {}, hasta + ' bpm')));

    /* ---------- cobertura de datos ---------- */
    const pct = (n, t) => t ? Math.round((n / t) * 100) : 0;
    const cobertura = [
      { etiqueta: 'Con tempo', valor: pct(conTempo.length, songs.length), det: `${conTempo.length} de ${songs.length}` },
      { etiqueta: '…medido', valor: pct(conTempo.length - sugeridos.length, songs.length), det: `${conTempo.length - sugeridos.length} a mano` },
      { etiqueta: '…sugerido', valor: pct(sugeridos.length, songs.length), det: `${sugeridos.length} de internet` },
      { etiqueta: 'Con cifra', valor: pct(conCifra.length, songs.length), det: `${conCifra.length} con link` },
    ].map(x => ({ ...x, etiqueta: x.etiqueta, titulo: x.det }));

    /* ---------- armado ---------- */
    cont.append(
      resumen,

      h('div.stats-grid', {},
        tarjeta('Caballitos de batalla', 'los que más veces sonaron',
          masTocados.length ? ranking(masTocados, { unidad: '×' })
            : h('div.dim', {}, 'Todavía no hay jams con temas')),

        tarjeta('Bandas que más suenan', 'sumando todos sus temas',
          bandas.length ? ranking(bandas, { color: '#7fb4ff', unidad: '×' })
            : h('div.dim', {}, 'Sin datos')),

        tarjeta('Cantantes', 'temas cantados y en cuántas jams',
          cantantes.length
            ? h('div.cantantes-lista', {}, cantantes.map(filaCantante))
            : h('div.dim', {}, 'Todavía nadie tiene temas asignados')),

        tarjeta('Mezcla de categorías', 'qué se toca de cada una',
          barraApilada(mezclaCat)),

        tarjeta('Energía', 'reparto por franja de tempo',
          barraApilada(mezclaFranja)),

        tarjeta('Pulso del repertorio', `${conTempo.length} temas con tempo`,
          cubos.size ? histograma : h('div.dim', {}, 'Ningún tema tiene tempo cargado')),

        tarjeta('Rotación', 'cuánto se repite el repertorio',
          h('div', {},
            ranking([
              { etiqueta: 'Sonaron 1 sola vez', valor: unaVez, color: 'var(--warn)' },
              { etiqueta: 'Repetidos', valor: distintos - unaVez, color: 'var(--ok)' },
              { etiqueta: 'Nunca sonaron', valor: sinTocar, color: '#3b3b4a' },
            ], { max: Math.max(1, distintos, sinTocar) }),
            h('div.dim', { style: { fontSize: '11.5px', marginTop: '10px', lineHeight: '1.5' } },
              `De ${songs.length} temas en DBSongs, ${distintos} pisaron el escenario `
              + `y cada uno sonó ${distintos ? Math.round((totalTemas / distintos) * 10) / 10 : 0} veces en promedio.`))),

        tarjeta('Datos cargados', 'qué le falta al repertorio',
          h('div', {},
            ranking(cobertura, { max: 100, unidad: '%', color: 'var(--acc-2)' }),
            h('div.dim', { style: { fontSize: '11.5px', marginTop: '10px' } },
              'Los sugeridos vienen de internet y conviene confirmarlos a mano.'))),

        tarjeta('Estructura de las jams', 'lo que no son temas',
          ranking([
            { etiqueta: 'Medleys', valor: medleys, color: 'var(--acc-2)' },
            { etiqueta: 'Breaks', valor: breaks, color: 'var(--txt-3)' },
            { etiqueta: 'Bloques', valor: bloques, color: 'var(--acc)' },
          ])),
      ),
    );
  }

  pintar();

  return frag(
    h('div.page-head', {},
      h('div', {},
        h('h1', {}, 'Stats'),
        h('p.sub', {}, 'Todo sale de las jams cargadas: si editás una lista, los números cambian.')),
      h('div.page-actions', {},
        select([
          { value: 'todas', label: 'Todas las jams' },
          { value: 'historicas', label: 'Solo las históricas' },
          { value: 'mias', label: 'Solo las mías' },
        ], { value: alcance, onchange: e => { alcance = e.target.value; pintar(); } }))),
    cont,
  );
}
