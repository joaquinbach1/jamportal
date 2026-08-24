/* ============================================================
   views/login.js — la puerta
   ------------------------------------------------------------
   Solo aparece cuando la app está conectada a la base compartida
   y no hay sesión. En modo local no se ve nunca: ahí no hay nada
   que proteger porque los datos son de este navegador.

   Se entra con mail y contraseña. El magic link queda abajo,
   como salida para quien se la olvidó: depende de que lleguen
   mails, que con el SMTP incluido de Supabase son dos por hora.

   Se puede crear cuenta desde acá. Lo que la hace segura es que
   Supabase no la confirma sola: manda un mail y hasta que no se
   abra ese link, la cuenta no entra. Sin eso, cualquiera que
   supiera qué mail está en `miembro` podría adelantarse y
   quedarse con esa cuenta.

   Crear cuenta no da acceso: además hay que estar en `miembro`,
   y eso lo hace alguien de la banda.
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
  const clave = h('input.login-mail', {
    type: 'password', placeholder: 'contraseña', autocomplete: 'current-password',
  });
  const boton = h('button.btn.primary', {}, 'Entrar');
  const aviso = h('div.login-aviso');
  const sub = h('p.login-sub', {}, 'Entrá con tu mail y tu contraseña.');
  let modo = 'entrar';   // 'entrar' | 'registro'
  const cambiarModo = h('button.btn.xs.ghost');

  function decir(txt, tipo = '') {
    clear(aviso);
    if (txt) aviso.appendChild(h('div.login-msg' + (tipo ? '.' + tipo : ''), {}, txt));
  }

  async function entrar() {
    const dir = email.value.trim();
    if (!dir || !dir.includes('@')) { decir('Escribí tu mail.', 'err'); email.focus(); return; }
    if (!clave.value) { decir('Falta la contraseña.', 'err'); clave.focus(); return; }

    boton.disabled = true;
    const antes = boton.textContent;
    boton.textContent = 'Entrando…';
    try {
      await auth.entrarConClave(dir, clave.value);
      decir('Listo, entrando…', 'ok');
      alEntrar();
    } catch (e) {
      decir(e.message, 'err');
      boton.disabled = false;
      boton.textContent = antes;
      clave.select();
    }
  }

  async function pedirLink() {
    const dir = email.value.trim();
    if (!dir || !dir.includes('@')) { decir('Escribí tu mail primero.', 'err'); email.focus(); return; }
    decir('Mandando…');
    try {
      await auth.enviarMagicLink(dir);
      decir(`Te mandé un link a ${dir}. Abrilo desde este mismo navegador.`, 'ok');
    } catch (e) {
      // El SMTP incluido manda dos mails por hora: cuando se agota, la
      // persona merece saber que no es culpa suya ni de la contraseña.
      const lim = /rate|limit|seconds|too many/i.test(e.message);
      const off = /disabled|not allowed/i.test(e.message);
      decir(lim
        ? 'Supabase manda pocos mails por hora y el cupo está agotado. '
          + 'Esperá un rato, o pedile a alguien que te resetee la contraseña.'
        : off
          ? 'El login por mail está apagado en Supabase, así que no hay link. '
            + 'Pedile a alguien que te resetee la contraseña.'
          : 'No se pudo mandar el link: ' + e.message, 'err');
    }
  }

  async function registrar() {
    const dir = email.value.trim();
    if (!dir || !dir.includes('@')) { decir('Escribí tu mail.', 'err'); email.focus(); return; }
    if (clave.value.length < 8) {
      decir('La contraseña tiene que tener al menos 8 caracteres.', 'err');
      clave.focus(); return;
    }

    boton.disabled = true;
    const antes = boton.textContent;
    boton.textContent = 'Creando…';
    try {
      await auth.registrarse(dir, clave.value);
      // No podemos afirmar que se creó: si el mail ya existía, Supabase
      // devuelve lo mismo para no delatar quién tiene cuenta.
      decir(`Si ese mail no tenía cuenta, te llegó un link a ${dir} para `
        + 'confirmarla. Abrilo desde este navegador. Después pedile a alguien '
        + 'de la banda que te habilite, si todavía no lo hizo.', 'ok');
      boton.textContent = 'Revisá tu mail ✓';
    } catch (e) {
      decir(e.message, 'err');
      boton.disabled = false;
      boton.textContent = antes;
    }
  }

  function ponerModo(m) {
    modo = m;
    const registro = m === 'registro';
    boton.textContent = registro ? 'Crear cuenta' : 'Entrar';
    boton.disabled = false;
    clave.autocomplete = registro ? 'new-password' : 'current-password';
    clave.placeholder = registro ? 'contraseña nueva (mínimo 8)' : 'contraseña';
    clear(sub);
    sub.append(registro
      ? 'Elegí tu contraseña. Te vamos a mandar un mail para confirmar.'
      : 'Entrá con tu mail y tu contraseña.');
    clear(cambiarModo);
    cambiarModo.append(registro ? '← Ya tengo cuenta' : '¿Primera vez? Creá tu cuenta');
    decir('');
  }

  const enviar = () => (modo === 'registro' ? registrar() : entrar());
  boton.addEventListener('click', enviar);
  cambiarModo.addEventListener('click', () => ponerModo(modo === 'registro' ? 'entrar' : 'registro'));
  for (const campo of [email, clave]) {
    campo.addEventListener('keydown', e => { if (e.key === 'Enter') enviar(); });
  }
  ponerModo('entrar');

  clear(donde);
  donde.appendChild(h('div.login', {},
    h('div.login-caja', {},
      h('div.login-logo', {}, '🎸'),
      h('h1', {}, 'JAM PORTAL'),
      sub,
      h('div.login-campos', {}, email, clave, boton),
      aviso,
      h('div.login-pie', {},
        cambiarModo,
        h('button.btn.xs.ghost', { onclick: pedirLink },
          '¿Te olvidaste? Pedí un link por mail'),
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
