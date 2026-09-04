/* ============================================================
   views/ensayos-admin.js — Ensayos Admin
   ------------------------------------------------------------
   Dos cosas, y en este orden porque la segunda depende de la
   primera:

   1. Cómo viene cada tema: no tocado · le falta · listo. Es la
      única entrada que hace falta para decidir a qué darle
      tiempo, y se marca de a un clic.

   2. El plan. Se dice a qué hora puede venir cada cantante a
      cada ensayo y sale el orden del día, con la hora de llegada
      de cada uno. De ahí se puede guardar en la jam, y las
      convocatorias salen por donde salen siempre.

   Los días no los inventa: son los ensayos que la jam ya tiene.
   Si no hay ninguno, lo primero es cargarlos.
   ============================================================ */

import { store } from '../store.js';
import { h, clear, poner, toast, fechaLinda, copiar } from '../ui.js';
import { ESTADOS } from '../ensayada.js';
import {
  unidades, cantantesDelSetlist, planificar, planATexto, MINUTOS_POR_PASADA,
} from '../ensayos-plan.js';

/* Lo que dijo cada cantante, por jam. Vive en este equipo: es la
   respuesta a «¿a qué hora podés?», que se junta por WhatsApp antes de
   armar nada y no tiene por qué ocupar lugar en la base. */
const CLAVE_VIENEN = 'jamportal.ensayos.vienen';

function vienenDe(jamId) {
  try { return JSON.parse(localStorage.getItem(CLAVE_VIENEN) || '{}')[jamId] || {}; }
  catch { return {}; }
}

function guardarVienen(jamId, datos) {
  let todo = {};
  try { todo = JSON.parse(localStorage.getItem(CLAVE_VIENEN) || '{}'); } catch { /* vacío */ }
  todo[jamId] = datos;
  try { localStorage.setItem(CLAVE_VIENEN, JSON.stringify(todo)); } catch { /* lleno */ }
}

