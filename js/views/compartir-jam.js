/* ============================================================
   views/compartir-jam.js — el link de una jam, y la vuelta atrás
   ------------------------------------------------------------
   Los dos diálogos que van juntos, porque uno es la razón del
   otro: si cualquiera con el link puede editar la lista, tiene
   que haber cómo volver atrás.

   Viven acá y no adentro de una vista porque hacen falta en las
   dos —la lista del celular y el editor de la compu—, y un
   miembro tiene que poder sacar el link desde donde esté.
   ============================================================ */

import { store } from '../store.js';
import { h, clear, modal, input, toast, confirmar, copiar, poner } from '../ui.js';

/**
 * El link para compartir la jam.
 *
 * Quien lo tenga entra sin cuenta y edita ESTA jam. El diálogo lo dice
 * con todas las letras: es un permiso que se regala por WhatsApp y
 * conviene que quien lo manda sepa qué está mandando. Cortarlo es
 * borrar el token, y el link muere para todos en el momento.
 */
export function dialogoLink(jam) {
  const caja = h('div', {}, h('div.method-hint', {}, 'Pidiendo el link…'));
  const m = modal({
    title: 'Link para compartir',
    body: [caja],
    footer: [h('button.btn.ghost', { onclick: () => m.close() }, 'Cerrar')],
  });

  (async () => {
    let token;
    try {
      token = await store.driver.rpc('crear_token', { p_jam: jam.id });
    } catch (e) {
      poner(clear(caja), h('div.method-hint', {}, 'No se pudo: ' + e.message));
      return;
    }
    const url = location.href.split('#')[0] + '#/v/' + token;
    const campo = input({ value: url, readonly: true, onclick: e => e.target.select() });

    poner(clear(caja),
      h('div.method-hint', {},
        h('b', {}, 'Cualquiera con este link entra sin cuenta y puede editar esta jam.'),
        ' Ve el setlist y el repertorio para poder buscar temas. No ve las otras jams, ',
        'ni los teléfonos y mails de la gente, ni los ensayos. Cada cambio deja copia: ',
        'se vuelve atrás desde «Versiones anteriores».'),
      campo,
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' } },
        h('button.btn.primary', {
          onclick: () => { copiar(url); toast('Link copiado', 'ok'); },
        }, '📋 Copiar'),
        h('button.btn.ghost.danger', {
          onclick: async () => {
            const ok = await confirmar(
              'El link deja de funcionar para todos los que lo tengan. Podés generar '
              + 'uno nuevo cuando quieras, pero va a ser otro link.',
              { titulo: 'Cortar el link', okText: 'Cortarlo' });
            if (!ok) return;
            try {
              await store.driver.rpc('quitar_token', { p_jam: jam.id });
              m.close(); toast('Link cortado');
            } catch (e) { toast('No se pudo: ' + e.message, 'err'); }
          },
        }, 'Cortar el link')));
  })();

  return m;
}

/**
 * Las versiones anteriores de la lista.
 *
 * La base guarda una copia antes de cada guardado —venga de un miembro
 * o del link— y se queda con las últimas 20. Restaurar solo cambia los
 * temas: la fecha, la hora y el lugar quedan como están, porque volver
 * la lista atrás no debería mover la jam de día.
 *
 * @param {object} jam
 * @param {function} [alRestaurar] para que la vista se redibuje
 */
export function dialogoRespaldos(jam, alRestaurar = () => {}) {
  const caja = h('div', {}, h('div.method-hint', {}, 'Buscando…'));
  const m = modal({
    title: 'Versiones anteriores',
    body: [caja],
    footer: [h('button.btn.ghost', { onclick: () => m.close() }, 'Cerrar')],
  });

  (async () => {
    let lista;
    try {
      lista = await store.driver.rpc('respaldos_de', { p_jam: jam.id });
    } catch (e) {
      poner(clear(caja), h('div.method-hint', {}, 'No se pudo: ' + e.message));
      return;
    }
    if (!lista || !lista.length) {
      poner(clear(caja), h('div.method-hint', {},
        'Todavía no hay ninguna. Se guarda una copia antes de cada cambio, así que '
        + 'la primera aparece en cuanto alguien toque la lista.'));
      return;
    }

    const cuando = iso => new Date(iso).toLocaleString('es-AR',
      { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

    poner(clear(caja),
      h('div.method-hint', {},
        'Cada una es cómo estaba la lista ANTES de un cambio. Restaurar cambia solo '
        + 'los temas; la fecha, la hora y el lugar quedan como están.'),
      ...lista.map(r => h('div.respaldo', {},
        h('div', { style: { minWidth: 0, flex: 1 } },
          h('b', {}, `${r.temas} tema${r.temas === 1 ? '' : 's'}`),
          h('div.dim', { style: { fontSize: '12px' } }, `${cuando(r.cuando)}  ·  ${r.quien}`)),
        h('button.btn.xs', {
          onclick: async e => {
            const btn = e.currentTarget;
            const ok = await confirmar(
              `Vuelve la lista a esos ${r.temas} temas. Lo de ahora queda guardado como `
              + 'una versión más, así que esto también se puede deshacer.',
              { titulo: 'Restaurar', danger: false, okText: 'Restaurar' });
            if (!ok) return;
            btn.disabled = true;
            try {
              await store.driver.rpc('restaurar_respaldo', { p_id: r.id });
              await store.sincronizar();
              m.close(); alRestaurar(); toast('Lista restaurada', 'ok');
            } catch (err) {
              toast('No se pudo: ' + err.message, 'err');
              btn.disabled = false;
            }
          },
        }, 'Restaurar'))));
  })();

  return m;
}
