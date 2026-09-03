/* ============================================================
   views/song-form.js — alta / edición de un tema de DBSongs
   ============================================================ */

import { store, franjaDeBpm, FRANJA_LABEL } from '../store.js';
import { h, modal, field, input, select, personPicker, toast, confirmar } from '../ui.js';
import { buscarCifra, urlBusqueda } from '../cifra.js';
import { buscarBpm } from '../lookup.js';
import { duracionLinda } from '../duracion.js';
import { linkSpotify } from '../spotify.js';

/**
 * Abre el diálogo de canción.
 * @param {object} pre     valores iniciales (o la canción existente si trae id)
 * @param {function} onOk  recibe la canción guardada
 */
export function dialogoCancion(pre = {}, onOk) {
  const editando = !!pre.id;
  const d = {
    titulo: '', artista: '', categoria: store.categorias[0], bpm: '', franja: '',
    cantantes: [], patches: [], notas: '', anio: '', generoWeb: '', origen: 'manual',
    duracionSec: null, spotifyUrl: '',
    ...pre,
  };

  const fTitulo  = input({ value: d.titulo, placeholder: 'Nombre del tema' });
  const fArtista = input({ value: d.artista, placeholder: 'Banda o artista' });
  const fCat     = select(store.categorias, { value: d.categoria });
  const fBpm     = h('input', { type: 'number', min: 30, max: 260, value: d.bpm || '', placeholder: '—' });
  const fFranja  = select(
    [{ value: '', label: 'Automática según BPM' },
     { value: 'low', label: FRANJA_LABEL.low + ' (≤99)' },
     { value: 'mid', label: FRANJA_LABEL.mid + ' (100–124)' },
     { value: 'high', label: FRANJA_LABEL.high + ' (125+)' }],
    { value: d.franja || '' });
  const fAnio    = input({ value: d.anio || '', placeholder: '—' });
  const fAlbum   = input({ value: d.album || '', placeholder: 'Disco al que pertenece' });
  const fPatches = input({ value: (d.patches || []).join(', '), placeholder: 'a13, g52…' });
  const fCifra   = input({ value: d.cifraUrl || '', placeholder: 'https://www.cifraclub.com/…' });
  const fSpotify = input({ value: d.spotifyUrl || '', placeholder: 'https://open.spotify.com/track/…' });
  /* mm:ss, que es como se lee una duración. Vacío significa "no sé":
     la app va a contar 4 minutos al estimar el horario de la jam. */
  const fDur     = input({ value: d.duracionSec ? duracionLinda(d.duracionSec) : '',
                           placeholder: '4:00', style: { maxWidth: '90px' } });
  const fNotas   = h('textarea', { value: d.notas || '', placeholder: 'Tonalidad, arreglo, quién la propuso…' });

  /* Si el tema lleva coros. Como los vientos, es del tema y no de la jam:
     los arreglos de coros se ensayan una vez y quedan. */
  let coros = !!d.coros;
  const btnCoros = h('button.btn.sm', { onclick: () => { coros = !coros; pintarCoros(); } });
  const pintarCoros = () => {
    btnCoros.textContent = coros ? '🎙 Lleva coros ✓' : '🎙 Sin coros';
    btnCoros.classList.toggle('primary', coros);
    btnCoros.classList.toggle('ghost', !coros);
  };
  pintarCoros();

  let cantantes = [...(d.cantantes || [])];
  const pick = personPicker({
    opciones: store.cantantes.map(c => c.nombre),
    seleccionados: cantantes,
    onChange: v => cantantes = v,
    placeholder: 'Quién la canta…',
  });

  // el BPM queda marcado como "sugerido" solo mientras sea el valor que trajo
  // internet; si el usuario lo corrige a mano, pasa a ser un dato medido
  let bpmSugerido = d.bpmFuente === 'sugerido' ? String(d.bpm || '') : null;
  const esSugerido = () => bpmSugerido !== null && String(fBpm.value) === bpmSugerido;
  const btnBpm = h('button.btn.sm', {
    style: { flex: 'none' },
    title: 'Buscar el tempo en internet (queda marcado como sugerido)',
    onclick: async () => {
      btnBpm.textContent = '…'; btnBpm.disabled = true;
      const r = await buscarBpm(fTitulo.value, fArtista.value);
      btnBpm.textContent = '⏱'; btnBpm.disabled = false;
      if (r) { fBpm.value = r.bpm; bpmSugerido = String(r.bpm); syncFranja(); toast(`Tempo sugerido: ${r.bpm} bpm`, 'ok'); }
      else toast('No encontré el tempo de este tema', 'err');
    },
  }, '⏱');

  const previewFranja = h('span.dim', { style: { fontSize: '11.5px' } });
  const syncFranja = () => {
    const f = fFranja.value || franjaDeBpm(fBpm.value);
    previewFranja.textContent = (f ? 'Franja: ' + FRANJA_LABEL[f] : 'Sin franja (cargá el BPM)')
      + (esSugerido() ? '  ·  tempo sugerido (estimado, no medido)' : '');
  };
  fBpm.addEventListener('input', syncFranja);
  fFranja.addEventListener('change', syncFranja);
  syncFranja();

  /** 'mm:ss' o 'm' → segundos. Devuelve null si no se entiende. */
  function segundosDe(txt) {
    const t = (txt || '').trim();
    if (!t) return null;
    const m = /^(\d{1,2}):([0-5]\d)$/.exec(t);
    const seg = m ? (+m[1] * 60 + +m[2]) : (/^\d{1,4}$/.test(t) ? +t * 60 : null);
    return seg && seg >= 20 && seg <= 1800 ? seg : null;
  }

  function guardar() {
    const titulo = fTitulo.value.trim();
    if (!titulo) { toast('Falta el título', 'err'); fTitulo.focus(); return; }
    const datos = {
      titulo,
      artista: fArtista.value.trim() || 'Desconocido',
      categoria: fCat.value,
      bpm: fBpm.value ? parseInt(fBpm.value, 10) : null,
      franja: fFranja.value || franjaDeBpm(fBpm.value),
      anio: fAnio.value.trim(),
      album: fAlbum.value.trim(),
      /* si le cambiás el disco a mano, la tapa y el id de antes ya no
         corresponden: se limpian para que se vuelvan a buscar */
      ...(fAlbum.value.trim() !== (d.album || '') ? { cover: '', albumId: null, albumFuente: '' } : {}),
      generoWeb: d.generoWeb || '',
      cantantes,
      patches: fPatches.value.split(',').map(s => s.trim()).filter(Boolean),
      coros,
      notas: fNotas.value.trim(),
      origen: d.origen,
      bpmFuente: esSugerido() ? 'sugerido' : '',
      duracionSec: segundosDe(fDur.value),
      spotifyUrl: fSpotify.value.trim(),
      cifraUrl: fCifra.value.trim(),
      cifraConfianza: fCifra.value.trim() && fCifra.value.trim() !== (d.cifraUrl || '') ? 'alta' : d.cifraConfianza,
    };
    const song = editando ? store.updateSong(d.id, datos) : store.addSong(datos);
    m.close();
    toast(editando ? 'Tema actualizado' : `«${song.titulo}» agregado a DBSongs`, 'ok');
    onOk && onOk(song);
  }

  const footer = [
    editando ? h('button.btn.danger', {
      style: { marginRight: 'auto' },
      onclick: async () => {
        if (await confirmar(`¿Borrar «${d.titulo}» de DBSongs? Se saca de todos los setlists.`, { titulo: 'Borrar tema' })) {
          store.removeSong(d.id); m.close(); toast('Tema borrado'); onOk && onOk(null);
        }
      },
    }, 'Borrar') : null,
    h('button.btn.ghost', { onclick: () => m.close() }, 'Cancelar'),
    h('button.btn.primary', { onclick: guardar }, editando ? 'Guardar' : 'Agregar a DBSongs'),
  ];

  const m = modal({
    title: editando ? 'Editar tema' : 'Nuevo tema en DBSongs',
    footer,
    body: [
      d.origen && d.origen.startsWith('web')
        ? h('div.method-hint', {}, `🌐 Datos traídos de internet (${d.origen.split(':')[1]})${d.generoWeb ? ' · género: ' + d.generoWeb : ''}. Revisalos antes de guardar.`)
        : null,
      h('div.grid-2', {}, field('Título', fTitulo), field('Artista / banda', fArtista)),
      field('Categoría', fCat),
      h('div.grid-4', {},
        field('BPM', h('div', { style: { display: 'flex', gap: '6px' } }, fBpm, btnBpm)),
        field('Franja', fFranja), field('Año', fAnio),
        field('Duración', fDur)),
      previewFranja,
      field('Cantantes habituales', pick),
      field('Disco', h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
        d.cover
          ? h('img', { src: d.cover, alt: '', style: {
              width: '44px', height: '44px', borderRadius: '5px', objectFit: 'cover', flex: 'none' } })
          : null,
        fAlbum)),
      h('div.grid-2', {}, field('Patch de teclado', fPatches), field('Coros', btnCoros)),
      field('Cifra / acordes', h('div', { style: { display: 'flex', gap: '8px' } },
        fCifra,
        h('button.btn.sm', {
          style: { flex: 'none' },
          onclick: async e => {
            const btn = e.currentTarget;
            btn.textContent = '…'; btn.disabled = true;
            const r = await buscarCifra(fTitulo.value, fArtista.value);
            btn.textContent = '🎸 Buscar'; btn.disabled = false;
            if (r) {
              fCifra.value = r.url;
              d.cifraArtista = r.artista; d.cifraConfianza = r.confianza;
              toast(r.confianza === 'alta' ? 'Cifra encontrada' : `Ojo: es la cifra de ${r.artista}`, r.confianza === 'alta' ? 'ok' : '');
            } else {
              window.open(urlBusqueda(fTitulo.value, fArtista.value), '_blank', 'noopener');
              toast('No está en Cifra Club — te abro el buscador');
            }
          },
        }, '🎸 Buscar'),
        d.cifraUrl ? h('a.btn.sm.ghost', { href: d.cifraUrl, target: '_blank', rel: 'noopener', style: { flex: 'none' } }, 'Abrir') : null)),
      /* Vacío está bien: la app arma sola un link de búsqueda con título y
         artista. Esto es para cuando esa búsqueda cae en el tema equivocado. */
      field('Spotify (opcional)', h('div', { style: { display: 'flex', gap: '8px' } },
        fSpotify,
        h('button.btn.sm', {
          style: { flex: 'none' },
          title: 'Abrir la búsqueda en Spotify y copiar de ahí el link del tema',
          /* se arma al tocar, no al dibujar: en un alta el título todavía
             no estaba escrito cuando este botón se creó */
          onclick: () => window.open(
            linkSpotify({ titulo: fTitulo.value, artista: fArtista.value, spotifyUrl: fSpotify.value.trim() }),
            '_blank', 'noopener'),
        }, '♫ Buscar'))),
      field('Notas', fNotas),
    ],
  });

  fTitulo.focus();
  return m;
}
