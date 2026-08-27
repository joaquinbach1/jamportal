/* ============================================================
   duracion.js — cuánto dura la jam y a qué hora termina
   ------------------------------------------------------------
   Tres reglas, y ninguna pretende ser exacta:

   1. Cada tema dura lo que dice `duracionSec` (viene de iTunes).
      El que no lo tiene se cuenta como 4 minutos, que es el
      promedio del repertorio.
   2. Entre tema y tema se pierde tiempo: se afina, se cambia de
      cantante, alguien dice algo. Se suma un 20% del tema. El
      último no lleva ese respiro, porque después no hay nada.
   3. En un medley los temas van por la mitad: se toca un pedazo
      y se encadena con el siguiente.

   Los breaks suman sus propios minutos, tal como están cargados.
   ============================================================ */

export const SEG_POR_TEMA   = 4 * 60;   // el que no tiene dato
export const RESPIRO        = 0.20;     // entre tema y tema
export const FACTOR_MEDLEY  = 0.5;      // adentro de un medley

/** Lo que ocupa un tema, sin contar el respiro de después. */
export function segundosDeTema(song, enMedley = false) {
  const base = (song && song.duracionSec) || SEG_POR_TEMA;
  return Math.round(base * (enMedley ? FACTOR_MEDLEY : 1));
}

/** '3:49', o '1:05:20' si se pasa de la hora. */
export function duracionLinda(seg) {
  const s = Math.max(0, Math.round(seg || 0));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return hh
    ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${mm}:${String(ss).padStart(2, '0')}`;
}

/** '3h 35m' — para el total, donde los segundos son ruido. */
export function largoLindo(seg) {
  const m = Math.round((seg || 0) / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/** 'HH:MM' sumándole segundos a una hora de arranque. Sin hora, ''. */
export function horaMas(hhmm, seg) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return '';
  const t = (+m[1] * 60 + +m[2]) * 60 + Math.round(seg || 0);
  const total = Math.floor(t / 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * La jam minuto a minuto.
 *
 * @param {object} jam
 * @param {function} song  id → canción (normalmente `id => store.song(id)`)
 * @returns {{
 *   filas: Array, total: number, musica: number, breaks: number,
 *   temas: number, inicio: string, fin: string, sinDato: number
 * }}
 *   `filas` viene en el orden de la lista, cada una con `desde` (segundos
 *   desde el arranque), `hora` ('HH:MM' o '') y `seg` (lo que ocupa).
 */
export function agenda(jam, song) {
  const filas = [];
  const inicio = (jam && jam.hora) || '';
  let t = 0, temas = 0, musica = 0, breaks = 0, sinDato = 0, n = 0;

  /* El respiro va DESPUÉS de cada tema salvo el último, así que se
     agrega al cerrar: cuando ya sabemos que viene otro. */
  let ultimoConRespiro = -1;
  const respirar = () => {
    if (ultimoConRespiro < 0) return;
    const f = filas[ultimoConRespiro];
    const extra = Math.round(f.seg * RESPIRO);
    f.seg += extra; t += extra; musica += extra;
    ultimoConRespiro = -1;
  };

  for (const it of (jam && jam.items) || []) {
    if (it.tipo === 'bloque') {
      filas.push({ tipo: 'bloque', label: it.label || '', desde: t, hora: horaMas(inicio, t), seg: 0 });
      continue;
    }

    respirar();

    if (it.tipo === 'break') {
      const seg = (it.minutos || 0) * 60;
      filas.push({ tipo: 'break', label: it.label || 'BREAK', minutos: it.minutos || 0,
                   desde: t, hora: horaMas(inicio, t), seg });
      t += seg; breaks += seg;
      continue;
    }

    if (it.tipo === 'medley') {
      const songs = (it.songs || []).map(ms => {
        const s = song(ms.songId);
        if (!s || !s.duracionSec) sinDato++;
        temas++;
        return { song: s, cantantes: ms.cantantes || [], songId: ms.songId,
                 seg: segundosDeTema(s, true) };
      });
      const seg = songs.reduce((a, x) => a + x.seg, 0);
      n++;
      filas.push({ tipo: 'medley', n, titulo: it.titulo || 'Medley', songs,
                   desde: t, hora: horaMas(inicio, t), seg });
      t += seg; musica += seg;
      ultimoConRespiro = filas.length - 1;
      continue;
    }

    const s = song(it.songId);
    if (!s || !s.duracionSec) sinDato++;
    const seg = segundosDeTema(s);
    n++; temas++;
    filas.push({ tipo: 'song', n, song: s, songId: it.songId, cantantes: it.cantantes || [],
                 desde: t, hora: horaMas(inicio, t), seg });
    t += seg; musica += seg;
    ultimoConRespiro = filas.length - 1;
  }

  return { filas, total: t, musica, breaks, temas, sinDato,
           inicio, fin: horaMas(inicio, t) };
}
