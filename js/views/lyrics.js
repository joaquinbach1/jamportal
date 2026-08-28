/* ============================================================
   views/lyrics.js — las letras de la jam, en orden
   ------------------------------------------------------------
   La lista completa del setlist. Tocás un tema y la letra se abre
   ocupando toda la pantalla; se cierra con la cruz o con Esc, y
   con ← → pasás de tema sin volver a la lista.

   La misma pantalla sirve para dos cosas: la de adentro de la app,
   que busca las letras en internet, y la del link compartido, que
   ya las trae puestas y anda sin conexión.
   ============================================================ */

import { store } from '../store.js';
import { h, clear, frag, poner, modal, field, input, toast, copiar, avatar } from '../ui.js';
import { buscarLetra, urlBusquedaLetra, precargar, letraDesdeUrl, guardarEnCache } from '../letras.js';
import { filas as filasDelSetlist } from './live.js';
import { empaquetar, linkDeLetras, sePuedeComprimir } from '../compartir.js';

const CLAVE_TAM = 'jamportal.letras.tam';
const tamGuardado = () => {
  const n = parseFloat(localStorage.getItem(CLAVE_TAM));
  return Number.isFinite(n) ? Math.min(3.2, Math.max(1, n)) : 1.5;
};

/* ============================================================
   La pantalla, sin saber de dónde salen las letras
   ------------------------------------------------------------
   filas: [{ tipo:'bloque'|'break'|'medley'|'song', label, n,
             titulo, artista, dentro, song? }]
   traer: (fila) => Promise<{ ok, texto }>
   ============================================================ */
