/* ============================================================
   views/singers.js — la gente de la banda
   ------------------------------------------------------------
   Una sección por instrumento, que es como se piensa una banda:
   «¿a quién tengo para la batería?» y no «buscá en la lista de
   101 nombres».

   Quién toca qué sale de dos lados y hace falta de los dos: el
   campo `instrumentos` de cada persona, que está cargado a
   medias, y la lista de puestos de musicos.js, que es la que
   usamos para armar cada jam. Sin la segunda, media banda
   quedaba en OTROS —Nano no tiene nada escrito en su ficha y
   toca la guitarra en todas las jams.

   Alguien puede estar en más de una: Fede toca la batería y el
   saxo, y aparece en las dos. Es lo correcto, porque a las dos
   listas se las mira buscando a quién llamar.
   ============================================================ */

import { store, norm } from '../store.js';
import { h, frag, clear, modal, field, input, avatar, toast, confirmar, catPill, franjaDot, debounce } from '../ui.js';
import { PUESTOS } from '../musicos.js';

/* Los grupos, en el orden en que se leen. Cada uno sabe reconocer a los
   suyos por lo que dice la ficha y por los puestos donde figura. */
const GRUPOS = [
  { titulo: 'CANTANTES',   puestos: [],                 texto: /voz|canta/ },
  { titulo: 'BATERISTAS',  puestos: ['bat', 'percu'],   texto: /bater|percu|tambor/ },
  { titulo: 'GUITARRISTAS', puestos: ['g1', 'g2'],      texto: /guitarr|viola/ },
  { titulo: 'BAJISTAS',    puestos: ['bajo'],           texto: /bajo|bass/ },
  { titulo: 'TECLADISTAS', puestos: ['t1', 't2'],       texto: /tecla|piano|key|sinte/ },
  { titulo: 'VIENTOS',     puestos: ['saxo'],           texto: /saxo|ca[ñn]o|viento|tromp|tromb|flauta/ },
];

/** Los nombres que figuran en cada puesto, sacados de musicos.js. */
const enPuesto = clave => {
  const p = PUESTOS.find(x => x.clave === clave);
  return p ? p.gente.map(norm) : [];
};

/** A qué grupos pertenece alguien. Puede ser a más de uno, o a ninguno. */
function gruposDe(persona) {
  const texto = norm((persona.instrumentos || []).join(' '));
  const nombre = norm(persona.nombre);
  return GRUPOS.filter(g => {
    if (g.titulo === 'CANTANTES') return persona.rol !== 'instrumento';
    if (texto && g.texto.test(texto)) return true;
    return g.puestos.some(c => enPuesto(c).includes(nombre));
  });
}

/**
 * Los temas de una persona: los que canta y los que toca de invitada.
 *
 * Antes esto solo miraba `cantantes`, y para los músicos se leía el
 * contador guardado en la persona — que nadie recalculaba nunca y estaba
 * mal en 35 de 101. La base lo expone bien en persona_stats; acá se
 * recalcula igual para que la pantalla no espere a releer.
 */
function temasDe(nombre) {
  const n = norm(nombre);
  const esta = lista => (lista || []).some(x => norm(x).includes(n));
  return store.songs.filter(s => esta(s.cantantes) || esta(s.invitados));
}

function jamsDe(nombre) {
  const set = new Set();
  temasDe(nombre).forEach(s => (s.jams || []).forEach(j => set.add(j)));
  return [...set];
}

