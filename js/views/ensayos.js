/* ============================================================
   views/ensayos.js — ensayos de una jam y su convocatoria
   ------------------------------------------------------------
   Cada ensayo tiene fecha, hora de inicio y de fin, lugar y una
   lista de convocados. A cada convocado se le pone la hora a la
   que tiene que estar, y desde ahí se le dispara el aviso por
   WhatsApp o por mail con el texto ya armado.

   Modelo:
     ensayo = { fecha, hora, horaFin, lugar, notas,
                convocados: [{ nombre, hora, instrumento, aviso }] }
     aviso  = '' | 'wsp' | 'mail'   (queda registrado que ya se avisó)
   ============================================================ */

import { store, norm } from '../store.js';
import { h, clear, poner, modal, field, input, select, toast, avatar, fechaLinda, copiar } from '../ui.js';

/* ---------- contactos ---------- */
export function personaPorNombre(nombre) {
  const n = norm(nombre);
  return store.cantantes.find(c => norm(c.nombre) === n)
      || store.musicos.find(m => norm(m.nombre) === n)
      || null;
}

/** Saca los dígitos de un teléfono: "+54 9 11 5555-1234" → "5491155551234" */
function telLimpio(tel) {
  return (tel || '').replace(/[^\d]/g, '');
}

export function contactoDe(nombre) {
  const p = personaPorNombre(nombre);
  if (!p) return { telefono: '', email: '' };
  // `contacto` es el campo viejo: puede tener un mail o un teléfono suelto
  const suelto = p.contacto || '';
  const email = p.email || (suelto.includes('@') ? suelto.trim() : '');
  const telefono = p.telefono || (!suelto.includes('@') && telLimpio(suelto).length >= 8 ? suelto : '');
  return { telefono, email, persona: p };
}

/* ---------- texto del aviso ---------- */
export function textoConvocatoria(jam, ensayo, convocado) {
  const cuando = [ensayo.fecha ? fechaLinda(ensayo.fecha) : '', convocado.hora || ensayo.hora]
    .filter(Boolean).join(' a las ');
  const L = [];
  L.push(`¡Hola ${convocado.nombre}!`);
  L.push(`Te convoco al ensayo de ${jam.nombre || 'la jam'}.`);
  L.push('');
  if (cuando) L.push(`📅 ${cuando}${ensayo.horaFin ? ` (hasta ${ensayo.horaFin})` : ''}`);
  if (ensayo.lugar) L.push(`📍 ${ensayo.lugar}`);
  if (convocado.instrumento) L.push(`🎵 ${convocado.instrumento}`);
  if (ensayo.notas) L.push(`📝 ${ensayo.notas}`);
  if (jam.fecha) L.push('', `La jam es el ${fechaLinda(jam.fecha)}${jam.hora ? ' a las ' + jam.hora : ''}${jam.lugar ? ' en ' + jam.lugar : ''}.`);
  L.push('', '¿Podés?');
  return L.join('\n');
}

function abrirWhatsApp(jam, ensayo, convocado) {
  const { telefono } = contactoDe(convocado.nombre);
  const texto = encodeURIComponent(textoConvocatoria(jam, ensayo, convocado));
  const tel = telLimpio(telefono);
  // sin teléfono cargado, wa.me abre el selector de contacto de WhatsApp
  window.open(tel ? `https://wa.me/${tel}?text=${texto}` : `https://wa.me/?text=${texto}`, '_blank', 'noopener');
}

function abrirMail(jam, ensayo, convocado) {
  const { email } = contactoDe(convocado.nombre);
  const asunto = encodeURIComponent(`Ensayo ${jam.nombre || ''}${ensayo.fecha ? ' — ' + fechaLinda(ensayo.fecha) : ''}`);
  const cuerpo = encodeURIComponent(textoConvocatoria(jam, ensayo, convocado));
  window.open(`mailto:${email}?subject=${asunto}&body=${cuerpo}`, '_blank');
}

/* ============================================================
   Planilla de producción: quién viene y a qué hora
   ============================================================ */
