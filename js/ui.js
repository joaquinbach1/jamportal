/* ============================================================
   ui.js — helpers de DOM, modales, toasts, autocomplete
   ============================================================ */

/** Mini hyperscript: h('div.card', {onclick}, hijo1, hijo2) */
export function h(sel, props = {}, ...children) {
  const [tagPart, ...classes] = sel.split('.');
  const [tag, id] = tagPart.split('#');
  const node = document.createElement(tag || 'div');
  if (id) node.id = id;
  if (classes.length) node.className = classes.join(' ');

  if (props && (props.nodeType || Array.isArray(props) || typeof props === 'string')) {
    children.unshift(props); props = {};
  }

  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className += (node.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k in node && k !== 'list') node[k] = v;
    else node.setAttribute(k, v);
  }

  append(node, children);
  return node;
}

function append(node, children) {
  for (const c of children.flat(4)) {
    if (c == null || c === false || c === '') continue;
    node.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

export const frag = (...children) => { const f = document.createDocumentFragment(); append(f, children); return f; };
export const $  = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const clear = n => { while (n.firstChild) n.removeChild(n.firstChild); return n; };

/** Como append(), pero saltea null y false — el append nativo los escribiría
    literalmente como "null". Útil para listas con partes condicionales. */
export function poner(cont, ...hijos) {
  cont.append(...hijos.flat(4).filter(x => x != null && x !== false && x !== ''));
  return cont;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ---------- toasts ---------- */
export function toast(msg, kind = '') {
  const t = h('div.toast' + (kind ? '.' + kind : ''), msg);
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .25s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 260); }, 2600);
}

/* ---------- modal ---------- */
export function modal({ title, body, footer, wide = false, onClose }) {
  const root = document.getElementById('modalRoot');
  const close = () => { back.remove(); document.removeEventListener('keydown', esc); onClose && onClose(); };
  const esc = e => { if (e.key === 'Escape') close(); };

  const box = h('div.modal' + (wide ? '.wide' : ''), {},
    h('div.modal-head', {},
      h('h3', {}, title),
      h('button.icon-btn', { onclick: close, title: 'Cerrar (Esc)' }, '✕')),
    h('div.modal-body', {}, body),
    footer ? h('div.modal-foot', {}, footer) : null,
  );

  const back = h('div.modal-back', { onclick: e => { if (e.target === back) close(); } }, box);
  clear(root).appendChild(back);
  document.addEventListener('keydown', esc);
  setTimeout(() => { const f = box.querySelector('input,textarea,select'); f && f.focus(); }, 40);
  return { close, box };
}

/**
 * Hoja de acciones, para el dedo.
 * En vez de cinco íconos de 40px apretados contra el borde, una lista
 * con el nombre de cada cosa. Se acierta sin mirar y se entiende qué hace.
 *   acciones: [{ icono, texto, onClick, peligro?, clase? }]
 *   detalle:  nodo opcional debajo del título, para lo que hay que LEER
 *             (de qué tema estamos hablando) y no tocar.
 */
export function hojaAcciones(titulo, acciones, { detalle = null } = {}) {
  const cerrar = () => { back.remove(); document.removeEventListener('keydown', esc); };
  const esc = e => { if (e.key === 'Escape') cerrar(); };

  const hoja = h('div.hoja', {},
    h('div.hoja-titulo', {}, titulo),
    detalle,
    ...acciones.filter(Boolean).map(a => h('button.hoja-item'
      + (a.peligro ? '.peligro' : '') + (a.clase ? '.' + a.clase : ''), {
      onclick: () => { cerrar(); a.onClick(); },
    }, h('span.hoja-icono', {}, a.icono), h('span', {}, a.texto))),
    h('button.hoja-item.hoja-cancelar', { onclick: cerrar }, 'Cancelar'));

  const back = h('div.hoja-back', { onclick: e => { if (e.target === back) cerrar(); } }, hoja);
  clear(document.getElementById('modalRoot')).appendChild(back);
  document.addEventListener('keydown', esc);
  return { cerrar };
}

