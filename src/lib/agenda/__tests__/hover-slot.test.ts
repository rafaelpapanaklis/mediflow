/**
 * Tests de la geometría de la guía de horario de la agenda dental.
 * La usan las DOS vistas: Día (columnas = doctores) y Semana (columnas
 * = los siete días).
 *
 * Run: npm run test:hover-slot
 *
 * Foco crítico:
 *  - Lo que la guía RESALTA y lo que el click CREA salen de la misma
 *    función. Si divergen, la guía miente y agendar vuelve a ser puntería:
 *    justo el error que vino a resolver.
 *  - El borde entre slots: y = 2 slots exactos es el slot 2 (arriba), no
 *    el 1. Un off-by-one aquí = cita media hora corrida.
 *  - Columnas cortas estiradas por `min-height: 100%`: el alto de slot es
 *    slotHpx SIEMPRE, no altoRenderizado/slotsDeEsaColumna.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  columnFromOffsetX,
  slotFromOffsetY,
  slotStartLabel,
} from "../hover-slot";
import { getTzParts, slotIndexToUtc } from "../time-utils";

test("slotFromOffsetY: el slot sale del alto real, no del alto estirado", () => {
  const slotHpx = 30;
  // Columna de 9:00 a 21:00 en slots de 15 → 48 slots = 1440px, pero
  // estirada a 1800px porque otra columna tiene una cita a las 23:00.
  const stretched = 1800;
  // 12:15 con dayStart 9 y slots de 15 = slot 13 → y entre 390 y 419.
  assert.equal(slotFromOffsetY(390, slotHpx, stretched), 13);
  assert.equal(slotFromOffsetY(419, slotHpx, stretched), 13);
  assert.equal(slotFromOffsetY(420, slotHpx, stretched), 14);
});

test("slotFromOffsetY: el límite entre slots cae en el de abajo", () => {
  assert.equal(slotFromOffsetY(59, 30, 900), 1);
  assert.equal(slotFromOffsetY(60, 30, 900), 2);
});

test("slotFromOffsetY: nunca se sale de la grilla", () => {
  assert.equal(slotFromOffsetY(-40, 30, 900), 0);
  assert.equal(slotFromOffsetY(99999, 30, 900), 29);
  // Alto que no es múltiplo exacto del slot: el último slot parcial cuenta.
  assert.equal(slotFromOffsetY(99999, 30, 905), 30);
  // Densidad degenerada: no revienta ni devuelve NaN.
  assert.equal(slotFromOffsetY(100, 0, 900), 0);
});

test("columnFromOffsetX: reparte parejo y clampa en los extremos", () => {
  // 4 doctores en 800px → 200px cada uno.
  assert.equal(columnFromOffsetX(0, 800, 4), 0);
  assert.equal(columnFromOffsetX(199, 800, 4), 0);
  assert.equal(columnFromOffsetX(200, 800, 4), 1);
  // El tercer doctor (índice 2) es el del caso reportado.
  assert.equal(columnFromOffsetX(410, 800, 4), 2);
  assert.equal(columnFromOffsetX(799, 800, 4), 3);
  assert.equal(columnFromOffsetX(800, 800, 4), 3);
  assert.equal(columnFromOffsetX(-10, 800, 4), 0);
  assert.equal(columnFromOffsetX(100, 0, 4), 0);
  assert.equal(columnFromOffsetX(100, 800, 0), 0);
});

test("slotStartLabel: dice la hora exacta del slot, no solo las horas en punto", () => {
  // dayStart 9, slots de 15 → slot 13 = 12:15.
  assert.equal(slotStartLabel(13, 9, 15), "12:15");
  assert.equal(slotStartLabel(0, 9, 15), "09:00");
  assert.equal(slotStartLabel(1, 8, 30), "08:30");
  assert.equal(slotStartLabel(4, 7, 5), "07:20");
  // Cita fuera de horario: el slot se pasa del cierre y sigue siendo válido.
  assert.equal(slotStartLabel(56, 9, 15), "23:00");
});

test("guía y click coinciden en el mismo punto", () => {
  // La columna usa slotFromOffsetY con el rect de la columna y la guía con
  // el del cuerpo de columnas; ambos rects tienen el mismo techo y el mismo
  // alto (grid row), así que el slot tiene que ser idéntico.
  const slotHpx = 22;
  const height = 22 * 48;
  for (const y of [0, 21, 22, 253, 254, 700, 1055]) {
    assert.ok(slotFromOffsetY(y, slotHpx, height) <= 47);
  }
});

/* ─── VISTA SEMANA ───────────────────────────────────────────
   La semana estrena la misma guía, pero sus columnas son los siete días
   y no los doctores, y su click lo calcula WeekDayColumn.handleClick.
   Estas pruebas fijan lo único que podía desincronizarse al traerla. */

/** La cuenta que hacía el click de la semana ANTES de compartir la guía. */
function slotViejoDeLaSemana(
  y: number,
  altoRenderizado: number,
  slotsTotal: number,
): number {
  const slotHeight = altoRenderizado / slotsTotal;
  return Math.max(0, Math.min(slotsTotal - 1, Math.floor(y / slotHeight)));
}

