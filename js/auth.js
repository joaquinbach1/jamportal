/* ============================================================
   auth.js — entrar
   ------------------------------------------------------------
   Dos caminos. El principal es con contraseña: no depende de que
   lleguen mails, que con el SMTP incluido de Supabase son dos por
   hora y se agotan enseguida.

   El otro es el magic link, que queda como salida de emergencia
   para quien se olvidó la clave. Sirve solo si el Email provider
   está prendido y hay cupo.

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
   * Entra con mail y contraseña. Es el camino de todos los días:
   * no manda ningún mail.
   */
  async entrarConClave(email, clave) {
    const res = await fetch(`${this.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: this.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: (email || '').trim(), password: clave }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Supabase no distingue mail inexistente de clave equivocada, a
      // propósito: decirlo permitiría averiguar quién tiene cuenta.
      if (d.error_code === 'invalid_credentials') {
        throw new Error('Mail o contraseña incorrectos.');
      }
      if (d.error_code === 'email_not_confirmed') {
        throw new Error('Todavía no confirmaste tu mail. Abrí el link que te mandamos.');
      }
      if (d.error_code === 'email_provider_disabled') {
        throw new Error('El login por mail está apagado en Supabase. '
          + 'Hay que prender Authentication → Providers → Email.');
      }
      throw new Error(d.msg || d.error_description || `Auth ${res.status}`);
    }
    guardar(this.sesion = {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expira: Date.now() + (d.expires_in || 3600) * 1000,
      email: (d.user && d.user.email) || emailDelJwt(d.access_token),
    });
    return this.sesion;
  }

  /**
   * Crea una cuenta. NO devuelve sesión: Supabase manda un mail de
   * confirmación y hasta que no se abra ese link, la cuenta no entra.
   *
   * Eso es lo que hace seguro dejar el registro abierto. Si las cuentas
   * quedaran confirmadas solas, cualquiera que supiera qué mail está en
   * `miembro` podría adelantarse y quedarse con esa cuenta.
   *
   * Ojo con la respuesta: si el mail ya existe, Supabase devuelve 200 con
   * un usuario inventado en vez de decir "ya está registrado", para que
   * nadie pueda averiguar quién tiene cuenta. Por eso el mensaje que
   * mostramos no puede afirmar que la cuenta se creó.
   */
  async registrarse(email, clave) {
    const volverA = location.origin + location.pathname;
    const res = await fetch(
      `${this.url}/auth/v1/signup?redirect_to=${encodeURIComponent(volverA)}`, {
      method: 'POST',
      headers: { apikey: this.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: (email || '').trim(), password: clave }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (d.error_code === 'signup_disabled') {
        throw new Error('El registro está cerrado. Pedile a alguien de la banda que te dé de alta.');
      }
      if (d.error_code === 'weak_password' || /password/i.test(d.msg || '')) {
        throw new Error('Esa contraseña es muy corta. Poné al menos 8 caracteres.');
      }
      if (/rate|limit/i.test(d.msg || d.error_code || '')) {
        throw new Error('Demasiados intentos seguidos. Esperá un minuto.');
      }
      throw new Error(d.msg || d.error_description || `Auth ${res.status}`);
    }
    return { confirmar: !d.access_token };
  }

  /** Cambia la contraseña de quien está adentro. */
  async cambiarClave(nueva) {
    if ((nueva || '').length < 8) {
      throw new Error('La contraseña tiene que tener al menos 8 caracteres.');
    }
    const token = await this.token();
    const res = await fetch(`${this.url}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: nueva }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      if (d.error_code === 'same_password') {
        throw new Error('Esa ya es tu contraseña. Poné una distinta.');
      }
      if (d.error_code === 'weak_password') {
        throw new Error('Esa contraseña es muy fácil. Probá una más larga.');
      }
      throw new Error(d.msg || `No se pudo cambiar: ${res.status}`);
    }
  }

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
