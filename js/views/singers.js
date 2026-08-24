/* ============================================================
   views/singers.js — base de cantantes y músicos
   ============================================================ */

import { store, norm } from '../store.js';
import { h, frag, clear, modal, field, input, avatar, toast, confirmar, catPill, franjaDot, debounce } from '../ui.js';

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
  const gridCant = h('div.singer-grid');
  const gridMus = h('div.singer-grid');

  function tarjeta(p) {
    const temas = temasDe(p.nombre).length;
    const jams = jamsDe(p.nombre).length;
    return h('div.singer-card' + (p.activo === false ? '.off' : ''), { onclick: () => ficha(p, pintar) },
      avatar(p.nombre),
      h('div', { style: { minWidth: 0 } },
        h('div.sc-name', {}, p.nombre),
        h('div.sc-meta', {}, (p.rol === 'instrumento'
          ? (p.instrumentos || []).join(', ') + ` · ${temas} temas`
          : `${temas} temas · ${jams} jams`)
          + (p.telefono ? ' · 📱' : '') + (p.email ? ' ✉️' : ''))));
  }

  function pintar() {
    const n = norm(q);
    const filtro = p => (!n || norm(p.nombre).includes(n)) && (!soloActivos || p.activo !== false);
    clear(gridCant);
    store.cantantes.filter(filtro)
      .sort((a, b) => temasDe(b.nombre).length - temasDe(a.nombre).length || a.nombre.localeCompare(b.nombre))
      .forEach(p => gridCant.appendChild(tarjeta(p)));
    clear(gridMus);
    store.musicos.filter(filtro)
      .sort((a, b) => (b.temas || 0) - (a.temas || 0))
      .forEach(p => gridMus.appendChild(tarjeta(p)));
  }

  const buscador = h('input', { type: 'search', placeholder: 'Buscar por nombre…' });
  buscador.addEventListener('input', debounce(() => { q = buscador.value; pintar(); }, 100));

  pintar();

  return frag(
    h('div.page-head', {},
      h('div', {},
        h('h1', {}, 'Cantantes'),
        h('p.sub', {}, `${store.cantantes.length} cantantes y ${store.musicos.length} músicos, sacados del historial de jams`)),
      h('div.page-actions', {},
        h('button.btn.primary', { onclick: () => ficha({ rol: 'voz', activo: true }, pintar) }, '＋ Cantante'),
        h('button.btn', { onclick: () => ficha({ rol: 'instrumento', activo: true, instrumentos: [] }, pintar) }, '＋ Músico'))),

    h('div.filters', {},
      h('div.search', {}, buscador),
      h('label', { style: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', color: 'var(--txt-2)' } },
        h('input', { type: 'checkbox', style: { width: 'auto' }, onchange: e => { soloActivos = e.target.checked; pintar(); } }),
        'Solo activos')),

    gridCant,
    h('h2.sec', { style: { marginTop: '30px' } }, 'Músicos invitados'),
    gridMus,
  );
}