export function planillaEnsayo(jam, ensayo) {
  const L = [];
  L.push(`ENSAYO — ${jam.nombre || 'Jam'}`);
  const cuando = [
    ensayo.fecha ? fechaLinda(ensayo.fecha) : 'sin fecha',
    ensayo.hora ? (ensayo.horaFin ? `${ensayo.hora} a ${ensayo.horaFin}` : `desde ${ensayo.hora}`) : '',
    ensayo.lugar,
  ].filter(Boolean).join('  ·  ');
  L.push(cuando);
  L.push('─'.repeat(Math.max(cuando.length, 28)));
  L.push('');

  // agrupados por horario de citación, en orden
  const porHora = new Map();
  for (const c of ensayo.convocados || []) {
    const hora = c.hora || ensayo.hora || '--:--';
    if (!porHora.has(hora)) porHora.set(hora, []);
    porHora.get(hora).push(c);
  }
  const horas = [...porHora.keys()].sort();

  if (!horas.length) L.push('(sin convocados)');
  for (const hora of horas) {
    L.push(`${hora}`);
    for (const c of porHora.get(hora)) {
      const { telefono } = contactoDe(c.nombre);
      const detalle = [c.instrumento, telefono].filter(Boolean).join(' · ');
      L.push(`   ${c.nombre}${detalle ? `  (${detalle})` : ''}${c.aviso ? '  ✓ avisado' : ''}`);
    }
    L.push('');
  }

  const total = (ensayo.convocados || []).length;
  const avisados = (ensayo.convocados || []).filter(c => c.aviso).length;
  L.push(`Total: ${total} convocados · ${avisados} ya avisados`);
  if (ensayo.notas) L.push('', `Notas: ${ensayo.notas}`);
  if (jam.fecha) L.push('', `La jam es el ${fechaLinda(jam.fecha)}${jam.hora ? ' a las ' + jam.hora : ''}${jam.lugar ? ' en ' + jam.lugar : ''}.`);
  return L.join('\n');
}

/** Cómo se llama un ensayo en los selectores. */
export function nombreEnsayo(e, i) {
  const partes = [
    e.fecha ? fechaLinda(e.fecha).replace(/ de \d{4}$/, '') : `Ensayo ${i + 1}`,
    e.hora || null,
  ].filter(Boolean);
  return partes.join(' · ');
}

/* ============================================================
   Diálogo: convocar músicos a un ensayo
   ------------------------------------------------------------
   Si la jam tiene más de un ensayo, arriba quedan todos para
   moverse entre ellos sin cerrar, ver cuántos van en cada uno y
   copiar la convocatoria de otro.
   ============================================================ */
