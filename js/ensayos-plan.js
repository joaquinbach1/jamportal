/* ============================================================
   ensayos-plan.js — qué se toca en cada ensayo
   ------------------------------------------------------------
   El problema real de la banda: los cantantes no vienen todo el
   ensayo. Vienen un rato, y en ese rato hay que tener listos los
   temas que cantan ellos. Todo lo demás —la banda sola, buscando
   el arreglo— va antes.

   Así que la hora a la que puede venir cada cantante no es un
   dato de color: es el eje sobre el que se ordena el ensayo.

   La cuenta, en orden:

     1. Cada tema pide unas pasadas según cómo viene (ver
        ensayada.js): las «sin cantante» son la banda sola y las
        «con cantante» necesitan que esa persona esté ahí.

     2. Los ensayos son los que la jam ya tiene. Cada uno da una
        cantidad de espacios, que salen de cuánto dura dividido
        lo que lleva una pasada.

     3. En cada ensayo, las pasadas con cantante se reservan
        primero, cada una desde que llegó el último de los suyos
        —un tema a dos voces los necesita a los dos—, y en orden
        de quién puede empezar antes: así el que llegó temprano
        hace lo suyo y se va, en vez de esperar a otro.

     4. Lo que sobra se llena con pasadas sin cantante, que es
        justo lo que la banda hace mientras espera.

     5. Lo que no entró pasa al ensayo siguiente. Si al final
        queda algo afuera, se dice: es la información que sirve
        para agregar un ensayo o bajar un tema.

   No es un optimizador y no pretende serlo. Es el orden que
   alguien armaría a mano, hecho rápido y sin olvidarse a nadie.
   ============================================================ */

import { estadoDe, PASADAS } from './ensayada.js';
import { PUESTOS } from './musicos.js';

export const MINUTOS_POR_PASADA = 10;
const DURACION_POR_DEFECTO = 180;      // 3 horas, si el ensayo no dice hasta cuándo

const aMinutos = hhmm => {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  return m ? (+m[1]) * 60 + (+m[2]) : null;
};

const aHora = min => {
  const t = ((Math.round(min) % 1440) + 1440) % 1440;
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
};

/* La banda base: los que están en casi todos los temas. Vienen desde
   que arranca el ensayo salvo que se diga otra cosa, que es lo que
   pasa de verdad —al resto hay que preguntarle, a estos no. */
export const BANDA_BASE = ['Joaco', 'Mati', 'Tomi', 'Nano', 'Nahue'];

/** Quiénes tocan un ítem, sacado de su formación. */
function musicosDe(it) {
  const m = it && it.musicos;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return [];
  return PUESTOS.map(p => m[p.clave] && m[p.clave].nombre).filter(Boolean);
}

/**
 * Los temas de una jam como unidades de ensayo. Un medley es una sola
 * unidad: se ensaya entero o no se ensaya, y partirlo no querría decir
 * nada. Los bloques y los breaks no son temas.
 */
export function unidades(jam, song) {
  const out = [];
  (jam.items || []).forEach((it, i) => {
    if (it.tipo === 'medley') {
      const titulos = (it.songs || []).map(s => (song(s.songId) || {}).titulo).filter(Boolean);
      out.push({
        i, tipo: 'medley',
        titulo: it.titulo || 'Medley',
        detalle: titulos.join(' · '),
        cantantes: [...new Set((it.songs || []).flatMap(s => s.cantantes || []))],
        musicos: [...new Set((it.songs || []).flatMap(musicosDe))],
        estado: estadoDe(it),
      });
      return;
    }
    if (it.tipo !== 'song') return;
    const s = song(it.songId);
    out.push({
      i, tipo: 'song',
      titulo: s ? s.titulo : '(tema borrado)',
      detalle: s ? s.artista : '',
      cantantes: it.cantantes || [],
      musicos: musicosDe(it),
      estado: estadoDe(it),
    });
  });
  return out;
}

