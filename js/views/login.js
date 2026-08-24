/* ============================================================
   views/login.js — la puerta
   ------------------------------------------------------------
   Solo aparece cuando la app está conectada a la base compartida
   y no hay sesión. En modo local no se ve nunca: ahí no hay nada
   que proteger porque los datos son de este navegador.

   Entrar es con magic link. No hay contraseña, así que no hay
   contraseña que se filtre ni que alguien tenga que rotar.
   ============================================================ */

import { store } from '../store.js';
import { h, clear, toast } from '../ui.js';

/**
 * @param {HTMLElement} donde  dónde dibujar
 * @param {function} alEntrar  se llama cuando la sesión quedó lista
 */
export async function vistaLogin(donde, alEntrar) {
  const auth = await store.prepararAuth();
  const cfg = store.configNube() || {};

  const email = h('input.login-mail', {
    type: 'email', placeholder: 'tu@mail.com', autocomplete: 'email',
    autofocus: true, inputmode: 'email',
  });
  const boton = h('button.btn.primary', {}, 'Mandame el link');
  const aviso = h('div.login-aviso');

  function decir(txt, tipo = '') {
    clear(aviso);
    if (txt) aviso.appendChild(h('div.login-msg' + (tipo ? '.' + tipo : ''), {}, txt));
  }

  async function pedir() {
    const dir = email.value.trim();
    if (!dir || !dir.includes('@')) { decir('Escribí tu mail.', 'err'); email.focus(); return; }

    boton.disabled = true;
    const antes = boton.textContent;
    boton.textContent = 'Mandando…';
    try {
      await auth.enviarMagicLink(dir);
      decir(`Te mandé un link a ${dir}. Abrilo desde este mismo navegador.`, 'ok');
      email.disabled = true;
      boton.textContent = 'Link mandado ✓';
      return;
    } catch (e) {
      // El SMTP que viene con Supabase manda pocos mails por hora: si es
      // eso, conviene decirlo en vez de dejar a la persona reintentando.
      const lim = /rate|limit|seconds/i.test(e.message);
      decir(lim
        ? 'Supabase limita cuántos mails manda por hora. Esperá un rato y probá de nuevo.'
        : 'No se pudo mandar el link: ' + e.message, 'err');
      boton.disabled = false;
      boton.textContent = antes;
    }
  }

  boton.addEventListener('click', pedir);
  email.addEventListener('keydown', e => { if (e.key === 'Enter') pedir(); });

  clear(donde);
  donde.appendChild(h('div.login', {},
    h('div.login-caja', {},
      h('div.login-logo', {}, '🎸'),
      h('h1', {}, 'JAM PORTAL'),
      h('p.login-sub', {},
        'Entrá con tu mail. Te llega un link y listo — no hay contraseña.'),
      h('div.login-form', {}, email, boton),
      aviso,
      h('div.login-pie', {},
        h('span.dim', {}, cfg.url ? cfg.url.replace(/^https?:\/\//, '') : ''),
        h('button.btn.xs.ghost', {
          onclick: () => {
            if (!confirm('¿Trabajar solo en este navegador? La base compartida queda como está.')) return;
            store.desconectarNube();
            location.reload();
          },
        }, 'Trabajar sin la base compartida')))));

  // Si volvemos del mail, el token viene en el hash.
  const vuelta = auth.capturarRedirect();
  if (vuelta && vuelta.error) {
    decir('El link no sirvió: ' + vuelta.error + '. Pedí uno nuevo.', 'err');
  } else if (vuelta && vuelta.ok) {
    decir('Entrando…', 'ok');
    alEntrar();
  }

  email.focus();
}

/** ¿Hay que mostrar la puerta? */
export async function hayQueEntrar() {
  if (!store.configNube()) return false;         // modo local: no hay puerta
  const auth = await store.prepararAuth();
  // Si el token viene en el hash, la puerta se muestra igual para
  // capturarlo y entrar sola.
  if (location.hash.includes('access_token=') || location.hash.includes('error=')) return true;
  return !auth.haySesion;
}