function ficha(persona, onChange) {
  const esCantante = persona.rol !== 'instrumento';
  const temas = esCantante ? temasDe(persona.nombre) : [];
  const jams = esCantante ? jamsDe(persona.nombre) : [];

  const viejo = persona.contacto || '';
  const fNombre = input({ value: persona.nombre });
  const fTel = input({
    value: persona.telefono || (!viejo.includes('@') ? viejo : ''),
    placeholder: '+54 9 11 5555-1234',
  });
  const fEmail = h('input', {
    type: 'email',
    value: persona.email || (viejo.includes('@') ? viejo : ''),
    placeholder: 'nombre@mail.com',
  });
  const fInstr = input({ value: (persona.instrumentos || []).join(', '), placeholder: 'batería, saxo…' });
  const fNotas = h('textarea', { value: persona.notas || '', placeholder: 'Rango, temas que le quedan bien, disponibilidad…' });
  const fActivo = h('input', { type: 'checkbox', checked: persona.activo !== false, style: { width: 'auto' } });

  const m = modal({
    title: persona.nombre || 'Nueva persona',
    wide: true,
    body: [
      h('div.grid-2', {},
        field('Nombre', fNombre),
        field('Teléfono (para WhatsApp)', fTel)),
      field('Mail', fEmail),
      !esCantante ? field('Instrumentos', fInstr) : null,
      field('Notas', fNotas),
      h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13.5px' } },
        fActivo, 'Activo — aparece en las convocatorias'),

      esCantante && temas.length ? h('div', {},
        h('h2.sec', { style: { marginTop: '8px' } }, `Cantó ${temas.length} temas en ${jams.length} jams`),
        h('div.tbl-wrap', { style: { maxHeight: '280px', overflowY: 'auto' } },
          h('table.tbl', {},
            h('tbody', {}, temas
              .sort((a, b) => (b.jams || []).length - (a.jams || []).length)
              .map(s => h('tr', {},
                h('td', {}, franjaDot(s.franja)),
                h('td', {}, h('div.t-title', {}, s.titulo), h('div.dim', { style: { fontSize: '11px' } }, s.artista)),
                h('td', {}, catPill(s.categoria)),
                h('td.mono.dim', {}, s.bpm || '—'),
                h('td.mono.dim', {}, ((s.jams || []).length || '') + '×')))))),
        jams.length ? h('div.chips', { style: { marginTop: '10px' } }, jams.map(j => h('span.chip', {}, j))) : null,
      ) : null,
    ],
    footer: [
      persona.id ? h('button.btn.danger', {
        style: { marginRight: 'auto' },
        onclick: async () => {
          if (await confirmar(`¿Sacar a ${persona.nombre} de la base? Los temas que cantó quedan igual.`, { titulo: 'Borrar persona' })) {
            store.removeCantante(persona.id); m.close(); toast('Borrado'); onChange();
          }
        },
      }, 'Borrar') : null,
      h('button.btn.ghost', { onclick: () => m.close() }, 'Cancelar'),
      h('button.btn.primary', {
        onclick: () => {
          const datos = {
            nombre: fNombre.value.trim(),
            telefono: fTel.value.trim(),
            email: fEmail.value.trim(),
            contacto: '',
            notas: fNotas.value.trim(),
            activo: fActivo.checked,
            instrumentos: fInstr.value.split(',').map(s => s.trim()).filter(Boolean),
          };
          if (!datos.nombre) { toast('Falta el nombre', 'err'); return; }
          if (persona.id) store.updateCantante(persona.id, datos);
          else if (esCantante) store.addCantante(datos);
          else store.addMusico({ ...datos, rol: 'instrumento' });
          m.close(); toast('Guardado', 'ok'); onChange();
        },
      }, 'Guardar'),
    ],
  });
}