/** Los cantantes que aparecen en el setlist, en orden de cuántos temas llevan. */
export function cantantesDelSetlist(unis) {
  const cuenta = new Map();
  for (const u of unis) for (const c of u.cantantes) cuenta.set(c, (cuenta.get(c) || 0) + 1);
  return [...cuenta.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
    .map(([nombre, temas]) => ({ nombre, temas }));
}

/* Los que siempre hay que preguntar aunque no figuren en ningún tema:
   entran y salen según la noche, y si no aparecen en la lista nadie se
   acuerda de escribirles. */
export const SIEMPRE_PREGUNTAR = ['Fede', 'Fabo', 'Sivibra'];

/**
 * Los músicos de la jam, sacados del setlist igual que los cantantes:
 * quién está puesto en cada puesto, en cuántos temas, y en qué. Se les
 * suman los de SIEMPRE_PREGUNTAR, que van con o sin temas asignados.
 */
export function musicosDelSetlist(jam) {
  const gente = new Map();
  const sumar = (nombre, puesto) => {
    if (!nombre) return;
    const x = gente.get(nombre) || { nombre, temas: 0, puestos: new Set() };
    x.temas++;
    if (puesto) x.puestos.add(puesto);
    gente.set(nombre, x);
  };

  const delItem = it => {
    const m = it && it.musicos;
    if (!m || typeof m !== 'object' || Array.isArray(m)) return;
    for (const p of PUESTOS) if (m[p.clave]) sumar(m[p.clave].nombre, p.label);
  };

  for (const it of jam.items || []) {
    if (it.tipo === 'medley') (it.songs || []).forEach(delItem);
    else if (it.tipo === 'song') delItem(it);
  }

  for (const nombre of SIEMPRE_PREGUNTAR) {
    if (!gente.has(nombre)) gente.set(nombre, { nombre, temas: 0, puestos: new Set() });
  }

  /* La banda base va en su propia tabla, con otra regla: acá quedan
     los que hay que preguntar uno por uno. */
  for (const nombre of BANDA_BASE) gente.delete(nombre);

  return [...gente.values()]
    .map(x => ({ nombre: x.nombre, temas: x.temas, puestos: [...x.puestos] }))
    .sort((a, b) => b.temas - a.temas || a.nombre.localeCompare(b.nombre, 'es'));
}

/**
 * Arma el plan.
 *
 * @param unis        lo que devuelve unidades()
 * @param ensayos     los de la jam: { fecha, hora, horaFin, lugar }
 * @param vienen      { [indiceDeEnsayo]: { [cantante]: 'HH:MM' | '' } }
 *                    vacío o ausente = ese día no viene
 * @param minutos     lo que lleva una pasada
 */
export function planificar(unis, ensayos, vienen = {}, minutos = MINUTOS_POR_PASADA) {
  /* Lo que hay que hacer, tema por tema. Se va descontando. */
  const pendiente = unis.map(u => ({
    u,
    sin: PASADAS[u.estado].sin,
    con: u.cantantes.length ? PASADAS[u.estado].con : 0,
  }));

  const dias = ensayos.map((e, idx) => {
    const arranca = aMinutos(e.hora) ?? 19 * 60;
    const termina = aMinutos(e.horaFin);
    const largo = termina != null && termina > arranca ? termina - arranca : DURACION_POR_DEFECTO;
    const espacios = Math.max(0, Math.floor(largo / minutos));
    const dicho = vienen[idx] || {};

    /* Desde qué espacio está cada uno.

       Un valor sin poner no quiere decir lo mismo para todos: a la
       banda base no se le pregunta, viene desde que arranca, y por eso
       su ausencia se marca a propósito con una cadena vacía. Al resto
       hay que preguntarle, así que sin respuesta es que no viene. */
    const llegada = new Map();
    for (const nombre of BANDA_BASE) {
      if (!(nombre in dicho)) llegada.set(nombre, 0);
    }
    for (const [nombre, hora] of Object.entries(dicho)) {
      if (!hora) continue;
      llegada.set(nombre, Math.max(0, Math.ceil(((aMinutos(hora) ?? arranca) - arranca) / minutos)));
    }

    const presentes = [...llegada.entries()]
      .map(([nombre, desde]) => ({ nombre, desde, hora: aHora(arranca + desde * minutos) }))
      .sort((a, b) => a.desde - b.desde);

    return { idx, ensayo: e, arranca, espacios, presentes, llegada,
             slots: new Array(espacios).fill(null) };
  });

  /* Desde qué espacio se puede tocar un tema ese día, o null si falta
     alguien. `conVoz` suma a los cantantes a la cuenta. */
  const desdeCuando = (d, u, conVoz) => {
    const hace_falta = conVoz ? [...u.musicos, ...u.cantantes] : u.musicos;
    let desde = 0;
    for (const nombre of hace_falta) {
      const k = d.llegada.get(nombre);
      if (k === undefined) return null;          // ese día no está: el tema espera
      desde = Math.max(desde, k);
    }
    return desde;
  };

  /* ---- 1) las pasadas con cantante, que son las que tienen horario ----
     Cada una arranca cuando llegó el último que hace falta: los músicos
     del tema y sus cantantes. Un tema a dos voces los necesita a los
     dos, y si el que hace la segunda guitarra llega a las nueve, antes
     de las nueve ese tema no se toca aunque el cantante esté.

     En orden de quién puede empezar antes, para que el que llegó
     temprano haga lo suyo y se vaya. */
  for (const d of dias) {
    const listas = pendiente
      .filter(t => t.con > 0)
      .map(t => ({ t, desde: desdeCuando(d, t.u, true) }))
      .filter(x => x.desde !== null)
      .sort((a, b) => a.desde - b.desde);

    for (const { t, desde } of listas) {
      let k = desde;
      while (t.con > 0 && k < d.espacios) {
        if (d.slots[k] === null) {
          d.slots[k] = { u: t.u, con: t.u.cantantes.join(' y ') };
          t.con--;
        }
        k++;
      }
    }
  }

  /* ---- 2) el resto del tiempo, la banda sola ----
     Los huecos se recorren a lo ancho y no a lo largo: primero el
     primer hueco de todos los días, después el segundo de todos, y
     así. Llenando día por día entraba todo en el primero y el segundo
     quedaba vacío —cierto, pero inútil: pasar un tema tres veces en
     una noche enseña menos que tres veces repartidas.

     En cada hueco va el que peor viene de los que se pueden tocar en
     ese momento: sin sus músicos no hay tema, por más que haga falta. */
  const huecos = [];
  const maxEspacios = Math.max(0, ...dias.map(d => d.espacios));
  for (let k = 0; k < maxEspacios; k++) {
    for (const d of dias) if (k < d.espacios && d.slots[k] === null) huecos.push({ d, k });
  }

  for (const { d, k } of huecos) {
    const t = pendiente
      .filter(x => x.sin > 0)
      .filter(x => { const desde = desdeCuando(d, x.u, false); return desde !== null && desde <= k; })
      .sort((a, b) => b.sin - a.sin)[0];
    if (!t) continue;
    d.slots[k] = { u: t.u, con: null };
    t.sin--;
  }

  /* ---- 3) el plan, en horas de reloj ---- */
  const plan = dias.map(d => {
    const pasadas = [];
    d.slots.forEach((s, k) => {
      if (!s) return;
      const anterior = pasadas[pasadas.length - 1];
      /* Dos pasadas seguidas del mismo tema y en la misma condición son
         una sola línea que dice «×2»: en un papel se lee mejor. */
      if (anterior && anterior.u === s.u && anterior.con === s.con && anterior.hasta === k) {
        anterior.veces++; anterior.hasta = k + 1;
        return;
      }
      pasadas.push({ u: s.u, con: s.con, veces: 1, desde: k, hasta: k + 1,
                     hora: aHora(d.arranca + k * minutos) });
    });

    /* A qué hora conviene que llegue cada uno: cuando empieza lo
       primero en lo que está, no cuando dijo que podía. Llegar antes es
       esperar al pedo. */
    const llamados = d.presentes.map(p => {
      const suyas = pasadas.filter(x =>
        x.u.musicos.includes(p.nombre) || (x.con && x.u.cantantes.includes(p.nombre)));
      return {
        nombre: p.nombre, dijo: p.hora,
        hora: suyas.length ? suyas[0].hora : p.hora,
        hasta: suyas.length ? suyas[suyas.length - 1].hora : null,
        sinTemas: !suyas.length,
        /* Para qué se lo llama: el mismo nombre puede estar en las dos
           listas, y en la convocatoria hay que decirle qué va a hacer. */
        canta: unis.some(u => u.cantantes.includes(p.nombre)),
        toca: unis.some(u => u.musicos.includes(p.nombre)),
      };
    });

    return { ...d, pasadas, llamados, usados: d.slots.filter(Boolean).length };
  });

  const falta = pendiente
    .filter(t => t.sin > 0 || t.con > 0)
    .map(t => ({ u: t.u, sin: t.sin, con: t.con }));

  return { plan, falta, minutos };
}

/** El plan de un día, en texto, para pegar en WhatsApp. */
export function planATexto(dia, fechaLinda) {
  const L = [];
  L.push(`ENSAYO ${dia.ensayo.fecha ? fechaLinda(dia.ensayo.fecha) : ''}`.trim());
  if (dia.ensayo.lugar) L.push(`📍 ${dia.ensayo.lugar}`);
  L.push('');
  for (const p of dia.pasadas) {
    const veces = p.veces > 1 ? ` ×${p.veces}` : '';
    L.push(`${p.hora}  ${p.u.titulo}${veces}${p.con ? `  🎤 ${p.con}` : ''}`);
  }
  if (dia.llamados.length) {
    L.push('', 'Quién y a qué hora:');
    for (const c of dia.llamados) L.push(`  ${c.nombre} — ${c.hora}`);
  }
  return L.join('\n');
}
