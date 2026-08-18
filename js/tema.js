/* ============================================================
   tema.js — modo oscuro / claro
   ------------------------------------------------------------
   El tema es solo un atributo en <html>: todos los colores salen
   de variables CSS, así que no hay nada más que cambiar.

   Sin elección guardada, seguimos al sistema — y si el sistema
   cambia mientras la app está abierta, la seguimos también.
   ============================================================ */

const KEY = 'jamportal.tema';
const consulta = window.matchMedia('(prefers-color-scheme: light)');

export function temaGuardado() {
  const v = localStorage.getItem(KEY);
  return v === 'claro' || v === 'oscuro' ? v : null;
}

export function temaActual() {
  return temaGuardado() || (consulta.matches ? 'claro' : 'oscuro');
}

function aplicar(tema) {
  document.documentElement.dataset.tema = tema;
}

export function ponerTema(tema) {
  if (tema === null) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, tema);
  aplicar(temaActual());
}

/** Arranca el tema y deja escuchando al sistema. */
export function iniciarTema() {
  aplicar(temaActual());
  consulta.addEventListener('change', () => {
    if (!temaGuardado()) aplicar(temaActual());   // solo si no elegiste vos
  });
}

/** El botón del sidebar. Un clic alterna; se puede volver a "seguir al sistema". */
export function botonTema(h) {
  const btn = h('button.tema-btn', {
    onclick: () => {
      ponerTema(temaActual() === 'claro' ? 'oscuro' : 'claro');
      pintar();
    },
    oncontextmenu: e => {                          // clic derecho: volver al sistema
      e.preventDefault();
      ponerTema(null);
      pintar();
    },
  });

  function pintar() {
    const claro = temaActual() === 'claro';
    btn.textContent = claro ? '☀︎' : '☾';
    btn.title = (claro ? 'Modo claro' : 'Modo oscuro')
      + (temaGuardado() ? ' (elegido a mano — clic derecho para seguir al sistema)' : ' (siguiendo al sistema)');
  }

  pintar();
  return btn;
}
