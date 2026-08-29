/**
 * El aviso del contrato institucional (src/lib/edu/contract.ts).
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-contract.test.ts
 *
 * Lo que fija:
 *  - que AVISA y nada más (nunca devuelve algo que se pueda leer como "corta");
 *  - que el contrato vale durante TODO su último día;
 *  - que la fecha se pinta en UTC: guardada a medianoche y formateada en
 *    America/Tijuana, el 31 de diciembre se leería "30 de diciembre".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDU_CONTRACT_WARN_DAYS,
  eduContractNotice,
  eduContractNoticeIsFor,
  formatEduContractDate,
} from "../contract";

const DIA = 24 * 60 * 60 * 1000;
const AHORA = new Date("2026-08-28T18:00:00.000Z");
const activo = { isActive: true, contractStartsAt: null as Date | null, contractEndsAt: null as Date | null };

test("sin fechas y activo: no hay nada que avisar", () => {
  assert.equal(eduContractNotice({ ...activo }, AHORA), null);
});

test("contrato holgado: tampoco avisa", () => {
  const fin = new Date(AHORA.getTime() + (EDU_CONTRACT_WARN_DAYS + 5) * DIA);
  assert.equal(eduContractNotice({ ...activo, contractEndsAt: fin }, AHORA), null);
});

test("por vencer: avisa sin cortar", () => {
  const fin = new Date(AHORA.getTime() + 5 * DIA);
  const aviso = eduContractNotice({ ...activo, contractEndsAt: fin }, AHORA);
  assert.equal(aviso?.level, "ending-soon");
  assert.ok(aviso!.days > 0 && aviso!.days <= EDU_CONTRACT_WARN_DAYS);
  assert.match(aviso!.detail, /no se cierra/i);
});

test("el contrato vale TODO su último día: la mañana del vencimiento aún no está vencido", () => {
  const fin = new Date("2026-08-28T00:00:00.000Z"); // vence hoy
  const aviso = eduContractNotice({ ...activo, contractEndsAt: fin }, AHORA);
  assert.equal(aviso?.level, "ending-soon", "marcarlo vencido el mismo día es adelantarse un día entero");
  assert.equal(aviso?.title, "El contrato vence hoy");
});

test("vencido: avisa, dice que nadie se queda fuera, y nunca devuelve un corte", () => {
  const fin = new Date("2026-06-30T00:00:00.000Z");
  const aviso = eduContractNotice({ ...activo, contractEndsAt: fin }, AHORA);
  assert.equal(aviso?.level, "expired");
  assert.match(aviso!.title, /30 de junio de 2026/);
  assert.match(aviso!.detail, /panel sigue abierto/i);
  // El contrato solo produce texto: si algún día alguien le agrega un
  // "blocked: true" para cortar el paso, este test se entera.
  assert.deepEqual(Object.keys(aviso!).sort(), ["days", "detail", "level", "title"]);
});

test("instituto inactivo: se avisa, no se echa a nadie", () => {
  const aviso = eduContractNotice({ ...activo, isActive: false }, AHORA);
  assert.equal(aviso?.level, "inactive");
  assert.match(aviso!.detail, /sigue funcionando/i);
});

test("contrato que aún no empieza: se avisa y se deja entrar igual", () => {
  const inicio = new Date(AHORA.getTime() + 10 * DIA);
  const aviso = eduContractNotice({ ...activo, contractStartsAt: inicio }, AHORA);
  assert.equal(aviso?.level, "not-started");
  assert.match(aviso!.detail, /desde hoy/i);
});

test("la fecha se pinta en UTC: el 31 de diciembre no se lee 30 de diciembre", () => {
  assert.equal(formatEduContractDate(new Date("2026-12-31T00:00:00.000Z")), "31 de diciembre de 2026");
  assert.equal(formatEduContractDate(null), "—");
  assert.equal(formatEduContractDate("no es una fecha"), "—");
});

test("el banner es para quien administra el contrato, no para el residente", () => {
  assert.equal(eduContractNoticeIsFor("DIRECCION"), true);
  assert.equal(eduContractNoticeIsFor("ALUMNO"), false);
  assert.equal(eduContractNoticeIsFor("DOCENTE"), false);
  assert.equal(eduContractNoticeIsFor("CAJA"), false);
});
