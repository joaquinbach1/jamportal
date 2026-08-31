/* ============================================================
   api/og.js — la imagen de la tarjeta, con la lista adentro
   ------------------------------------------------------------
   WhatsApp recorta la descripción a dos renglones y le da toda
   la pantalla a la imagen. Así que la lista tiene que estar EN
   la imagen, o no se ve.

   Es la única dependencia del proyecto (@vercel/og), y vive
   nada más que acá: el sitio se sigue sirviendo estático y sin
   build, y el navegador no descarga una línea de esto.

   Sin JSX, que pediría un paso de compilación. Satori acepta
   los elementos como objetos planos —{ type, props }— que es lo
   mismo que produce JSX, escrito a mano.
   ============================================================ */

import { ImageResponse } from '@vercel/og';

/* Runtime de Node y no edge: con edge, `vercel dev` no puede resolver las
   fuentes que @vercel/og carga y la función no se puede probar local. El
   handler recibe una Request y devuelve una Response, que es la forma web
   que el runtime de Node también entiende. */

const SUPABASE_URL = 'https://qvqrwjzbfenupkqjrhli.supabase.co';
const SUPABASE_KEY = 'sb_publishable__uhmgdmoIAqP6ar_oJqXFQ_b9GnG_JH';

const ANCHO = 1200, ALTO = 630;
const POR_COLUMNA = 11;          // 22 temas entran sin apretar
const FONDO = '#0a0a0e', PANEL = '#15151d', LINEA = '#282833';
const TXT = '#e9e9f2', TXT2 = '#a0a0b4', TXT3 = '#6b6b80', ACC = '#ffc94d';

/** Elemento al estilo de los que produce JSX, pero a mano. */
const el = (type, style, children) => ({ type, props: { style, children } });

/** '2026-09-05' → 'sáb 5 de septiembre'. Vacío si no hay fecha. */
function fechaLinda(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).toLocaleDateString('es-AR', {
    weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

async function resumen(token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/resumen_publico`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ t: token }),
  });
  if (!res.ok) return null;
  return res.json();
}

/** Un renglón: el número en ámbar y el tema al lado, cortado si no entra. */
function renglon(n, texto) {
  return el('div', {
    display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 9,
  }, [
    el('div', {
      color: ACC, fontSize: 20, fontFamily: 'monospace',
      width: 34, textAlign: 'right', flexShrink: 0,
    }, String(n)),
    el('div', {
      color: TXT, fontSize: 24, whiteSpace: 'nowrap',
      overflow: 'hidden', textOverflow: 'ellipsis',
    }, texto),
  ]);
}

function columna(lineas, desde) {
  return el('div', { display: 'flex', flexDirection: 'column', width: 540 },
    lineas.map((t, i) => renglon(desde + i + 1, t)));
}

export default async function handler(req) {
  const url = new URL(req.url, 'http://localhost');
  const token = (url.searchParams.get('token') || '').slice(0, 64);

  let jam = null;
  try {
    if (/^[A-Za-z0-9_-]{6,}$/.test(token)) jam = await resumen(token);
  } catch { /* si la base no contesta, sale la tarjeta sin lista */ }

  const nombre = (jam && jam.nombre) || 'JAM PORTAL';
  const sub = jam
    ? [fechaLinda(jam.fecha), jam.hora, jam.lugar].filter(Boolean).join('  ·  ')
    : 'La lista de temas de la jam';

  const todas = (jam && jam.lista) || [];
  const caben = todas.slice(0, POR_COLUMNA * 2);
  const faltan = todas.length - caben.length;

  const cuerpo = caben.length
    ? el('div', { display: 'flex', gap: 40 }, [
        columna(caben.slice(0, POR_COLUMNA), 0),
        columna(caben.slice(POR_COLUMNA), POR_COLUMNA),
      ])
    : el('div', { color: TXT3, fontSize: 26 }, 'Abrí el link para ver la lista');

  return new ImageResponse(
    el('div', {
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: FONDO, padding: '44px 52px', fontFamily: 'sans-serif',
    }, [
      /* cabecera */
      el('div', {
        display: 'flex', flexDirection: 'column',
        borderBottom: `2px solid ${LINEA}`, paddingBottom: 18, marginBottom: 26,
      }, [
        el('div', {
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
        }, [
          el('div', {
            color: ACC, fontSize: 17, letterSpacing: 4, fontFamily: 'monospace',
          }, 'JAM PORTAL'),
          jam && jam.temas
            ? el('div', {
                color: TXT3, fontSize: 17, fontFamily: 'monospace',
                background: PANEL, borderRadius: 20, padding: '3px 14px',
              }, `${jam.temas} temas`)
            : el('div', {}, ''),
        ]),
        el('div', { color: TXT, fontSize: 46, fontWeight: 700 }, nombre),
        sub ? el('div', { color: TXT2, fontSize: 24, marginTop: 6 }, sub) : el('div', {}, ''),
      ]),

      cuerpo,

      faltan > 0
        ? el('div', { color: TXT3, fontSize: 20, marginTop: 14 }, `… y ${faltan} temas más`)
        : el('div', {}, ''),
    ]),
    { width: ANCHO, height: ALTO },
  );
}
