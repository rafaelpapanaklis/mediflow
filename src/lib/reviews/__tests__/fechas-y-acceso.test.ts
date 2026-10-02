/**
 * RESEÑAS: FECHAS Y «SIN ACCESO» — ws1-t4 (fallos 7 y 8 de la revisión de ws1-t2).
 *
 * Run: npm run test:resenas-fechas-acceso
 *
 * - «Octubre De 2026»: era `text-transform: capitalize` sobre «octubre de 2026». Ahora la fecha sale ya con solo
 *   la primera letra en mayúscula y ninguna de las pantallas de reseñas usa `capitalize` sobre ella.
 * - «Invitaciones enviadas» (últimos 30 días) muestra el día: «2 de octubre de 2026».
 * - Un usuario sin permiso (/api/reviews responde 403) ve «No tienes acceso…», no «No pudimos cargar tus reseñas».
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatInvitationDate, formatReviewDate } from "../types";

const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("formatReviewDate: «Octubre de 2026», sin «De» en mayúscula", () => {
  assert.equal(formatReviewDate("2026-10-15T12:00:00Z"), "Octubre de 2026");
  assert.equal(formatReviewDate("no es fecha"), "");
});

test("formatInvitationDate: lleva el día, en minúsculas", () => {
  assert.equal(formatInvitationDate("2026-10-02T18:00:00Z"), "2 de octubre de 2026");
  assert.equal(formatInvitationDate("no es fecha"), "");
});

test("formatInvitationDate sigue el idioma de la interfaz: en inglés, «October 2, 2026»", () => {
  assert.equal(formatInvitationDate("2026-10-02T18:00:00Z", "en"), "October 2, 2026");
  assert.equal(formatInvitationDate("2026-10-02T18:00:00Z", "en-US"), "October 2, 2026");
  assert.equal(formatInvitationDate("2026-10-02T18:00:00Z", "es"), "2 de octubre de 2026");
  assert.equal(formatInvitationDate("2026-10-02T18:00:00Z", "es-MX"), "2 de octubre de 2026");
  assert.equal(formatInvitationDate("no es fecha", "en"), "");
});

test("ninguna pantalla de reseñas pone `capitalize` sobre la fecha, y Invitaciones usa la fecha con día", () => {
  const inv = leer("src/app/dashboard/resenas/invitaciones.tsx");
  assert.ok(!/capitalize/.test(inv));
  assert.equal((inv.match(/formatInvitationDate\(i\.createdAt, locale\)/g) ?? []).length, 2);
  assert.ok(!/capitalize/.test(leer("src/app/dashboard/resenas/ResenasClient.tsx")));
  assert.ok(!/capitalize/.test(leer("src/components/dashboard/pequenas-rediseno/resenas.tsx")));
});

test("403 de /api/reviews dice «No tienes acceso», no «No pudimos cargar»", () => {
  const c = leer("src/app/dashboard/resenas/ResenasClient.tsx");
  const i403 = c.indexOf("res.status === 403");
  assert.ok(i403 > 0);
  assert.ok(c.indexOf("No tienes acceso", i403) > i403);
  assert.ok(i403 < c.indexOf("if (!res.ok) throw"), "el 403 se atiende antes del error genérico");
});