export function dialogoConvocatoria(jam, ensayoInicial, alGuardar) {
  const ensayos = () => (jam.ensayos || []);
  let ensayo = ensayoInicial;
  if (!Array.isArray(ensayo.convocados)) ensayo.convocados = [];

  const lista = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
  const selector = h('div');
  const encabezado = h('div');
  const copiarCont = h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } });
  const accionesPie = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' } });

  const gente = [...new Set([
    ...(jam.musicos || []),
    ...store.cantantes.filter(c => c.activo !== false).map(c => c.nombre),
    ...store.musicos.filter(m => m.activo !== false).map(m => m.nombre),
  ])].sort((a, b) => a.localeCompare(b));

  /** Los otros ensayos a los que ya está convocada una persona. */
  function otrosEnsayosDe(nombre) {
    return ensayos()
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e !== ensayo && (e.convocados || []).some(c => c.nombre === nombre))
      .map(({ e, i }) => nombreEnsayo(e, i));
  }

  function pintarSelector() {
    clear(selector); clear(encabezado);
    const todos = ensayos();
    if (todos.length > 1) {
      selector.append(
        h('h2.sec', { style: { marginBottom: '8px' } }, `A qué ensayo convocás (${todos.length})`),
        h('div.seg', {}, todos.map((e, i) => {
          const cuantos = (e.convocados || []).length;
          return h('button' + (e === ensayo ? '.on' : ''), {
            onclick: () => {
              ensayo = e;
              if (!Array.isArray(ensayo.convocados)) ensayo.convocados = [];
              pintarSelector(); pintar(); refrescarSelect();
            },
          }, nombreEnsayo(e, i) + (cuantos ? `  (${cuantos})` : ''));
        })));
    }

    const cuando = [
      ensayo.fecha ? fechaLinda(ensayo.fecha) : 'sin fecha',
      ensayo.hora ? (ensayo.horaFin ? `${ensayo.hora} a ${ensayo.horaFin}` : `desde ${ensayo.hora}`) : null,
      ensayo.lugar,
    ].filter(Boolean).join('  ·  ');
    encabezado.append(h('div.dim', { style: { fontSize: '12px', marginTop: todos.length > 1 ? '8px' : '0' } }, cuando));

    // los otros ensayos que ya tienen gente, para traerse su lista
    clear(copiarCont);
    const conGente = todos.map((e, i) => ({ e, i }))
      .filter(({ e }) => e !== ensayo && (e.convocados || []).length);
    if (conGente.length) {
      copiarCont.append(
        h('span.dim', { style: { fontSize: '11.5px' } }, 'o traer la convocatoria de:'),
        ...conGente.map(({ e, i }) => h('button.btn.xs', { onclick: () => copiarDeOtro(e) },
          `${nombreEnsayo(e, i)} (${e.convocados.length})`)));
    }
  }

  /**
   * Aviso masivo, uno por clic.
   *
   * Antes abría todos los chats de una con setTimeout, pero eso corre fuera del
   * clic del usuario: el navegador bloquea todas las ventanas menos la primera y
   * quedaba un solo mensaje, casi siempre el que no era. Ahora cada clic abre el
   * WhatsApp del que sigue —siempre dentro del gesto, nunca bloqueado— y el botón
   * dice a quién le toca.
   */
  function pintarPie() {
    clear(accionesPie);
    // se recalcula en cada pintada Y en cada clic, para no usar una lista vieja
    const pendientes = () => ensayo.convocados.filter(c => !c.aviso);
    const faltan = pendientes();

    poner(accionesPie,
      h('button.btn.sm', {
        title: 'Copia quién viene y a qué hora, para pasarle al productor',
        onclick: () => {
          if (!ensayo.convocados.length) { toast('No hay nadie convocado', 'err'); return; }
          copiar(planillaEnsayo(jam, ensayo));
        },
      }, '📋 Planilla'),

      faltan.length
        ? h('button.btn.sm.primary', {
            title: `Abre el WhatsApp de ${faltan[0].nombre} con su mensaje. Después seguís con el siguiente.`,
            onclick: () => {
              const cola = pendientes();
              if (!cola.length) { pintar(); return; }
              const quien = cola[0];
              abrirWhatsApp(jam, ensayo, quien);
              quien.aviso = 'wsp';
              store.commit(); pintar(); pintarSelector(); alGuardar && alGuardar();
              if (cola.length > 1) toast(`Avisado ${quien.nombre}. Sigue ${cola[1].nombre}`, 'ok');
              else toast(`Avisado ${quien.nombre} — no queda nadie`, 'ok');
            },
          }, `💬 Avisar a ${faltan[0].nombre}${faltan.length > 1 ? ` (1 de ${faltan.length})` : ''}`)
        : (ensayo.convocados.length
            ? h('span.dim', { style: { fontSize: '12px', alignSelf: 'center' } }, '✓ ya les avisaste a todos')
            : null),
    );
  }

  function pintar() {
    clear(lista);
    pintarPie();
    if (!ensayo.convocados.length) {
      lista.appendChild(h('div.empty', { style: { padding: '20px' } }, 'Nadie convocado a este ensayo todavía'));
    }

    ensayo.convocados.forEach((c, i) => {
      const { telefono, email, persona } = contactoDe(c.nombre);
      const fila = h('div.conv-row', {},
        avatar(c.nombre),
        h('div', { style: { minWidth: 0, flex: 1 } },
          h('div', { style: { fontWeight: 600, fontSize: '13.5px' } }, c.nombre),
          h('div.dim', { style: { fontSize: '11px' } },
            persona
              ? [persona.rol === 'instrumento' ? (persona.instrumentos || []).join(', ') : 'voz',
                 telefono ? '📱' : null, email ? '✉️' : null].filter(Boolean).join(' · ')
              : 'no está en la base'),
          (() => {
            const otros = otrosEnsayosDe(c.nombre);
            return otros.length
              ? h('div.dim', { style: { fontSize: '10.5px', marginTop: '2px' } }, 'también en: ' + otros.join(' · '))
              : null;
          })()),

        h('input', {
          type: 'time', value: c.hora || ensayo.hora || '', title: 'A qué hora tiene que estar',
          style: { width: '104px', flex: 'none' },
          oninput: e => { c.hora = e.target.value; store.commit(); },
        }),

        input({
          value: c.instrumento || '', placeholder: 'qué toca',
          style: { width: '110px', flex: 'none', fontSize: '12.5px' },
          oninput: e => { c.instrumento = e.target.value; store.commit(); },
        }),

        h('div', { style: { display: 'flex', gap: '2px', flex: 'none' } },
          h('button.icon-btn' + (c.aviso === 'wsp' ? '.avisado' : ''), {
            title: telefono ? `WhatsApp a ${telefono}` : 'WhatsApp (sin teléfono cargado: elegís el contacto)',
            onclick: () => { abrirWhatsApp(jam, ensayo, c); c.aviso = 'wsp'; store.commit(); pintar(); pintarSelector(); },
          }, '💬'),
          h('button.icon-btn' + (c.aviso === 'mail' ? '.avisado' : ''), {
            title: email ? `Mail a ${email}` : 'Sin mail cargado — abrí la ficha para agregarlo',
            disabled: !email,
            onclick: () => { abrirMail(jam, ensayo, c); c.aviso = 'mail'; store.commit(); pintar(); pintarSelector(); },
          }, '✉️'),
          h('button.icon-btn.danger', {
            title: 'Sacar del ensayo',
            onclick: () => { ensayo.convocados.splice(i, 1); store.commit(); pintar(); alGuardar && alGuardar(); },
          }, '✕')),
      );
      lista.appendChild(fila);
    });
  }

  /* --- agregar gente --- */
  const selPersona = select(
    [{ value: '', label: 'Elegí a quién convocar…' },
     ...gente.filter(g => !ensayo.convocados.some(c => c.nombre === g)).map(g => ({ value: g, label: g }))],
    { onchange: e => { if (e.target.value) { agregar(e.target.value); e.target.value = ''; } } });

  function agregar(nombre, destino = ensayo) {
    if (!Array.isArray(destino.convocados)) destino.convocados = [];
    if (destino.convocados.some(c => c.nombre === nombre)) return;
    const p = personaPorNombre(nombre);
    destino.convocados.push({
      nombre,
      hora: destino.hora || '',
      instrumento: p && p.rol === 'instrumento' ? (p.instrumentos || []).join(', ') : '',
      aviso: '',
    });
    store.commit(); pintar(); pintarSelector(); refrescarSelect(); alGuardar && alGuardar();
  }

  /**
   * Trae la lista de convocados de otro ensayo.
   * Los horarios se rebasan al inicio de este ensayo, salvo los que estaban
   * citados a una hora distinta a propósito — ésos conservan su horario.
   * Los avisos no se copian: a este ensayo hay que avisarle igual.
   */
  function copiarDeOtro(origen) {
    let sumados = 0;
    (origen.convocados || []).forEach(c => {
      if (ensayo.convocados.some(x => x.nombre === c.nombre)) return;
      const citadoAparte = c.hora && c.hora !== origen.hora;
      ensayo.convocados.push({
        ...c,
        hora: citadoAparte ? c.hora : (ensayo.hora || ''),
        aviso: '',
      });
      sumados++;
    });
    store.commit(); pintar(); pintarSelector(); refrescarSelect(); alGuardar && alGuardar();
    toast(sumados ? `${sumados} convocados copiados` : 'Ya estaban todos', sumados ? 'ok' : '');
  }

  function refrescarSelect() {
    clear(selPersona);
    selPersona.appendChild(h('option', { value: '' }, 'Elegí a quién convocar…'));
    gente.filter(g => !ensayo.convocados.some(c => c.nombre === g))
      .forEach(g => selPersona.appendChild(h('option', { value: g }, g)));
  }

  const m = modal({
    title: (jam.ensayos || []).length > 1 ? 'Convocatoria a los ensayos' : 'Convocar al ensayo',
    wide: true,
    body: [
      h('div.method-hint', {},
        'Cada uno puede venir a distinta hora: poné el horario de citación al lado del nombre. ',
        '💬 abre WhatsApp y ✉️ el mail, con el mensaje ya escrito. El botón queda marcado cuando ya avisaste.'),

      selector,
      encabezado,

      h('div.row', { style: { marginTop: '4px' } },
        field('Sumar a este ensayo', selPersona),
        h('div', { style: { flex: '0 0 auto', alignSelf: 'flex-end', display: 'flex', gap: '6px' } },
          h('button.btn.sm', {
            onclick: () => {
              (jam.musicos || []).forEach(n => agregar(n));
              toast('Convocados todos los de la jam', 'ok');
            },
          }, '＋ Todos los de la jam'),
          ensayos().length > 1
            ? h('button.btn.sm', {
                title: 'Convocar a los mismos en todos los ensayos de esta jam',
                onclick: () => {
                  const nombres = ensayo.convocados.map(c => c.nombre);
                  if (!nombres.length) { toast('Primero armá la lista de este ensayo', 'err'); return; }
                  ensayos().filter(e => e !== ensayo).forEach(e => nombres.forEach(n => agregar(n, e)));
                  toast('Copiados a todos los ensayos', 'ok');
                },
              }, '⇉ A todos los ensayos')
            : null)),

      copiarCont,

      lista,

      accionesPie,
    ],
    footer: [h('button.btn.primary', { onclick: () => { store.commit(); m.close(); alGuardar && alGuardar(); } }, 'Listo')],
  });

  pintarSelector();
  pintar();
  return m;
}

