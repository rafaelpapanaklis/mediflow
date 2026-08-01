/**
 * Tests unitarios de la DISPONIBILIDAD del manager de cuenta.
 *
 * Run: npm run test:account-manager
 *
 * Qué protege (la tarjeta de Soporte le PROMETE algo al cliente):
 *  - El chip "EN LÍNEA" es una promesa de respuesta inmediata. Si se enciende
 *    fuera de horario, la clínica escribe y nadie contesta.
 *  - Los BORDES son el caso real de todos los días: a las 9:00 en punto ya
 *    atiende (inclusivo); a las 18:00 en punto ya no (exclusivo). Un `<=` mal
 *    puesto en el cierre deja el chip verde una hora de más cada tarde.
 *  - Un manager PAUSADO no puede salir en línea jamás, tenga el horario que
 *    tenga: pausar es justamente cómo se le quita de circulación.
 *  - El horario se evalúa en la TIMEZONE DEL MANAGER, no en la del servidor
 *    (Vercel corre en UTC) ni en la del visitante. En UTC, las 9:00 de Mérida
 *    son las 15:00: sin la conversión el chip estaría 6 horas corrido.
 *  - El texto de fuera de horario tiene que cruzar el FIN DE SEMANA: un viernes
 *    a las 18:01 "te responde mañana" es mentira — es el lunes.
 *
 * Zona horaria de referencia: America/Mexico_City = UTC-6 todo el año (México
 * abolió el horario de verano en 2022), así que los instantes UTC de abajo son
 * estables. Los de America/Tijuana (que SÍ tiene DST) sólo se usan para
 * comprobar que la tz del manager manda, en una fecha de agosto (UTC-7).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatDays,
  formatMinutes,
  formatSchedule,
  isOnline,
  nextAvailableText,
} from "@/lib/account-manager/availability";
import type { AccountManagerSchedule } from "@/lib/account-manager/types";

// Rafael P.: Lun–Vie 9:00–18:00, Mérida (America/Mexico_City = UTC-6).
const RAFAEL: AccountManagerSchedule = {
  days: [1, 2, 3, 4, 5],
  startMinutes: 540,  // 9:00
  endMinutes: 1080,   // 18:00
  timezone: "America/Mexico_City",
  status: "active",
};

const at = (iso: string) => new Date(iso);

// ── isOnline: dentro / fuera ───────────────────────────────────────────────

test("isOnline: lunes al mediodía está en línea", () => {
  // 2026-08-03T18:00Z = lunes 12:00 en México.
  assert.equal(isOnline(RAFAEL, at("2026-08-03T18:00:00Z")), true);
});

test("isOnline: lunes antes de abrir NO está en línea", () => {
  // 08:59 — un minuto antes de la apertura.
  assert.equal(isOnline(RAFAEL, at("2026-08-03T14:59:00Z")), false);
});

test("isOnline: lunes después de cerrar NO está en línea", () => {
  // 18:01.
  assert.equal(isOnline(RAFAEL, at("2026-08-04T00:01:00Z")), false);
});

// ── isOnline: bordes exactos ───────────────────────────────────────────────

test("isOnline: las 9:00 EN PUNTO ya cuenta como en línea (apertura inclusiva)", () => {
  assert.equal(isOnline(RAFAEL, at("2026-08-03T15:00:00Z")), true);
});

test("isOnline: las 18:00 EN PUNTO ya NO cuenta (cierre exclusivo)", () => {
  assert.equal(isOnline(RAFAEL, at("2026-08-04T00:00:00Z")), false);
});

// ── isOnline: día no hábil ─────────────────────────────────────────────────

test("isOnline: sábado en horario de oficina NO está en línea (día no hábil)", () => {
  // 2026-08-08T18:00Z = sábado 12:00 en México: la hora encaja, el día no.
  assert.equal(isOnline(RAFAEL, at("2026-08-08T18:00:00Z")), false);
});

test("isOnline: domingo tampoco", () => {
  // 2026-08-09T18:00Z = domingo 12:00.
  assert.equal(isOnline(RAFAEL, at("2026-08-09T18:00:00Z")), false);
});

test("isOnline: un manager de fin de semana SÍ está en línea el sábado", () => {
  const finde: AccountManagerSchedule = { ...RAFAEL, days: [0, 6], startMinutes: 600, endMinutes: 840 };
  assert.equal(isOnline(finde, at("2026-08-08T18:00:00Z")), true);  // sábado 12:00
  assert.equal(isOnline(finde, at("2026-08-03T18:00:00Z")), false); // lunes 12:00
});

// ── isOnline: manager pausado ──────────────────────────────────────────────

test("isOnline: un manager PAUSADO nunca está en línea, aunque sea su horario", () => {
  const pausado: AccountManagerSchedule = { ...RAFAEL, status: "paused" };
  assert.equal(isOnline(pausado, at("2026-08-03T18:00:00Z")), false);
});

// ── isOnline: la timezone que manda es la del MANAGER ──────────────────────

test("isOnline: se evalúa en la tz del manager, no en UTC", () => {
  // Mismo instante: 15:00 UTC. En México son las 9:00 (abre); en Tijuana
  // (UTC-7 en agosto) son las 8:00 (aún cerrado).
  const instante = at("2026-08-03T15:00:00Z");
  assert.equal(isOnline(RAFAEL, instante), true);
  assert.equal(isOnline({ ...RAFAEL, timezone: "America/Tijuana" }, instante), false);
  // Una hora después Tijuana sí abre.
  assert.equal(isOnline({ ...RAFAEL, timezone: "America/Tijuana" }, at("2026-08-03T16:00:00Z")), true);
});

test("isOnline: medianoche local no se lee como las 24:00", () => {
  // Intl con hour12:false devuelve "24" para la medianoche en algunos runtimes.
  // 2026-08-06T06:15Z = jueves 00:15 en México → fuera de horario, no dentro.
  assert.equal(isOnline(RAFAEL, at("2026-08-06T06:15:00Z")), false);
});

// ── isOnline: configuraciones degeneradas ──────────────────────────────────

test("isOnline: sin días configurados nunca está en línea", () => {
  assert.equal(isOnline({ ...RAFAEL, days: [] }, at("2026-08-03T18:00:00Z")), false);
});

test("isOnline: una ventana vacía o invertida nunca está en línea", () => {
  assert.equal(isOnline({ ...RAFAEL, startMinutes: 600, endMinutes: 600 }, at("2026-08-03T18:00:00Z")), false);
  assert.equal(isOnline({ ...RAFAEL, startMinutes: 1080, endMinutes: 540 }, at("2026-08-03T18:00:00Z")), false);
});

// ── nextAvailableText ──────────────────────────────────────────────────────

test("nextAvailableText: tras cerrar un lunes, responde mañana", () => {
  assert.equal(nextAvailableText(RAFAEL, at("2026-08-04T00:00:00Z")), "te responde mañana a las 9:00");
});

test("nextAvailableText: antes de abrir un día hábil, responde HOY", () => {
  assert.equal(nextAvailableText(RAFAEL, at("2026-08-03T14:59:00Z")), "te responde hoy a las 9:00");
});

test("nextAvailableText: viernes al cerrar cruza el fin de semana → el lunes", () => {
  // 2026-08-08T00:00Z = viernes 18:00 en México. "mañana" sería sábado: falso.
  assert.equal(nextAvailableText(RAFAEL, at("2026-08-08T00:00:00Z")), "te responde el lunes a las 9:00");
});

test("nextAvailableText: el sábado también apunta al lunes", () => {
  assert.equal(nextAvailableText(RAFAEL, at("2026-08-08T18:00:00Z")), "te responde el lunes a las 9:00");
});

test("nextAvailableText: el domingo dice mañana (el lunes YA es mañana)", () => {
  assert.equal(nextAvailableText(RAFAEL, at("2026-08-09T18:00:00Z")), "te responde mañana a las 9:00");
});

test("nextAvailableText: respeta la hora de apertura configurada", () => {
  const tarde: AccountManagerSchedule = { ...RAFAEL, startMinutes: 630 }; // 10:30
  assert.equal(nextAvailableText(tarde, at("2026-08-04T00:00:00Z")), "te responde mañana a las 10:30");
});

test("nextAvailableText: un manager pausado no promete nada", () => {
  assert.equal(nextAvailableText({ ...RAFAEL, status: "paused" }, at("2026-08-08T18:00:00Z")), "");
});

test("nextAvailableText: sin días configurados no promete nada", () => {
  assert.equal(nextAvailableText({ ...RAFAEL, days: [] }, at("2026-08-08T18:00:00Z")), "");
});

// ── Formateo ───────────────────────────────────────────────────────────────

test("formatMinutes: sin cero a la izquierda en la hora", () => {
  assert.equal(formatMinutes(540), "9:00");
  assert.equal(formatMinutes(1080), "18:00");
  assert.equal(formatMinutes(630), "10:30");
  assert.equal(formatMinutes(0), "0:00");
});

test("formatDays: colapsa los consecutivos y enumera los sueltos", () => {
  assert.equal(formatDays([1, 2, 3, 4, 5]), "Lun–Vie");
  assert.equal(formatDays([0, 6]), "Dom, Sáb");
  assert.equal(formatDays([1, 3, 5]), "Lun, Mié, Vie");
  assert.equal(formatDays([0, 1, 2, 3, 4, 5, 6]), "Todos los días");
});

test("formatDays: ignora valores fuera de rango y duplicados", () => {
  assert.equal(formatDays([1, 1, 2, 9, -3, 3, 4, 5]), "Lun–Vie");
});

test("formatSchedule: la línea completa de la tarjeta", () => {
  assert.equal(formatSchedule(RAFAEL), "Lun–Vie · 9:00–18:00");
});

// ── i18n: el panel soporta es/en (clinic.locale) ───────────────────────────

test("los textos siguen el locale; 'es' es el default", () => {
  assert.equal(formatDays([1, 2, 3, 4, 5], "en"), "Mon–Fri");
  assert.equal(formatSchedule(RAFAEL, "en"), "Mon–Fri · 9:00–18:00");
  assert.equal(nextAvailableText(RAFAEL, at("2026-08-04T00:00:00Z"), "en"), "replies tomorrow at 9:00");
  assert.equal(nextAvailableText(RAFAEL, at("2026-08-08T00:00:00Z"), "en"), "replies on Monday at 9:00");
  // Un locale desconocido cae a español, nunca a la llave cruda.
  assert.equal(formatSchedule(RAFAEL, "pt"), "Lun–Vie · 9:00–18:00");
});
