/* ============================================================
   fusionar-jam.js — cuando dos personas guardan la misma jam
   ------------------------------------------------------------
   La base frena al segundo que guarda: manda la versión que
   leyó, y si en el servidor hay otra, la escritura se rechaza.
   Hasta ahora la respuesta era pisar —la versión del segundo
   reemplazaba entera la del primero, con su tema adentro—, que
   es exactamente perder trabajo de alguien.

   Acá se juntan las dos. Hay tres documentos:

     base    la última versión que este navegador escribió o
             leyó: de ahí arrancaron los dos
     mía     lo que estoy tratando de guardar
     suya    lo que hay ahora en el servidor

   Con los tres se puede saber quién hizo qué, que es lo que no
   se sabe comparando solo dos: un tema que está en la mía y no
   en la suya puede ser uno que yo agregué o uno que el otro
   borró, y la diferencia la da la base.

   El orden de la lista lo pone la versión del servidor, y lo
   mío se inserta donde estaba. Alguien tenía que ganar el orden
   y gana quien llegó primero; lo que no se pierde es el
   contenido, que es lo que duele.

   No es un merge de texto ni pretende serlo: no hay forma de
   fusionar dos ediciones del mismo campo, así que ahí gana la
   mía —es la que la persona tiene delante y acaba de escribir.
   ============================================================ */

/* Cómo reconocer el mismo ítem en dos versiones de la lista. No hay id
   estable: guardar_jam borra e inserta todo en cada guardado, así que
   los uuid cambian. Se identifica por lo que el ítem es. */
function clave(it, i) {
  if (!it) return `nada:${i}`;
  if (it.tipo === 'song') return `song:${it.songId}`;
  if (it.tipo === 'medley') {
    const temas = (it.songs || []).map(s => s.songId).join('+');
    return `medley:${it.titulo || ''}:${temas}`;
  }
  /* Bloques y breaks se repiten —dos «BANDA» en una lista es normal—
     así que llevan su posición: no son contenido, son separadores. */
  return `${it.tipo}:${it.label || ''}:${i}`;
}

const mapa = items => {
  const m = new Map();
  (items || []).forEach((it, i) => {
    const k = clave(it, i);
    /* Un tema repetido en la misma lista existe. El segundo lleva sufijo
       para que no se pisen entre ellos. */
    let final = k, n = 2;
    while (m.has(final)) final = `${k}#${n++}`;
    m.set(final, { it, i });
  });
  return m;
};

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Junta la lista de temas de las dos versiones.
 *
 * La del servidor manda el orden; lo que yo agregué se mete donde
 * estaba. Lo que cualquiera de los dos borró, se va.
 */
export function fusionarItems(base, mios, suyos) {
  const mB = mapa(base), mM = mapa(mios), mS = mapa(suyos);

  /* Lo que el otro ya no tiene y en la base estaba: lo borró. Queda
     afuera aunque yo lo tenga, porque yo no lo toqué. */
  const borradosPorEl = [...mB.keys()].filter(k => !mS.has(k));
  const borradosPorMi = [...mB.keys()].filter(k => !mM.has(k));

  const out = [];
  const puestos = new Set();

  const poner = (k, it) => { if (!puestos.has(k)) { puestos.add(k); out.push(it); } };

  /* Arranca la del servidor, salteando lo que yo borré. */
  for (const [k, { it }] of mS) {
    if (borradosPorMi.includes(k)) continue;
    const mio = mM.get(k);
    /* Si los dos lo tienen y yo lo cambié respecto de la base, gana el
       mío: es lo que la persona acaba de editar. */
    const enBase = mB.get(k);
    const loCambieYo = mio && enBase && !igual(mio.it, enBase.it);
    poner(k, loCambieYo ? mio.it : it);
  }

  /* Y ahora lo que agregué yo: no está en la base ni lo tiene el otro.
     Va en la posición que tenía en mi lista, para que un tema que puse
     tercero no termine al final. */
  const agregadosPorMi = [...mM.entries()]
    .filter(([k]) => !mB.has(k) && !mS.has(k))
    .sort((a, b) => a[1].i - b[1].i);

  for (const [k, { it, i }] of agregadosPorMi) {
    const corte = Math.min(i, out.length);
    out.splice(corte, 0, it);
    puestos.add(k);
  }

  return { items: out, agregadosPorMi: agregadosPorMi.length,
           agregadosPorEl: [...mS.keys()].filter(k => !mB.has(k) && !mM.has(k)).length,
           borradosPorEl: borradosPorEl.length };
}

/* Los campos sueltos de la jam. No se pueden fusionar dos textos, así
   que gana el que lo haya cambiado; si lo cambiaron los dos, el mío. */
const CAMPOS = ['nombre', 'fecha', 'hora', 'lugar', 'notas', 'historica',
                'conOrden', 'cerrada', 'codigo', 'vivoIndice', 'mes', 'dia',
                'musicos', 'musicosExtra', 'ensayos'];

/**
 * Junta dos versiones de una jam.
 *
 * @param base  la última que este navegador escribió o leyó
 * @param mia   la que se está tratando de guardar
 * @param suya  la que hay en el servidor ahora
 */
export function fusionarJam(base, mia, suya) {
  if (!suya) return { jam: mia, resumen: null };
  /* Sin base no se puede saber quién hizo qué. Antes que adivinar mal,
     se queda la del servidor con mis temas nuevos encima —que es lo
     mínimo que no pierde nada de nadie. */
  const b = base || { ...suya, items: suya.items || [] };

  const r = fusionarItems(b.items, mia.items, suya.items);

  const jam = { ...suya, items: r.items };
  for (const campo of CAMPOS) {
    const cambiado = !igual(mia[campo], b[campo]);
    if (cambiado) jam[campo] = mia[campo];
  }
  /* La versión es la del servidor: es contra esa que vamos a reescribir. */
  jam.version = suya.version;

  return { jam, resumen: r };
}