/* ============================================================
   Bloque de ensayos dentro del editor de la jam
   ============================================================ */
export function seccionEnsayos(jam, alCambiar) {
  const cont = h('div');

  function pintar() {
    clear(cont);
    if (!Array.isArray(jam.ensayos)) jam.ensayos = [];

    jam.ensayos.forEach((e, i) => {
      if (!Array.isArray(e.convocados)) e.convocados = [];
      const avisados = e.convocados.filter(c => c.aviso).length;

      cont.appendChild(h('div.ensayo', {},
        h('div.rehearsal', {},
          h('input', { type: 'date', value: e.fecha || '', title: 'Fecha',
            oninput: ev => { e.fecha = ev.target.value; store.commit(); alCambiar && alCambiar(); } }),
          h('input', { type: 'time', value: e.hora || '', title: 'Desde',
            oninput: ev => { e.hora = ev.target.value; store.commit(); } }),
          h('span.dim', { style: { flex: 'none', fontSize: '12px' } }, 'a'),
          h('input', { type: 'time', value: e.horaFin || '', title: 'Hasta',
            oninput: ev => { e.horaFin = ev.target.value; store.commit(); } }),
          input({ placeholder: 'Dónde', value: e.lugar || '',
            oninput: ev => { e.lugar = ev.target.value; store.commit(); } }),
          h('button.icon-btn.danger', { title: 'Borrar ensayo',
            onclick: () => { jam.ensayos.splice(i, 1); store.commit(); pintar(); alCambiar && alCambiar(); } }, '✕')),

        h('div.ensayo-pie', {},
          h('button.btn.xs', { onclick: () => dialogoConvocatoria(jam, e, pintar) },
            e.convocados.length ? `🎺 Convocatoria (${e.convocados.length})` : '🎺 Convocar músicos'),
          e.convocados.length
            ? h('span.dim', { style: { fontSize: '11.5px' } },
                avisados === e.convocados.length ? '✓ todos avisados' : `${avisados} de ${e.convocados.length} avisados`)
            : h('span.dim', { style: { fontSize: '11.5px' } }, 'sin convocatoria'),
          h('div.chips', { style: { marginLeft: 'auto' } },
            e.convocados.slice(0, 6).map(c =>
              h('span.chip' + (c.aviso ? '.sel' : ''), { title: c.aviso ? 'Ya avisado' : 'Todavía sin avisar' },
                (c.hora ? c.hora + ' ' : '') + c.nombre)),
            e.convocados.length > 6 ? h('span.chip', {}, '+' + (e.convocados.length - 6)) : null)),
      ));
    });

    cont.appendChild(h('button.btn.sm.ghost', {
      onclick: () => {
        jam.ensayos.push({ fecha: '', hora: '', horaFin: '', lugar: '', notas: '', convocados: [] });
        store.commit(); pintar();
      },
    }, '＋ Ensayo'));
  }

  pintar();
  return cont;
}