export function confirmar(msg, { titulo = 'Confirmar', danger = true, okText = 'Sí, dale' } = {}) {
  return new Promise(resolve => {
    const m = modal({
      title: titulo,
      body: h('p', { style: { margin: 0, color: 'var(--txt-2)', lineHeight: '1.6' } }, msg),
      footer: [
        h('button.btn.ghost', { onclick: () => { m.close(); resolve(false); } }, 'Cancelar'),
        h('button.btn' + (danger ? '.danger' : '.primary'), { onclick: () => { m.close(); resolve(true); } }, okText),
      ],
    });
  });
}

/* ---------- campos ---------- */
export function field(label, input) {
  return h('label.field', {}, h('span', {}, label), input);
}

export function input(props = {}) { return h('input', { type: 'text', ...props }); }

export function select(options, props = {}) {
  const s = h('select', props);
  for (const o of options) {
    const { value, label } = typeof o === 'string' ? { value: o, label: o } : o;
    s.appendChild(h('option', { value, selected: props.value === value }, label));
  }
  if (props.value !== undefined) s.value = props.value;
  return s;
}

/* ---------- visuales de dominio ---------- */
/* Las categorías del repertorio, con su pill y su nombre corto.
   Ojo con el orden: "Internacional" contiene "nacional", así que va primero.
   El corte es por idioma y origen, no por género. */
const CAT_CLASS = [
  [/internacional/i,          'cat-intl', 'INTL', 'Internacional'],
  [/nacional|rioplatense/i,   'cat-nac',  'NAC',  'Nacional'],
  [/latino|espa/i,            'cat-lat',  'LAT',  'Latino'],
  [/cumbia|tropical|cuarteto/i, 'cat-cum','TROP', 'Tropical'],
];

