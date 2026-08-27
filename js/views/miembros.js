/* ============================================================
   views/miembros.js — quién puede entrar
   ------------------------------------------------------------
   Solo la ven los admins. Antes esto se manejaba por psql, así
   que cuando alguien se registraba se quedaba afuera hasta que
   apareciera quien tenía la contraseña de la base.

   Estar en la lista no crea la cuenta: cada uno se registra
   desde la pantalla de entrada. Se puede habilitar un mail
   antes de que esa persona se registre — la columna "cuenta"
   distingue "lo habilité" de "ya entró".
   ============================================================ */

import { store } from '../store.js';
import { h, clear, input, toast, confirmar, avatar, fechaLinda } from '../ui.js';

export function tarjetaMiembros() {
  if (!store.esAdmin) return null;

  const lista = h('div.miembros');
  const fMail = input({ type: 'email', placeholder: 'mail@ejemplo.com',
                        autocomplete: 'off', inputmode: 'email' });
  const bAdd = h('button.btn.primary.sm', {}, 'Agregar');

  async function refrescar() {
    clear(lista);
    lista.appendChild(h('div.dim', { style: { fontSize: '13px' } }, 'Cargando…'));
    try {
      const filas = await store.driver.listarMiembros();
      pintar(filas || []);
    } catch (e) {
      clear(lista);
      lista.appendChild(h('div.login-msg.err', {}, 'No pude traer la lista: ' + e.message));
    }
  }

  function pintar(filas) {
    clear(lista);
    for (const m of filas) {
      lista.appendChild(h('div.miembro', {},
        avatar(m.email.split('@')[0]),
        h('div', { style: { minWidth: 0 } },
          h('div.miembro-mail', {}, m.email,
            m.soy_yo ? h('span.miembro-vos', {}, 'vos') : null),
          h('div.miembro-meta', {},
            m.admin ? h('span.miembro-tag.admin', {}, 'admin') : null,
            m.tiene_cuenta
              ? h('span.dim', {}, 'ya entró')
              : h('span.miembro-tag.espera', { title: 'Todavía no se registró desde la app' }, 'sin registrarse'),
            h('span.dim', {}, '· desde ' + fechaLinda(m.alta.slice(0, 10))))),
        h('div.miembro-acciones', {},
          h('button.btn.xs.ghost', {
            title: m.admin ? 'Dejarlo como miembro común' : 'Que también pueda manejar la lista',
            onclick: e => accion(e.currentTarget, () => store.driver.setAdmin(m.email, !m.admin)),
          }, m.admin ? 'Quitar admin' : 'Hacer admin'),
          m.soy_yo ? null : h('button.btn.xs.ghost.danger', {
            onclick: async e => {
              // El botón se guarda ANTES del await: currentTarget solo vale
              // mientras el evento se está despachando, y después de esperar
              // la confirmación ya es null.
              const boton = e.currentTarget;
              if (!(await confirmar(
                `${m.email} deja de ver la jam en el acto. La cuenta le queda, `
                + 'pero la base no le muestra nada.',
                { titulo: 'Sacar de la lista', okText: 'Sacar' }))) return;
              accion(boton, () => store.driver.sacarMiembro(m.email));
            },
          }, 'Sacar'))));
    }
  }

  /** @param {HTMLElement} boton el botón, no el evento: ver arriba. */
  async function accion(boton, fn) {
    boton.disabled = true;
    try { await fn(); await refrescar(); }
    catch (e) { toast(e.message, 'err'); boton.disabled = false; }
  }

  async function agregar() {
    const mail = fMail.value.trim();
    if (!mail.includes('@')) { toast('Escribí un mail', 'err'); fMail.focus(); return; }
    bAdd.disabled = true;
    try {
      await store.driver.agregarMiembro(mail, false);
      fMail.value = '';
      toast(`${mail} habilitado`, 'ok');
      await refrescar();
    } catch (e) {
      toast(e.message, 'err');
    }
    bAdd.disabled = false;
    fMail.focus();
  }

  bAdd.addEventListener('click', agregar);
  fMail.addEventListener('keydown', e => { if (e.key === 'Enter') agregar(); });
  refrescar();

  return h('div.card', {},
    h('h2.sec', {}, 'Miembros'),
    h('p.method-hint', {},
      'Quién puede ver y editar la jam. Habilitar un mail no crea la cuenta: '
      + 'esa persona todavía tiene que registrarse desde la pantalla de entrada, '
      + 'y se puede habilitar antes de que lo haga.'),
    lista,
    h('div.miembros-alta', {}, fMail, bAdd));
}
