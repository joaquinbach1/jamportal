/* ============================================================
   auth.js — entrar con magic link
   ------------------------------------------------------------
   Supabase manda un mail con un link; al volver, el token viene
   en el hash de la URL. No hay contraseña que recordar ni que
   rotar, que para una banda de cinco es lo que menos molesta.

   Habla con la API de auth por fetch, sin SDK, igual que el
   driver. Guarda la sesión en localStorage y renueva el token
   solo cuando está por vencer.

   Ojo con el hash: la app rutea por `#/jams` y el token vuelve
   también en el hash, así que capturarlo tiene que pasar ANTES
   de que arranque el router, y hay que dejar la URL limpia.
   ============================================================ */

const KEY_SESION = 'jamportal.sesion';
const MARGEN_MS = 60_000;   // renovamos un minuto antes de que venza

export class Auth {
  constructor({ url, key }) {
    this.url = (url || '').replace(/\/+$/, '');
    this.key = key || '';
    this.sesion = leer();
    this.renovando = null;
  }

  get email() { return this.sesion ? this.sesion.email : null; }
  get haySesion() { return !!(this.sesion && this.sesion.refresh_token); }

  /**
   * Manda el mail con el link de entrada.
   *
   * `redirect_to` va como parámetro de la URL, no en el cuerpo — y la
   * dirección tiene que estar permitida en Authentication → URL
   * Configuration, si no Supabase manda el link a la Site URL.
   *
   * `create_user` queda en true: quien no está en la lista puede crear
   * una cuenta pero no ve absolutamente nada, porque el que decide es
   * el RLS contra la tabla `miembro`, no esta pantalla.
   */
  async enviarMagicLink(email) {
    const volverA = location.origin + location.pathname;
    const res = await fetch(
      `${this.url}/auth/v1/otp?redirect_to=${encodeURIComponent(volverA)}`, {
      method: 'POST',
      headers: { apikey: this.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, create_user: true }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.msg || d.error_description || `Auth ${res.status}`);
    }
  }

  /**
   * Si volvimos del mail, el token está en el hash. Lo guarda y deja
   * la URL como estaba, para no romper el ruteo.
   * @returns {null | {ok: true} | {error: string}}
   */
  capturarRedirect() {
    const bruto = location.hash.slice(1);
    if (!bruto.includes('access_token=') && !bruto.includes('error=')) return null;

    const p = new URLSearchParams(bruto);
    limpiarHash();

    if (p.get('error')) {
      return { error: p.get('error_description') || p.get('error') };
    }
    guardar(this.sesion = {
      access_token: p.get('access_token'),
      refresh_token: p.get('refresh_token'),
      expira: Date.now() + (parseInt(p.get('expires_in'), 10) || 3600) * 1000,
      email: emailDelJwt(p.get('access_token')),
    });
    return { ok: true };
  }

  /**
   * Un access_token válido. Si está por vencer lo renueva, y si dos
   * llamadas coinciden comparten la misma renovación.
   */
  async token() {
    if (!this.sesion) return null;
    if (Date.now() < this.sesion.expira - MARGEN_MS) return this.sesion.access_token;
    if (!this.renovando) {
      this.renovando = this.renovar().finally(() => { this.renovando = null; });
    }
    return this.renovando;
  }

  async renovar() {
    const res = await fetch(`${this.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: this.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: this.sesion.refresh_token }),
    });
    if (!res.ok) {
      this.cerrarSesion();
      throw new Error('La sesión venció. Entrá de nuevo.');
    }
    const d = await res.json();
    guardar(this.sesion = {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expira: Date.now() + (d.expires_in || 3600) * 1000,
      email: (d.user && d.user.email) || emailDelJwt(d.access_token),
    });
    return this.sesion.access_token;
  }

  cerrarSesion() {
    if (this.sesion) {
      // best effort: si falla, igual borramos la sesión de este navegador
      fetch(`${this.url}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: this.key, Authorization: `Bearer ${this.sesion.access_token}` },
      }).catch(() => {});
    }
    this.sesion = null;
    localStorage.removeItem(KEY_SESION);
  }
}

/* ---------- ayudas ---------- */
function leer() {
  try { return JSON.parse(localStorage.getItem(KEY_SESION) || 'null'); }
  catch { return null; }
}

function guardar(s) { localStorage.setItem(KEY_SESION, JSON.stringify(s)); }

/** Saca el mail del payload del JWT. No valida nada: eso lo hace la base. */
function emailDelJwt(jwt) {
  try {
    const carga = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(carga)))).email || '';
  } catch { return ''; }
}

/** Saca el token de la URL sin dejar una entrada en el historial. */
function limpiarHash() {
  const limpia = location.pathname + location.search;
  history.replaceState(null, '', limpia);
}