export function pantallaLetras({ titulo, sub, filas, volverA, traer, extras = [], alFaltar = null }) {
  const cantables = [...filas.filter(f => f.tipo === 'song')];

  let tam = tamGuardado();
  let abierta = -1;

  const listaCont = h('div.ly-lista');
  const pantalla = h('div.ly-full', { style: { display: 'none' } });

  /* Filtrar por cantante: arriba de todo, uno por persona. Sirve para
     "mostrame solo lo que canto yo" antes de subir al escenario. */
  const cantantes = [...new Set(filas.flatMap(f => f.cantantes || []))].sort((a, b) => a.localeCompare(b));
  let filtro = '';
  const barraCantantes = h('div.ly-cantantes');

  async function abrir(i) {
    if (i < 0 || i >= cantables.length) return;
    abierta = i;
    const fila = cantables[i];
    const proxima = cantables[i + 1];

    clear(pantalla);
    pantalla.style.display = '';
    document.body.classList.add('letra-abierta');

    const texto = h('div.ly-texto', { style: { fontSize: tam + 'rem' } }, 'Buscando la letra…');

    poner(pantalla,
      h('div.ly-barra', {},
        h('div.ly-izq', {},
          h('button.icon-btn', { title: 'Tema anterior (←)', disabled: i === 0, onclick: () => abrir(i - 1) }, '‹'),
          h('span.ly-cuenta', {}, `${i + 1}/${cantables.length}`),
          h('button.btn.xs', { title: 'Más chica', onclick: () => cambiarTam(-0.15) }, 'A−'),
          h('button.btn.xs', { title: 'Más grande', onclick: () => cambiarTam(+0.15) }, 'A+')),

        h('div.ly-quien', {},
          h('h2', {}, fila.titulo),
          h('div.ly-artista', {}, fila.artista || '')),

        h('div.ly-der', {},
          proxima
            ? h('button.ly-proxima', { title: 'Pasar al que sigue (→)', onclick: () => abrir(i + 1) },
                h('span.ly-prox-rotulo', {}, 'sigue'),
                h('span.ly-prox-t', {}, proxima.titulo),
                h('span.ly-prox-a', {}, proxima.artista || ''))
            : h('span.ly-prox-fin', {}, 'último tema'),
          h('button.icon-btn.ly-flecha', {
            title: 'Pasar al que sigue (→)', disabled: !proxima, onclick: () => abrir(i + 1),
          }, '›'),
          h('button.ly-cerrar', { title: 'Cerrar (Esc)', onclick: cerrar }, '✕'))),

      h('div.ly-scroll', {}, texto));

    pantalla.querySelector('.ly-scroll').scrollTop = 0;

    const res = await traer(fila);
    if (abierta !== i) return;

    clear(texto);
    if (res.ok) {
      texto.textContent = res.texto;
    } else {
      texto.classList.add('sin');
      poner(texto,
        h('div', {}, 'No encontré la letra de este tema.'),
        alFaltar ? alFaltar(fila, i) : h('div.dim', { style: { fontSize: '14px', marginTop: '8px' } },
          'No vino en el link.'));
    }

    const prox = cantables[i + 1];
    if (prox && prox.song) precargar(prox.song);
  }

  function cerrar() {
    abierta = -1;
    pantalla.style.display = 'none';
    clear(pantalla);
    document.body.classList.remove('letra-abierta');
  }

  function cambiarTam(delta) {
    tam = Math.min(3.2, Math.max(1, tam + delta));
    localStorage.setItem(CLAVE_TAM, String(tam));
    const t = pantalla.querySelector('.ly-texto');
    if (t) t.style.fontSize = tam + 'rem';
  }

  function visibles() {
    if (!filtro) return filas;
    const quedan = filas.filter(f => f.tipo !== 'song' || (f.cantantes || []).includes(filtro));

    /* Un bloque o un medley sin ningún tema debajo es un título suelto:
       si al filtrar se quedó sin contenido, se va con él. */
    return quedan.filter((f, i) => {
      if (f.tipo === 'song') return true;
      const siguiente = quedan.slice(i + 1).find(x => x.tipo === 'song' || x.tipo === 'bloque' || x.tipo === 'medley');
      return siguiente && siguiente.tipo === 'song';
    });
  }

  function pintarBarra() {
    clear(barraCantantes);
    if (!cantantes.length) return;
    poner(barraCantantes,
      h('span.ly-cant-rotulo', {}, 'quién canta'),
      ...cantantes.map(n => {
        const cuantas = filas.filter(f => (f.cantantes || []).includes(n)).length;
        const b = h('button.ly-cant' + (filtro === n ? '.on' : ''), {
          title: filtro === n ? 'Ver todos de nuevo' : `Solo las ${cuantas} de ${n}`,
          onclick: () => { filtro = filtro === n ? '' : n; pintarBarra(); pintarLista(); },
        }, avatar(n), h('span', {}, n), h('span.ly-cant-n', {}, String(cuantas)));
        return b;
      }),
      filtro ? h('button.btn.xs.ghost', { onclick: () => { filtro = ''; pintarBarra(); pintarLista(); } }, 'Ver todos') : null);
  }

  function pintarLista() {
    clear(listaCont);
    cantables.length = 0;
    for (const f of visibles()) if (f.tipo === 'song') cantables.push(f);
    dibujarFilas();
  }

  function dibujarFilas() {
  let iCantable = 0;
  for (const f of visibles()) {
    if (f.tipo === 'bloque') { listaCont.appendChild(h('div.ly-bloque', {}, (f.label || '').toUpperCase())); continue; }
    if (f.tipo === 'break') { listaCont.appendChild(h('div.ly-break', {}, f.label || 'BREAK')); continue; }
    if (f.tipo === 'medley') { listaCont.appendChild(h('div.ly-medley', {}, f.label || 'Medley')); continue; }
    const i = iCantable++;
    listaCont.appendChild(h('button.ly-item' + (f.dentro ? '.dentro' : ''), {
      onclick: () => abrir(i), title: 'Ver la letra',
    },
      h('span.ly-n', {}, f.dentro ? '·' : String(f.n)),
      h('span.ly-t', {}, f.titulo),
      h('span.ly-a', {}, f.artista || '')));
  }
  if (!cantables.length) {
    listaCont.appendChild(h('div.empty', {},
      filtro ? `${filtro} no tiene temas asignados en esta jam` : 'Esta jam no tiene temas todavía'));
  }
  }

  const alTeclado = e => {
    if (abierta < 0) {
      if (e.key === 'Escape' && volverA) location.hash = volverA;
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); cerrar(); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); abrir(abierta + 1); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); abrir(abierta - 1); }
  };
  document.addEventListener('keydown', alTeclado);
  window.addEventListener('hashchange', function limpiar() {
    document.removeEventListener('keydown', alTeclado);
    window.removeEventListener('hashchange', limpiar);
    document.body.classList.remove('letra-abierta');
  });

  pintarBarra();
  pintarLista();

  return frag(
    h('div.page-head', {},
      h('div', {},
        h('div.titulo-jam', {},
          volverA ? h('a.btn.sm.ghost', { href: volverA, title: 'Volver a la jam' }, '← Volver') : null,
          h('h1', {}, titulo)),
        h('p.sub', {}, sub)),
      extras.length ? h('div.page-actions', {}, extras) : null),
    barraCantantes,
    listaCont,
    pantalla,
  );
}

/* ============================================================
   1) La de adentro de la app
   ============================================================ */
