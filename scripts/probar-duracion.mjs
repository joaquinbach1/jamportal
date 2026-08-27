/* ============================================================
   probar-duracion.mjs — la cuenta del horario de la jam
   ------------------------------------------------------------
   duracion.js es matemática pura, sin DOM ni base, así que se
   prueba de una:   node scripts/probar-duracion.mjs

   Lo que más importa acá es el respiro del 20%: va ENTRE tema y
   tema, no después del último. Con 30 temas, equivocarse en eso
   son cuatro minutos de más en la hora de cierre.
   ============================================================ */

import { agenda, duracionLinda, largoLindo, horaMas, segundosDeTema } from '../js/duracion.js';

let ok = 0, mal = 0;
const eq = (a, b, m) => { if (JSON.stringify(a) === JSON.stringify(b)) { ok++; console.log('  ✓', m); }
                          else { mal++; console.log('  ✗', m, '→', JSON.stringify(a), '≠', JSON.stringify(b)); } };

const S = { a: { id:'a', titulo:'A', duracionSec: 300 },   // 5:00
            b: { id:'b', titulo:'B', duracionSec: 180 },   // 3:00
            c: { id:'c', titulo:'C' } };                   // sin dato → 4:00
const song = id => S[id];

eq(duracionLinda(229), '3:49', 'duracionLinda 3:49');
eq(duracionLinda(3920), '1:05:20', 'duracionLinda pasa la hora');
eq(largoLindo(12900), '3h 35m', 'largoLindo');
eq(largoLindo(1800), '30m', 'largoLindo corto');
eq(horaMas('22:00', 3600), '23:00', 'horaMas');
eq(horaMas('23:30', 3600 * 2), '01:30', 'horaMas cruza medianoche');
eq(horaMas('', 60), '', 'horaMas sin hora');
eq(segundosDeTema(S.a), 300, 'tema con dato');
eq(segundosDeTema(S.c), 240, 'tema sin dato = 4 min');
eq(segundosDeTema(S.a, true), 150, 'en medley, la mitad');

// dos temas: 300 (+20% = 360) + 180 (sin respiro, es el último) = 540
let p = agenda({ hora: '22:00', items: [{tipo:'song', songId:'a'}, {tipo:'song', songId:'b'}] }, song);
eq(p.total, 540, 'el respiro va entre temas, no después del último');
eq(p.fin, '22:09', 'hora de fin');
eq(p.temas, 2, 'cuenta los temas');
eq(p.sinDato, 0, 'todos con duración');

// un solo tema: sin respiro
eq(agenda({ items: [{tipo:'song', songId:'b'}] }, song).total, 180, 'un tema solo no lleva respiro');

// con break: 300+60(respiro) | break 900 | 180 = 1440
p = agenda({ hora: '22:00', items: [
  {tipo:'song', songId:'a'}, {tipo:'break', label:'BREAK', minutos:15}, {tipo:'song', songId:'b'}] }, song);
eq(p.total, 1440, 'el break suma sus minutos');
eq(p.breaks, 900, 'segundos de break');
eq(p.filas[1].hora, '22:06', 'el break arranca después del respiro del tema anterior');
eq(p.filas[2].hora, '22:21', 'el tema de después del break');

// medley de dos: 150 + 90 = 240, y como es el último no lleva respiro
p = agenda({ items: [{tipo:'medley', titulo:'M', songs:[{songId:'a'},{songId:'b'}]}] }, song);
eq(p.total, 240, 'medley: los temas van por la mitad');
eq(p.filas[0].songs.length, 2, 'el medley conserva sus temas');
eq(p.temas, 2, 'los temas del medley cuentan');

// tema sin dato
p = agenda({ items: [{tipo:'song', songId:'c'}] }, song);
eq(p.sinDato, 1, 'marca los que estimó');

// bloque: no ocupa tiempo ni corta el respiro
p = agenda({ items: [{tipo:'song', songId:'a'}, {tipo:'bloque', label:'ROCK'}, {tipo:'song', songId:'b'}] }, song);
eq(p.total, 540, 'un bloque no suma tiempo');

// lista vacía
eq(agenda({ items: [] }, song).total, 0, 'lista vacía');
eq(agenda({}, song).filas.length, 0, 'jam sin items');

console.log(`\n${mal ? '✗' : '✓'} ${ok} ok, ${mal} mal`);
process.exit(mal ? 1 : 0);
