/* ============================================================
   api/jam.js — la tarjeta del link, para cuando se pega en un chat
   ------------------------------------------------------------
   El que lee un link pegado en WhatsApp es un robot que no
   ejecuta JavaScript. Y hay algo peor: el hash NUNCA llega al
   servidor, así que con `#/v/<token>` no había forma de saber
   siquiera de qué jam se trataba. Por eso el link que se comparte
   pasa a ser `/j/<token>`, con el token en el path.

   Esta función devuelve HTML plano con las etiquetas Open Graph
   ya rellenas —nombre de la jam, horario, y la lista de temas— y
   manda a la persona a la app. El robot se queda con las
   etiquetas; el navegador sigue de largo.

   Sin dependencias: pide el resumen a `resumen_publico()`, que es
   la misma función anónima que usa la app y devuelve 800 bytes en
   vez de los 289 kB del catálogo entero.

   El precio de tener tarjeta: el token viaja en el path, así que
   queda en los logs de acceso de Vercel. Con el hash no pasaba.
   No hay forma de tener las dos cosas.
   ============================================================ */

import { NUBE } from '../js/config.js';

const MAX_LINEAS = 14;          // lo que entra en una descripción sin cansar

const escapar = (t) => String(t ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** '2026-09-05' → 'sáb 5 de septiembre'. Vacío si no hay fecha. */
function fechaLinda(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
  const [a, m, d] = iso.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.toLocaleDateString('es-AR', {
    weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

async function resumen(token) {
  const res = await fetch(`${NUBE.url}/rest/v1/rpc/resumen_publico`, {
    method: 'POST',
    headers: { apikey: NUBE.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ t: token }),
  });
  if (!res.ok) return null;
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

function pagina({ titulo, descripcion, destino, canonical, imagen }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${escapar(titulo)}</title>
<meta name="description" content="${escapar(descripcion)}">

<meta property="og:type" content="website">
<meta property="og:site_name" content="JAM PORTAL">
<meta property="og:title" content="${escapar(titulo)}">
<meta property="og:description" content="${escapar(descripcion)}">
<meta property="og:url" content="${escapar(canonical)}">
<!-- La lista va también EN la imagen: WhatsApp recorta la descripción a dos
     renglones y le da toda la pantalla a la imagen. -->
<meta property="og:image" content="${escapar(imagen)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escapar(titulo)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${escapar(imagen)}">
<meta name="twitter:title" content="${escapar(titulo)}">
<meta name="twitter:description" content="${escapar(descripcion)}">

<meta name="robots" content="noindex, nofollow">
<link rel="canonical" href="${escapar(canonical)}">
<script>location.replace(${JSON.stringify(destino)});</script>
</head>
<body style="font-family:system-ui;background:#0a0a0e;color:#e9e9f2;padding:40px;text-align:center">
  <p>${escapar(titulo)}</p>
  <p><a href="${escapar(destino)}" style="color:#ffc94d">Abrir la lista</a></p>
</body>
</html>`;
}

export default async function handler(req, res) {
  const token = String((req.query && req.query.token) || '').slice(0, 64);
  /* Relativo: el protocolo no se adivina —en local es http y en Vercel
     https— y para mandar a la app no hace falta saberlo. El absoluto se
     arma solo para el canonical, donde sí tiene que ser una URL entera. */
  const destino = `/#/v/${encodeURIComponent(token)}`;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const base = `${proto}://${req.headers.host}`;
  const canonical = `${base}${destino}`;
  /* La imagen tiene que ser absoluta: el robot la pide desde su servidor. */
  const imagen = `${base}/api/og?token=${encodeURIComponent(token)}`;

  let jam = null;
  try {
    if (/^[A-Za-z0-9_-]{6,}$/.test(token)) jam = await resumen(token);
  } catch { /* si la base no contesta, sale la tarjeta genérica */ }

  let titulo = 'JAM PORTAL', descripcion = 'La lista de temas de la jam.';

  if (jam) {
    const cab = [fechaLinda(jam.fecha), jam.hora, jam.lugar].filter(Boolean).join(' · ');
    titulo = jam.nombre || 'Jam';
    if (cab) titulo += ' — ' + cab;

    const lista = (jam.lista || []).slice(0, MAX_LINEAS)
      .map((l, i) => `${i + 1}. ${l}`);
    const faltan = (jam.lista || []).length - lista.length;
    if (faltan > 0) lista.push(`… y ${faltan} más`);

    descripcion = `${jam.temas} tema${jam.temas === 1 ? '' : 's'}`
      + (lista.length ? '\n' + lista.join('\n') : '');
  }

  /* Que el robot pueda cachear un rato, pero no tanto como para mostrar
     una lista vieja: el setlist se toca hasta el día de la jam. */
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
  res.status(200).send(pagina({ titulo, descripcion, destino, canonical, imagen }));
}
