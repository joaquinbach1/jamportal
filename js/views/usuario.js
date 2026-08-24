/* ============================================================
   views/usuario.js — quién sos, y cómo salir
   ------------------------------------------------------------
   Un chip en el pie del sidebar con las iniciales y el mail, y
   un menú con lo poco que hay para hacer: cambiar la contraseña
   y salir.

   Solo aparece contra la base compartida. En modo local no hay
   con quién identificarse.
   ============================================================ */

import { store } from '../store.js';
import { h, clear, modal, input, toast, avatar } from '../ui.js';

/* ---------- cambiar la propia contraseña ---------- */
export function dialogoClave() {
  const f1 = input({ type: 'password', autocomplete: 'new-password',
                     placeholder: 'nueva contraseña (mínimo 8)' });
  const f2 = input({ type: 'password', autocomplete: 'new-password',
                     placeholder: 'repetila' });

  const m = modal({
    title: 'Cambiar contraseña',
    body: h('div', { style: { display: 'grid', gap: '10px' } }, f1, f2,
      h('div.method-hint', {},
        'Se cambia en el acto y no se manda ningún mail. Las sesiones que tengas '
        + 'abiertas en otros dispositivos siguen andando hasta que venzan.')),
    footer: [
      h('button.btn.ghost', { onclick: () => m.close() }, 'Cancelar'),
      h('button.btn.primary', {
        onclick: async e => {
          if (f1.value !== f2.value) { toast('No coinciden', 'err'); f2.select(); return; }
          const b = e.currentTarget; b.disabled = true; b.textContent = 'Cambiando…';
          try {
            await store.auth.cambiarClave(f1.value);
            m.close();
            toast('Contraseña cambiada', 'ok');
          } catch (err) {
            toast(err.message, 'err');
            b.disabled = false; b.textContent = 'Cambiar';
          }
        },
      }, 'Cambiar'),
    ],
  });
  f1.focus();
}

/* ---------- el chip del sidebar ---------- */
export function montarUsuario(slot) {
  clear(slot);
  if (!store.enLaNube || !store.email) return;

  const mail = store.email;
  const nombre = mail.split('@')[0].replace(/[._-]+/g, ' ');

  const menu = h('div.umenu', { hidden: true },
    h('div.umenu-mail', {}, mail),
    h('button.umenu-item', {
      onclick: () => { cerrar(); dialogoClave(); },
    }, 'Cambiar contraseña'),
    h('button.umenu-item.danger', {
      onclick: () => { cerrar(); store.cerrarSesion(); location.reload(); },
    }, 'Salir'));

  const chip = h('button.uchip', {
    title: mail,
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    onclick: e => { e.stopPropagation(); menu.hidden ? abrir() : cerrar(); },
  }, avatar(nombre), h('span.uchip-mail', {}, mail));

  function abrir() {
    menu.hidden = false;
    chip.setAttribute('aria-expanded', 'true');
    // Se cierra al tocar cualquier otra cosa o con Escape, que es lo que
    // espera cualquiera que haya usado un menú antes.
    document.addEventListener('click', afuera);
    document.addEventListener('keydown', escape);
  }
  function cerrar() {
    menu.hidden = true;
    chip.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', afuera);
    document.removeEventListener('keydown', escape);
  }
  const afuera = e => { if (!menu.contains(e.target)) cerrar(); };
  const escape = e => { if (e.key === 'Escape') cerrar(); };

  slot.appendChild(h('div.uwrap', {}, chip, menu));
}
