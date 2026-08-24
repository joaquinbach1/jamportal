/* ============================================================
   realtime.js — enterarse en el momento
   ------------------------------------------------------------
   Un WebSocket contra Supabase Realtime, hablando el protocolo
   Phoenix a mano para no sumar el SDK (y con él un bundler).

   Escucha una sola tabla: `revision`, que es una fila con un
   contador. Por el socket no viaja ni un dato del repertorio —
   el aviso dice "algo cambió" y la app vuelve a leer por la vía
   de siempre, que ya pasa por los permisos. Menos superficie y
   nada que se pueda filtrar por el canal.

   Si el socket no levanta o se cae, no pasa nada grave: el
   sondeo de siempre sigue ahí como red.
   ============================================================ */

const LATIDO_MS = 30_000;      // Phoenix corta la conexión sin latido
const REINTENTO_BASE = 1_000;
const REINTENTO_MAX = 30_000;
const TOPICO = 'realtime:jamportal';

export class Realtime {
  /**
   * @param {object} o
   * @param {string} o.url      https://xxxx.supabase.co
   * @param {string} o.key      clave publicable
   * @param {object} o.auth     para sacar el JWT (y renovarlo)
   * @param {function} o.alCambiar  se llama cuando alguien más guardó
   * @param {function} [o.alEstado] 'conectando' | 'conectado' | 'caido'
   */
  constructor({ url, key, auth, alCambiar, alEstado }) {
    this.url = (url || '').replace(/^http/, 'ws').replace(/\/+$/, '');
    this.key = key;
    this.auth = auth;
    this.alCambiar = alCambiar || (() => {});
    this.alEstado = alEstado || (() => {});
    this.ws = null;
    this.ref = 0;
    this.latido = null;
    this.reintento = null;
    this.intentos = 0;
    this.vivo = false;         // false = nos desconectaron a propósito
    this.suscripto = false;
  }

  get conectado() { return this.suscripto; }

  async conectar() {
    this.vivo = true;
    const token = this.auth ? await this.auth.token() : null;
    if (!token) return;                      // sin sesión no hay nada que oír

    this.alEstado('conectando');
    const ws = new WebSocket(
      `${this.url}/realtime/v1/websocket?apikey=${encodeURIComponent(this.key)}&vsn=1.0.0`);
    this.ws = ws;

    ws.onopen = () => {
      this.intentos = 0;
      this.mandar(TOPICO, 'phx_join', {
        config: {
          postgres_changes: [
            { event: 'UPDATE', schema: 'public', table: 'revision' },
          ],
        },
        access_token: token,
      });
      clearInterval(this.latido);
      this.latido = setInterval(() => this.mandar('phoenix', 'heartbeat', {}), LATIDO_MS);
    };

    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }

      if (m.event === 'postgres_changes') {
        this.alCambiar();
        return;
      }
      if (m.event === 'phx_reply' && m.topic === TOPICO) {
        if (m.payload && m.payload.status === 'ok') {
          this.suscripto = true;
          this.alEstado('conectado');
        } else {
          // Se une pero no se suscribe: mejor caer al sondeo que
          // quedarnos creyendo que estamos escuchando.
          console.warn('Realtime rechazó la suscripción', m.payload);
          this.alEstado('caido');
        }
        return;
      }
      if (m.event === 'phx_error' || m.event === 'phx_close') {
        this.suscripto = false;
        this.alEstado('caido');
      }
    };

    ws.onerror = () => { this.suscripto = false; this.alEstado('caido'); };

    ws.onclose = () => {
      this.suscripto = false;
      clearInterval(this.latido);
      this.alEstado('caido');
      if (this.vivo) this.reconectar();
    };
  }

  /** Espera cada vez más, para no martillar si Supabase está caído. */
  reconectar() {
    clearTimeout(this.reintento);
    const espera = Math.min(REINTENTO_BASE * 2 ** this.intentos, REINTENTO_MAX);
    this.intentos++;
    this.reintento = setTimeout(() => this.conectar().catch(() => {}), espera);
  }

  /** El JWT vence cada hora: hay que pasarle el nuevo al socket. */
  async refrescarToken() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.auth) return;
    const token = await this.auth.token().catch(() => null);
    if (!token || token === this.ultimoToken) return;   // no repetimos el mismo
    this.ultimoToken = token;
    this.mandar(TOPICO, 'access_token', { access_token: token });
  }

  mandar(topic, event, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ topic, event, payload, ref: String(++this.ref) }));
  }

  desconectar() {
    this.vivo = false;
    this.suscripto = false;
    clearInterval(this.latido);
    clearTimeout(this.reintento);
    if (this.ws) { try { this.ws.close(); } catch { /* ya estaba cerrado */ } }
    this.ws = null;
  }
}