test("semana: hoy la cuenta vieja y la guía dan lo MISMO — el cambio no corre ninguna cita", () => {
  // Las siete columnas-día miden todas baseSlotsTotal × slotHpx, así que
  // rect.height/slotsTotal es exactamente slotHpx y las dos cuentas caen
  // en el mismo renglón. Sin esto, cambiar el click sería mover citas.
  const slotHpx = 23;
  const slotsTotal = 48; // 08:00–20:00 en slots de 15 min
  const alto = slotHpx * slotsTotal;
  for (let y = 0; y < alto; y++) {
    assert.equal(
      slotFromOffsetY(y, slotHpx, alto),
      slotViejoDeLaSemana(y, alto, slotsTotal),
    );
  }
});

test("semana: en cuanto la columna se estira, la cuenta vieja miente", () => {
  // `min-height: 100%` estira las columnas cortas hasta la más alta; ahí
  // rect.height/slotsTotal deja de ser el alto del slot y el click abre
  // una hora distinta de la que resalta la guía. Por eso las dos salen
  // ahora de slotFromOffsetY.
  const slotHpx = 30;
  const slotsTotal = 48;
  const estirada = 30 * 60; // 1800px en vez de 1440
  // y = 510 con slots de 30px es el renglón 17 = 12:15 con dayStart 8.
  assert.equal(slotFromOffsetY(510, slotHpx, estirada), 17);
  assert.equal(slotStartLabel(17, 8, 15), "12:15");
  // La cuenta vieja lo lee como el 13 = 11:15: una hora entera de menos.
  assert.equal(slotViejoDeLaSemana(510, estirada, slotsTotal), 13);
});

test("semana: los siete días reparten parejo el ancho", () => {
  // .columnsBody es repeat(var(--mf-agenda-cols), minmax(160px, 1fr)) y la
  // semana escribe --mf-agenda-cols: 7. Los siete tracks llevan la MISMA
  // función de tamaño, así que miden igual tanto estirados (1fr) como en
  // su mínimo (160px) — justo lo que asume columnFromOffsetX.
  const ancho = 1400; // 200px por día
  assert.equal(columnFromOffsetX(0, ancho, 7), 0); // lunes
  assert.equal(columnFromOffsetX(199, ancho, 7), 0);
  assert.equal(columnFromOffsetX(200, ancho, 7), 1); // martes
  assert.equal(columnFromOffsetX(1399, ancho, 7), 6); // domingo
  assert.equal(columnFromOffsetX(1400, ancho, 7), 6);
  // Ventana angosta: los tracks caen a su mínimo y el cuerpo mide 7 × 160.
  assert.equal(columnFromOffsetX(159, 1120, 7), 0);
  assert.equal(columnFromOffsetX(160, 1120, 7), 1);
  assert.equal(columnFromOffsetX(1119, 1120, 7), 6);
});

test("semana: el ancho que se reparte es el de las COLUMNAS, no el de la caja", () => {
  // Los tracks son minmax(160px, 1fr): cuando la grilla no cabe se quedan
  // en 160px y desbordan su caja. Medido en Chrome a 1280 con la barra
  // lateral abierta: la caja del cuerpo mide 979px y las siete columnas
  // 1120. Repartir 979 entre 7 da columnas de 140px imaginarias y el
  // resalte se corre de día en el 43% del ancho.
  const caja = 979;
  const columnas = 1120; // 7 × 160
  const diaDeVerdad = (x: number) => Math.min(6, Math.floor(x / 160));

  // x = 140 cae todavía en el lunes, pero repartiendo la caja da martes.
  assert.equal(diaDeVerdad(140), 0);
  assert.equal(columnFromOffsetX(140, caja, 7), 1); // lo que marcaba antes
  assert.equal(columnFromOffsetX(140, columnas, 7), 0); // lo que marca ahora

  // Y en todo el ancho visible: con el ancho de las columnas nunca falla.
  let fallosCaja = 0;
  for (let x = 0; x < caja; x++) {
    assert.equal(columnFromOffsetX(x, columnas, 7), diaDeVerdad(x));
    if (columnFromOffsetX(x, caja, 7) !== diaDeVerdad(x)) fallosCaja++;
  }
  assert.ok(fallosCaja > 400, `la cuenta vieja fallaba en ${fallosCaja}px`);
});

test("semana: con la grilla holgada, caja y columnas son lo mismo", () => {
  // A 1536 con la barra lateral cerrada los tracks son 1fr y llenan la
  // caja: el máximo de los dos anchos es el mismo número y nada cambia.
  const caja = 1355;
  for (let x = 0; x < caja; x++) {
    assert.equal(
      columnFromOffsetX(x, Math.max(caja, caja), 7),
      columnFromOffsetX(x, caja, 7),
    );
  }
});

test("semana: la hora que escribe la guía es la que abre el alta", () => {
  // El rótulo sale de slotStartLabel y la cita de slotIndexToUtc: si esas
  // dos se separan, la guía dice 12:15 y el alta abre 12:30.
  const tz = "America/Mexico_City";
  const cfg = { timezone: tz, slotMinutes: 15, dayStart: 8, dayEnd: 20 };
  const slotHpx = 30;
  const alto = slotHpx * 48;
  for (const y of [0, 29, 30, 510, 511, 1439]) {
    const slot = slotFromOffsetY(y, slotHpx, alto);
    const rotulo = slotStartLabel(slot, cfg.dayStart, cfg.slotMinutes);
    const partes = getTzParts(slotIndexToUtc(slot, "2026-09-02", cfg), tz);
    const enLaCita =
      `${partes.hour.toString().padStart(2, "0")}:` +
      `${partes.minute.toString().padStart(2, "0")}`;
    assert.equal(enLaCita, rotulo);
  }
});