export function vistaSingers() {
  let q = '';
  let soloActivos = false;
  const cuerpo = h('div');

  function tarjeta(p) {
    const temas = temasDe(p.nombre).length;
    const jams = jamsDe(p.nombre).length;
    return h('div.singer-card' + (p.activo === false ? '.off' : '') + (p.sinFicha ? '.fantasma' : ''), {
      title: p.sinFicha ? 'Toca en la banda pero no tiene ficha — tocá para crearla' : '',
      onclick: () => ficha(p, pintar),
    },
      avatar(p.nombre),
      h('div', { style: { minWidth: 0 } },
        h('div.sc-name', {}, p.nombre),
        h('div.sc-meta', {}, p.sinFicha
          ? 'sin ficha'
          : (p.rol === 'instrumento'
              ? [(p.instrumentos || []).join(', '), `${temas} temas`].filter(Boolean).join(' · ')
              : `${temas} temas · ${jams} jams`)
            + (p.telefono ? ' · 📱' : '') + (p.email ? ' ✉️' : ''))));
  }

  /* Más temas primero: el que más toca es el que más se busca. */
  const porUso = (a, b) =>
    temasDe(b.nombre).length - temasDe(a.nombre).length ||
    a.nombre.localeCompare(b.nombre, 'es');

  /* Los de la lista de puestos que no tienen ficha. Tocan en todas las
     jams pero nadie los cargó nunca como personas, así que sin esto
     TECLADISTAS salía vacía aunque Mati y Alva estén en cada tema.

     Se muestran igual, marcados, y el clic abre la ficha con el nombre
     y el instrumento puestos: el agujero se ve y se tapa de un clic. */
  function sinFicha(grupo, conocidos, filtro) {
    const instr = { bat: 'batería', percu: 'percusión', g1: 'guitarra', g2: 'guitarra',
                    bajo: 'bajo', t1: 'teclados', t2: 'teclados', saxo: 'saxo' };
    const vistos = new Set();
    const out = [];
    for (const clave of grupo.puestos) {
      const p = PUESTOS.find(x => x.clave === clave);
      for (const nombre of (p ? p.gente : [])) {
        if (nombre === 'Invitado' || conocidos.has(norm(nombre)) || vistos.has(nombre)) continue;
        vistos.add(nombre);
        const fantasma = { nombre, rol: 'instrumento', activo: true,
                           instrumentos: [instr[clave] || ''].filter(Boolean), sinFicha: true };
        if (filtro(fantasma)) out.push(fantasma);
      }
    }
    return out;
  }

  function pintar() {
    const n = norm(q);
    const filtro = p => (!n || norm(p.nombre).includes(n)) && (!soloActivos || p.activo !== false);
    const gente = [...store.cantantes, ...store.musicos].filter(filtro);
    const conocidos = new Set([...store.cantantes, ...store.musicos].map(p => norm(p.nombre)));

    /* Quién quedó sin grupo va a OTROS, que se arma al final con lo que
       sobró en vez de con una regla propia: así nadie se pierde. */
    const ubicados = new Set();
    const secciones = GRUPOS.map(g => {
      const suyos = gente.filter(p => gruposDe(p).includes(g)).sort(porUso);
      suyos.forEach(p => ubicados.add(p));
      return { titulo: g.titulo, suyos: [...suyos, ...sinFicha(g, conocidos, filtro)] };
    });
    const otros = gente.filter(p => !ubicados.has(p)).sort(porUso);
    if (otros.length) secciones.push({ titulo: 'OTROS', suyos: otros });

    clear(cuerpo);
    const conGente = secciones.filter(x => x.suyos.length);
    if (!conGente.length) {
      cuerpo.appendChild(h('div.empty', {}, h('b', {}, 'Nadie con ese nombre')));
      return;
    }
    for (const sec of conGente) {
      cuerpo.appendChild(h('div.grupo-cab', {},
        h('h2.sec.grupo-tit', {}, sec.titulo),
        h('span.dim', {}, `${sec.suyos.length}`)));
      const grid = h('div.singer-grid');
      sec.suyos.forEach(p => grid.appendChild(tarjeta(p)));
      cuerpo.appendChild(grid);
    }
  }

  const buscador = h('input', { type: 'search', placeholder: 'Buscar por nombre…' });
  buscador.addEventListener('input', debounce(() => { q = buscador.value; pintar(); }, 100));

  pintar();

  return frag(
    h('div.page-head', {},
      h('div', {},
        h('h1', {}, 'Músicos'),
        h('p.sub', {}, `${store.cantantes.length} cantantes y ${store.musicos.length} instrumentistas, sacados del historial de jams`)),
      h('div.page-actions', {},
        h('button.btn.primary', { onclick: () => ficha({ rol: 'voz', activo: true }, pintar) }, '＋ Cantante'),
        h('button.btn', { onclick: () => ficha({ rol: 'instrumento', activo: true, instrumentos: [] }, pintar) }, '＋ Músico'))),

    h('div.filters', {},
      h('div.search', {}, buscador),
      h('label', { style: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', color: 'var(--txt-2)' } },
        h('input', { type: 'checkbox', style: { width: 'auto' }, onchange: e => { soloActivos = e.target.checked; pintar(); } }),
        'Solo activos')),

    cuerpo,
  );
}
