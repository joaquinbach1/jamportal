/* ============================================================
   views/lyrics.js — las letras de la jam, en orden
   ------------------------------------------------------------
   La lista completa del setlist. Tocás un tema y la letra se abre
   ocupando toda la pantalla, para leerla de lejos; se cierra con
   la cruz de arriba o con Esc, y con ← → pasás al tema de al lado
   sin volver a la lista.

   Las letras se traen en el momento y quedan en memoria; la que
   sigue se va cargando sola mientras leés la actual.
   ============================================================ */

import { store } from '../store.js';
import { h, clear, frag, poner, modal, field, input, toast } from '../ui.js';
import { buscarLetra, urlBusquedaLetra, precargar, letraDesdeUrl, guardarEnCache } from '../letras.js';
import { filas } from './live.js';

const CLAVE_TAM = 'jamportal.letras.tam';
const tamGuardado = () => {
  const n = parseFloat(localStorage.getItem(CLAVE_TAM));
  return Number.isFinite(n) ? Math.min(3.2, Math.max(1, n)) : 1.5;
};

export function vistaLyrics(jamId) {
  const jam = store.jam(jamId);
  if (!jam) {
    return h('div.empty', {}, h('b', {}, 'Esa jam no existe'),
      h('a.btn.sm', { href: '#/jams', style: { marginTop: '12px' } }, 'Volver'));
  }

  const todas = filas(jam);
  const cantables = [];
  for (const f of todas) {
    if (f.tipo === 'song' && f.song) cantables.push({ song: f.song, n: String(f.n) });
    if (f.tipo === 'medley') for (const ms of f.songs) if (ms.song) cantables.push({ song: ms.song, n: '·' });
  }

  let tam = tamGuardado();
  let abierta = -1;                       // índice del tema abierto, o -1

  const listaCont = h('div.ly-lista');
  const pantalla = h('div.ly-full', { style: { display: 'none' } });

  /* ============ la letra, a pantalla completa ============ */

  async function abrir(i) {
    if (i < 0 || i >= cantables.length) return;
    abierta = i;
    const { song } = cantables[i];

    clear(pantalla);
    pantalla.style.display = '';
    document.body.classList.add('letra-abierta');

    const texto = h('div.ly-texto', { style: { fontSize: tam + 'rem' } }, 'Buscando la letra…');

    poner(pantalla,
      h('div.ly-barra', {},
        h('div.ly-quien', {},
          h('h2', {}, song.titulo),
          h('div.ly-artista', {}, song.artista || '')),
        h('div.ly-controles', {},
          h('button.icon-btn', { title: 'Tema anterior (←)', disabled: i === 0, onclick: () => abrir(i - 1) }, '‹'),
          h('span.dim', { style: { fontSize: '12px', fontFamily: 'var(--mono)' } }, `${i + 1}/${cantables.length}`),
          h('button.icon-btn', { title: 'Tema siguiente (→)', disabled: i === cantables.length - 1, onclick: () => abrir(i + 1) }, '›'),
          h('button.btn.xs', { title: 'Más chica', onclick: () => cambiarTam(-0.15) }, 'A−'),
          h('button.btn.xs', { title: 'Más grande', onclick: () => cambiarTam(+0.15) }, 'A+'),
          h('button.ly-cerrar', { title: 'Cerrar (Esc)', onclick: cerrar }, '✕'))),
      h('div.ly-scroll', {}, texto));

    pantalla.querySelector('.ly-scroll').scrollTop = 0;

    const res = await buscarLetra(song);
    if (abierta !== i) return;            // cambiaste de tema mientras buscaba

    clear(texto);
    if (res.ok) {
      texto.textContent = res.texto;
    } else {
      texto.classList.add('sin');
      poner(texto,
        h('div', {}, 'No encontré la letra de este tema.'),
        h('div.dim', { style: { fontSize: '14px', marginTop: '8px' } },
          'Las bases que uso flojean con cumbia y tropical. Buscala y pegá la dirección: queda guardada para siempre.'),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '16px' } },
          h('a.btn.sm', { href: urlBusquedaLetra(song), target: '_blank', rel: 'noopener' }, '🔎 Buscarla en internet'),
          h('button.btn.sm.primary', { onclick: () => dialogoUrl(song, i) }, '🔗 Pegar URL de la letra')),
        song.letraUrl
          ? h('div', { style: { marginTop: '14px' } },
              h('a.btn.xs', { href: song.letraUrl, target: '_blank', rel: 'noopener' }, '↗ Abrir la que guardaste'),
              h('button.btn.xs.ghost', {
                style: { marginLeft: '6px' },
                onclick: () => { store.updateSong(song.id, { letraUrl: '' }); song.letraUrl = ''; abrir(i); },
              }, 'Olvidarla'))
          : null);
    }

    const prox = cantables[i + 1];
    if (prox) precargar(prox.song);
  }

  /** Pegar a mano la dirección de la letra. Se guarda con el tema. */
  function dialogoUrl(song, i) {
    const campo = input({ placeholder: 'https://…', value: song.letraUrl || '' });
    const aviso = h('div.dim', { style: { fontSize: '12.5px', marginTop: '8px' } });

    const usar = async e => {
      const btn = e.currentTarget;
      const url = campo.value.trim();
      if (!url) { toast('Pegá la dirección', 'err'); campo.focus(); return; }

      btn.disabled = true; const t = btn.textContent; btn.textContent = 'Leyendo…';
      const res = await letraDesdeUrl(url);
      btn.disabled = false; btn.textContent = t;

      /* La guardamos igual, se haya podido leer o no: si el sitio no
         deja, al menos queda el link a un clic. */
      store.updateSong(song.id, { letraUrl: url });
      song.letraUrl = url;

      if (res.ok) {
        guardarEnCache(song, res.texto);
        m.close();
        toast('Letra guardada', 'ok');
        abrir(i);
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

    /* Plan B para los sitios que no se dejan leer: el texto, a mano. */
    const areaTexto = h('textarea', { placeholder: 'Pegá acá el texto de la letra…', style: { minHeight: '160px' } });
    const pegarTexto = h('div', { style: { display: 'none', marginTop: '12px' } },
      field('O pegá la letra tal cual', areaTexto));

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
            m.close(); toast('Letra guardada', 'ok'); abrir(i);
          },
        }, 'Usar el texto pegado'),
        h('button.btn.primary', { onclick: usar }, 'Usar esta URL'),
      ],
    });
    setTimeout(() => campo.focus(), 60);
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

  /* ============ la lista ============ */

  function pintarLista() {
    clear(listaCont);
    let i = 0;
    for (const f of todas) {
      if (f.tipo === 'bloque') { listaCont.appendChild(h('div.ly-bloque', {}, (f.label || '').toUpperCase())); continue; }
      if (f.tipo === 'break') { listaCont.appendChild(h('div.ly-break', {}, f.label || 'BREAK')); continue; }
      if (f.tipo === 'medley') {
        listaCont.appendChild(h('div.ly-medley', {}, `${f.n} · ${f.titulo || 'Medley'}`));
        for (const ms of f.songs) if (ms.song) listaCont.appendChild(item(ms.song, i++, true, '·'));
        continue;
      }
      if (f.tipo === 'song' && f.song) listaCont.appendChild(item(f.song, i++, false, String(f.n)));
    }
    if (!cantables.length) listaCont.appendChild(h('div.empty', {}, 'Esta jam no tiene temas todavía'));
  }

  function item(song, i, enMedley, n) {
    return h('button.ly-item' + (enMedley ? '.dentro' : ''), {
      onclick: () => abrir(i),
      title: 'Ver la letra',
    },
      h('span.ly-n', {}, n),
      h('span.ly-t', {}, song.titulo),
      h('span.ly-a', {}, song.artista || ''));
  }

  /* ============ teclado ============ */

  const alTeclado = e => {
    if (abierta < 0) {
      if (e.key === 'Escape') location.hash = '#/jams/' + jamId;
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

  pintarLista();

  return frag(
    h('div.page-head', {},
      h('div', {},
        h('div.titulo-jam', {},
          h('a.btn.sm.ghost', { href: '#/jams/' + jamId, title: 'Volver a la jam' }, '← Volver'),
          h('h1', {}, 'Letras')),
        h('p.sub', {}, `${jam.nombre || 'Jam'} · ${cantables.length} temas · tocá uno para ver la letra`))),
    listaCont,
    pantalla,
  );
}
