/* ============================================================
   setlist-texto.js — la lista como texto, y de vuelta
   ------------------------------------------------------------
   Para editarla como en un doc: se ve todo junto, se reordena
   cortando y pegando líneas, se agrega escribiendo.

   El formato es el mismo que ya usa "Copiar lista", sin los
   links (que ahí sirven y acá solo estorban para editar):

     ▸ PIANO BAR                     ← bloque
     1. Tema — Artista  [Cantante]   ← tema (el número es adorno)
     ——  BREAK (15')  ——             ← break
     4. Redondos (medley)            ← medley…
        · Ji Ji Ji — Patricio Rey    ← …y lo que va adentro
                                     ← el renglón vacío lo cierra

   Nada de esto es obligatorio: si escribís solo "Tema - Artista"
   se entiende igual. Los números se recalculan al guardar, así
   que podés mover líneas sin renumerar nada.
   ============================================================ */

const RE_BLOQUE     = /^[▸>#]+\s*(.+)$/;
const RE_ENVUELTO   = /^[—–-]{2,}\s*(.*?)\s*[—–-]{2,}$/;
const RE_BREAK      = /^(break|intervalo|corte|descanso)\b/i;
const RE_VINETA     = /^[·•*]\s*(.+)$/;
const RE_NUMERO     = /^\s*\d+\s*[.)\-–]\s*/;
const RE_MEDLEY     = /\s*\(\s*medley\s*\)\s*$/i;

/* ---------- lista → texto ---------- */

function unaLinea(song, cantantes) {
  const base = song ? [song.titulo, song.artista].filter(Boolean).join(' — ') : '?';
  const c = (cantantes || []).filter(Boolean);
  return base + (c.length ? `  [${c.join(', ')}]` : '');
}

export function setlistATexto(jam, store) {
  const L = [];
  let n = 0;
  for (const it of jam.items || []) {
    if (it.tipo === 'bloque') {
      L.push('', '▸ ' + (it.label || '').toUpperCase(), '');
      continue;
    }
    if (it.tipo === 'break') {
      L.push('', `—— ${(it.label || 'BREAK').toUpperCase()}${it.minutos ? ` (${it.minutos}')` : ''} ——`, '');
      continue;
    }
    if (it.tipo === 'medley') {
      n++;
      L.push(`${n}. ${it.titulo || 'Medley'} (medley)`);
      for (const ms of it.songs || []) L.push('   · ' + unaLinea(store.song(ms.songId), ms.cantantes));
      L.push('');
      continue;
    }
    n++;
    L.push(`${n}. ` + unaLinea(store.song(it.songId), it.cantantes));
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* ---------- texto → lista ---------- */

/** Separa "Tema — Artista  [Cantantes]" en sus partes. */
function partirTema(txt) {
  let s = txt.trim();
  let cantantes = [];
  const c = s.match(/\[([^\]]*)\]\s*$/);
  if (c) {
    cantantes = c[1].split(/\s*,\s*/).map(x => x.trim()).filter(Boolean);
    s = s.slice(0, c.index).trim();
  }
  let titulo = s, artista = '';
  const partes = s.split(/\s+[—–|]\s+|\s+-\s+/);
  if (partes.length >= 2) {
    titulo = partes[0].trim();
    artista = partes.slice(1).join(' - ').trim();
  }
  return { titulo, artista, cantantes };
}

/** "—— BREAK (15') ——", "BREAK 20" o "Corte" → el item, o null. */
function leerBreak(l) {
  const env = l.match(RE_ENVUELTO);
  const cuerpo = env ? env[1] : (RE_BREAK.test(l) ? l : null);
  if (cuerpo === null) return null;
  const min = cuerpo.match(/(\d+)\s*'?\s*\)?\s*$/);
  const label = cuerpo.replace(/\(?\s*\d+\s*'?\s*\)?\s*$/, '').trim();
  return { tipo: 'break', label: (label || 'BREAK').toUpperCase(), minutos: min ? +min[1] : 15 };
}

const matchear = (store, t) => store.matchSong(t.titulo, t.artista) || store.matchSong(t.artista, t.titulo);

/**
 * Devuelve los items para la jam y el detalle línea por línea,
 * que es lo que el diálogo usa para avisar qué no reconoció.
 */
export function textoASetlist(txt, store) {
  const items = [];
  const lineas = [];
  let medley = null;                       // medley abierto, si venimos de uno

  for (const bruta of (txt || '').split('\n')) {
    const l = bruta.trim();
    if (!l) { medley = null; continue; }    // un renglón vacío cierra el medley

    const bloque = l.match(RE_BLOQUE);
    if (bloque) {
      medley = null;
      items.push({ tipo: 'bloque', label: bloque[1].trim() });
      lineas.push({ tipo: 'bloque', texto: bloque[1].trim() });
      continue;
    }

    const brk = leerBreak(l);
    if (brk) {
      medley = null;
      items.push(brk);
      lineas.push({ tipo: 'break', texto: brk.label });
      continue;
    }

    /* con viñeta y un medley abierto arriba: va adentro del medley */
    const vineta = l.match(RE_VINETA);
    if (vineta && medley) {
      const t = partirTema(vineta[1]);
      const s = matchear(store, t);
      lineas.push({ ...t, tipo: 'tema', match: s, bruta: l });
      if (s) medley.songs.push({ songId: s.id, cantantes: t.cantantes });
      continue;
    }

    const cuerpo = (vineta ? vineta[1] : l).replace(RE_NUMERO, '').trim();

    if (RE_MEDLEY.test(cuerpo)) {
      medley = { tipo: 'medley', titulo: cuerpo.replace(RE_MEDLEY, '').trim() || 'Medley', songs: [] };
      items.push(medley);
      lineas.push({ tipo: 'medley', texto: medley.titulo });
      continue;
    }

    medley = null;
    const t = partirTema(cuerpo);
    const s = matchear(store, t);
    lineas.push({ ...t, tipo: 'tema', match: s, bruta: l });
    if (s) items.push({ tipo: 'song', songId: s.id, cantantes: t.cantantes, notas: '' });
  }

  return {
    /* un medley al que no le quedó ningún tema no es un medley */
    items: items.filter(it => it.tipo !== 'medley' || (it.songs || []).length),
    lineas,
  };
}
