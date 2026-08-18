/* ============================================================
   docx.js — genera un .docx del setlist, sin librerías
   ------------------------------------------------------------
   Un .docx es un ZIP con XML adentro. Como no queremos depender
   de nada externo, acá va un escritor de ZIP mínimo (método
   "stored", sin compresión: Word, Google Docs y Pages lo abren
   igual) y el armado del documento.

   Los links a las cifras se escriben como hipervínculos reales,
   así siguen siendo clickeables dentro del Word.
   ============================================================ */

/* ---------- CRC32 ---------- */
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* ---------- ZIP ---------- */
const utf8 = new TextEncoder();

function zip(archivos) {
  const partes = [];
  const central = [];
  let offset = 0;

  const u16 = n => [n & 0xFF, (n >> 8) & 0xFF];
  const u32 = n => [n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >>> 24) & 0xFF];

  for (const { name, text } of archivos) {
    const nombre = utf8.encode(name);
    const datos = utf8.encode(text);
    const crc = crc32(datos);

    const local = new Uint8Array([
      0x50, 0x4B, 0x03, 0x04,        // firma
      20, 0, ...u16(0x0800),         // versión · flag UTF-8
      ...u16(0),                     // método: stored
      ...u16(0), ...u16(0x21),       // hora y fecha (fijas: 1 ene 2000)
      ...u32(crc), ...u32(datos.length), ...u32(datos.length),
      ...u16(nombre.length), ...u16(0),
      ...nombre,
    ]);
    partes.push(local, datos);

    central.push(new Uint8Array([
      0x50, 0x4B, 0x01, 0x02,
      20, 0, 20, 0, ...u16(0x0800),
      ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(datos.length), ...u32(datos.length),
      ...u16(nombre.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset),
      ...nombre,
    ]));

    offset += local.length + datos.length;
  }

  const dirLargo = central.reduce((n, c) => n + c.length, 0);
  const fin = new Uint8Array([
    0x50, 0x4B, 0x05, 0x06,
    ...u16(0), ...u16(0),
    ...u16(central.length), ...u16(central.length),
    ...u32(dirLargo), ...u32(offset), ...u16(0),
  ]);

  return new Blob([...partes, ...central, fin],
    { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/* ---------- XML ---------- */
const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Un párrafo. tam va en puntos; sangria en cm. */
function p(texto, { tam = 11, negrita = false, color = '000000', tam2, mayus = false,
                    espacioAntes = 0, sangria = 0, centrado = false, borde = false } = {}) {
  const props = [
    centrado ? '<w:jc w:val="center"/>' : '',
    espacioAntes ? `<w:spacing w:before="${Math.round(espacioAntes * 20)}"/>` : '',
    sangria ? `<w:ind w:left="${Math.round(sangria * 567)}"/>` : '',
    borde ? '<w:pBdr><w:bottom w:val="single" w:sz="6" w:color="999999"/></w:pBdr>' : '',
  ].join('');
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${run(texto, { tam, negrita, color, mayus })}</w:p>`;
}

function run(texto, { tam = 11, negrita = false, color = '000000', mayus = false, subrayado = false } = {}) {
  const rPr = `<w:rPr>${negrita ? '<w:b/>' : ''}${subrayado ? '<w:u w:val="single"/>' : ''}` +
    `<w:color w:val="${color}"/><w:sz w:val="${tam * 2}"/><w:szCs w:val="${tam * 2}"/>` +
    `${mayus ? '<w:caps/>' : ''}</w:rPr>`;
  return `<w:r>${rPr}<w:t xml:space="preserve">${esc(texto)}</w:t></w:r>`;
}

/* ============================================================
   Armado del setlist
   ============================================================ */

/**
 * @param {object} jam
 * @param {function} song  (songId) => canción de DBSongs
 * @param {string} subtitulo  fecha · hora · lugar
 * @param {string} sello      timestamp de generación
 */
export function setlistDocx(jam, song, subtitulo, sello) {
  const cuerpo = [];
  const links = [];                       // {id, url} para document.xml.rels

  const linkRun = (texto, url) => {
    const id = 'rIdL' + (links.length + 1);
    links.push({ id, url });
    return `<w:hyperlink r:id="${id}">${run(texto, { tam: 8, color: '0A58CA', subrayado: true })}</w:hyperlink>`;
  };

  cuerpo.push(p(jam.nombre || 'Jam', { tam: 20, negrita: true }));
  if (subtitulo) cuerpo.push(p(subtitulo, { tam: 10, color: '666666' }));
  if ((jam.musicos || []).length) {
    cuerpo.push(p('Convocados: ' + jam.musicos.join(', '), { tam: 9, color: '666666' }));
  }
  cuerpo.push(p('', { tam: 6 }));

  let n = 0;

  /** Los "runs" de un tema: título, artista, cantante, bpm, patch y el link. */
  const runsTema = (s, cantantes) => {
    const partes = [run(`${s ? s.titulo : '—'}`, { tam: 12, negrita: true })];
    if (s && s.artista) partes.push(run(`  ${s.artista}`, { tam: 10, color: '666666' }));
    const extra = [
      (cantantes || []).length ? '🎤 ' + cantantes.join(', ') : '',
      s && s.bpm ? `${s.bpm} bpm${s.bpmFuente === 'sugerido' ? ' (sug.)' : ''}` : '',
      s && (s.patches || []).length ? '🎹 ' + s.patches.join(' ') : '',
    ].filter(Boolean).join('   ');
    if (extra) partes.push(run(`   ${extra}`, { tam: 9, color: '444444' }));
    if (s && s.cifraUrl) partes.push(run('   ', { tam: 8 }), linkRun('cifra', s.cifraUrl));
    return partes.join('');
  };

  const parrafoTema = (contenido, sangria = 0) =>
    `<w:p><w:pPr>${sangria ? `<w:ind w:left="${Math.round(sangria * 567)}"/>` : ''}` +
    `<w:spacing w:before="60"/></w:pPr>${contenido}</w:p>`;

  for (const it of jam.items || []) {
    if (it.tipo === 'bloque') {
      cuerpo.push(p(it.label || '', { tam: 11, negrita: true, mayus: true, espacioAntes: 14, borde: true }));
      continue;
    }
    if (it.tipo === 'break') {
      cuerpo.push(p(`——  ${it.label || 'BREAK'}${it.minutos ? `  ${it.minutos}'` : ''}  ——`,
        { tam: 11, negrita: true, centrado: true, espacioAntes: 10, color: '888888' }));
      continue;
    }
    if (it.tipo === 'medley') {
      n++;
      cuerpo.push(p(`${n}.  MEDLEY — ${it.titulo || ''}`, { tam: 12, negrita: true, espacioAntes: 8, color: 'B5306B' }));
      (it.songs || []).forEach(ms =>
        cuerpo.push(parrafoTema(run('·  ', { tam: 11, color: '888888' }) + runsTema(song(ms.songId), ms.cantantes), 1)));
      continue;
    }
    n++;
    cuerpo.push(parrafoTema(run(`${n}.  `, { tam: 11, color: '888888' }) + runsTema(song(it.songId), it.cantantes)));
  }

  cuerpo.push(p('', { tam: 8 }));
  cuerpo.push(p(sello, { tam: 8, color: '999999' }));

  const documento =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>${cuerpo.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>
<w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000"/></w:sectPr></w:body></w:document>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${links.map(l => `<Relationship Id="${l.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(l.url)}" TargetMode="External"/>`).join('')}
</Relationships>`;

  return zip([
    {
      name: '[Content_Types].xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    { name: 'word/document.xml', text: documento },
    { name: 'word/_rels/document.xml.rels', text: rels },
  ]);
}
