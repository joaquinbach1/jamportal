/* ============================================================
   views/songs.js — DBSongs: la base de canciones
   ============================================================ */

import { store, norm, FRANJA_LABEL } from '../store.js';
import { asegurarAlbum, porAlbum } from '../album.js';
import { temasDelAlbum } from '../lookup.js';
import { hojaAcciones } from '../ui.js';
import { h, frag, clear, poner, select, catPill, catCorta, franjaDot, toast, debounce, modal, songAutocomplete } from '../ui.js';
import { dialogoCancion } from './song-form.js';
import { botonCifra } from './jam-editor.js';
import { chipTempo } from '../tempo.js';
import { buscarEnWeb, webAResultado } from '../lookup.js';

/* la última jam elegida como destino se recuerda entre visitas */
let ultimoDestino = null;

export function vistaSongs() {
  const f = { q: '', categoria: '', franja: '', cantante: '', historial: '' };
  let orden = { campo: 'artista', dir: 1 };


  const cuerpo = h('tbody');
  const grilla = h('div.discos');
  let vista = localStorage.getItem('jamportal.songs.vista') === 'discos' ? 'discos' : 'lista';

  const btnVista = h('button.btn', {
    onclick: () => {
      vista = vista === 'discos' ? 'lista' : 'discos';
      localStorage.setItem('jamportal.songs.vista', vista);
      pintarVista(); pintar();
    },
  });
  function pintarVista() {
    btnVista.textContent = vista === 'discos' ? '☰ Ver como lista' : '▦ Ver como discos';
    btnVista.title = vista === 'discos'
      ? 'La tabla de siempre'
      : 'Los temas agrupados por disco, con la tapa';
  }
  pintarVista();

  /* Trae disco y tapa de los que no los tienen. Es una consulta por tema,
     así que va de a uno y avisa cómo viene. */
  const btnTapas = h('button.btn', {
    title: 'Busca en internet el disco y la tapa de los temas que no los tienen',
    onclick: async () => {
      const faltan = store.repertorio.filter(x => !x.cover && x.albumFuente !== 'sin');
      if (!faltan.length) { toast('Todos los temas ya tienen tapa', 'ok'); return; }

      btnTapas.disabled = true;
      let ok = 0;
      for (const [i, x] of faltan.entries()) {
        btnTapas.textContent = `▦ ${i + 1}/${faltan.length}…`;
        if (await asegurarAlbum(x)) ok++;
        if (i % 12 === 0) pintar();
        await new Promise(r => setTimeout(r, 150));
      }
      btnTapas.textContent = '▦ Traer tapas'; btnTapas.disabled = false;
      pintar();
      toast(`${ok} tapas encontradas` + (faltan.length - ok ? ` · ${faltan.length - ok} sin dato` : ''), 'ok');
    },
  }, '▦ Traer tapas');
  const contador = h('span.count');
  const barraEnvio = h('div.enviar');
  const seleccion = new Set();

  /* Solo se puede mandar temas a una jam en preparación: las históricas son
     el registro de lo que ya pasó y no se tocan desde acá. */
  const enPreparacion = () => store.jams.filter(j => !j.historica);

  function agregarA(jamId, songs) {
    const jam = store.jam(jamId);
    if (!jam || jam.historica || !songs.length) return;
    jam.items = [...(jam.items || []),
      ...songs.map(s => ({ tipo: 'song', songId: s.id, cantantes: [], notas: '' }))];
    store.commit();
    seleccion.clear();
    pintar();
    toast(songs.length === 1
      ? `«${songs[0].titulo}» agregada a ${jam.nombre}`
      : `${songs.length} temas agregados a ${jam.nombre}`, 'ok');
  }

  function pintarBarra() {
    clear(barraEnvio);
    const jams = enPreparacion();

    if (!jams.length) {
      barraEnvio.appendChild(h('div.method-hint', {},
        'Para mandar temas a una jam primero creá una — las históricas no se modifican desde acá. ',
        h('a', { href: '#/nueva', style: { color: 'var(--acc)', textDecoration: 'underline' } }, 'Armar nueva Jam')));
      return;
    }

    if (!ultimoDestino || !jams.some(j => j.id === ultimoDestino)) ultimoDestino = jams[0].id;

    const sel = select(jams.map(j => ({
      value: j.id,
      label: `${j.nombre || 'Jam sin nombre'} (${(j.items || []).length})`,
    })), { value: ultimoDestino, onchange: e => { ultimoDestino = e.target.value; pintarBarra(); } });

    const elegidos = [...seleccion].map(id => store.song(id)).filter(Boolean);

    poner(barraEnvio,
      h('span.dim', { style: { fontSize: '12.5px' } }, 'Agregar a'),
      h('div', { style: { flex: '0 1 260px' } }, sel),
      elegidos.length
        ? h('button.btn.sm.primary', { onclick: () => agregarA(ultimoDestino, elegidos) },
            `＋ Agregar ${elegidos.length} tema${elegidos.length > 1 ? 's' : ''}`)
        : h('span.dim', { style: { fontSize: '11.5px' } },
            'Tildá los temas de la lista, o usá el ＋ de cada fila'),
      elegidos.length
        ? h('button.btn.sm.ghost', { onclick: () => { seleccion.clear(); pintar(); } }, 'Limpiar')
        : null);
  }

  function filtrar() {
    let res = store.repertorio;
    if (f.q) {
      const n = norm(f.q);
      res = res.filter(s => norm(s.titulo).includes(n) || norm(s.artista).includes(n) || (s.cantantes || []).some(c => norm(c).includes(n)));
    }
    if (f.categoria) res = res.filter(s => s.categoria === f.categoria);
    if (f.franja) res = res.filter(s => s.franja === f.franja);
    if (f.cantante) res = res.filter(s => (s.cantantes || []).includes(f.cantante));
    if (f.historial === 'tocados') res = res.filter(s => (s.jams || []).length);
    if (f.historial === 'nuevos') res = res.filter(s => !(s.jams || []).length);

    const dir = orden.dir;
    const val = s => {
      switch (orden.campo) {
        case 'titulo': return norm(s.titulo);
        case 'bpm': return s.bpm || 0;
        case 'jams': return (s.jams || []).length;
        case 'cifra': return s.cifraUrl ? 1 : 0;
        case 'categoria': return s.categoria || '';
        default: return norm(s.artista) + ' ' + norm(s.titulo);
      }
    };
    return [...res].sort((a, b) => {
      const x = val(a), y = val(b);
      return (x > y ? 1 : x < y ? -1 : 0) * dir;
    });
  }

  /* ---------- vista de discos ---------- */

  /* La lista de temas de cada disco se pide una vez y queda; los discos
     que abriste quedan abiertos aunque se redibuje la grilla (pasa cada
     vez que sumás un tema). */
  const pistas = new Map();
  const abiertos = new Set();

  function pintarDiscos(res) {
    clear(grilla);
    const grupos = porAlbum(res);

    for (const g of grupos) grilla.appendChild(tarjetaDisco(g));
    if (!grupos.length) grilla.appendChild(h('div.empty', {}, 'Nada con esos filtros'));
  }

  function tarjetaDisco(g) {
    const tapa = g.cover
      ? h('img.disco-tapa', { src: g.cover, alt: '', loading: 'lazy' })
      : h('div.disco-tapa.sin', {}, '♪');

    const listado = h('div.disco-temas');
    const barra = h('div.disco-barra', {}, h('div.disco-avance'));
    const cuenta = h('span.disco-cuenta');

    /* Sin el disco entero solo podemos mostrar los nuestros. Con él, se ve
       cuánto falta: es la diferencia entre "tenemos tres" y "tenemos tres
       de diez". */
    function pintarListado(delDisco) {
      clear(listado);
      const nuestrosPorTitulo = new Map(g.temas.map(t => [norm(t.titulo), t]));

      const filas = delDisco.length
        ? delDisco.map(p => ({ titulo: p.titulo, nro: p.nro, nuestro: nuestrosPorTitulo.get(norm(p.titulo)) }))
        : g.temas.map(t => ({ titulo: t.titulo, nro: null, nuestro: t }));

      /* los nuestros que el disco no lista (otra edición, otro nombre) */
      if (delDisco.length) {
        const enDisco = new Set(delDisco.map(p => norm(p.titulo)));
        for (const t of g.temas) {
          if (!enDisco.has(norm(t.titulo))) filas.push({ titulo: t.titulo, nro: null, nuestro: t });
        }
      }

      const tenemos = filas.filter(f => f.nuestro).length;
      const total = filas.length;
      barra.querySelector('.disco-avance').style.width = total ? `${(tenemos / total) * 100}%` : '0%';
      cuenta.textContent = `${tenemos}/${total}`;

      for (const f of filas) {
        if (f.nuestro) {
          listado.appendChild(h('button.disco-tema.tenemos', {
            onclick: () => dialogoCancion(f.nuestro, () => pintar()),
            title: 'Lo tocamos — clic para ver el tema',
          }, f.titulo));
          continue;
        }
        /* puede estar en Ideas: no es del repertorio, pero ya lo anotaste */
        const idea = store.ideas.find(x => norm(x.titulo) === norm(f.titulo)
          && norm(x.artista) === norm(g.artista));
        listado.appendChild(idea
          ? h('button.disco-tema.idea', {
              onclick: () => dialogoCancion(idea, () => pintar()),
              title: 'Ya está en Ideas',
            }, f.titulo, h('span.disco-mas', {}, '💡'))
          : h('button.disco-tema.falta', {
              onclick: () => hojaSumar(f.titulo, g),
              title: 'No lo tocamos — clic para sumarlo',
            }, f.titulo, h('span.disco-mas', {}, '＋')));
      }
    }

    const yaAbierto = g.albumId && abiertos.has(g.albumId);
    pintarListado(yaAbierto ? (pistas.get(g.albumId) || []) : []);

    /* el disco completo se pide al abrirlo, no de entrada: son 200 tarjetas */
    const btnVer = h('button.btn.xs.ghost', {
      onclick: async () => {
        if (!g.albumId) { toast('De este disco no tengo la lista', 'err'); return; }
        btnVer.disabled = true; btnVer.textContent = 'Trayendo…';
        const t = pistas.get(g.albumId) || await temasDelAlbum(g.albumId);
        pistas.set(g.albumId, t);
        abiertos.add(g.albumId);
        btnVer.remove();
        pintarListado(t);
      },
    }, 'Ver el disco entero');

    return h('div.disco', {},
      tapa,
      h('div.disco-datos', {},
        h('div.disco-album', { title: g.album || 'Sin disco' }, g.album || 'Sin disco'),
        h('div.disco-artista', {}, g.artista),
        h('div.disco-progreso', {}, barra, cuenta),
        listado,
        (g.albumId && !yaAbierto) ? btnVer : null));
  }

  /** Qué hacer con un tema del disco que todavía no tocamos. */
  function hojaSumar(titulo, g) {
    const proximas = store.jams.filter(j => !j.historica && !j.cerrada);
    const datos = { titulo, artista: g.artista, album: g.album, cover: g.cover, albumId: g.albumId };

    hojaAcciones(titulo, [
      ...proximas.slice(0, 3).map(j => ({
        icono: '🎵', texto: `Sumarlo a « ${j.nombre || 'jam'} »`,
        onClick: () => {
          const s = store.matchSong(titulo, g.artista) || store.addSong(datos);
          j.items = [...(j.items || []), { tipo: 'song', songId: s.id, cantantes: [], notas: '' }];
          store.commit();
          toast(`«${titulo}» sumado a ${j.nombre || 'la jam'}`, 'ok');
          pintar();
        },
      })),
      { icono: '💡', texto: 'Guardarlo en Ideas',
        onClick: () => {
          if (store.matchSong(titulo, g.artista)) { toast('Ese tema ya está cargado'); return; }
          store.addSong({ ...datos, esIdea: true });
          toast(`«${titulo}» guardado en Ideas`, 'ok');
          pintar();
        } },
      { icono: '🎼', texto: 'Sumarlo al repertorio',
        onClick: () => {
          if (store.matchSong(titulo, g.artista)) { toast('Ese tema ya está cargado'); return; }
          store.addSong(datos);
          toast(`«${titulo}» sumado al repertorio`, 'ok');
          pintar();
        } },
    ]);
  }

  function pintar() {
    const res = filtrar();
    contador.textContent = `${res.length} / ${store.repertorio.length}`;

    grilla.style.display = vista === 'discos' ? '' : 'none';
    const tabla = grilla.parentElement && grilla.parentElement.querySelector('.tbl-wrap');
    if (tabla) tabla.style.display = vista === 'discos' ? 'none' : '';
    if (vista === 'discos') { pintarDiscos(res); return; }

    clear(cuerpo);

    if (!res.length) {
      cuerpo.appendChild(h('tr', {}, h('td', { colspan: 11 },
        h('div.empty', { style: { border: 'none' } }, h('b', {}, 'Nada con esos filtros')))));
      pintarBarra();
      return;
    }

    res.forEach(s => {
      cuerpo.appendChild(h('tr' + (seleccion.has(s.id) ? '.elegida' : ''), { onclick: () => dialogoCancion(s, () => pintar()) },
        h('td.col-check', { onclick: e => e.stopPropagation() },
          h('input', {
            type: 'checkbox', checked: seleccion.has(s.id), style: { width: 'auto' },
            onchange: e => { e.target.checked ? seleccion.add(s.id) : seleccion.delete(s.id); pintar(); },
          })),
        h('td', {}, h('div.t-title', {}, s.titulo),
          (s.notas || '') ? h('div.dim', { style: { fontSize: '11px' } }, s.notas) : null),
        h('td.t-art', {}, s.artista),
        h('td.t-album', { title: s.album || '' },
          s.cover ? h('img.t-tapa', { src: s.cover, alt: '', loading: 'lazy' }) : null,
          h('span', {}, s.album || '—')),
        h('td', {}, catPill(s.categoria)),
        h('td', { onclick: e => e.stopPropagation() },
          chipTempo(s, pintar),
          s.bpmRaw ? h('span.dim', { title: 'Dos mediciones en el doc original', style: { fontSize: '10px' } }, ' *') : null),
        h('td', {}, s.franja ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } }, franjaDot(s.franja), s.franja) : h('span.dim', {}, '—')),
        h('td', {}, (s.cantantes || []).length
          ? h('div.chips', {}, s.cantantes.slice(0, 3).map(c => h('span.chip', {}, c)), s.cantantes.length > 3 ? h('span.chip', {}, '+' + (s.cantantes.length - 3)) : null)
          : h('span.dim', {}, '—')),
        h('td.mono', { title: (s.jams || []).join('\n') }, (s.jams || []).length || h('span.dim', {}, '0')),
        h('td', { onclick: e => e.stopPropagation() }, botonCifra(s, pintar)),
        h('td', { onclick: e => e.stopPropagation() },
          h('button.icon-btn', {
            title: 'Agregar este tema a la jam elegida arriba',
            disabled: !enPreparacion().length,
            onclick: () => agregarA(ultimoDestino, [s]),
          }, '＋')),
      ));
    });
    pintarBarra();
  }

  const th = (label, campo) => h('th' + (campo ? '.sortable' : ''), {
    onclick: campo ? () => { orden = { campo, dir: orden.campo === campo ? -orden.dir : 1 }; pintar(); } : null,
  }, label + (orden.campo === campo ? (orden.dir > 0 ? ' ↑' : ' ↓') : ''));

  const buscador = h('input', { type: 'search', placeholder: 'Buscar tema, artista o cantante…' });
  buscador.addEventListener('input', debounce(() => { f.q = buscador.value; pintar(); }, 120));

  const cantantesConTemas = [...new Set(store.repertorio.flatMap(s => s.cantantes || []))].sort((a, b) => a.localeCompare(b));

  /* --- alta rápida con búsqueda en internet --- */
  function altaRapida() {
    const ac = songAutocomplete({
      placeholder: 'Nombre del tema… lo busco en DBSongs y en internet',
      buscar: q => store.searchSongs(q, 8),
      onPick: s => { toast(`«${s.titulo}» ya está en DBSongs`); dialogoCancion(s, () => pintar()); },
      buscarWeb: buscarEnWeb,
      onPickWeb: r => dialogoCancion(webAResultado(r), () => pintar()),
      onNew: q => dialogoCancion({ titulo: q }, () => pintar()),
    });
    const m = modal({
      title: 'Agregar tema a DBSongs',
      body: [h('div.method-hint', {}, 'Escribí el nombre: si no está en la base, lo busco en internet y traigo banda, género y año.'), ac],
      footer: [h('button.btn.ghost', { onclick: () => m.close() }, 'Cerrar')],
    });
    setTimeout(() => ac.focusInput && ac.focusInput(), 80);
  }

  pintar();

  return frag(
    h('div.page-head', {},
      h('div', {},
        h('h1', {}, 'Canciones DB'),
        h('p.sub', {}, `${store.repertorio.length} temas tocados · ${store.artistas().length} artistas · ${store.repertorio.filter(s => s.bpm).length} con tempo` + (store.ideas.length ? ` · ${store.ideas.length} ideas sin tocar` : ''))),
      h('div.page-actions', {},
        h('button.btn.primary', { onclick: altaRapida }, '＋ Agregar tema'),
        btnVista,
        btnTapas,
        h('a.btn.ghost', { href: '#/data' }, 'Importar / exportar'))),

    h('div.filters', {},
      h('div.search', {}, buscador),
      select([{ value: '', label: 'Todas las categorías' }, ...store.categorias.map(c => ({ value: c, label: catCorta(c) }))],
        { onchange: e => { f.categoria = e.target.value; pintar(); } }),
      select([{ value: '', label: 'Toda franja' },
        { value: 'low', label: FRANJA_LABEL.low }, { value: 'mid', label: FRANJA_LABEL.mid }, { value: 'high', label: FRANJA_LABEL.high }],
        { onchange: e => { f.franja = e.target.value; pintar(); } }),
      select([{ value: '', label: 'Cualquier cantante' }, ...cantantesConTemas.map(c => ({ value: c, label: c }))],
        { onchange: e => { f.cantante = e.target.value; pintar(); } }),
      select([{ value: '', label: 'Todo el historial' }, { value: 'tocados', label: 'Ya tocados' }, { value: 'nuevos', label: 'Nunca tocados' }],
        { onchange: e => { f.historial = e.target.value; pintar(); } }),
      contador),

    barraEnvio,

    grilla,

    h('div.tbl-wrap', {},
      h('table.tbl', {},
        h('thead', {}, h('tr', {},
          h('th.col-check', {}), th('Tema', 'titulo'), th('Artista', 'artista'), th('Disco', 'album'), th('Cat.', 'categoria'),
          th('BPM', 'bpm'), th('Franja'), th('Cantantes'), th('Jams', 'jams'), th('Cifra', 'cifra'), h('th', {}))),
        cuerpo)),

    store.porConfirmar.length ? h('div.card', { style: { marginTop: '18px' } },
      h('div.card-head', {}, h('h3', {}, 'Por confirmar'),
        h('span.dim', { style: { fontSize: '12px' } }, 'venían sin artista claro en el documento original')),
      h('div.chips', {}, store.porConfirmar.map(t => h('span.chip', {}, t)))) : null,
  );
}