/** Nombre corto de una categoría, para botones y filtros. */
export function catCorta(categoria) {
  const m = CAT_CLASS.find(([re]) => re.test(categoria || ''));
  return m ? m[3] : (categoria || '').split(/[ (]/)[0].replace(/,$/, '');
}

export function catPill(categoria) {
  const m = CAT_CLASS.find(([re]) => re.test(categoria || '')) || [null, 'cat-intl', '—'];
  return h('span.cat-pill.' + m[1], { title: categoria }, m[2]);
}
export function catClass(categoria) {
  const m = CAT_CLASS.find(([re]) => re.test(categoria || ''));
  return m ? m[1] : 'cat-intl';
}

export function franjaDot(franja) {
  return h('span.dot.' + (franja || 'none'), { title: franja ? franja.toUpperCase() : 'sin tempo' });
}

/* Los avatares se pintan con la paleta de acentos: en claro se oscurecen
   desde el CSS para que el texto blanco encima siga leyéndose. */
const AV_COLORS = ['var(--av-1)', 'var(--av-2)', 'var(--av-3)', 'var(--av-4)',
                   'var(--av-5)', 'var(--av-6)', 'var(--av-7)', 'var(--av-8)'];
export function avatar(nombre) {
  const iniciales = (nombre || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  let hash = 0;
  for (const ch of nombre || '') hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return h('div.avatar', { style: { background: AV_COLORS[hash % AV_COLORS.length] } }, iniciales);
}

/* ============================================================
   Autocomplete de canciones
   ------------------------------------------------------------
   opts: { placeholder, onPick(song), onNew(query), buscarWeb(query)->Promise[],
           onPickWeb(resultado), clearOnPick }
   ============================================================ */
export function songAutocomplete(opts) {
  const {
    placeholder = 'Escribí el nombre del tema…',
    buscar, onPick, onNew, buscarWeb, onPickWeb,
    /* Una fuente extra, opcional, que va PRIMERA: son pocos y más
       específicos que un tema suelto, así que enterrarlos abajo de veinte
       resultados sería esconderlos. Hoy la usan los medleys. */
    buscarExtra, onPickExtra, nodoExtra, seccionExtra = '',
    clearOnPick = true, autofocus = false,
    /* Cerrar al perder el foco es lo correcto cuando el desplegable flota
       sobre otra cosa. Cuando el desplegable ES la pantalla, no: en iOS,
       el ✓ que baja el teclado también saca el foco, y se llevaba puesta
       la lista de resultados que la persona estaba por tocar. */
    cerrarAlSalir = true,
  } = opts;

  let items = [];      // [{kind:'db'|'web'|'new', ...}]
  let hl = -1;
  let webResultados = [];
  let ultimaWeb = '';

  const inp = h('input', { type: 'text', placeholder, autocomplete: 'off', spellcheck: false });
  const menu = h('div.ac-menu', { style: { display: 'none' } });
  const wrap = h('div.ac-wrap', {}, inp, menu);

  const cerrar = () => { menu.style.display = 'none'; hl = -1; };

  function pintar() {
    clear(menu);
    if (!items.length) { cerrar(); return; }
    let seccion = null;
    items.forEach((it, i) => {
      if (it.seccion !== seccion) {
        seccion = it.seccion;
        if (seccion) menu.appendChild(h('div.ac-head', {}, seccion));
      }
      menu.appendChild(it.node(i === hl));
    });
    menu.style.display = 'block';
  }

  function elegir(i) {
    const it = items[i];
    if (!it) return;
    it.pick();
    if (clearOnPick) { inp.value = ''; items = []; }
    cerrar();
    inp.focus();
  }

  function construir(q) {
    const found = buscar(q);
    items = (buscarExtra ? buscarExtra(q) : []).map(x => ({
      seccion: seccionExtra,
      node: (on) => {
        const nodo = nodoExtra(x);
        nodo.classList.add('ac-item');
        if (on) nodo.classList.add('hl');
        nodo.addEventListener('mousedown', e => e.preventDefault());
        nodo.addEventListener('click', () => {
          onPickExtra(x); if (clearOnPick) inp.value = ''; cerrar();
        });
        return nodo;
      },
      pick: () => onPickExtra(x),
    }));

    items.push(...found.map(s => ({
      seccion: 'En DBSongs',
      node: (on) => h('div.ac-item' + (on ? '.hl' : ''), { onmousedown: e => e.preventDefault(), onclick: () => { onPick(s); if (clearOnPick) inp.value = ''; cerrar(); } },
        franjaDot(s.franja),
        h('div', {}, h('div.ac-t', {}, s.titulo), h('div.ac-s', {}, s.artista)),
        h('div.ac-r', {},
          s.bpm ? h('span.mono.dim', { style: { fontSize: '11px' } }, s.bpm) : null,
          (s.jams || []).length ? h('span.chip', {}, (s.jams || []).length + '×') : null,
          catPill(s.categoria))),
      pick: () => onPick(s),
    })));

    webResultados.forEach(r => items.push({
      seccion: 'Encontrado en internet',
      node: (on) => h('div.ac-item.web' + (on ? '.hl' : ''), { onmousedown: e => e.preventDefault(), onclick: () => { onPickWeb(r); if (clearOnPick) inp.value = ''; cerrar(); } },
        h('div', {}, h('div.ac-t', {}, r.titulo), h('div.ac-s', {}, [r.artista, r.genero, r.anio].filter(Boolean).join(' · '))),
        h('div.ac-r', {}, r.bpm ? h('span.mono.dim', {}, r.bpm) : null, h('span.chip', {}, '+ DBSongs'))),
      pick: () => onPickWeb(r),
    }));

    if (q.trim().length >= 2 && onNew) {
      items.push({
        seccion: null,
        node: (on) => h('div.ac-item.new' + (on ? '.hl' : ''), { onmousedown: e => e.preventDefault(), onclick: () => { onNew(q.trim()); if (clearOnPick) inp.value = ''; cerrar(); } },
          h('div.ac-t', {}, `＋ Crear «${q.trim()}» a mano`)),
        pick: () => onNew(q.trim()),
      });
    }
    pintar();
  }

  const buscarEnWeb = debounce(async (q) => {
    if (!buscarWeb || q.trim().length < 3) return;
    if (q === ultimaWeb) return;
    ultimaWeb = q;
    const locales = buscar(q);
    if (locales.length >= 5) { webResultados = []; return; }   // ya hay suficiente en la DB
    menu.appendChild(h('div.ac-loading', {}, '🌐 Buscando en internet…'));
    try {
      const res = await buscarWeb(q);
      if (inp.value !== q) return;                              // el usuario siguió tipeando
      // no repetir lo que ya está en la DB
      webResultados = res.filter(r => !locales.some(l => l.titulo.toLowerCase() === (r.titulo || '').toLowerCase()));
      construir(inp.value);
    } catch (e) {
      console.warn('lookup falló', e);
      webResultados = [];
      construir(inp.value);
    }
  }, 420);

  inp.addEventListener('input', () => {
    const q = inp.value;
    webResultados = [];
    if (!q.trim()) { items = []; cerrar(); return; }
    construir(q);
    buscarEnWeb(q);
  });

  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); hl = Math.min(hl + 1, items.length - 1); pintar(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); hl = Math.max(hl - 1, 0); pintar(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (hl >= 0) elegir(hl);
      else if (items.length) elegir(0);
    }
    else if (e.key === 'Escape') { cerrar(); inp.blur(); }
  });

  if (cerrarAlSalir) inp.addEventListener('blur', () => setTimeout(cerrar, 120));
  inp.addEventListener('focus', () => { if (inp.value.trim()) construir(inp.value); });
  if (autofocus) setTimeout(() => inp.focus(), 60);

  wrap.focusInput = () => inp.focus();
  return wrap;
}