export function vistaEnsayosAdmin(jamId) {
  const cont = h('div.ens-admin');

  /* Sin jam elegida, la lista para elegir una. */
  if (!jamId) return listaDeJams(cont);

  const jam = store.jam(jamId);
  if (!jam) {
    return h('div.empty', {}, h('b', {}, 'Esa jam no existe'),
      h('a.btn.sm', { href: '#/ensayos', style: { marginTop: '12px' } }, 'Volver'));
  }

  /* Igual que en el editor: la jam se resuelve contra el store en cada
     lectura y escritura. Al sincronizar, el store reemplaza las jams por
     objetos nuevos y una referencia guardada queda huérfana. */
  const alDia = () => store.jam(jamId) || jam;
  const guardar = () => store.commit();

  let vienen = vienenDe(jamId);
  let minutos = MINUTOS_POR_PASADA;

  const panelTemas = h('div.ens-panel');
  const panelPlan = h('div.ens-panel');

  function pintar() {
    pintarTemas();
    pintarPlan();
  }

  /* ---------- 1. cómo viene cada tema ---------- */
  function pintarTemas() {
    const unis = unidades(alDia(), id => store.song(id));
    const cuenta = Object.fromEntries(ESTADOS.map(e => [e.clave, 0]));
    for (const u of unis) cuenta[u.estado]++;

    clear(panelTemas);
    poner(panelTemas,
      h('div.ens-cab', {},
        h('h2', {}, 'Cómo viene cada tema'),
        h('div.ens-resumen', {},
          ESTADOS.map(e => h('span.ens-pill.e-' + e.clave, {},
            `${cuenta[e.clave]} ${e.label.toLowerCase()}`)))),

      unis.length
        ? h('div.ens-temas', {}, unis.map(u => {
            const fila = h('div.ens-tema.e-' + u.estado, {});
            poner(fila,
              h('div.ens-tema-txt', {},
                h('div.ens-tema-tit', {},
                  u.tipo === 'medley' ? h('span.live-tag', {}, 'MEDLEY') : null,
                  ' ' + u.titulo),
                h('div.ens-tema-sub', {},
                  u.detalle || '',
                  u.cantantes.length ? h('span.ens-canta', {}, '🎤 ' + u.cantantes.join(', ')) : null)),
              /* Los tres botones a la vista y no un ciclo: en una lista
                 larga, adivinar en qué queda cada clic es peor que leer. */
              h('div.ens-estados', {},
                ESTADOS.map(e => h('button.ens-est' + (u.estado === e.clave ? '.on' : ''), {
                  title: e.hint,
                  onclick: () => {
                    const it = (alDia().items || [])[u.i];
                    if (!it) return;
                    it.ensayada = e.clave;
                    guardar(); pintar();
                  },
                }, e.label))));
            return fila;
          }))
        : h('div.dim', {}, 'Esta jam no tiene temas todavía.'));
  }

  /* ---------- 2. el plan ---------- */
  function pintarPlan() {
    const unis = unidades(alDia(), id => store.song(id));
    const gente = cantantesDelSetlist(unis);
    const ensayos = alDia().ensayos || [];

    clear(panelPlan);

    if (!ensayos.length) {
      poner(panelPlan,
        h('div.ens-cab', {}, h('h2', {}, 'El plan')),
        h('div.empty', {},
          h('b', {}, 'Esta jam no tiene ensayos'),
          h('p', {}, 'Los días salen de ahí: cargalos primero en la jam y volvé.'),
          h('a.btn.sm', { href: `#/jams/${jam.id}/editar` }, 'Ir a la jam')));
      return;
    }

    if (!gente.length) {
      poner(panelPlan,
        h('div.ens-cab', {}, h('h2', {}, 'El plan')),
        h('div.empty', {},
          h('b', {}, 'Ningún tema tiene cantante asignado'),
          h('p', {}, 'El plan se ordena alrededor de cuándo pueden venir. Asignalos en la jam y volvé.')));
      return;
    }

    const { plan, falta } = planificar(unis, ensayos, vienen, minutos);

    poner(panelPlan,
      h('div.ens-cab', {},
        h('h2', {}, 'El plan'),
        h('div.ens-min', {},
          h('span', {}, 'Cada pasada dura'),
          h('input', {
            type: 'number', min: 3, max: 30, value: minutos,
            onchange: e => { minutos = Math.max(3, +e.target.value || MINUTOS_POR_PASADA); pintarPlan(); },
          }),
          h('span', {}, 'minutos'))),

      /* la pregunta que abre todo: a qué hora puede venir cada uno */
      h('div.ens-vienen', {},
        h('div.ens-vienen-cab', {}, 'A qué hora puede venir cada cantante'),
        h('table.ens-tabla', {},
          h('thead', {}, h('tr', {},
            h('th', {}, ''),
            ensayos.map((e, i) => h('th', {},
              e.fecha ? fechaLinda(e.fecha) : `Ensayo ${i + 1}`,
              h('div.dim', {}, [e.hora, e.horaFin].filter(Boolean).join('–') || 'sin horario'))))),
          h('tbody', {}, gente.map(p => h('tr', {},
            h('th', {}, p.nombre, h('span.dim', {}, ` ${p.temas}`)),
            ensayos.map((e, i) => h('td', {},
              h('input.ens-hora', {
                type: 'time', value: (vienen[i] || {})[p.nombre] || '',
                title: 'Vacío quiere decir que ese día no viene',
                onchange: ev => {
                  vienen[i] = { ...(vienen[i] || {}), [p.nombre]: ev.target.value };
                  guardarVienen(jamId, vienen);
                  pintarPlan();
                },
              }))))))),

      falta.length
        ? h('div.ens-falta', {},
            h('b', {}, `No entraron ${falta.length}:`), ' ',
            falta.map(f => h('span.ens-falta-item', {},
              `${f.u.titulo} (${[f.sin ? `${f.sin} sin cantante` : '', f.con ? `${f.con} con` : ''].filter(Boolean).join(', ')})`)),
            h('p.dim', {}, 'Falta tiempo o falta que venga alguien. Sirve para agregar un ensayo o sacar un tema.'))
        : null,

      h('div.ens-dias', {}, plan.map(d => diaDelPlan(d))),

      h('div.ens-acciones', {},
        h('button.btn.primary', { onclick: () => aplicar(plan) },
          '✓ Guardar en la jam'),
        h('span.dim', {},
          'Escribe el orden del día en las notas de cada ensayo y pone la hora de llegada de cada cantante. Las convocatorias salen desde la jam, como siempre.'))));
  }

  function diaDelPlan(d) {
    const caja = h('div.ens-dia');
    poner(caja,
      h('div.ens-dia-cab', {},
        h('b', {}, d.ensayo.fecha ? fechaLinda(d.ensayo.fecha) : `Ensayo ${d.idx + 1}`),
        h('span.dim', {}, [d.ensayo.hora, d.ensayo.horaFin].filter(Boolean).join('–')),
        h('span.dim', {}, `${d.usados} de ${d.espacios} espacios`),
        h('button.btn.xs.ghost', {
          onclick: () => { copiar(planATexto(d, fechaLinda)); toast('Copiado', 'ok'); },
        }, '📋')),

      d.llamados.length
        ? h('div.ens-llamados', {}, d.llamados.map(c =>
            h('span.ens-llamado' + (c.sinTemas ? '.vacio' : ''), {
              title: c.sinTemas
                ? 'Ese día no le toca ningún tema — no hace falta que venga'
                : `Dijo que podía ${c.dijo}; sus temas empiezan ${c.hora}`,
            }, `🎤 ${c.nombre} ${c.sinTemas ? 'no hace falta' : c.hora}`)))
        : null,

      d.pasadas.length
        ? h('div.ens-pasadas', {}, d.pasadas.map(p =>
            h('div.ens-pasada' + (p.con ? '.con' : ''), {},
              h('span.ens-hora-txt', {}, p.hora),
              h('span.ens-pasada-tit', {}, p.u.titulo),
              p.veces > 1 ? h('span.ens-veces', {}, `×${p.veces}`) : null,
              p.con ? h('span.ens-con', {}, '🎤 ' + p.con) : h('span.dim', {}, 'banda sola'))))
        : h('div.dim', {}, 'Nada que hacer este día.'));
    return caja;
  }

  /* Escribe el plan en la jam: el orden del día en las notas del ensayo
     y la hora de llegada de cada cantante en su convocatoria. No inventa
     convocados —los que no estaban se agregan— ni pisa a los músicos. */
  function aplicar(plan) {
    const j = alDia();
    let tocados = 0;
    plan.forEach(d => {
      const e = (j.ensayos || [])[d.idx];
      if (!e) return;
      e.notas = d.pasadas
        .map(p => `${p.hora} ${p.u.titulo}${p.veces > 1 ? ` ×${p.veces}` : ''}${p.con ? ` (${p.con})` : ''}`)
        .join('\n');
      if (!Array.isArray(e.convocados)) e.convocados = [];
      d.llamados.filter(c => !c.sinTemas).forEach(c => {
        const ya = e.convocados.find(x => x.nombre === c.nombre);
        if (ya) ya.hora = c.hora;
        else e.convocados.push({ nombre: c.nombre, hora: c.hora, instrumento: '🎤', aviso: '' });
      });
      tocados++;
    });
    guardar();
    toast(`Guardado en ${tocados} ensayo${tocados === 1 ? '' : 's'}`, 'ok');
  }

  poner(cont,
    h('div.ens-head', {},
      h('a.btn.sm', { href: '#/ensayos' }, '← Jams'),
      h('h1', {}, jam.nombre || 'Jam'),
      h('a.btn.sm', { href: `#/jams/${jam.id}/editar` }, 'Ir a la jam')),
    panelTemas,
    panelPlan);

  pintar();
  return cont;
}

/* ---------- elegir jam ---------- */
function listaDeJams(cont) {
  const abiertas = store.jams.filter(j => !j.historica);
  poner(cont,
    h('div.ens-head', {}, h('h1', {}, 'Ensayos Admin')),
    h('p.dim', {}, 'Cómo viene cada tema y cómo repartirlos entre los ensayos de la jam.'),
    abiertas.length
      ? h('div.ens-jams', {}, abiertas.map(j => h('a.ens-jam', { href: `#/ensayos/${j.id}` },
          h('b', {}, j.nombre || 'Jam sin nombre'),
          h('span.dim', {}, [
            j.fecha ? fechaLinda(j.fecha) : 'sin fecha',
            `${(j.items || []).filter(x => x.tipo === 'song' || x.tipo === 'medley').length} temas`,
            `${(j.ensayos || []).length} ensayos`,
          ].join(' · ')))))
      : h('div.empty', {}, h('b', {}, 'No hay jams abiertas')));
  return cont;
}