export function vistaLyrics(jamId) {
  const jam = store.jam(jamId);
  if (!jam) {
    return h('div.empty', {}, h('b', {}, 'Esa jam no existe'),
      h('a.btn.sm', { href: '#/jams', style: { marginTop: '12px' } }, 'Volver'));
  }

  const filas = [];
  for (const f of filasDelSetlist(jam)) {
    if (f.tipo === 'bloque') { filas.push({ tipo: 'bloque', label: f.label }); continue; }
    if (f.tipo === 'break') { filas.push({ tipo: 'break', label: f.label }); continue; }
    if (f.tipo === 'medley') {
      filas.push({ tipo: 'medley', label: `${f.n} · ${f.titulo || 'Medley'}` });
      for (const ms of f.songs) if (ms.song) filas.push({ tipo: 'song', song: ms.song, titulo: ms.song.titulo, artista: ms.song.artista, dentro: true, cantantes: ms.cantantes || [] });
      continue;
    }
    if (f.tipo === 'song' && f.song) filas.push({ tipo: 'song', song: f.song, titulo: f.song.titulo, artista: f.song.artista, n: f.n, cantantes: f.cantantes || [] });
  }

  const cantidad = filas.filter(f => f.tipo === 'song').length;
  const vista = pantallaLetras({
    titulo: 'Letras',
    sub: `${jam.nombre || 'Jam'} · ${cantidad} temas · tocá uno para ver la letra`,
    filas,
    volverA: '#/jams/' + jamId,
    traer: f => buscarLetra(f.song),
    extras: [botonCompartir(jam, filas)],
    alFaltar: (f, i) => bloqueFaltante(f.song, () => reabrir(i)),
  });

  /* el diálogo de pegar URL necesita poder volver a abrir la letra */
  let reabrirFn = null;
  const reabrir = i => reabrirFn && reabrirFn(i);
  queueMicrotask(() => {
    const btns = [...document.querySelectorAll('.ly-item')];
    reabrirFn = i => btns[i] && btns[i].click();
  });

  return vista;
}

/** Lo que se ofrece cuando ninguna base tiene la letra. */
function bloqueFaltante(song, reabrir) {
  return frag(
    h('div.dim', { style: { fontSize: '14px', marginTop: '8px' } },
      'Las bases que uso flojean con cumbia y tropical. Buscala y pegá la dirección: queda guardada para siempre.'),
    h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '16px' } },
      h('a.btn.sm', { href: urlBusquedaLetra(song), target: '_blank', rel: 'noopener' }, '🔎 Buscarla en internet'),
      h('button.btn.sm.primary', { onclick: () => dialogoUrl(song, reabrir) }, '🔗 Pegar URL de la letra')),
    song.letraUrl
      ? h('div', { style: { marginTop: '14px' } },
          h('a.btn.xs', { href: song.letraUrl, target: '_blank', rel: 'noopener' }, '↗ Abrir la que guardaste'))
      : null);
}

function dialogoUrl(song, reabrir) {
  const campo = input({ placeholder: 'https://…', value: song.letraUrl || '' });
  const aviso = h('div.dim', { style: { fontSize: '12.5px', marginTop: '8px' } });
  const areaTexto = h('textarea', { placeholder: 'Pegá acá el texto de la letra…', style: { minHeight: '160px' } });
  const pegarTexto = h('div', { style: { display: 'none', marginTop: '12px' } },
    field('O pegá la letra tal cual', areaTexto));

  const usar = async e => {
    const btn = e.currentTarget;
    const url = campo.value.trim();
    if (!url) { toast('Pegá la dirección', 'err'); campo.focus(); return; }

    btn.disabled = true; const t = btn.textContent; btn.textContent = 'Leyendo…';
    const res = await letraDesdeUrl(url);
    btn.disabled = false; btn.textContent = t;

    store.updateSong(song.id, { letraUrl: url });
    song.letraUrl = url;

    if (res.ok) {
      guardarEnCache(song, res.texto);
      m.close(); toast('Letra guardada', 'ok'); reabrir();
    } else {
      clear(aviso);
      poner(aviso,
        h('div', {}, res.motivo),
        h('div', { style: { marginTop: '6px' } },
          'Guardé el link igual: te queda un botón para abrirlo. ',
          'Si querés verla acá adentro, copiá el texto de la letra y pegalo abajo.'));
      pegarTexto.style.display = '';
    }
  };

  const m = modal({
    title: 'Letra de « ' + song.titulo + ' »',
    body: [
      h('div.method-hint', {},
        'Buscala en internet y pegá acá la dirección de la página. ',
        'Queda guardada con el tema, así no la buscás de nuevo.'),
      h('div', { style: { marginTop: '12px' } }, field('Dirección', campo)),
      aviso,
      pegarTexto,
    ],
    footer: [
      h('button.btn.ghost', { onclick: () => m.close() }, 'Cancelar'),
      h('button.btn.sm', {
        onclick: () => {
          const txt = areaTexto.value.trim();
          if (txt.length < 40) { toast('Falta el texto de la letra', 'err'); return; }
          guardarEnCache(song, txt);
          store.updateSong(song.id, { letra: txt });
          m.close(); toast('Letra guardada', 'ok'); reabrir();
        },
      }, 'Usar el texto pegado'),
      h('button.btn.primary', { onclick: usar }, 'Usar esta URL'),
    ],
  });
  setTimeout(() => campo.focus(), 60);
}