/* ============================================================
   Reparto en porcentajes
   ------------------------------------------------------------
   Un grupo de filas «etiqueta − 40% +» que entre todas nunca
   pasan de 100: cada una se topa en lo que queda libre.
   ============================================================ */
export function grupoPorcentajes({ objeto, filas, paso = 5, onCambio, textoLibre }) {
  const cont = h('div.pcts');
  const pie = h('div.pct-libre');

  const suma = () => filas.reduce((n, f) => n + (objeto[f.clave] || 0), 0);

  function pintar() {
    clear(cont);
    const libre = 100 - suma();

    filas.forEach(f => {
      const v = objeto[f.clave] || 0;
      const puedeSubir = libre >= paso;

      const menos = h('button.pct-btn', {
        disabled: v <= 0,
        title: `Bajar ${paso}%`,
        onclick: () => { objeto[f.clave] = Math.max(0, v - paso); pintar(); onCambio && onCambio(); },
      }, '−');

      const mas = h('button.pct-btn', {
        disabled: !puedeSubir,
        title: puedeSubir ? `Subir ${paso}%` : 'Ya está repartido el 100%',
        onclick: () => { objeto[f.clave] = v + Math.min(paso, libre); pintar(); onCambio && onCambio(); },
      }, '+');

      cont.appendChild(h('div.pct-fila' + (v ? '.activa' : ''), { title: f.titulo || null },
        h('span.pct-nombre', {}, f.etiqueta),
        h('div.pct-ctrl', {}, menos, h('span.pct-valor', {}, v + '%'), mas)));
    });

    pie.textContent = typeof textoLibre === 'function' ? textoLibre(libre)
      : (libre === 100 ? 'Sin preferencia: entra lo que haya'
        : libre > 0 ? `Queda ${libre}% libre — se completa con lo que haya`
        : 'Repartido el 100%');
    pie.classList.toggle('completo', libre === 0);
  }

  pintar();
  return h('div', {}, cont, pie);
}