/* ---------- armar el link para compartir ---------- */

function botonCompartir(jam, filas) {
  const btn = h('button.btn.sm', {
    title: 'Un link con la lista y las letras adentro: se abre sin cuenta y sin internet',
    onclick: async () => {
      if (!sePuedeComprimir()) { toast('Este navegador no puede armar el link', 'err'); return; }
      const original = btn.textContent;
      btn.disabled = true;

      const temas = filas.filter(f => f.tipo === 'song');
      let listas = 0;
      const letras = new Map();
      for (const f of temas) {
        btn.textContent = `Juntando letras ${++listas}/${temas.length}…`;
        const r = await buscarLetra(f.song);
        if (r.ok) letras.set(f.song.id, r.texto);
      }

      const datos = {
        v: 1,
        n: jam.nombre || 'Jam',
        f: jam.fecha || '',
        i: filas.map(f => f.tipo === 'song'
          ? { k: 's', t: f.titulo, a: f.artista || '', y: letras.get(f.song.id) || '',
              d: f.dentro ? 1 : 0, n: f.n, c: f.cantantes || [] }
          : { k: f.tipo === 'bloque' ? 'b' : f.tipo === 'break' ? 'r' : 'm', l: f.label || '' }),
      };

      const paquete = await empaquetar(datos);
      const link = linkDeLetras(paquete);
      btn.disabled = false;
      btn.textContent = original;

      const conLetra = letras.size;
      dialogoLink(link, temas.length, conLetra);
    },
  }, '🔗 Compartir');
  return btn;
}

function dialogoLink(link, total, conLetra) {
  const campo = input({ value: link, readonly: true, style: { fontFamily: 'var(--mono)', fontSize: '11.5px' } });
  const kb = Math.round(new Blob([link]).size / 1024);

  const m = modal({
    title: 'Link de las letras',
    body: [
      h('div.method-hint', {},
        'Este link se lleva la lista y las letras adentro. ',
        h('b', {}, 'Se abre sin cuenta y sin internet'), ': en el iPad, abrilo en Safari una vez ',
        'y después "Compartir → Agregar a inicio" para tenerlo como una app.'),
      h('div', { style: { marginTop: '12px' } }, field('Link', campo)),
      h('div.dim', { style: { fontSize: '12px', marginTop: '8px' } },
        `${conLetra} de ${total} temas con letra · ${kb} KB`),
      conLetra < total
        ? h('div.dim', { style: { fontSize: '12px', marginTop: '4px' } },
            'Los que no tienen letra van igual, con su título: podés cargarlas antes y volver a compartir.')
        : null,
    ],
    footer: [
      h('button.btn.ghost', { onclick: () => m.close() }, 'Cerrar'),
      h('button.btn.primary', {
        onclick: () => { copiar(link); toast('Link copiado', 'ok'); m.close(); },
      }, '📋 Copiar el link'),
    ],
  });
  setTimeout(() => { campo.focus(); campo.select(); }, 60);
}

/* ============================================================
   2) La del link compartido: sin app, sin cuenta, sin internet
   ============================================================ */
export function vistaLetrasCompartidas(datos) {
  if (!datos || !Array.isArray(datos.i)) {
    return h('div.empty', {}, h('b', {}, 'Este link no se entiende'),
      h('div', {}, 'Puede haber quedado cortado al copiarlo. Pedí que te lo manden de nuevo.'));
  }

  const filas = datos.i.map(x => x.k === 's'
    ? { tipo: 'song', titulo: x.t, artista: x.a, dentro: !!x.d, n: x.n, letra: x.y, cantantes: x.c || [] }
    : { tipo: x.k === 'b' ? 'bloque' : x.k === 'r' ? 'break' : 'medley', label: x.l });

  const cantidad = filas.filter(f => f.tipo === 'song').length;

  return pantallaLetras({
    titulo: datos.n || 'Letras',
    sub: `${cantidad} temas · tocá uno para ver la letra`,
    filas,
    volverA: null,
    traer: async f => (f.letra ? { ok: true, texto: f.letra } : { ok: false }),
  });
}