/* ---------- multi-select de personas ---------- */
export function personPicker({ opciones, seleccionados = [], onChange, placeholder = 'Agregar…' }) {
  const cont = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
  const chips = h('div.chips');
  const inp = h('input', { type: 'text', placeholder, list: '', autocomplete: 'off' });
  const menu = h('div.ac-menu', { style: { display: 'none' } });
  const wrap = h('div.ac-wrap', {}, inp, menu);

  function render() {
    clear(chips);
    seleccionados.forEach(n => chips.appendChild(
      h('span.chip.sel', {}, n, h('button', { title: 'Quitar', onclick: () => { seleccionados = seleccionados.filter(x => x !== n); onChange(seleccionados); render(); } }, '✕'))
    ));
    if (!seleccionados.length) chips.appendChild(h('span.dim', { style: { fontSize: '12px' } }, 'Nadie convocado todavía'));
  }

  /* El menú va pegado al body y posicionado a mano: dentro de un modal, que
     tiene overflow, un menú absoluto queda recortado y no se puede clickear. */
  function ubicarMenu() {
    if (!inp.isConnected) { menu.remove(); return; }
    const r = inp.getBoundingClientRect();
    Object.assign(menu.style, {
      position: 'fixed',
      left: Math.min(r.left, window.innerWidth - r.width - 8) + 'px',
      top: Math.min(r.bottom + 4, window.innerHeight - 260) + 'px',
      width: Math.max(r.width, 180) + 'px',
      zIndex: 300,
    });
  }

  function sugerir() {
    const q = inp.value.trim().toLowerCase();
    const libres = opciones.filter(o => !seleccionados.includes(o) && (!q || o.toLowerCase().includes(q))).slice(0, 40);
    clear(menu);
    libres.forEach(o => menu.appendChild(h('div.ac-item', {
      onmousedown: e => e.preventDefault(),
      onclick: () => sumar(o),
    }, h('div.ac-t', {}, o))));
    if (q && !libres.some(o => o.toLowerCase() === q)) {
      menu.appendChild(h('div.ac-item.new', {
        onmousedown: e => e.preventDefault(),
        onclick: () => sumar(inp.value),
      }, h('div.ac-t', {}, `＋ Agregar «${inp.value.trim()}»`)));
    }
    menu.style.display = menu.children.length ? 'block' : 'none';
    if (menu.children.length) { document.body.appendChild(menu); ubicarMenu(); }
  }

  /** Suma un nombre y deja el campo listo para el siguiente. */
  function sumar(nombre) {
    const n = (nombre || '').trim();
    if (!n || seleccionados.includes(n)) return;
    seleccionados = [...seleccionados, n];
    onChange(seleccionados);
    render();
    inp.value = '';
    sugerir();
  }

  inp.addEventListener('input', sugerir);
  inp.addEventListener('focus', sugerir);
  inp.addEventListener('blur', () => setTimeout(() => menu.remove(), 160));
  window.addEventListener('scroll', () => { if (menu.isConnected) ubicarMenu(); }, true);

  /* Con Enter se agrega sin tener que ir al mouse: toma la primera sugerencia
     y, si no hay ninguna, el nombre tal como lo escribiste. */
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const primera = menu.isConnected && menu.querySelector('.ac-item:not(.new) .ac-t');
      sumar(primera ? primera.textContent : inp.value);
    } else if (e.key === 'Escape') {
      menu.remove(); inp.blur();
    } else if (e.key === 'Backspace' && !inp.value && seleccionados.length) {
      seleccionados = seleccionados.slice(0, -1);   // borra el último chip
      onChange(seleccionados); render(); sugerir();
    }
  });

  render();
  cont.append(chips, wrap);
  return cont;
}

/* ---------- utilidades varias ---------- */
export function fechaLinda(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return iso;
  const dt = new Date(y, m - 1, d);
  return dt
    .toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
    .replace(/^\w/, c => c.toUpperCase());
}

export function copiar(texto) {
  const fallback = () => {
    const ta = h('textarea', { value: texto, style: { minHeight: '320px', fontFamily: 'var(--mono)', fontSize: '12.5px' } });
    const m = modal({
      title: 'Copiar la lista',
      wide: true,
      body: [h('div.method-hint', {}, 'El navegador no dejó copiar solo. Está todo seleccionado: ⌘C y listo.'), ta],
      footer: [h('button.btn.primary', { onclick: () => m.close() }, 'Cerrar')],
    });
    setTimeout(() => { ta.focus(); ta.select(); }, 60);
  };

  if (!navigator.clipboard) { fallback(); return; }
  navigator.clipboard.writeText(texto)
    .then(() => toast('Copiado al portapapeles', 'ok'))
    .catch(fallback);
}

export function descargar(nombre, contenido, tipo = 'application/json') {
  descargarBlob(nombre, new Blob([contenido], { type: tipo }));
}

export function descargarBlob(nombre, blob) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: nombre });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
